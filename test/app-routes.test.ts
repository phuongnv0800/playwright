import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { CrawlRun, JobRun, NormalizedEntity } from "../src/types.js";

function createJob(id: string): JobRun {
  return {
    id,
    siteId: "site_fixture",
    jobType: "crawl.url",
    status: "queued",
    payload: {},
    result: {},
    createdAt: new Date().toISOString(),
  };
}

function createCrawlRun(id: string): CrawlRun {
  return {
    id,
    siteId: "site_fixture",
    jobId: "job_fixture",
    seedUrl: "https://example.com/list",
    status: "queued",
    discoveryStatus: "queued",
    authStatus: "queued",
    crawlStatus: "queued",
    deliveryStatus: "queued",
    confidence: 0,
    authConfig: {
      mode: "auto",
    },
    crawlConfig: {
      maxDepth: 2,
      maxPages: 200,
      maxRecords: 100,
      sameOriginOnly: true,
    },
    sinkConfig: {
      enabled: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("app routes", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("accepts crawl-from-url and exposes crawl run management routes", async () => {
    const crawlRun = createCrawlRun("crawl_fixture");
    const enqueueFromUrl = vi.fn().mockResolvedValue(crawlRun);
    const getCrawlRun = vi.fn().mockResolvedValue({
      crawlRun,
      exports: [
        {
          id: "export_fixture",
          crawlRunId: crawlRun.id,
          exportType: "summary.json",
          path: "/tmp/summary.json",
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const approveCrawlRun = vi.fn().mockResolvedValue({
      ...crawlRun,
      status: "running",
    });
    const retryAuth = vi.fn().mockResolvedValue({
      ...crawlRun,
      authStatus: "queued",
    });
    const getExports = vi.fn().mockResolvedValue([
      {
        id: "export_fixture",
        crawlRunId: crawlRun.id,
        exportType: "summary.json",
        path: "/tmp/summary.json",
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const service = {
      createSite: vi.fn(),
      enqueueSiteDiscovery: vi.fn().mockResolvedValue(createJob("job_discover")),
      publishRecipe: vi.fn(),
      enqueueSiteRun: vi.fn().mockResolvedValue(createJob("job_run")),
      getJob: vi.fn().mockResolvedValue(createJob("job_run")),
      approveReview: vi.fn().mockResolvedValue({
        entity: {
          id: "entity_fixture",
          siteId: "site_fixture",
          jobId: "job_fixture",
          entityType: "Document",
          externalId: "doc-1",
          data: {},
          status: "approved",
          confidence: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies NormalizedEntity,
      }),
      testSink: vi.fn().mockResolvedValue({ ok: true }),
      enqueueSessionReauth: vi.fn().mockResolvedValue(createJob("job_reauth")),
    };

    const urlCrawlService = {
      enqueueFromUrl,
      getCrawlRun,
      approveCrawlRun,
      retryAuth,
      getExports,
    };

    const app = await buildApp(service as never, urlCrawlService as never);
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/crawl-from-url",
      payload: {
        url: "https://example.com/list",
        auth: {
          mode: "auto",
        },
      },
    });

    expect(createResponse.statusCode).toBe(202);
    expect(enqueueFromUrl).toHaveBeenCalledWith({
      url: "https://example.com/list",
      auth: {
        mode: "auto",
      },
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/crawl-runs/${crawlRun.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getCrawlRun).toHaveBeenCalledWith(crawlRun.id);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/crawl-runs/${crawlRun.id}/approve`,
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveCrawlRun).toHaveBeenCalledWith(crawlRun.id);

    const retryResponse = await app.inject({
      method: "POST",
      url: `/crawl-runs/${crawlRun.id}/retry-auth`,
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryAuth).toHaveBeenCalledWith(crawlRun.id);

    const exportResponse = await app.inject({
      method: "GET",
      url: `/crawl-runs/${crawlRun.id}/export`,
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(getExports).toHaveBeenCalledWith(crawlRun.id);
  });

  it("returns 404 when a crawl run does not exist", async () => {
    const service = {
      createSite: vi.fn(),
      enqueueSiteDiscovery: vi.fn(),
      publishRecipe: vi.fn(),
      enqueueSiteRun: vi.fn(),
      getJob: vi.fn(),
      approveReview: vi.fn(),
      testSink: vi.fn(),
      enqueueSessionReauth: vi.fn(),
    };

    const urlCrawlService = {
      enqueueFromUrl: vi.fn(),
      getCrawlRun: vi.fn().mockResolvedValue({
        crawlRun: null,
        exports: [],
      }),
      approveCrawlRun: vi.fn(),
      retryAuth: vi.fn(),
      getExports: vi.fn().mockResolvedValue([]),
    };

    const app = await buildApp(service as never, urlCrawlService as never);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/crawl-runs/missing",
    });

    expect(response.statusCode).toBe(404);
  });
});
