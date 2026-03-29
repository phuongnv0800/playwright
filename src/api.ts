import { createRuntime } from "./bootstrap.js";
import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const runtime = await createRuntime();
const app = await buildApp(runtime.service, runtime.urlCrawlService);

const close = async () => {
  await app.close();
  await runtime.close();
};

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

await app.listen({
  host: "0.0.0.0",
  port: env.PORT,
});
