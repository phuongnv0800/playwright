import { afterEach, describe, expect, it } from "vitest";

import { AuthOrchestrator } from "../src/services/auth-orchestrator.js";
import type { SessionState } from "../src/types.js";
import { createFixtureServer } from "./fixture-server.js";

class MemorySessionStore {
  private readonly sessions = new Map<string, SessionState>();

  async getSessionByAccountId(accountId: string): Promise<SessionState | null> {
    return this.sessions.get(accountId) ?? null;
  }

  async upsertSession(params: {
    accountId: string;
    status: SessionState["status"];
    state: Record<string, unknown>;
    storageStatePath?: string;
    lastAuthenticatedAt?: string;
    expiresAt?: string;
  }): Promise<SessionState> {
    const next: SessionState = {
      id: this.sessions.get(params.accountId)?.id ?? `session_${params.accountId}`,
      accountId: params.accountId,
      status: params.status,
      state: params.state,
      storageStatePath: params.storageStatePath,
      lastAuthenticatedAt: params.lastAuthenticatedAt,
      expiresAt: params.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(params.accountId, next);
    return next;
  }
}

describe("AuthOrchestrator", () => {
  const servers: Array<Awaited<ReturnType<typeof createFixtureServer>>> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it("authenticates against the fixture login form and persists session state", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const store = new MemorySessionStore();
    const orchestrator = new AuthOrchestrator(store);
    const result = await orchestrator.ensureAuthenticated(
      {
        id: "site_fixture",
        slug: "fixture",
        name: "Fixture",
        baseUrl: fixture.baseUrl,
        objective: "Authenticate",
        entityType: "Record",
        fieldList: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "acct_fixture",
        siteId: "site_fixture",
        label: "default",
        authMode: "basic",
        credentials: {
          username: "demo",
          password: "secret",
        },
        isDefault: true,
      },
      {
        version: 1,
        connectorType: "url-discovery",
        entryUrl: `${fixture.baseUrl}/records`,
        authRequired: true,
        autoDiscovery: {
          entityType: "Record",
          fields: ["title", "url", "summary", "content"],
          authStrategy: {
            mode: "form",
            loginUrl: `${fixture.baseUrl}/login`,
            usernameSelector: 'input[name="username"]',
            passwordSelector: 'input[name="password"]',
            submitSelector: 'button[type="submit"]',
            successUrlContains: "/records",
          },
          pageKinds: [],
          navigation: {
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 10,
            maxRecords: 10,
            allowPatterns: [],
            denyPatterns: [],
          },
          verification: {
            sampleUrls: [],
            artifacts: [],
          },
        },
      },
      {
        mode: "form",
        credentials: {
          username: "demo",
          password: "secret",
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.session?.status).toBe("authenticated");
  });

  it("resolves OTP from a webhook inbox during form login", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const store = new MemorySessionStore();
    const orchestrator = new AuthOrchestrator(store);
    const result = await orchestrator.ensureAuthenticated(
      {
        id: "site_fixture_otp",
        slug: "fixture-otp",
        name: "Fixture OTP",
        baseUrl: fixture.baseUrl,
        objective: "Authenticate with OTP",
        entityType: "Record",
        fieldList: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "acct_fixture_otp",
        siteId: "site_fixture_otp",
        label: "default",
        authMode: "basic+otp",
        credentials: {
          username: "demo",
          password: "secret",
        },
        isDefault: true,
      },
      {
        version: 1,
        connectorType: "url-discovery",
        entryUrl: `${fixture.baseUrl}/records-otp`,
        authRequired: true,
        autoDiscovery: {
          entityType: "Record",
          fields: ["title", "url", "summary", "content"],
          authStrategy: {
            mode: "form",
            loginUrl: `${fixture.baseUrl}/login-otp`,
            usernameSelector: 'input[name="username"]',
            passwordSelector: 'input[name="password"]',
            submitSelector: 'button[type="submit"]',
            otpSelector: 'input[name="otpCode"]',
            successUrlContains: "/records-otp",
          },
          pageKinds: [],
          navigation: {
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 10,
            maxRecords: 10,
            allowPatterns: [],
            denyPatterns: [],
          },
          verification: {
            sampleUrls: [],
            artifacts: [],
          },
        },
      },
      {
        mode: "form",
        credentials: {
          username: "demo",
          password: "secret",
        },
        otp: {
          mode: "webhook-inbox",
          config: {
            url: `${fixture.baseUrl}/otp/latest`,
            codePath: "code",
            intervalMs: 100,
            timeoutMs: 2_000,
          },
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "otp" && event.status === "succeeded")).toBe(true);
  });

  it("submits VNPT-style OTP forms that use a text button without submit type", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const store = new MemorySessionStore();
    const orchestrator = new AuthOrchestrator(store);
    const result = await orchestrator.ensureAuthenticated(
      {
        id: "site_fixture_vnpt_otp",
        slug: "fixture-vnpt-otp",
        name: "Fixture VNPT OTP",
        baseUrl: fixture.baseUrl,
        objective: "Authenticate with VNPT-style OTP step",
        entityType: "Record",
        fieldList: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "acct_fixture_vnpt_otp",
        siteId: "site_fixture_vnpt_otp",
        label: "default",
        authMode: "basic+otp",
        credentials: {
          username: "demo",
          password: "secret",
        },
        isDefault: true,
      },
      {
        version: 1,
        connectorType: "url-discovery",
        entryUrl: `${fixture.baseUrl}/records-otp-vnpt`,
        authRequired: true,
        autoDiscovery: {
          entityType: "Record",
          fields: ["title", "url", "summary", "content"],
          authStrategy: {
            mode: "form",
            loginUrl: `${fixture.baseUrl}/login-otp-vnpt`,
            usernameSelector: 'input[name="username"]',
            passwordSelector: 'input[name="password"]',
            submitSelector: 'button[type="submit"]',
            otpSelector: "#passOTP",
            successUrlContains: "/records-otp-vnpt",
          },
          pageKinds: [],
          navigation: {
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 10,
            maxRecords: 10,
            allowPatterns: [],
            denyPatterns: [],
          },
          verification: {
            sampleUrls: [],
            artifacts: [],
          },
        },
      },
      {
        mode: "form",
        credentials: {
          username: "demo",
          password: "secret",
        },
        otp: {
          mode: "manual",
          config: {
            code: "728989",
          },
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "otp" && event.status === "succeeded")).toBe(true);
  });

  it("resumes the same OTP challenge without triggering a new OTP issue on submit", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const store = new MemorySessionStore();
    const orchestrator = new AuthOrchestrator(store);
    const site = {
      id: "site_fixture_live_otp",
      slug: "fixture-live-otp",
      name: "Fixture Live OTP",
      baseUrl: fixture.baseUrl,
      objective: "Resume OTP challenge in-place",
      entityType: "Record" as const,
      fieldList: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const account = {
      id: "acct_fixture_live_otp",
      siteId: "site_fixture_live_otp",
      label: "default",
      authMode: "basic+otp" as const,
      credentials: {
        username: "demo",
        password: "secret",
      },
      isDefault: true,
    };
    const recipe = {
      version: 1,
      connectorType: "url-discovery" as const,
      entryUrl: `${fixture.baseUrl}/records-otp-live`,
      authRequired: true,
      autoDiscovery: {
        entityType: "Record" as const,
        fields: ["title", "url", "summary", "content"],
        authStrategy: {
          mode: "form" as const,
          loginUrl: `${fixture.baseUrl}/login-otp-live`,
          usernameSelector: 'input[name="username"]',
          passwordSelector: 'input[name="password"]',
          submitSelector: 'button[type="submit"]',
          otpSelector: "#passOTP",
          successUrlContains: "/records-otp-live",
        },
        pageKinds: [],
        navigation: {
          sameOriginOnly: true,
          maxDepth: 2,
          maxPages: 10,
          maxRecords: 10,
          allowPatterns: [],
          denyPatterns: [],
        },
        verification: {
          sampleUrls: [],
          artifacts: [],
        },
      },
    };

    const firstResult = await orchestrator.ensureAuthenticated(site, account, recipe, {
      mode: "form",
      credentials: {
        username: "demo",
        password: "secret",
      },
      otp: {
        mode: "manual",
        config: {},
      },
    });

    expect(firstResult.status).toBe("needs_review");
    expect(fixture.otpIssueCount).toBe(1);

    const wrongOtpResult = await orchestrator.ensureAuthenticated(site, account, recipe, {
      mode: "form",
      credentials: {
        username: "demo",
        password: "secret",
      },
      otp: {
        mode: "manual",
        config: {
          code: "111111",
        },
      },
    });

    expect(wrongOtpResult.status).toBe("needs_review");
    expect(fixture.otpIssueCount).toBe(1);

    const successResult = await orchestrator.ensureAuthenticated(site, account, recipe, {
      mode: "form",
      credentials: {
        username: "demo",
        password: "secret",
      },
      otp: {
        mode: "manual",
        config: {
          code: "728989",
        },
      },
    });

    expect(successResult.status).toBe("succeeded");
    expect(fixture.otpIssueCount).toBe(1);
  }, 20_000);

  it("handles a generic oauth browser flow", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const store = new MemorySessionStore();
    const orchestrator = new AuthOrchestrator(store);
    const result = await orchestrator.ensureAuthenticated(
      {
        id: "site_fixture_oauth",
        slug: "fixture-oauth",
        name: "Fixture OAuth",
        baseUrl: fixture.baseUrl,
        objective: "Authenticate with OAuth",
        entityType: "Record",
        fieldList: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "acct_fixture_oauth",
        siteId: "site_fixture_oauth",
        label: "default",
        authMode: "oauth",
        credentials: {
          oauthUsername: "oauth@example.com",
          oauthPassword: "oauth-secret",
        },
        isDefault: true,
      },
      {
        version: 1,
        connectorType: "url-discovery",
        entryUrl: `${fixture.baseUrl}/oauth-protected`,
        authRequired: true,
        autoDiscovery: {
          entityType: "Record",
          fields: ["title", "url", "summary", "content"],
          authStrategy: {
            mode: "oauth",
            oauthTriggerTexts: ["Continue with Google"],
            successUrlContains: "/oauth-protected/records",
          },
          pageKinds: [],
          navigation: {
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 10,
            maxRecords: 10,
            allowPatterns: [],
            denyPatterns: [],
          },
          verification: {
            sampleUrls: [],
            artifacts: [],
          },
        },
      },
      {
        mode: "oauth",
        credentials: {
          oauthUsername: "oauth@example.com",
          oauthPassword: "oauth-secret",
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "oauth" && event.status === "succeeded")).toBe(true);
  });
});
