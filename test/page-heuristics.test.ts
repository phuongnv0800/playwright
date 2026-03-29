import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { StubAIProvider } from "../src/connectors/ai/stub-ai-provider.js";
import { extractPageHeuristics } from "../src/services/page-heuristics.js";
import { createFixtureServer } from "./fixture-server.js";

describe("page heuristics and discovery fallback", () => {
  const servers: Array<Awaited<ReturnType<typeof createFixtureServer>>> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it("detects repeated groups on a public catalog page and drafts a url-discovery recipe", async () => {
    const fixture = await createFixtureServer();
    servers.push(fixture);

    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(`${fixture.baseUrl}/catalog`, {
        waitUntil: "domcontentloaded",
      });

      const profile = await extractPageHeuristics(page, requests);
      expect(profile.repeatedGroups[0]?.count).toBeGreaterThanOrEqual(3);

      const ai = new StubAIProvider();
      const planned = await ai.planDiscovery({
        site: {
          id: "site_fixture",
          slug: "fixture-catalog",
          name: "Fixture Catalog",
          baseUrl: fixture.baseUrl,
          objective: "Auto crawl from URL",
          entityType: "Record",
          fieldList: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        seedUrl: `${fixture.baseUrl}/catalog`,
        auth: {
          mode: "none",
        },
        crawl: {
          maxDepth: 2,
          maxPages: 10,
          maxRecords: 10,
          sameOriginOnly: true,
        },
        seedProfile: profile,
        sampleProfiles: [],
      });

      expect(planned.recipe.connectorType).toBe("url-discovery");
      expect(planned.recipe.autoDiscovery?.pageKinds.some((pageDefinition) => pageDefinition.kind === "list")).toBe(true);
      expect(planned.confidence).toBeGreaterThan(0.6);

      await context.close();
    } finally {
      await browser.close();
    }
  });
});
