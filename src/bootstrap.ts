import PgBoss from "pg-boss";

import { env } from "./config/env.js";
import { CodexAuthProvider } from "./connectors/ai/codex-auth-provider.js";
import { OpenAICompatibleProvider } from "./connectors/ai/openai-compatible-provider.js";
import { StubAIProvider } from "./connectors/ai/stub-ai-provider.js";
import { EchoSinkConnector } from "./connectors/sink/echo-sink.js";
import { WebhookSinkConnector } from "./connectors/sink/webhook-sink.js";
import { GenericRecipeSourceConnector } from "./connectors/source/generic-recipe-connector.js";
import { pool } from "./db/pool.js";
import { CrawlRunRepository } from "./repositories/crawl-run-repository.js";
import { PlatformRepository } from "./repositories/platform-repository.js";
import { AuthOrchestrator } from "./services/auth-orchestrator.js";
import { PlatformQueue } from "./services/platform-queue.js";
import { PlatformService } from "./services/platform-service.js";
import { SessionManager } from "./services/session-manager.js";
import { UrlCrawlService } from "./services/url-crawl-service.js";
import type { AIProvider, SinkConnector, SourceConnector } from "./types.js";

export interface PlatformRuntime {
  repository: PlatformRepository;
  crawlRepository: CrawlRunRepository;
  queue: PlatformQueue;
  service: PlatformService;
  urlCrawlService: UrlCrawlService;
  close(): Promise<void>;
}

function buildAIProvider(): AIProvider {
  if (env.AI_PROVIDER === "codex-auth") {
    return new CodexAuthProvider();
  }

  if (env.AI_PROVIDER === "openai-compatible") {
    return new OpenAICompatibleProvider();
  }

  return new StubAIProvider();
}

export async function createRuntime(): Promise<PlatformRuntime> {
  const repository = new PlatformRepository(pool);
  const crawlRepository = new CrawlRunRepository(pool);
  const boss = new PgBoss(env.DATABASE_URL);
  const queue = new PlatformQueue(boss);
  await queue.start();

  const sourceConnectors = new Map<string, SourceConnector>();
  sourceConnectors.set("generic-recipe", new GenericRecipeSourceConnector());

  const sinkConnectors = new Map<string, SinkConnector>();
  sinkConnectors.set("echo", new EchoSinkConnector());
  sinkConnectors.set("webhook", new WebhookSinkConnector());

  const sessionManager = new SessionManager(repository);
  const authOrchestrator = new AuthOrchestrator(repository);
  const service = new PlatformService({
    repository,
    queue,
    sessionManager,
    aiProvider: buildAIProvider(),
    sourceConnectors,
    sinkConnectors,
  });
  const urlCrawlService = new UrlCrawlService({
    platformRepository: repository,
    crawlRepository,
    queue,
    authOrchestrator,
    aiProvider: buildAIProvider(),
    sinkConnectors,
  });

  return {
    repository,
    crawlRepository,
    queue,
    service,
    urlCrawlService,
    async close(): Promise<void> {
      await queue.stop();
      await pool.end();
    },
  };
}
