import Fastify from "fastify";

import { env } from "./config/env.js";
import type { PlatformService } from "./services/platform-service.js";
import type { UrlCrawlService } from "./services/url-crawl-service.js";
import { registerPlatformRoutes } from "./routes/platform-routes.js";
import { registerUiRoutes } from "./routes/ui-routes.js";

export async function buildApp(service: PlatformService, urlCrawlService: UrlCrawlService) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  await registerPlatformRoutes(app, service, urlCrawlService);
  await registerUiRoutes(app);
  return app;
}
