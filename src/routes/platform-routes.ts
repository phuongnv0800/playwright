import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PlatformService } from "../services/platform-service.js";
import type { UrlCrawlService } from "../services/url-crawl-service.js";

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
          mode: z.enum(["totp", "imap", "webhook-inbox"]),
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
    return crawlRun;
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
    return result;
  });

  app.post("/crawl-runs/:id/approve", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return urlCrawlService.approveCrawlRun(params.id);
  });

  app.post("/crawl-runs/:id/retry-auth", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return urlCrawlService.retryAuth(params.id);
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
