import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { env } from "../config/env.js";
import type { PlatformRepository } from "../repositories/platform-repository.js";
import type { SessionState, SiteAccount, SiteDefinition, SourceRecipe } from "../types.js";

export class SessionManager {
  constructor(private readonly repository: PlatformRepository) {}

  async ensureAuthenticated(
    site: SiteDefinition,
    account: SiteAccount | null,
    recipe: SourceRecipe,
  ): Promise<SessionState | undefined> {
    if (!account || account.authMode === "none") {
      return undefined;
    }

    const current = await this.repository.getSessionByAccountId(account.id);
    if (current?.status === "authenticated") {
      return current;
    }

    return this.reauthenticate(site, account, recipe);
  }

  async reauthenticate(site: SiteDefinition, account: SiteAccount, recipe: SourceRecipe): Promise<SessionState> {
    if (!recipe.login) {
      return this.repository.upsertSession({
        accountId: account.id,
        status: "authenticated",
        state: {},
      });
    }

    const credentials = account.credentials;
    const username = String(credentials.username ?? "");
    const password = String(credentials.password ?? "");
    const otpCode = credentials.otpCode ? String(credentials.otpCode) : undefined;
    if (!username && !password && account.authMode !== "none") {
      throw new Error(`Missing credentials for account ${account.id}`);
    }

    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      const login = recipe.login;

      await page.goto(login.loginUrl ?? recipe.entryUrl ?? site.baseUrl, {
        waitUntil: "domcontentloaded",
      });

      if (login.usernameSelector && username) {
        await page.locator(login.usernameSelector).first().fill(username);
      }
      if (login.passwordSelector && password) {
        await page.locator(login.passwordSelector).first().fill(password);
      }
      if (login.submitSelector) {
        await page.locator(login.submitSelector).first().click();
      }
      if (login.otpSelector) {
        if (!otpCode) {
          return this.repository.upsertSession({
            accountId: account.id,
            status: "challenge_required",
            state: {},
          });
        }

        await page.locator(login.otpSelector).first().fill(otpCode);
        if (login.submitSelector) {
          await page.locator(login.submitSelector).first().click();
        }
      }

      if (login.successSelector) {
        await page.waitForSelector(login.successSelector);
      } else if (login.successUrlContains) {
        const successUrlContains = login.successUrlContains;
        await page.waitForURL((url) => url.toString().includes(successUrlContains));
      }

      const storageState = await context.storageState();
      const stateDir = path.resolve(env.PLAYWRIGHT_STATE_DIR);
      await mkdir(stateDir, {
        recursive: true,
      });
      const storageStatePath = path.join(stateDir, `${account.id}.json`);
      await writeFile(storageStatePath, JSON.stringify(storageState, null, 2));

      return this.repository.upsertSession({
        accountId: account.id,
        status: "authenticated",
        state: storageState as Record<string, unknown>,
        storageStatePath,
        lastAuthenticatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.upsertSession({
        accountId: account.id,
        status: "error",
        state: {
          message: error instanceof Error ? error.message : "Unknown authentication error",
        },
      });
      throw error;
    } finally {
      await browser.close();
    }
  }
}
