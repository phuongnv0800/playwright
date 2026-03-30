import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PlatformService } from "../services/platform-service.js";
import type { UrlCrawlService } from "../services/url-crawl-service.js";
import type { CrawlRun } from "../types.js";

const createSiteSchema = z.object({
  slug: z.string().min(2),
  name: z.string().min(2),
  baseUrl: z.string().url(),
  objective: z.string().min(5),
  entityType: z.enum(["Document", "Task", "Record"]),
  fieldList: z.array(z.string().min(1)).min(1),
  account: z
    .object({
      label: z.string().optional(),
      authMode: z.enum(["none", "basic", "basic+otp"]).default("none"),
      credentials: z.record(z.unknown()).optional(),
    })
    .optional(),
  sink: z
    .object({
      sinkType: z.enum(["echo", "webhook"]),
      config: z.record(z.unknown()).default({}),
      template: z.record(z.unknown()),
    })
    .optional(),
});

const runJobSchema = z.object({
  siteId: z.string().min(1),
});

const crawlFromUrlSchema = z.object({
  url: z.string().url(),
  auth: z
    .object({
      mode: z.enum(["auto", "none", "form", "oauth"]).optional(),
      credentials: z.record(z.unknown()).optional(),
      otp: z
        .object({
          mode: z.enum(["totp", "imap", "webhook-inbox", "manual"]),
          config: z.record(z.unknown()).default({}),
        })
        .optional(),
      captcha: z
        .object({
          mode: z.literal("2captcha-compatible"),
          config: z.record(z.unknown()).default({}),
        })
        .optional(),
    })
    .optional(),
  sink: z
    .object({
      enabled: z.boolean().default(false),
      sinkType: z.enum(["echo", "webhook"]).optional(),
      config: z.record(z.unknown()).optional(),
      template: z.record(z.unknown()).optional(),
    })
    .optional(),
  crawl: z
    .object({
      maxDepth: z.coerce.number().int().positive().optional(),
      maxPages: z.coerce.number().int().positive().optional(),
      maxRecords: z.coerce.number().int().positive().optional(),
      sameOriginOnly: z.boolean().optional(),
    })
    .optional(),
});

const submitOtpSchema = z.object({
  code: z.string().trim().min(4).max(12),
});

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(password|secret|token|otp|code|api[_-]?key|^key$)/i.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactValue(entry);
  }
  return result;
}

function normalizeCrawlRun(crawlRun: CrawlRun): CrawlRun {
  const normalized: CrawlRun = {
    ...crawlRun,
  };

  if (normalized.status === "needs_review") {
    if (normalized.authStatus === "needs_review" && normalized.discoveryStatus === "running") {
      normalized.discoveryStatus = normalized.publishedRecipeVersion ? "succeeded" : "needs_review";
    }

    if (normalized.discoveryStatus === "running") {
      normalized.discoveryStatus = "needs_review";
    }

    if (normalized.crawlStatus === "running") {
      normalized.crawlStatus = "queued";
    }

    if (normalized.deliveryStatus === "running") {
      normalized.deliveryStatus = "queued";
    }
  }

  if (normalized.status === "failed") {
    if (normalized.discoveryStatus === "running") {
      normalized.discoveryStatus = "failed";
    }
    if (normalized.authStatus === "running") {
      normalized.authStatus = "failed";
    }
    if (normalized.crawlStatus === "running") {
      normalized.crawlStatus = "failed";
    }
    if (normalized.deliveryStatus === "running") {
      normalized.deliveryStatus = "failed";
    }
  }

  return normalized;
}

function toPublicCrawlRun(crawlRun: CrawlRun): CrawlRun {
  const normalized = normalizeCrawlRun(crawlRun);
  return {
    ...normalized,
    authConfig: {
      ...normalized.authConfig,
      credentials: normalized.authConfig.credentials ? (redactValue(normalized.authConfig.credentials) as Record<string, unknown>) : undefined,
      otp: normalized.authConfig.otp
        ? {
            ...normalized.authConfig.otp,
            config: redactValue(normalized.authConfig.otp.config) as Record<string, unknown>,
          }
        : undefined,
      captcha: normalized.authConfig.captcha
        ? {
            ...normalized.authConfig.captcha,
            config: redactValue(normalized.authConfig.captcha.config) as Record<string, unknown>,
          }
        : undefined,
    },
  };
}

export async function registerPlatformRoutes(
  app: FastifyInstance,
  service: PlatformService,
  urlCrawlService: UrlCrawlService,
): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
  }));

  app.post("/sites", async (request, reply) => {
    const body = createSiteSchema.parse(request.body);
    const result = await service.createSite(body);
    reply.code(201);
    return result;
  });

  app.post("/sites/:id/discover", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await service.enqueueSiteDiscovery(params.id);
    reply.code(202);
    return job;
  });

  app.post("/sites/:id/recipes/:version/publish", async (request) => {
    const params = z
      .object({
        id: z.string().min(1),
        version: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    return service.publishRecipe(params.id, params.version);
  });

  app.post("/jobs/run", async (request, reply) => {
    const body = runJobSchema.parse(request.body);
    const job = await service.enqueueSiteRun(body.siteId);
    reply.code(202);
    return job;
  });

  app.get("/jobs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await service.getJob(params.id);
    if (!job) {
      reply.code(404);
      return {
        message: "Job not found",
      };
    }

    return job;
  });

  app.post("/reviews/:id/approve", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return service.approveReview(params.id);
  });

  app.post("/connectors/sinks/test", async (request) => {
    return service.testSink(request.body);
  });

  app.post("/sessions/:id/reauth", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await service.enqueueSessionReauth(params.id);
    reply.code(202);
    return job;
  });

  app.post("/crawl-from-url", async (request, reply) => {
    const body = crawlFromUrlSchema.parse(request.body);
    const crawlRun = await urlCrawlService.enqueueFromUrl(body);
    reply.code(202);
    return toPublicCrawlRun(crawlRun);
  });

  app.get("/crawl-runs", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(100).optional(),
      })
      .parse(request.query);
    const runs = await urlCrawlService.listCrawlRuns(query.limit ?? 20);
    return runs.map((crawlRun) => toPublicCrawlRun(crawlRun));
  });

  app.get("/crawl-runs/:id/json-view", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await urlCrawlService.getJsonView(params.id).catch((error) => {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    });
    if (!result) {
      reply.code(404);
      return {
        message: "Crawl run not found",
      };
    }
    return {
      ...result,
      crawlRun: toPublicCrawlRun(result.crawlRun),
    };
  });

  app.get("/crawl-runs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await urlCrawlService.getCrawlRun(params.id);
    if (!result.crawlRun) {
      reply.code(404);
      return {
        message: "Crawl run not found",
      };
    }
    return {
      ...result,
      crawlRun: toPublicCrawlRun(result.crawlRun),
    };
  });

  app.post("/crawl-runs/:id/approve", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return toPublicCrawlRun(await urlCrawlService.approveCrawlRun(params.id));
  });

  app.post("/crawl-runs/:id/retry-auth", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return toPublicCrawlRun(await urlCrawlService.retryAuth(params.id));
  });

  app.post("/crawl-runs/:id/submit-otp", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = submitOtpSchema.parse(request.body);
    return toPublicCrawlRun(await urlCrawlService.submitOtp(params.id, body.code));
  });

  app.get("/crawl-runs/:id/export", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const exports = await urlCrawlService.getExports(params.id);
    if (exports.length === 0) {
      reply.code(404);
      return {
        message: "No exports found for crawl run",
      };
    }
    return exports;
  });
}
