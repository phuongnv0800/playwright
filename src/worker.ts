import { createRuntime } from "./bootstrap.js";
import { queueNames } from "./services/platform-queue.js";

const runtime = await createRuntime();

await runtime.queue.work(queueNames.discover, async (job) => {
  if (!job.data.siteId) {
    throw new Error("siteId is required for discover jobs");
  }

  await runtime.service.handleDiscoverJob(job.data.jobRunId, job.data.siteId);
});

await runtime.queue.work(queueNames.run, async (job) => {
  if (!job.data.siteId) {
    throw new Error("siteId is required for run jobs");
  }

  await runtime.service.handleRunJob(job.data.jobRunId, job.data.siteId);
});

await runtime.queue.work(queueNames.reauth, async (job) => {
  if (!job.data.sessionId) {
    throw new Error("sessionId is required for reauth jobs");
  }

  await runtime.service.handleReauthJob(job.data.jobRunId, job.data.sessionId);
});

await runtime.queue.work(queueNames.crawlUrl, async (job) => {
  if (!job.data.crawlRunId) {
    throw new Error("crawlRunId is required for crawl.url jobs");
  }

  await runtime.urlCrawlService.handleCrawlRunJob(job.data.jobRunId, job.data.crawlRunId);
});

process.on("SIGINT", () => {
  void runtime.close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void runtime.close().finally(() => process.exit(0));
});

console.log("Worker started");
