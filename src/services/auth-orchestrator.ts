import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ImapFlow } from "imapflow";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

interface ChallengeSnapshotState {
  [key: string]: unknown;
  reason: string;
  challengeType?: "oauth" | "otp" | "captcha";
  challengeUrl?: string;
  storageState?: Record<string, unknown>;
}

interface LiveChallengeSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  challengeType: "oauth" | "otp" | "captcha";
}

const liveChallenges = new Map<string, LiveChallengeSession>();

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

function readManualOtpCode(authConfig: CrawlAuthInput): string | null {
  if (authConfig.otp?.mode !== "manual") {
    return null;
  }

  const code = String(authConfig.otp.config.code ?? "").trim();
  return code || null;
}

async function safeClick(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }
  try {
    await locator.first().click({
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function safePress(locator: ReturnType<Page["locator"]>, key: string): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }
  try {
    await locator.first().press(key, {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
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
    "#passOTP",
    'input[name="validate_pass_otp"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="pass_otp" i]',
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

  private getLiveChallenge(accountId: string): LiveChallengeSession | null {
    return liveChallenges.get(accountId) ?? null;
  }

  private async replaceLiveChallenge(accountId: string, next: LiveChallengeSession): Promise<void> {
    const current = liveChallenges.get(accountId);
    const isSameSession =
      current &&
      current.browser === next.browser &&
      current.context === next.context &&
      current.page === next.page &&
      current.challengeType === next.challengeType;
    if (current && !isSameSession) {
      await this.disposeLiveChallenge(accountId);
    }
    liveChallenges.set(accountId, next);
  }

  private async disposeLiveChallenge(accountId: string): Promise<void> {
    const current = liveChallenges.get(accountId);
    if (!current) {
      return;
    }
    liveChallenges.delete(accountId);
    await current.page.close().catch(() => undefined);
    await current.context.close().catch(() => undefined);
    await current.browser.close().catch(() => undefined);
  }

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

    const authStrategy = recipe.autoDiscovery?.authStrategy ?? {
      mode: authConfig.mode === "auto" ? "form" : authConfig.mode,
    };
    const manualOtpCode = readManualOtpCode(authConfig);
    const challengeState = current?.state as ChallengeSnapshotState | undefined;
    const liveChallenge = current?.status === "challenge_required" ? this.getLiveChallenge(account.id) : null;
    const canResumeOtpChallenge =
      current?.status === "challenge_required" &&
      challengeState?.challengeType === "otp" &&
      Boolean(liveChallenge) &&
      Boolean(manualOtpCode);

    if (current?.status === "challenge_required" && !canResumeOtpChallenge) {
      return {
        status: "needs_review",
        reviewReason:
          challengeState?.reason ??
          (challengeState?.challengeType === "otp"
            ? "OTP challenge is waiting for a fresh code."
            : "Authentication is waiting for manual review."),
        events: [],
      };
    }

    const events: AuthChallengeEvent[] = [];
    let browser: Browser | null = null;
    let keepLiveChallenge = false;
    let usingLiveChallenge = false;

    try {
      let context: BrowserContext;
      let page: Page;

      if (canResumeOtpChallenge && liveChallenge) {
        usingLiveChallenge = true;
        browser = liveChallenge.browser;
        context = liveChallenge.context;
        page = liveChallenge.page;
        page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      } else {
        browser = await chromium.launch({
          headless: env.PLAYWRIGHT_HEADLESS,
        });
        context = await browser.newContext();
        page = await context.newPage();
        page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      }

      if (canResumeOtpChallenge) {
        const resumeResult = await this.submitOtpChallenge(page, site, authStrategy.successUrlContains, authConfig, events);
        if (resumeResult !== "ok") {
          keepLiveChallenge = true;
          await this.replaceLiveChallenge(account.id, {
            browser,
            context,
            page,
            challengeType: "otp",
          });
          return await this.markChallenge(account.id, resumeResult, events, context, page, "otp");
        }
      } else {
        await page.goto(authStrategy.loginUrl ?? recipe.entryUrl ?? site.baseUrl, {
          waitUntil: "domcontentloaded",
        });

        if (authStrategy.mode === "oauth") {
          const oauthResult = await this.handleOAuth(page, site, account, authStrategy.oauthTriggerTexts ?? [], authConfig, events);
          if (oauthResult !== "ok") {
            const challengeType = (await this.detectChallengeType(page, authConfig, events)) ?? "oauth";
            keepLiveChallenge = challengeType === "otp";
            if (keepLiveChallenge) {
              await this.replaceLiveChallenge(account.id, {
                browser,
                context,
                page,
                challengeType,
              });
            }
            return await this.markChallenge(
              account.id,
              oauthResult,
              events,
              context,
              page,
              challengeType,
            );
          }
        } else if (authStrategy.mode === "form" || authConfig.mode === "auto") {
          const formResult = await this.handleFormLogin(page, site, account, authStrategy, authConfig, events);
          if (formResult !== "ok") {
            const challengeType = await this.detectChallengeType(page, authConfig, events);
            keepLiveChallenge = challengeType === "otp";
            if (keepLiveChallenge && challengeType) {
              await this.replaceLiveChallenge(account.id, {
                browser,
                context,
                page,
                challengeType,
              });
            }
            return await this.markChallenge(
              account.id,
              formResult,
              events,
              context,
              page,
              challengeType,
            );
          }
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
      await this.disposeLiveChallenge(account.id);

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
      if (!keepLiveChallenge) {
        if (usingLiveChallenge) {
          await this.disposeLiveChallenge(account.id);
        } else {
          await browser?.close().catch(() => undefined);
        }
      }
    }
  }

  private async markChallenge(
    accountId: string,
    reason: string,
    events: AuthChallengeEvent[],
    context?: BrowserContext,
    page?: Page,
    challengeType?: "oauth" | "otp" | "captcha",
  ): Promise<AuthExecutionResult> {
    let state: ChallengeSnapshotState = {
      reason,
      challengeType,
    };
    let storageStatePath: string | undefined;

    if (context) {
      const storageState = (await context.storageState()) as Record<string, unknown>;
      const stateDir = path.resolve(env.PLAYWRIGHT_STATE_DIR);
      await mkdir(stateDir, {
        recursive: true,
      });
      storageStatePath = path.join(stateDir, `${accountId}.challenge.json`);
      await writeFile(storageStatePath, JSON.stringify(storageState, null, 2));
      state = {
        ...state,
        challengeUrl: page?.url(),
        storageState,
      };
    }

    await this.store.upsertSession({
      accountId,
      status: "challenge_required",
      state,
      storageStatePath,
    });

    return {
      status: "needs_review",
      reviewReason: reason,
      events,
    };
  }

  private async detectChallengeType(
    page: Page,
    authConfig: CrawlAuthInput,
    events: AuthChallengeEvent[],
  ): Promise<"oauth" | "otp" | "captcha" | undefined> {
    if ((await findOtpSelector(page)) || authConfig.otp) {
      return "otp";
    }
    if (events.some((event) => event.type === "captcha" && event.status === "needs_review")) {
      return "captcha";
    }
    if (events.some((event) => event.type === "oauth")) {
      return "oauth";
    }
    return undefined;
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

    const loginSubmitSelectors = [
      submitSelector,
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("ĐĂNG NHẬP")',
      'button:has-text("Đăng nhập")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Continue")',
    ].filter((selector): selector is string => Boolean(selector));

    const clickedLoginSubmit = await this.clickFirstExisting(page, loginSubmitSelectors);
    if (!clickedLoginSubmit) {
      const submittedByEnter = await safePress(page.locator(passwordSelector), "Enter");
      if (!submittedByEnter) {
        return "Unable to submit the login form automatically.";
      }
    }

    await page.waitForTimeout(300);

    const otpResult = await this.submitOtpChallenge(page, site, authStrategy?.successUrlContains, authConfig, events, submitSelector);
    if (otpResult !== "not_present") {
      return otpResult;
    }

    const success = await this.waitForSuccess(page, site, authStrategy?.successUrlContains);
    return success ? "ok" : "Form login did not reach an authenticated state.";
  }

  private async submitOtpChallenge(
    page: Page,
    site: SiteDefinition,
    successUrlContains: string | undefined,
    authConfig: CrawlAuthInput,
    events: AuthChallengeEvent[],
    submitSelector?: string,
  ): Promise<"ok" | "not_present" | string> {
    const otpSelector = await findOtpSelector(page);
    if (!otpSelector) {
      return "not_present";
    }

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

    const otpSubmitSelectors = [
      "#verify-otp",
      'button:has-text("ĐĂNG NHẬP")',
      'button:has-text("Đăng nhập")',
      'button:has-text("Xác thực")',
      'button:has-text("Verify")',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
      'button:has-text("Sign in")',
      'button[type="submit"]',
      'input[type="submit"]',
      "form button",
    ];
    const clickedOtpSubmit = await this.clickFirstExisting(page, otpSubmitSelectors);
    if (!clickedOtpSubmit) {
      const clickedFallbackSubmit = submitSelector ? await safeClick(page.locator(submitSelector)) : false;
      if (!clickedFallbackSubmit) {
        await safePress(page.locator(otpSelector), "Enter");
      }
    }
    const challengeUrl = page.url();
    await page.waitForTimeout(800);

    const otpStillPresent = await findOtpSelector(page);
    if (otpStillPresent && page.url() === challengeUrl) {
      return "Form login did not reach an authenticated state.";
    }

    const success = await this.waitForSuccess(page, site, successUrlContains);
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
          { timeout: 15_000 },
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

    if (authConfig.otp.mode === "manual") {
      const code = String(authConfig.otp.config.code ?? "").trim();
      return code || null;
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
