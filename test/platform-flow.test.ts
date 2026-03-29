import { afterEach, describe, expect, it } from "vitest";

import { StubAIProvider } from "../src/connectors/ai/stub-ai-provider.js";
import { EchoSinkConnector } from "../src/connectors/sink/echo-sink.js";
import { WebhookSinkConnector } from "../src/connectors/sink/webhook-sink.js";
import { GenericRecipeSourceConnector } from "../src/connectors/source/generic-recipe-connector.js";
import { SessionManager } from "../src/services/session-manager.js";
import type { SessionState, SiteAccount, SiteDefinition, SinkDefinition } from "../src/types.js";
import { createFixtureServer } from "./fixture-server.js";

class MockSessionRepository {
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
    const current = this.sessions.get(params.accountId);
    const session: SessionState = {
      id: current?.id ?? "session_fixture",
      accountId: params.accountId,
      status: params.status,
      state: params.state,
      storageStatePath: params.storageStatePath,
      lastAuthenticatedAt: params.lastAuthenticatedAt,
      expiresAt: params.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(params.accountId, session);
    return session;
  }
}

describe("generic platform flow", () => {
  const servers: Array<Awaited<ReturnType<typeof createFixtureServer>>> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it("drafts a recipe, authenticates, and extracts records from a fixture site", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const site: SiteDefinition = {
      id: "site_fixture",
      slug: "fixture",
      name: "Fixture",
      baseUrl: fixture.baseUrl,
      objective: "Extract records from a controlled website",
      entityType: "Document",
      fieldList: ["id", "title", "status"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const account: SiteAccount = {
      id: "acct_fixture",
      siteId: site.id,
      label: "default",
      authMode: "basic",
      credentials: {
        username: "demo",
        password: "secret",
      },
      isDefault: true,
    };

    const ai = new StubAIProvider();
    const { recipe } = await ai.draftRecipe({ site, account });
    const repository = new MockSessionRepository();
    const sessionManager = new SessionManager(repository as never);
    const session = await sessionManager.reauthenticate(site, account, recipe);
    const connector = new GenericRecipeSourceConnector();
    const result = await connector.run({
      site,
      account,
      recipe,
      session,
    });

    expect(session.status).toBe("authenticated");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.externalId).toBe("DOC-001");
    expect(result.records[0]?.data.title).toBe("Alpha");
    expect(result.records[1]?.data.status).toBe("closed");
    expect(result.artifacts.length).toBeGreaterThanOrEqual(3);
  });

  it("delivers payloads through echo and webhook sinks", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const site: SiteDefinition = {
      id: "site_fixture",
      slug: "fixture",
      name: "Fixture",
      baseUrl: fixture.baseUrl,
      objective: "Deliver records",
      entityType: "Document",
      fieldList: ["id", "title", "status"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sink: SinkDefinition = {
      id: "sink_fixture",
      siteId: site.id,
      sinkType: "webhook",
      config: {
        endpoint: `${fixture.baseUrl}/webhook`,
        method: "POST",
      },
      isDefault: true,
    };

    const entity = {
      id: "entity_fixture",
      siteId: site.id,
      jobId: "job_fixture",
      entityType: "Document" as const,
      externalId: "DOC-001",
      data: {
        title: "Alpha",
        status: "open",
      },
      status: "approved" as const,
      confidence: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const template = {
      id: "map_fixture",
      sinkId: sink.id,
      entityType: "Document" as const,
      template: {
        site: "{{site.slug}}",
        externalId: "{{entity.externalId}}",
        title: "{{entity.data.title}}",
      },
    };

    const echo = new EchoSinkConnector();
    const echoResult = await echo.deliver({
      site,
      entity,
      sink: {
        ...sink,
        sinkType: "echo",
        config: {},
      },
      template,
    });

    expect(echoResult.status).toBe("succeeded");
    expect(echoResult.responsePayload.rendered).toEqual({
      site: "fixture",
      externalId: "DOC-001",
      title: "Alpha",
    });

    const webhook = new WebhookSinkConnector();
    const webhookResult = await webhook.deliver({
      site,
      entity,
      sink,
      template,
    });

    expect(webhookResult.status).toBe("succeeded");
    expect(fixture.deliveries[0]).toEqual({
      site: "fixture",
      externalId: "DOC-001",
      title: "Alpha",
    });
  });
});
