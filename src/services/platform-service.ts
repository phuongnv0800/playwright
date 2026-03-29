import { z } from "zod";

import { renderTemplate } from "../lib/template.js";
import type { SiteCreationInput } from "../repositories/platform-repository.js";
import type { PlatformRepository } from "../repositories/platform-repository.js";
import type { PlatformQueue } from "./platform-queue.js";
import { queueNames } from "./platform-queue.js";
import type { SessionManager } from "./session-manager.js";
import type {
  AIProvider,
  JobRun,
  MappingTemplate,
  NormalizedEntity,
  SinkConnector,
  SinkDefinition,
  SiteDefinition,
  SourceConnector,
} from "../types.js";

const sinkTestSchema = z.object({
  sinkType: z.enum(["echo", "webhook"]),
  config: z.record(z.unknown()).default({}),
  payload: z.record(z.unknown()).default({}),
});

interface PlatformServiceDeps {
  repository: PlatformRepository;
  queue: PlatformQueue;
  sessionManager: SessionManager;
  aiProvider: AIProvider;
  sourceConnectors: Map<string, SourceConnector>;
  sinkConnectors: Map<string, SinkConnector>;
}

export class PlatformService {
  constructor(private readonly deps: PlatformServiceDeps) {}

  async createSite(input: SiteCreationInput) {
    return this.deps.repository.createSite(input);
  }

  async enqueueSiteDiscovery(siteId: string): Promise<JobRun> {
    const job = await this.deps.repository.createJob({
      siteId,
      jobType: "site.discover",
      payload: {
        siteId,
      },
    });
    await this.deps.queue.publish(queueNames.discover, {
      jobRunId: job.id,
      siteId,
    });
    return job;
  }

  async publishRecipe(siteId: string, version: number) {
    return this.deps.repository.publishRecipe(siteId, version);
  }

  async enqueueSiteRun(siteId: string): Promise<JobRun> {
    const job = await this.deps.repository.createJob({
      siteId,
      jobType: "site.run",
      payload: {
        siteId,
      },
    });
    await this.deps.queue.publish(queueNames.run, {
      jobRunId: job.id,
      siteId,
    });
    return job;
  }

  async getJob(jobId: string): Promise<JobRun | null> {
    return this.deps.repository.getJob(jobId);
  }

  async approveReview(entityId: string): Promise<{
    entity: NormalizedEntity;
    delivery?: {
      requestPayload: Record<string, unknown>;
      responsePayload: Record<string, unknown>;
      status: string;
      error?: string;
    };
  }> {
    const entity = await this.deps.repository.approveEntity(entityId);
    const site = await this.requireSite(entity.siteId);
    const delivery = await this.deliverEntity(site, entity);
    return {
      entity,
      delivery,
    };
  }

  async testSink(input: unknown): Promise<Record<string, unknown>> {
    const parsed = sinkTestSchema.parse(input);
    const connector = this.deps.sinkConnectors.get(parsed.sinkType);
    if (!connector) {
      throw new Error(`Sink connector ${parsed.sinkType} is not registered`);
    }

    return connector.test(parsed.config, parsed.payload);
  }

  async enqueueSessionReauth(sessionId: string): Promise<JobRun> {
    const session = await this.deps.repository.getSessionById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const account = await this.deps.repository.getAccountById(session.accountId);
    const job = await this.deps.repository.createJob({
      siteId: account?.siteId,
      jobType: "session.reauth",
      payload: {
        sessionId,
      },
    });

    await this.deps.queue.publish(queueNames.reauth, {
      jobRunId: job.id,
      sessionId,
      siteId: account?.siteId,
    });

    return job;
  }

  async handleDiscoverJob(jobRunId: string, siteId: string): Promise<void> {
    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: "running",
      markStarted: true,
    });

    const site = await this.requireSite(siteId);
    const account = await this.deps.repository.getDefaultAccountBySiteId(siteId);
    const nextVersion = await this.deps.repository.getNextRecipeVersion(siteId);
    const drafted = await this.deps.aiProvider.draftRecipe({
      site,
      account: account ?? undefined,
    });
    drafted.recipe.version = nextVersion;

    const recipe = await this.deps.repository.createRecipe({
      siteId,
      version: nextVersion,
      recipe: drafted.recipe,
      confidence: drafted.confidence,
      aiProvider: this.deps.aiProvider.name,
      notes: drafted.notes,
    });

    await this.deps.repository.logEvent({
      entityType: "site",
      entityId: siteId,
      level: "info",
      message: "Draft recipe generated",
      metadata: {
        recipeId: recipe.id,
        version: recipe.version,
        confidence: recipe.confidence,
      },
    });

    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: "succeeded",
      markFinished: true,
      result: {
        recipeId: recipe.id,
        version: recipe.version,
        confidence: recipe.confidence,
      },
    });
  }

  async handleRunJob(jobRunId: string, siteId: string): Promise<void> {
    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: "running",
      markStarted: true,
    });

    const site = await this.requireSite(siteId);
    const account = await this.deps.repository.getDefaultAccountBySiteId(siteId);
    const publishedRecipe = await this.deps.repository.getPublishedRecipe(siteId);
    if (!publishedRecipe) {
      throw new Error(`No published recipe for site ${siteId}`);
    }

    const session = await this.deps.sessionManager.ensureAuthenticated(site, account, publishedRecipe.recipe);
    if (session?.status === "challenge_required") {
      await this.deps.repository.updateJobStatus({
        jobId: jobRunId,
        status: "reauth_required",
        markFinished: true,
        result: {
          sessionId: session.id,
        },
      });
      return;
    }

    const connector = this.deps.sourceConnectors.get(publishedRecipe.recipe.connectorType);
    if (!connector) {
      throw new Error(`Source connector ${publishedRecipe.recipe.connectorType} is not registered`);
    }

    const result = await connector.run({
      site,
      recipe: publishedRecipe.recipe,
      account: account ?? undefined,
      session,
    });

    await this.deps.repository.createArtifacts(site.id, jobRunId, result.artifacts);

    const savedEntities: Array<{
      entity: NormalizedEntity;
      delivery?: {
        requestPayload: Record<string, unknown>;
        responsePayload: Record<string, unknown>;
        status: string;
        error?: string;
      };
    }> = [];

    for (const record of result.records) {
      const entity = await this.deps.repository.upsertNormalizedEntity({
        siteId: site.id,
        jobId: jobRunId,
        entityType: site.entityType,
        externalId: record.externalId,
        data: record.data,
        status: record.status,
        confidence: record.confidence,
        reviewNotes: record.reviewNotes,
      });

      const delivery = entity.status === "approved" ? await this.deliverEntity(site, entity) : undefined;
      savedEntities.push({
        entity,
        delivery,
      });
    }

    const needsReview = savedEntities.some((item) => item.entity.status === "needs_review");
    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: needsReview ? "needs_review" : "succeeded",
      markFinished: true,
      result: {
        recipeVersion: publishedRecipe.version,
        artifacts: result.artifacts.length,
        entities: savedEntities.map((item) => ({
          id: item.entity.id,
          externalId: item.entity.externalId,
          status: item.entity.status,
          deliveryStatus: item.delivery?.status,
        })),
      },
    });
  }

  async handleReauthJob(jobRunId: string, sessionId: string): Promise<void> {
    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: "running",
      markStarted: true,
    });

    const session = await this.deps.repository.getSessionById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const account = await this.deps.repository.getAccountById(session.accountId);
    if (!account) {
      throw new Error(`Account ${session.accountId} not found`);
    }

    const site = await this.requireSite(account.siteId);
    const recipe = await this.deps.repository.getPublishedRecipe(site.id);
    if (!recipe) {
      throw new Error(`No published recipe for site ${site.id}`);
    }

    const refreshed = await this.deps.sessionManager.reauthenticate(site, account, recipe.recipe);
    await this.deps.repository.updateJobStatus({
      jobId: jobRunId,
      status: refreshed.status === "authenticated" ? "succeeded" : "reauth_required",
      markFinished: true,
      result: {
        sessionId: refreshed.id,
        sessionStatus: refreshed.status,
      },
    });
  }

  private async deliverEntity(
    site: SiteDefinition,
    entity: NormalizedEntity,
  ): Promise<
    | {
        requestPayload: Record<string, unknown>;
        responsePayload: Record<string, unknown>;
        status: string;
        error?: string;
      }
    | undefined
  > {
    const sink = await this.deps.repository.getDefaultSinkBySiteId(site.id);
    if (!sink) {
      return undefined;
    }

    const template = await this.deps.repository.getMappingTemplateBySinkId(sink.id, entity.entityType);
    if (!template) {
      return undefined;
    }

    const connector = this.requireSinkConnector(sink.sinkType);
    const requestPayload = this.renderRequestPayload(template, site, entity, sink);
    const result = await connector.deliver({
      site,
      entity,
      sink,
      template,
    });

    await this.deps.repository.createDeliveryRun({
      entityId: entity.id,
      sinkId: sink.id,
      status: result.status,
      requestPayload,
      responsePayload: result.responsePayload,
      error: result.error,
    });

    return {
      requestPayload,
      responsePayload: result.responsePayload,
      status: result.status,
      error: result.error,
    };
  }

  private renderRequestPayload(
    template: MappingTemplate,
    site: SiteDefinition,
    entity: NormalizedEntity,
    sink: SinkDefinition,
  ): Record<string, unknown> {
    return renderTemplate<Record<string, unknown>>(template.template, {
      entity,
      site,
      sink,
    });
  }

  private async requireSite(siteId: string): Promise<SiteDefinition> {
    const site = await this.deps.repository.getSite(siteId);
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }
    return site;
  }

  private requireSinkConnector(type: string): SinkConnector {
    const connector = this.deps.sinkConnectors.get(type);
    if (!connector) {
      throw new Error(`Sink connector ${type} is not registered`);
    }
    return connector;
  }
}
