import { chromium, type Locator, type Page } from "playwright";

import { env } from "../../config/env.js";
import { sha256 } from "../../lib/hash.js";
import type {
  ExtractedRecord,
  RawArtifact,
  RecipeField,
  SourceConnector,
  SourceConnectorRunContext,
  SourceConnectorRunResult,
} from "../../types.js";

function toAbsoluteUrl(baseUrl: string, target: string): string {
  try {
    return new URL(target, baseUrl).toString();
  } catch {
    return target;
  }
}

async function readField(root: Locator, field: RecipeField): Promise<unknown> {
  const target = root.locator(field.selector).first();
  if ((await target.count()) === 0) {
    return undefined;
  }

  if (field.attr) {
    return target.getAttribute(field.attr);
  }

  return (await target.textContent())?.trim();
}

async function readDetailFields(page: Page, fields: RecipeField[]): Promise<Record<string, unknown>> {
  const detailFields = fields.filter((field) => field.scope === "detail");
  const data: Record<string, unknown> = {};
  for (const field of detailFields) {
    const locator = page.locator(field.selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    data[field.name] = field.attr ? await locator.getAttribute(field.attr) : (await locator.textContent())?.trim();
  }
  return data;
}

function normalizeRecord(params: {
  raw: Record<string, unknown>;
  externalIdField?: string;
  titleField?: string;
  requiredFields: string[];
}): ExtractedRecord {
  const externalIdCandidate =
    (params.externalIdField ? params.raw[params.externalIdField] : undefined) ??
    params.raw.id ??
    params.raw.externalId ??
    params.raw.code;
  const externalId =
    typeof externalIdCandidate === "string" && externalIdCandidate.trim().length > 0
      ? externalIdCandidate.trim()
      : sha256(JSON.stringify(params.raw));
  const titleKey = params.titleField ?? Object.keys(params.raw)[0];
  const title = titleKey ? params.raw[titleKey] : undefined;
  const missingFields = params.requiredFields.filter((field) => {
    const value = params.raw[field];
    return value === undefined || value === null || value === "";
  });

  return {
    externalId,
    data: {
      ...params.raw,
      title: title ?? externalId,
    },
    confidence: missingFields.length === 0 ? 1 : 0.45,
    status: missingFields.length === 0 ? "approved" : "needs_review",
    reviewNotes: missingFields.length === 0 ? undefined : `Missing required fields: ${missingFields.join(", ")}`,
  };
}

export class GenericRecipeSourceConnector implements SourceConnector {
  readonly type = "generic-recipe";

  async run(context: SourceConnectorRunContext): Promise<SourceConnectorRunResult> {
    if (!context.recipe.discovery || !context.recipe.normalization) {
      throw new Error("generic-recipe connector requires discovery and normalization metadata");
    }

    const requests: string[] = [];
    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });

    const contextOptions =
      context.session?.state && Object.keys(context.session.state).length > 0
        ? {
            storageState: context.session.state as Parameters<typeof browser.newContext>[0] extends infer T
              ? T extends { storageState?: unknown }
                ? T["storageState"]
                : never
              : never,
          }
        : {};

    const browserContext = await browser.newContext(contextOptions);

    try {
      const page = await browserContext.newPage();
      page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      page.on("request", (request) => {
        requests.push(request.url());
      });

      const listUrl = context.recipe.discovery.listUrl ?? context.recipe.entryUrl;
      await page.goto(listUrl, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(context.recipe.discovery.waitForSelector);

      const locator = page.locator(context.recipe.discovery.listItemSelector);
      const count = await locator.count();
      const records: ExtractedRecord[] = [];

      const itemFields = context.recipe.discovery.fields.filter((field) => field.scope !== "detail");
      const detailFields = context.recipe.discovery.fields.filter((field) => field.scope === "detail");

      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        const data: Record<string, unknown> = {};

        for (const field of itemFields) {
          data[field.name] = await readField(item, field);
        }

        const detailLinkSelector = context.recipe.discovery.detailLinkSelector;
        if (detailLinkSelector && detailFields.length > 0) {
          const detailLink = await item.locator(detailLinkSelector).first().getAttribute("href");
          if (detailLink) {
            const detailPage = await browserContext.newPage();
            await detailPage.goto(toAbsoluteUrl(context.site.baseUrl, detailLink), {
              waitUntil: "domcontentloaded",
            });
            Object.assign(data, await readDetailFields(detailPage, detailFields));
            await detailPage.close();
          }
        }

        records.push(
          normalizeRecord({
            raw: data,
            externalIdField: context.recipe.normalization.externalIdField,
            titleField: context.recipe.normalization.titleField,
            requiredFields: context.site.fieldList,
          }),
        );
      }

      const screenshot = await page.screenshot({
        fullPage: true,
        type: "png",
      });

      const artifacts: Omit<RawArtifact, "id" | "jobId" | "siteId">[] = [
        {
          artifactType: "html",
          artifactKey: "list-page",
          content: await page.content(),
          metadata: {
            url: page.url(),
          },
        },
        {
          artifactType: "screenshot",
          artifactKey: "list-page",
          content: screenshot.toString("base64"),
          metadata: {
            encoding: "base64",
            format: "png",
          },
        },
        {
          artifactType: "network",
          artifactKey: "request-log",
          content: JSON.stringify(requests, null, 2),
          metadata: {
            count: requests.length,
          },
        },
      ];

      return {
        artifacts,
        records,
      };
    } finally {
      await browserContext.close();
      await browser.close();
    }
  }
}
