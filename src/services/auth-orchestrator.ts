import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ImapFlow } from "imapflow";
import { chromium, type BrowserContext, type Page } from "playwright";

import { env } from "../config/env.js";
import { generateTotpCode } from "../lib/totp.js";
import type { CrawlAuthInput, SessionState, SiteAccount, SiteDefinition, SourceRecipe } from "../types.js";

interface SessionStore {
  getSessionByAccountId(accountId: string): Promise<SessionState | null>;
  upsertSession(params: {
    accountId: string;
    status: SessionState["status"];
    state: Record<string, unknown>;
    storageStatePath?: string;
    lastAuthenticatedAt?: string;
    expiresAt?: string;
  }): Promise<SessionState>;
}

export interface AuthChallengeEvent {
  type: "oauth" | "otp" | "captcha";
  status: "succeeded" | "failed" | "needs_review";
  detail: Record<string, unknown>;
}

export interface AuthExecutionResult {
  status: "succeeded" | "needs_review" | "failed" | "skipped";
  session?: SessionState;
  reviewReason?: string;
  events: AuthChallengeEvent[];
}

interface CaptchaTaskResult {
  token: string;
  provider: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toRegExp(value: string): RegExp {
  return new RegExp(value, "i");
}

function getByPath(payload: unknown, pathValue: string): unknown {
  return pathValue
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current && typeof current === "object" && part in current) {
        return (current as Record<string, unknown>)[part];
      }
      return undefined;
    }, payload);
}

async function safeClick(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }
  await locator.first().click();
  return true;
}

async function fillFirstExisting(page: Page, selectors: string[], value: string): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    await locator.fill(value);
    return selector;
  }
  return null;
}

async function findOtpSelector(page: Page): Promise<string | null> {
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[type="tel"]',
    'input[type="number"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      return selector;
    }
  }

  return null;
}

async function findLoginForm(page: Page): Promise<{
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}> {
  const usernameSelectors = [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[type="text"]',
  ];
  const passwordSelectors = ['input[autocomplete="current-password"]', 'input[name="password"]', 'input[type="password"]'];
  const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button'];

  const usernameSelector = usernameSelectors.find(async (selector) => (await page.locator(selector).count()) > 0);
  const passwordSelector = passwordSelectors.find(async (selector) => (await page.locator(selector).count()) > 0);
  const submitSelector = submitSelectors.find(async (selector) => (await page.locator(selector).count()) > 0);

  return {
    usernameSelector: await fillExistingSelector(page, usernameSelectors),
    passwordSelector: await fillExistingSelector(page, passwordSelectors),
    submitSelector: await fillExistingSelector(page, submitSelectors),
  };
}

async function fillExistingSelector(page: Page, selectors: string[]): Promise<string | undefined> {
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) > 0) {
      return selector;
    }
  }
  return undefined;
}

export class AuthOrchestrator {
  constructor(private readonly store: SessionStore) {}

  async ensureAuthenticated(
    site: SiteDefinition,
    account: SiteAccount | null,
    recipe: SourceRecipe,
    authConfig: CrawlAuthInput,
  ): Promise<AuthExecutionResult> {
    if (!account || authConfig.mode === "none") {
      return {
        status: "skipped",
        events: [],
      };
    }

    const current = await this.store.getSessionByAccountId(account.id);
    if (current?.status === "authenticated") {
      return {
        status: "succeeded",
        session: current,
        events: [],
      };
    }

    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });

    const events: AuthChallengeEvent[] = [];

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);

      const authStrategy = recipe.autoDiscovery?.authStrategy ?? {
        mode: authConfig.mode === "auto" ? "form" : authConfig.mode,
      };

      await page.goto(authStrategy.loginUrl ?? recipe.entryUrl ?? site.baseUrl, {
        waitUntil: "domcontentloaded",
      });

      if (authStrategy.mode === "oauth") {
        const oauthResult = await this.handleOAuth(page, site, account, authStrategy.oauthTriggerTexts ?? [], authConfig, events);
        if (oauthResult !== "ok") {
          return await this.markChallenge(account.id, oauthResult, events);
        }
      } else if (authStrategy.mode === "form" || authConfig.mode === "auto") {
        const formResult = await this.handleFormLogin(page, site, account, authStrategy, authConfig, events);
        if (formResult !== "ok") {
          return await this.markChallenge(account.id, formResult, events);
        }
      }

      const storageState = await context.storageState();
      const stateDir = path.resolve(env.PLAYWRIGHT_STATE_DIR);
      await mkdir(stateDir, {
        recursive: true,
      });
      const storageStatePath = path.join(stateDir, `${account.id}.json`);
      await writeFile(storageStatePath, JSON.stringify(storageState, null, 2));

      const session = await this.store.upsertSession({
        accountId: account.id,
        status: "authenticated",
        state: storageState as Record<string, unknown>,
        storageStatePath,
        lastAuthenticatedAt: new Date().toISOString(),
      });

      return {
        status: "succeeded",
        session,
        events,
      };
    } catch (error) {
      await this.store.upsertSession({
        accountId: account.id,
        status: "error",
        state: {
          message: error instanceof Error ? error.message : "Unknown authentication error",
        },
      });

      return {
        status: "failed",
        reviewReason: error instanceof Error ? error.message : "Unknown authentication error",
        events,
      };
    } finally {
      await browser.close();
    }
  }

  private async markChallenge(
    accountId: string,
    reason: string,
    events: AuthChallengeEvent[],
  ): Promise<AuthExecutionResult> {
    await this.store.upsertSession({
      accountId,
      status: "challenge_required",
      state: {
        reason,
      },
    });

    return {
      status: "needs_review",
      reviewReason: reason,
      events,
    };
  }

  private async handleFormLogin(
    page: Page,
    site: SiteDefinition,
    account: SiteAccount,
    authStrategy: SourceRecipe["autoDiscovery"] extends infer T
      ? T extends { authStrategy: infer A }
        ? A
        : never
      : never,
    authConfig: CrawlAuthInput,
    events: AuthChallengeEvent[],
  ): Promise<"ok" | string> {
    const credentials = account.credentials;
    const username = String(credentials.username ?? credentials.email ?? "");
    const password = String(credentials.password ?? "");

    if (!username && !password) {
      return "Missing username/password credentials for form login.";
    }

    const loginLinkSelectors = [
      'a:has-text("Login")',
      'a:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ];
    if ((await page.locator('input[type="password"]').count()) === 0) {
      for (const selector of loginLinkSelectors) {
        if (await safeClick(page.locator(selector))) {
          await page.waitForLoadState("domcontentloaded");
          break;
        }
      }
    }

    const inferredSelectors = await findLoginForm(page);
    const usernameSelector = authStrategy?.usernameSelector ?? inferredSelectors.usernameSelector;
    const passwordSelector = authStrategy?.passwordSelector ?? inferredSelectors.passwordSelector;
    const submitSelector = authStrategy?.submitSelector ?? inferredSelectors.submitSelector;

    if (!usernameSelector || !passwordSelector) {
      return "Unable to detect username/password fields automatically.";
    }

    await page.locator(usernameSelector).first().fill(username);
    await page.locator(passwordSelector).first().fill(password);

    if (authConfig.captcha) {
      const captcha = await this.resolveCaptcha(page, authConfig.captcha);
      events.push({
        type: "captcha",
        status: captcha ? "succeeded" : "needs_review",
        detail: {
          provider: authConfig.captcha.mode,
          success: Boolean(captcha),
        },
      });
      if (!captcha) {
        return "CAPTCHA challenge detected but could not be solved automatically.";
      }
    }

    if (submitSelector) {
      await page.locator(submitSelector).first().click();
    }

    const otpSelector = authStrategy?.otpSelector ?? (await findOtpSelector(page));
    if (otpSelector) {
      const otpCode = await this.resolveOtp(authConfig);
      if (!otpCode) {
        events.push({
          type: "otp",
          status: "needs_review",
          detail: {
            mode: authConfig.otp?.mode ?? "unknown",
          },
        });
        return "OTP step detected but no OTP code could be resolved.";
      }
      await page.locator(otpSelector).first().fill(otpCode);
      events.push({
        type: "otp",
        status: "succeeded",
        detail: {
          mode: authConfig.otp?.mode ?? "unknown",
        },
      });
      const otpSubmitSelectors = ['#verify-otp', 'button:has-text("Verify")', 'button:has-text("Continue")', 'button[type="submit"]', 'input[type="submit"]'];
      const clickedOtpSubmit = await this.clickFirstExisting(page, otpSubmitSelectors);
      if (!clickedOtpSubmit && submitSelector) {
        await page.locator(submitSelector).first().click();
      }
    }

    const success = await this.waitForSuccess(page, site, authStrategy?.successUrlContains);
    return success ? "ok" : "Form login did not reach an authenticated state.";
  }

  private async handleOAuth(
    page: Page,
    site: SiteDefinition,
    account: SiteAccount,
    oauthTriggerTexts: string[],
    authConfig: CrawlAuthInput,
    events: AuthChallengeEvent[],
  ): Promise<"ok" | string> {
    const triggerCandidates = [
      ...oauthTriggerTexts,
      "Continue with Google",
      "Sign in with Google",
      "Continue with Microsoft",
      "Sign in with Microsoft",
      "SSO",
      "OAuth",
    ];

    let popupPage: Page | null = null;
    for (const text of triggerCandidates) {
      const candidates = [
        page.getByRole("button", { name: toRegExp(text) }),
        page.getByRole("link", { name: toRegExp(text) }),
        page.locator(`text=${text}`),
      ];
      for (const candidate of candidates) {
        if ((await candidate.count()) === 0) {
          continue;
        }
        try {
          const popupPromise = page.context().waitForEvent("page", { timeout: 2_000 }).catch(() => null);
          await candidate.first().click();
          popupPage = await popupPromise;
          break;
        } catch {
          continue;
        }
      }
      if (popupPage || page.url() !== site.baseUrl) {
        break;
      }
    }

    const activePage = popupPage ?? page;
    await activePage.waitForLoadState("domcontentloaded");

    const providerUser = String(account.credentials.oauthUsername ?? account.credentials.username ?? account.credentials.email ?? "");
    const providerPassword = String(account.credentials.oauthPassword ?? account.credentials.password ?? "");
    const usernameFilled = providerUser
      ? await fillFirstExisting(
          activePage,
          ['input[type="email"]', 'input[name="identifier"]', 'input[name="loginfmt"]', 'input[name="username"]'],
          providerUser,
        )
      : null;

    if (usernameFilled) {
      await safeClick(
        activePage
          .getByRole("button", { name: /next|continue|sign in|submit/i })
          .or(activePage.locator('input[type="submit"]')),
      );
    }

    if (providerPassword) {
      await fillFirstExisting(
        activePage,
        ['input[type="password"]', 'input[name="password"]', 'input[autocomplete="current-password"]'],
        providerPassword,
      );
      await safeClick(
        activePage
          .getByRole("button", { name: /next|continue|sign in|submit|approve|allow/i })
          .or(activePage.locator('input[type="submit"]')),
      );
    }

    const otpSelector = await findOtpSelector(activePage);
    if (otpSelector) {
      const otpCode = await this.resolveOtp(authConfig);
      if (!otpCode) {
        events.push({
          type: "otp",
          status: "needs_review",
          detail: {
            mode: authConfig.otp?.mode ?? "unknown",
            phase: "oauth",
          },
        });
        return "OAuth flow requested OTP but no automated resolver returned a code.";
      }
      await activePage.locator(otpSelector).first().fill(otpCode);
      await safeClick(
        activePage
          .getByRole("button", { name: /verify|continue|submit|next/i })
          .or(activePage.locator('input[type="submit"]')),
      );
      events.push({
        type: "otp",
        status: "succeeded",
        detail: {
          mode: authConfig.otp?.mode ?? "unknown",
          phase: "oauth",
        },
      });
    }

    if (authConfig.captcha) {
      const captcha = await this.resolveCaptcha(activePage, authConfig.captcha);
      events.push({
        type: "captcha",
        status: captcha ? "succeeded" : "needs_review",
        detail: {
          provider: authConfig.captcha.mode,
          phase: "oauth",
        },
      });
      if (!captcha) {
        return "OAuth provider CAPTCHA could not be solved automatically.";
      }
    }

    try {
      await page.waitForURL((url) => url.origin === new URL(site.baseUrl).origin, {
        timeout: 15_000,
      });
    } catch {
      if (popupPage) {
        await popupPage.waitForEvent("close", { timeout: 10_000 }).catch(() => undefined);
      }
    }

    events.push({
      type: "oauth",
      status: "succeeded",
      detail: {
        providerPage: activePage.url(),
      },
    });

    return (await this.waitForSuccess(page, site)) ? "ok" : "OAuth flow did not return to an authenticated state.";
  }

  private async waitForSuccess(page: Page, site: SiteDefinition, successUrlContains?: string): Promise<boolean> {
    const successPatterns = [
      async () => page.waitForSelector('[data-authenticated="true"], [data-page="records"], main, article', { timeout: 5_000 }),
      async () =>
        page.waitForURL(
          (url) => {
            if (successUrlContains) {
              return url.toString().includes(successUrlContains);
            }
            return url.origin === new URL(site.baseUrl).origin && !/login|signin/i.test(url.pathname);
          },
          { timeout: 10_000 },
        ),
    ];

    for (const pattern of successPatterns) {
      try {
        await pattern();
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private async resolveOtp(authConfig: CrawlAuthInput): Promise<string | null> {
    if (!authConfig.otp) {
      return null;
    }

    if (authConfig.otp.mode === "totp") {
      const secret = String(authConfig.otp.config.secret ?? "");
      if (!secret) {
        return null;
      }
      return generateTotpCode(secret);
    }

    if (authConfig.otp.mode === "webhook-inbox") {
      const url = String(authConfig.otp.config.url ?? "");
      const timeoutMs = Number(authConfig.otp.config.timeoutMs ?? 120_000);
      const intervalMs = Number(authConfig.otp.config.intervalMs ?? 5_000);
      const codePath = String(authConfig.otp.config.codePath ?? "code");
      const codeRegex = authConfig.otp.config.codeRegex ? new RegExp(String(authConfig.otp.config.codeRegex)) : /\b(\d{4,8})\b/;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const response = await fetch(url);
        if (response.ok) {
          const payload = (await response.json()) as unknown;
          const raw = getByPath(payload, codePath);
          const codeValue = typeof raw === "string" ? raw : JSON.stringify(raw);
          const match = codeValue.match(codeRegex);
          if (match?.[1]) {
            return match[1];
          }
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return null;
    }

    if (authConfig.otp.mode === "imap") {
      const host = String(authConfig.otp.config.host ?? "");
      const port = Number(authConfig.otp.config.port ?? 993);
      const secure = authConfig.otp.config.secure !== false;
      const user = String(authConfig.otp.config.username ?? "");
      const pass = String(authConfig.otp.config.password ?? "");
      const mailbox = String(authConfig.otp.config.mailbox ?? "INBOX");
      const subjectIncludes = String(authConfig.otp.config.subjectIncludes ?? "");
      const fromIncludes = String(authConfig.otp.config.fromIncludes ?? "");
      const codeRegex = authConfig.otp.config.codeRegex ? new RegExp(String(authConfig.otp.config.codeRegex)) : /\b(\d{4,8})\b/;
      const timeoutMs = Number(authConfig.otp.config.timeoutMs ?? 120_000);
      const intervalMs = Number(authConfig.otp.config.intervalMs ?? 5_000);

      if (!host || !user || !pass) {
        return null;
      }

      const client = new ImapFlow({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
      });

      try {
        await client.connect();
        await client.mailboxOpen(mailbox);

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          for await (const message of client.fetch("1:*", {
            envelope: true,
            source: true,
          })) {
            const subject = normalizeText(message.envelope?.subject);
            const from = normalizeText(
              message.envelope?.from?.map((entry) => entry.address ?? entry.name ?? "").join(" "),
            );
            if (subjectIncludes && !subject.toLowerCase().includes(subjectIncludes.toLowerCase())) {
              continue;
            }
            if (fromIncludes && !from.toLowerCase().includes(fromIncludes.toLowerCase())) {
              continue;
            }
            const source = message.source?.toString("utf8") ?? "";
            const match = source.match(codeRegex);
            if (match?.[1]) {
              return match[1];
            }
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
      return null;
    }

    return null;
  }

  private async resolveCaptcha(page: Page, captchaConfig: NonNullable<CrawlAuthInput["captcha"]>): Promise<CaptchaTaskResult | null> {
    const siteKey = await page.evaluate(() => {
      const fromAttr =
        document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey") ??
        document.querySelector('textarea[name="g-recaptcha-response"]')?.getAttribute("data-sitekey") ??
        document.querySelector('textarea[name="h-captcha-response"]')?.getAttribute("data-sitekey");
      if (fromAttr) {
        return fromAttr;
      }

      const iframe = document.querySelector<HTMLIFrameElement>('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
      if (!iframe) {
        return null;
      }

      try {
        const url = new URL(iframe.src);
        return url.searchParams.get("k") ?? url.searchParams.get("sitekey");
      } catch {
        return null;
      }
    });

    if (!siteKey) {
      return null;
    }

    const pageUrl = page.url();
    const baseUrl = String(captchaConfig.config.baseUrl ?? "https://2captcha.com");
    const apiKey = String(captchaConfig.config.apiKey ?? "");
    if (!apiKey) {
      return null;
    }

    const submitResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/in.php`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        key: apiKey,
        method: "userrecaptcha",
        googlekey: siteKey,
        pageurl: pageUrl,
        json: "1",
      }),
    });

    if (!submitResponse.ok) {
      return null;
    }

    const submitPayload = (await submitResponse.json()) as { status?: number; request?: string };
    if (submitPayload.status !== 1 || !submitPayload.request) {
      return null;
    }

    const requestId = submitPayload.request;
    const timeoutMs = Number(captchaConfig.config.timeoutMs ?? 120_000);
    const intervalMs = Number(captchaConfig.config.intervalMs ?? 5_000);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const pollResponse = await fetch(
        `${baseUrl.replace(/\/$/, "")}/res.php?${new URLSearchParams({
          key: apiKey,
          action: "get",
          id: requestId,
          json: "1",
        }).toString()}`,
      );

      if (!pollResponse.ok) {
        continue;
      }

      const pollPayload = (await pollResponse.json()) as { status?: number; request?: string };
      if (pollPayload.status === 1 && pollPayload.request) {
        const token = pollPayload.request;
        await page.evaluate((value) => {
          const selectors = ['textarea[name="g-recaptcha-response"]', 'textarea[name="h-captcha-response"]'];
          for (const selector of selectors) {
            const textarea = document.querySelector<HTMLTextAreaElement>(selector);
            if (textarea) {
              textarea.value = value;
              textarea.innerHTML = value;
              textarea.dispatchEvent(new Event("input", { bubbles: true }));
              textarea.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        }, token);
        return {
          token,
          provider: captchaConfig.mode,
        };
      }
    }

    return null;
  }

  private async clickFirstExisting(page: Page, selectors: string[]): Promise<boolean> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.click();
      return true;
    }

    return false;
  }
}
