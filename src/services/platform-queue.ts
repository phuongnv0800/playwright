import PgBoss, { type JobWithMetadata } from "pg-boss";

export const queueNames = {
  discover: "site.discover",
  run: "site.run",
  reauth: "session.reauth",
  crawlUrl: "crawl.url",
} as const;

export interface QueuePayload {
  jobRunId: string;
  siteId?: string;
  sessionId?: string;
  crawlRunId?: string;
}

export class PlatformQueue {
  constructor(private readonly boss: PgBoss) {}

  async start(): Promise<void> {
    await this.boss.start();
    for (const name of Object.values(queueNames)) {
      const existing = await this.boss.getQueue(name);
      if (!existing) {
        await this.boss.createQueue(name);
      }
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop();
  }

  async publish(name: string, payload: QueuePayload): Promise<string | null> {
    const jobId = await this.boss.send(name, payload);
    if (!jobId) {
      throw new Error(`Failed to enqueue job on queue ${name}`);
    }

    return jobId;
  }

  async work(
    name: string,
    handler: (job: JobWithMetadata<QueuePayload>) => Promise<void>,
  ): Promise<void> {
    await this.boss.work<QueuePayload>(name, { includeMetadata: true }, async (jobs) => {
      const job = jobs[0];
      if (!job) {
        return;
      }

      await handler(job);
    });
  }
}
