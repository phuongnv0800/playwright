import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

vi.mock("imapflow", () => {
  class FakeImapFlow {
    async connect(): Promise<void> {}

    async mailboxOpen(): Promise<void> {}

    async *fetch(): AsyncGenerator<{
      envelope: {
        subject: string;
        from: Array<{ address: string }>;
      };
      source: Buffer;
    }> {
      yield {
        envelope: {
          subject: "Your OTP code",
          from: [{ address: "noreply@example.com" }],
        },
        source: Buffer.from("Your verification code is 112233"),
      };
    }

    async logout(): Promise<void> {}
  }

  return {
    ImapFlow: FakeImapFlow,
  };
});

import { AuthOrchestrator } from "../src/services/auth-orchestrator.js";

class NullSessionStore {
  async getSessionByAccountId(): Promise<null> {
    return null;
  }

  async upsertSession(params: {
    accountId: string;
    status: "new" | "authenticated" | "challenge_required" | "error";
    state: Record<string, unknown>;
    storageStatePath?: string;
    lastAuthenticatedAt?: string;
    expiresAt?: string;
  }) {
    return {
      id: "session_fixture",
      accountId: params.accountId,
      status: params.status,
      state: params.state,
      storageStatePath: params.storageStatePath,
      lastAuthenticatedAt: params.lastAuthenticatedAt,
      expiresAt: params.expiresAt,
      updatedAt: new Date().toISOString(),
    };
  }
}

describe("AuthOrchestrator resolvers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads OTP codes through the IMAP resolver", async () => {
    const orchestrator = new AuthOrchestrator(new NullSessionStore());

    const code = await (orchestrator as any).resolveOtp({
      mode: "form",
      otp: {
        mode: "imap",
        config: {
          host: "mail.example.com",
          username: "demo@example.com",
          password: "secret",
          subjectIncludes: "OTP",
          fromIncludes: "noreply@example.com",
          timeoutMs: 500,
          intervalMs: 10,
        },
      },
    });

    expect(code).toBe("112233");
  });

  it("returns a manually submitted OTP code", async () => {
    const orchestrator = new AuthOrchestrator(new NullSessionStore());

    const code = await (orchestrator as any).resolveOtp({
      mode: "form",
      otp: {
        mode: "manual",
        config: {
          code: "654321",
        },
      },
    });

    expect(code).toBe("654321");
  });

  it("solves recaptcha through a 2captcha-compatible provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 1,
            request: "captcha-request-id",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 1,
            request: "captcha-solved-token",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.goto("https://example.com");
      await page.setContent(`
        <html>
          <body>
            <div data-sitekey="site-key-fixture"></div>
            <textarea name="g-recaptcha-response"></textarea>
          </body>
        </html>
      `);

      const orchestrator = new AuthOrchestrator(new NullSessionStore());
      const result = await (orchestrator as any).resolveCaptcha(page, {
        mode: "2captcha-compatible",
        config: {
          baseUrl: "https://solver.example.com",
          apiKey: "solver-key",
          intervalMs: 10,
          timeoutMs: 500,
        },
      });

      expect(result).toEqual({
        token: "captcha-solved-token",
        provider: "2captcha-compatible",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(page.locator('textarea[name="g-recaptcha-response"]').inputValue()).resolves.toBe(
        "captcha-solved-token",
      );
    } finally {
      await browser.close();
    }
  });
});
