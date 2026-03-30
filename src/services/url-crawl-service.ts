import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

import { env } from "../config/env.js";
import { renderCsv } from "../lib/csv.js";
import { renderTemplate } from "../lib/template.js";
import type { CrawlRunRepository } from "../repositories/crawl-run-repository.js";
import type { PlatformRepository } from "../repositories/platform-repository.js";
import { extractPageHeuristics } from "./page-heuristics.js";
import type { PlatformQueue } from "./platform-queue.js";
import { queueNames } from "./platform-queue.js";
import type {
  AIProvider,
  AutoDiscoveryAuthStrategy,
  CrawlAuthInput,
  CrawlConfig,
  CrawlPageKind,
  CrawlRun,
  CrawlSinkInput,
  DiscoveredLink,
  ExtractedRecord,
  MappingTemplate,
  NormalizedEntity,
  PageHeuristicProfile,
  RawArtifact,
  SinkConnector,
  SinkDefinition,
  SiteAccount,
  SiteDefinition,
  SourceRecipe,
} from "../types.js";
import type { AuthOrchestrator } from "./auth-orchestrator.js";

const defaultCrawlConfig: CrawlConfig = {
  maxDepth: 2,
  maxPages: 200,
  maxRecords: 100,
  sameOriginOnly: true,
};

const defaultSinkConfig: CrawlSinkInput = {
  enabled: false,
};

function sanitizeSlugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveSiteIdentity(seedUrl: string): {
  slug: string;
  name: string;
  baseUrl: string;
  objective: string;
} {
  const parsed = new URL(seedUrl);
  const firstPath = parsed.pathname.split("/").filter(Boolean)[0] ?? "root";
  const slug = `${sanitizeSlugPart(parsed.hostname)}-${sanitizeSlugPart(firstPath)}`;
  return {
    slug,
    name: `${parsed.hostname} ${firstPath}`.trim(),
    baseUrl: parsed.origin,
    objective: `Auto-discovered crawl for ${seedUrl}`,
  };
}

function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const param of [...parsed.searchParams.keys()]) {
    if (/^utm_|^fbclid$|^gclid$/.test(param)) {
      parsed.searchParams.delete(param);
    }
  }
  return parsed.toString();
}

function sameOrigin(originA: string, originB: string): boolean {
  return new URL(originA).origin === new URL(originB).origin;
}

function clearManualOtpCode(authConfig: CrawlAuthInput): CrawlAuthInput {
  if (authConfig.otp?.mode !== "manual") {
    return authConfig;
  }

  return {
    ...authConfig,
    otp: {
      ...authConfig.otp,
      config: {},
    },
  };
}

function shouldDenyUrl(url: string, denyPatterns: string[]): string | null {
  for (const pattern of denyPatterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(url)) {
      return pattern;
    }
  }
  return null;
}

function inferBootstrapAuthStrategy(seedUrl: string, profile: PageHeuristicProfile, authConfig: CrawlAuthInput): AutoDiscoveryAuthStrategy {
  if (authConfig.mode === "none") {
    return {
      mode: "none",
    };
  }

  const successUrlContains = new URL(seedUrl).pathname || "/";
  const oauthTexts = profile.links
    .map((link) => link.text.trim())
    .filter((text) => /(google|microsoft|oauth|sso|continue with|sign in with)/i.test(text))
    .slice(0, 3);

  if (authConfig.mode === "oauth" || (authConfig.mode === "auto" && oauthTexts.length > 0 && !profile.hasPasswordForm)) {
    return {
      mode: "oauth",
      loginUrl: profile.url,
      oauthTriggerTexts: oauthTexts.length > 0 ? oauthTexts : undefined,
      successUrlContains,
    };
  }

  return {
    mode: "form",
    loginUrl: profile.url,
    successUrlContains,
  };
}

export function shouldBootstrapAuthentication(seedUrl: string, authConfig: CrawlAuthInput, profile: PageHeuristicProfile): boolean {
  if (authConfig.mode === "none") {
    return false;
  }

  if (profile.hasPasswordForm) {
    return true;
  }

  const authText = [profile.url, profile.title, profile.textExcerpt].join(" ");
  if (/(login|sign[\s-]?in|đăng nhập|authentication|oauth|sso|cas)/i.test(authText)) {
    return true;
  }

  return !sameOrigin(profile.url, seedUrl);
}

export function buildBootstrapAuthRecipe(
  site: SiteDefinition,
  seedUrl: string,
  authConfig: CrawlAuthInput,
  profile: PageHeuristicProfile,
): SourceRecipe {
  return {
    version: 0,
    connectorType: "url-discovery",
    entryUrl: seedUrl,
    authRequired: authConfig.mode !== "none",
    autoDiscovery: {
      entityType: site.entityType,
      fields: site.fieldList.length > 0 ? site.fieldList : ["title", "url", "summary", "content"],
      authStrategy: inferBootstrapAuthStrategy(seedUrl, profile, authConfig),
      pageKinds: [],
      navigation: {
        ...defaultCrawlConfig,
        allowPatterns: ["^https?://"],
        denyPatterns: ["logout", "signout", "delete", "remove", "mailto:", "tel:"],
      },
      verification: {
        sampleUrls: [seedUrl, profile.url],
        artifacts: ["bootstrap-auth"],
        notes: "Temporary auth bootstrap recipe used before discovery on protected sites.",
      },
    },
    notes: "Bootstrap auth recipe",
  };
}

async function readText(locator: Locator, selector: string): Promise<string | undefined> {
  const target = locator.locator(selector).first();
  if ((await target.count()) === 0) {
    return undefined;
  }
  return (await target.textContent())?.replace(/\s+/g, " ").trim() || undefined;
}

async function readHref(locator: Locator, selector: string): Promise<string | undefined> {
  const target = locator.locator(selector).first();
  if ((await target.count()) === 0) {
    return undefined;
  }
  return (await target.getAttribute("href")) ?? undefined;
}

interface UrlCrawlServiceDeps {
  platformRepository: PlatformRepository;
  crawlRepository: CrawlRunRepository;
  queue: PlatformQueue;
  authOrchestrator: AuthOrchestrator;
  aiProvider: AIProvider;
  sinkConnectors: Map<string, SinkConnector>;
}

export class UrlCrawlService {
  constructor(private readonly deps: UrlCrawlServiceDeps) {}

  async enqueueFromUrl(input: {
    url: string;
    auth?: Partial<CrawlAuthInput>;
    sink?: Partial<CrawlSinkInput>;
    crawl?: Partial<CrawlConfig>;
  }): Promise<CrawlRun> {
    const identity = deriveSiteIdentity(input.url);
    const site = await this.deps.crawlRepository.createOrUpdateAutoSite(identity);
    const authConfig: CrawlAuthInput = {
      mode: input.auth?.mode ?? "auto",
      credentials: input.auth?.credentials ?? {},
      otp: input.auth?.otp,
      captcha: input.auth?.captcha,
    };
    await this.deps.crawlRepository.upsertDefaultAccount(site.id, authConfig);

    const job = await this.deps.platformRepository.createJob({
      siteId: site.id,
      jobType: "crawl.url",
      payload: {
        seedUrl: input.url,
      },
    });

    const crawlRun = await this.deps.crawlRepository.createCrawlRun({
      siteId: site.id,
      jobId: job.id,
      seedUrl: input.url,
      authConfig,
      crawlConfig: {
        ...defaultCrawlConfig,
        ...(input.crawl ?? {}),
      },
      sinkConfig: {
        ...defaultSinkConfig,
        ...(input.sink ?? {}),
      },
    });

    await this.deps.queue.publish(queueNames.crawlUrl, {
      jobRunId: job.id,
      siteId: site.id,
      crawlRunId: crawlRun.id,
    });

    return crawlRun;
  }

  async getCrawlRun(crawlRunId: string): Promise<{
    crawlRun: CrawlRun | null;
    exports: Awaited<ReturnType<CrawlRunRepository["listExports"]>>;
  }> {
    const crawlRun = await this.deps.crawlRepository.getCrawlRun(crawlRunId);
    const exports = crawlRun ? await this.deps.crawlRepository.listExports(crawlRunId) : [];
    return {
      crawlRun,
      exports,
    };
  }

  async listCrawlRuns(limit = 20): Promise<CrawlRun[]> {
    return this.deps.crawlRepository.listCrawlRuns(limit);
  }

  async getJsonView(crawlRunId: string): Promise<{
    crawlRun: CrawlRun;
    job: Awaited<ReturnType<PlatformRepository["getJob"]>>;
    exports: Awaited<ReturnType<CrawlRunRepository["listExports"]>>;
    pages: Awaited<ReturnType<CrawlRunRepository["listCrawlPages"]>>;
    challenges: Awaited<ReturnType<CrawlRunRepository["listChallengeAttempts"]>>;
    entities: Awaited<ReturnType<CrawlRunRepository["listEntitiesByJobId"]>>;
    files: Record<string, unknown>;
  }> {
    const crawlRun = await this.requireCrawlRun(crawlRunId);
    const [job, exports, pages, challenges, entities] = await Promise.all([
      this.deps.platformRepository.getJob(crawlRun.jobId),
      this.deps.crawlRepository.listExports(crawlRun.id),
      this.deps.crawlRepository.listCrawlPages(crawlRun.id),
      this.deps.crawlRepository.listChallengeAttempts(crawlRun.id),
      this.deps.crawlRepository.listEntitiesByJobId(crawlRun.jobId),
    ]);

    const files: Record<string, unknown> = {};
    for (const entry of exports) {
      if (!entry.exportType.endsWith(".json")) {
        continue;
      }
      try {
        files[entry.exportType] = JSON.parse(await readFile(entry.path, "utf8")) as unknown;
      } catch {
        files[entry.exportType] = {
          error: "Unable to read export file",
          path: entry.path,
        };
      }
    }

    return {
      crawlRun,
      job,
      exports,
      pages,
      challenges,
      entities,
      files,
    };
  }

  async approveCrawlRun(crawlRunId: string): Promise<CrawlRun> {
    const crawlRun = await this.requireCrawlRun(crawlRunId);
    const nextVersion = await this.deps.platformRepository.getNextRecipeVersion(crawlRun.siteId);
    const latestVersion = nextVersion - 1;
    if (latestVersion > 0) {
      const latest = await this.deps.platformRepository.getRecipeByVersion(crawlRun.siteId, latestVersion);
      if (latest) {
        await this.deps.platformRepository.publishRecipe(crawlRun.siteId, latest.version);
      }
    }

    const job = await this.deps.platformRepository.createJob({
      siteId: crawlRun.siteId,
      jobType: "crawl.url",
      payload: {
        seedUrl: crawlRun.seedUrl,
        approved: true,
      },
    });

    const updated = await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      jobId: job.id,
      status: "queued",
      discoveryStatus: "queued",
      authStatus: "queued",
      crawlStatus: "queued",
      deliveryStatus: "queued",
      reviewReason: null,
      markStarted: false,
      markFinished: false,
    });

    await this.deps.queue.publish(queueNames.crawlUrl, {
      jobRunId: job.id,
      siteId: crawlRun.siteId,
      crawlRunId: crawlRun.id,
    });

    return updated;
  }

  async retryAuth(crawlRunId: string): Promise<CrawlRun> {
    const crawlRun = await this.requireCrawlRun(crawlRunId);
    const nextAuthConfig = clearManualOtpCode(crawlRun.authConfig);
    return this.requeueCrawlRun(crawlRun, {
      seedUrl: crawlRun.seedUrl,
      retryAuth: true,
    }, nextAuthConfig);
  }

  async submitOtp(crawlRunId: string, code: string): Promise<CrawlRun> {
    const crawlRun = await this.requireCrawlRun(crawlRunId);
    const nextAuthConfig: CrawlAuthInput = {
      ...crawlRun.authConfig,
      otp: {
        mode: "manual",
        config: {
          code,
        },
      },
    };
    return this.requeueCrawlRun(
      crawlRun,
      {
        seedUrl: crawlRun.seedUrl,
        retryAuth: true,
        manualOtp: true,
      },
      nextAuthConfig,
    );
  }

  private async requeueCrawlRun(crawlRun: CrawlRun, payload: Record<string, unknown>, authConfig = crawlRun.authConfig): Promise<CrawlRun> {
    const job = await this.deps.platformRepository.createJob({
      siteId: crawlRun.siteId,
      jobType: "crawl.url",
      payload,
    });

    const updated = await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      jobId: job.id,
      status: "queued",
      authConfig,
      discoveryStatus: "queued",
      authStatus: "queued",
      crawlStatus: "queued",
      deliveryStatus: "queued",
      reviewReason: null,
    });

    await this.deps.queue.publish(queueNames.crawlUrl, {
      jobRunId: job.id,
      siteId: crawlRun.siteId,
      crawlRunId: crawlRun.id,
    });

    return updated;
  }

  async getExports(crawlRunId: string) {
    await this.requireCrawlRun(crawlRunId);
    return this.deps.crawlRepository.listExports(crawlRunId);
  }

  async handleCrawlRunJob(jobRunId: string, crawlRunId: string): Promise<void> {
    const crawlRun = await this.requireCrawlRun(crawlRunId);
    const site = await this.requireSite(crawlRun.siteId);
    const account = await this.deps.platformRepository.getDefaultAccountBySiteId(site.id);

    await this.deps.platformRepository.updateJobStatus({
      jobId: jobRunId,
      status: "running",
      markStarted: true,
    });
    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      status: "running",
      discoveryStatus: "running",
      authStatus: crawlRun.authConfig.mode === "none" ? "skipped" : "queued",
      crawlStatus: "queued",
      deliveryStatus: "queued",
      markStarted: true,
    });

    try {
      let recipe = await this.deps.platformRepository.getPublishedRecipe(site.id);
      let verificationSeed: PageHeuristicProfile | null = null;

      if (!recipe) {
        const bootstrap = await this.captureProfiles(site, crawlRun, undefined);
        let discoverySeed = bootstrap.seedProfile;
        let discoverySamples = bootstrap.sampleProfiles;
        verificationSeed = bootstrap.seedProfile;

        if (shouldBootstrapAuthentication(crawlRun.seedUrl, crawlRun.authConfig, bootstrap.seedProfile)) {
          const bootstrapRecipe = buildBootstrapAuthRecipe(site, crawlRun.seedUrl, crawlRun.authConfig, bootstrap.seedProfile);
          const authResult = await this.runAuthIfNeeded(site, account, bootstrapRecipe, crawlRun);
          if (authResult.status !== "ready") {
            await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
              discoveryStatus: "needs_review",
              crawlStatus: "queued",
              deliveryStatus: "queued",
            });
            return;
          }
          const authenticatedBootstrap = await this.captureProfiles(site, crawlRun, authResult.accountSession);
          discoverySeed = authenticatedBootstrap.seedProfile;
          discoverySamples = authenticatedBootstrap.sampleProfiles;
          verificationSeed = authenticatedBootstrap.seedProfile;
        }

        const plan = await this.planRecipe(site, crawlRun, discoverySeed, discoverySamples);
        const discoveryOutcome = await this.persistRecipeDecision(site, crawlRun, plan);
        if (discoveryOutcome.status !== "ready" || !discoveryOutcome.recipe) {
          return;
        }
        recipe = discoveryOutcome.recipe;
      } else {
        const authResult = await this.runAuthIfNeeded(site, account, recipe.recipe, crawlRun);
        if (authResult.status !== "ready") {
          await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
            discoveryStatus: "succeeded",
            crawlStatus: "queued",
            deliveryStatus: "queued",
          });
          return;
        }
        const bootstrap = await this.captureProfiles(site, crawlRun, authResult.accountSession);
        verificationSeed = bootstrap.seedProfile;
        const verified = await this.verifyRecipe(site, recipe.recipe, bootstrap.seedProfile, bootstrap.sampleProfiles, authResult.accountSession);
        if (!verified.ok) {
          const repaired = await this.deps.aiProvider.repairRecipe({
            recipe: recipe.recipe,
            failedProfile: bootstrap.seedProfile,
            failureReason: verified.reason,
          });
          await this.persistRecipeDecision(site, crawlRun, repaired, true);
          return;
        }
      }

      if (!recipe) {
        throw new Error("No recipe available after discovery.");
      }

      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        discoveryStatus: "succeeded",
        publishedRecipeVersion: recipe.version,
      });

      const authResult = await this.runAuthIfNeeded(site, account, recipe.recipe, crawlRun);
      if (authResult.status !== "ready") {
        await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
          discoveryStatus: "succeeded",
          crawlStatus: "queued",
          deliveryStatus: "queued",
        });
        return;
      }

      if (verificationSeed) {
        await this.deps.crawlRepository.recordDiscoveredProfile({
          crawlRunId: crawlRun.id,
          url: verificationSeed.url,
          pageKind: "seed",
          confidence: 1,
          profile: verificationSeed,
        });
      }

      const crawlResult = await this.executeCrawl(site, crawlRun, recipe.recipe, authResult.accountSession);
      const exportResult = await this.writeExports(crawlRun, site, crawlResult);
      const deliveryResult = await this.deliver(site, crawlRun, crawlResult.entities, crawlRun.sinkConfig, jobRunId);

      const finalStatus = deliveryResult.partialFailure ? "partial_success" : crawlResult.needsReview ? "needs_review" : "succeeded";
      await this.deps.platformRepository.updateJobStatus({
        jobId: jobRunId,
        status: finalStatus,
        markFinished: true,
        result: {
          records: crawlResult.entities.length,
          exports: exportResult.exports.map((entry) => entry.path),
          partialFailure: deliveryResult.partialFailure,
        },
      });
      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        status: finalStatus,
        discoveryStatus: "succeeded",
        authStatus: authResult.accountSession || crawlRun.authConfig.mode !== "none" ? "succeeded" : "skipped",
        crawlStatus: crawlResult.needsReview ? "needs_review" : "succeeded",
        deliveryStatus: deliveryResult.status,
        exportDir: exportResult.outputDir,
        reviewReason: crawlResult.reviewReason ?? null,
        markFinished: true,
      });
    } catch (error) {
      await this.deps.platformRepository.updateJobStatus({
        jobId: jobRunId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown crawl error",
        markFinished: true,
      });
      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        status: "failed",
        discoveryStatus: crawlRun.discoveryStatus === "running" ? "failed" : crawlRun.discoveryStatus,
        authStatus: crawlRun.authStatus === "running" ? "failed" : crawlRun.authStatus,
        crawlStatus: crawlRun.crawlStatus === "running" ? "failed" : crawlRun.crawlStatus,
        deliveryStatus: crawlRun.deliveryStatus === "running" ? "failed" : crawlRun.deliveryStatus,
        reviewReason: error instanceof Error ? error.message : "Unknown crawl error",
        markFinished: true,
      });
      throw error;
    }
  }

  private async persistRecipeDecision(
    site: SiteDefinition,
    crawlRun: CrawlRun,
    plan: Awaited<ReturnType<AIProvider["planDiscovery"]>>,
    isRepair = false,
  ): Promise<{ status: "ready"; recipe: Awaited<ReturnType<PlatformRepository["getPublishedRecipe"]>> } | { status: "stopped" }> {
    const entityType = plan.recipe.autoDiscovery?.entityType ?? "Record";
    const fields = plan.recipe.autoDiscovery?.fields ?? ["title", "url", "summary", "content"];
    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      entityType,
      confidence: plan.confidence,
    });
    await this.deps.crawlRepository.updateSiteDiscovery(site.id, entityType, fields, site.objective);

    const version = await this.deps.platformRepository.getNextRecipeVersion(site.id);
    plan.recipe.version = version;
    const recipe = await this.deps.platformRepository.createRecipe({
      siteId: site.id,
      version,
      recipe: plan.recipe,
      confidence: plan.confidence,
      aiProvider: this.deps.aiProvider.name,
      notes: plan.notes,
    });

    if (plan.confidence >= 0.85) {
      const published = await this.deps.platformRepository.publishRecipe(site.id, recipe.version);
      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        discoveryStatus: "succeeded",
        publishedRecipeVersion: published.version,
        confidence: plan.confidence,
        entityType,
      });
      return {
        status: "ready",
        recipe: published,
      };
    }

    const reviewReason =
      plan.confidence >= 0.6
        ? isRepair
          ? "Recipe repair needs review before crawl resumes."
          : "Discovery confidence below auto-publish threshold."
        : "Discovery confidence too low to proceed automatically.";

    const status = plan.confidence >= 0.6 ? "needs_review" : "failed";
    await this.deps.platformRepository.updateJobStatus({
      jobId: crawlRun.jobId,
      status,
      markFinished: true,
      result: {
        confidence: plan.confidence,
        recipeVersion: recipe.version,
      },
      error: plan.confidence >= 0.6 ? undefined : reviewReason,
    });
    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      status,
      discoveryStatus: plan.confidence >= 0.6 ? "needs_review" : "failed",
      reviewReason,
      confidence: plan.confidence,
      publishedRecipeVersion: null,
      markFinished: plan.confidence < 0.6,
    });

    return {
      status: "stopped",
    };
  }

  private async planRecipe(
    site: SiteDefinition,
    crawlRun: CrawlRun,
    seedProfile: PageHeuristicProfile,
    sampleProfiles: PageHeuristicProfile[],
  ) {
    const entityType = await this.deps.aiProvider.inferEntityType({
      seedUrl: crawlRun.seedUrl,
      seedProfile,
      sampleProfiles,
    });
    const plan = await this.deps.aiProvider.planDiscovery({
      site,
      seedUrl: crawlRun.seedUrl,
      auth: crawlRun.authConfig,
      crawl: crawlRun.crawlConfig,
      seedProfile,
      sampleProfiles,
    });
    if (plan.recipe.autoDiscovery) {
      plan.recipe.autoDiscovery.entityType = entityType.entityType;
    }
    return plan;
  }

  private async runAuthIfNeeded(
    site: SiteDefinition,
    account: SiteAccount | null,
    recipe: SourceRecipe,
    crawlRun: CrawlRun,
  ): Promise<{ status: "ready"; accountSession?: SiteAccount extends never ? never : import("../types.js").SessionState } | { status: "stopped" }> {
    if (crawlRun.authConfig.mode === "none" || recipe.autoDiscovery?.authStrategy.mode === "none") {
      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        authStatus: "skipped",
      });
      return {
        status: "ready",
      };
    }

    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      authStatus: "running",
    });

    const result = await this.deps.authOrchestrator.ensureAuthenticated(site, account, recipe, crawlRun.authConfig);
    const manualOtpAttempted =
      crawlRun.authConfig.otp?.mode === "manual" && String(crawlRun.authConfig.otp.config.code ?? "").trim().length > 0;
    const nextAuthConfig = clearManualOtpCode(crawlRun.authConfig);
    for (const event of result.events) {
      await this.deps.crawlRepository.recordChallengeAttempt({
        crawlRunId: crawlRun.id,
        challengeType: event.type,
        status: event.status,
        detail: event.detail,
      });
    }
    if (manualOtpAttempted && result.status === "needs_review") {
      await this.deps.crawlRepository.recordChallengeAttempt({
        crawlRunId: crawlRun.id,
        challengeType: "otp",
        status: "needs_review",
        detail: {
          mode: "manual",
          action: "resubmit_required",
        },
      });
    }

    if (result.status === "succeeded") {
      await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
        authStatus: "succeeded",
        authConfig: nextAuthConfig,
      });
      return {
        status: "ready",
        accountSession: result.session,
      };
    }

    await this.deps.platformRepository.updateJobStatus({
      jobId: crawlRun.jobId,
      status: result.status === "needs_review" ? "needs_review" : "failed",
      error: result.reviewReason,
      markFinished: result.status !== "needs_review",
    });
    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      status: result.status === "needs_review" ? "needs_review" : "failed",
      authStatus: result.status === "needs_review" ? "needs_review" : "failed",
      authConfig: nextAuthConfig,
      reviewReason:
        result.status === "needs_review" &&
        crawlRun.authConfig.otp?.mode === "manual" &&
        String(crawlRun.authConfig.otp.config.code ?? "").trim()
          ? "OTP da duoc dung 1 lan va da duoc xoa. Hay nhap OTP moi de thu lai."
          : (result.reviewReason ?? null),
      markFinished: result.status !== "needs_review",
    });
    return {
      status: "stopped",
    };
  }

  private async captureProfiles(
    site: SiteDefinition,
    crawlRun: CrawlRun,
    session: import("../types.js").SessionState | undefined,
  ): Promise<{ seedProfile: PageHeuristicProfile; sampleProfiles: PageHeuristicProfile[] }> {
    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });
    const context = await browser.newContext(
      session?.state && Object.keys(session.state).length > 0 ? { storageState: session.state as never } : undefined,
    );

    try {
      const { page, requests } = await this.openPage(context, crawlRun.seedUrl);
      const seedProfile = await extractPageHeuristics(page, requests);
      const links = this.pickSampleLinks(seedProfile.links, site.baseUrl, crawlRun.crawlConfig.sameOriginOnly);
      const sampleProfiles: PageHeuristicProfile[] = [];

      for (const link of links.slice(0, 2)) {
        const result = await this.openPage(context, link.href);
        sampleProfiles.push(await extractPageHeuristics(result.page, result.requests));
        await result.page.close();
      }

      await page.close();
      return {
        seedProfile,
        sampleProfiles,
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private pickSampleLinks(links: DiscoveredLink[], baseUrl: string, sameOriginOnly: boolean): DiscoveredLink[] {
    const seen = new Set<string>();
    const result: DiscoveredLink[] = [];
    for (const link of links) {
      if (!/^https?:/i.test(link.href)) {
        continue;
      }
      if (sameOriginOnly && !sameOrigin(link.href, baseUrl)) {
        continue;
      }
      if (/(logout|signout|delete|remove|download|mailto:|tel:)/i.test(link.href)) {
        continue;
      }
      const canonical = canonicalizeUrl(link.href);
      if (seen.has(canonical)) {
        continue;
      }
      seen.add(canonical);
      result.push({
        ...link,
        href: canonical,
      });
      if (result.length >= 4) {
        break;
      }
    }
    return result;
  }

  private async verifyRecipe(
    site: SiteDefinition,
    recipe: SourceRecipe,
    seedProfile: PageHeuristicProfile,
    sampleProfiles: PageHeuristicProfile[],
    session: import("../types.js").SessionState | undefined,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!recipe.autoDiscovery) {
      return {
        ok: false,
        reason: "Recipe is missing autoDiscovery metadata.",
      };
    }

    const listPage = recipe.autoDiscovery.pageKinds.find((page) => page.kind === "list");
    const detailPage = recipe.autoDiscovery.pageKinds.find((page) => page.kind === "detail");

    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });
    const context = await browser.newContext(
      session?.state && Object.keys(session.state).length > 0 ? { storageState: session.state as never } : undefined,
    );

    try {
      const urls = [seedProfile.url, ...sampleProfiles.map((profile) => profile.url)].slice(0, 3);
      for (const url of urls) {
        const { page } = await this.openPage(context, url);
        if (listPage?.itemSelector && (await page.locator(listPage.itemSelector).count()) > 0) {
          await page.close();
          continue;
        }
        if (detailPage?.contentSelector && (await page.locator(detailPage.contentSelector).count()) > 0) {
          await page.close();
          continue;
        }
        await page.close();
        return {
          ok: false,
          reason: `Recipe verification failed on ${url}`,
        };
      }

      return {
        ok: true,
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async executeCrawl(
    site: SiteDefinition,
    crawlRun: CrawlRun,
    recipe: SourceRecipe,
    session: import("../types.js").SessionState | undefined,
  ): Promise<{ entities: NormalizedEntity[]; needsReview: boolean; reviewReason?: string }> {
    if (!recipe.autoDiscovery) {
      throw new Error("Auto-discovery recipe is required for URL crawl.");
    }

    await this.deps.crawlRepository.updateCrawlRun(crawlRun.id, {
      crawlStatus: "running",
    });

    const browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });
    const context = await browser.newContext(
      session?.state && Object.keys(session.state).length > 0 ? { storageState: session.state as never } : undefined,
    );

    const queue: Array<{ url: string; depth: number; parentUrl?: string }> = [
      {
        url: crawlRun.seedUrl,
        depth: 0,
      },
    ];
    const visited = new Set<string>();
    const approvedEntities: NormalizedEntity[] = [];
    let needsReview = false;
    let reviewReason: string | undefined;

    try {
      while (queue.length > 0 && visited.size < crawlRun.crawlConfig.maxPages) {
        const next = queue.shift();
        if (!next) {
          continue;
        }

        const canonicalUrl = canonicalizeUrl(next.url);
        if (visited.has(canonicalUrl)) {
          continue;
        }
        visited.add(canonicalUrl);

        const deniedBy = shouldDenyUrl(canonicalUrl, recipe.autoDiscovery.navigation.denyPatterns);
        if (deniedBy) {
          await this.deps.crawlRepository.recordCrawlLink({
            crawlRunId: crawlRun.id,
            fromUrl: next.parentUrl ?? canonicalUrl,
            toUrl: canonicalUrl,
            decision: "blocked",
            reason: `Matched deny pattern ${deniedBy}`,
            depth: next.depth,
          });
          continue;
        }

        const { page, requests } = await this.openPage(context, canonicalUrl);
        const profile = await extractPageHeuristics(page, requests);
        const classified = await this.deps.aiProvider.classifyPage({
          recipe,
          profile,
        });

        await this.deps.crawlRepository.recordDiscoveredProfile({
          crawlRunId: crawlRun.id,
          url: canonicalUrl,
          pageKind: classified.pageKind,
          confidence: classified.confidence,
          profile,
        });
        await this.deps.crawlRepository.upsertCrawlPage({
          crawlRunId: crawlRun.id,
          url: canonicalUrl,
          canonicalUrl,
          pageKind: classified.pageKind,
          depth: next.depth,
          parentUrl: next.parentUrl,
          status: "visited",
          title: profile.title,
          confidence: classified.confidence,
          metadata: {
            notes: classified.notes,
          },
        });

        const pageArtifacts = await this.captureArtifacts(page, requests, visited.size);
        await this.deps.platformRepository.createArtifacts(site.id, crawlRun.jobId, pageArtifacts);

        const extracted = await this.extractRecordsForPage(site, recipe, page, profile, classified.pageKind);
        for (const record of extracted) {
          const entity = await this.deps.platformRepository.upsertNormalizedEntity({
            siteId: site.id,
            jobId: crawlRun.jobId,
            entityType: recipe.autoDiscovery.entityType,
            externalId: record.externalId,
            data: record.data,
            status: record.status,
            confidence: record.confidence,
            reviewNotes: record.reviewNotes,
          });
          approvedEntities.push(entity);
          if (entity.status === "needs_review") {
            needsReview = true;
            reviewReason = reviewReason ?? entity.reviewNotes ?? "Some extracted records need review.";
          }
          if (approvedEntities.length >= crawlRun.crawlConfig.maxRecords) {
            break;
          }
        }

        if (approvedEntities.length >= crawlRun.crawlConfig.maxRecords) {
          await page.close();
          break;
        }

        if (next.depth < crawlRun.crawlConfig.maxDepth) {
          for (const link of this.pickSampleLinks(profile.links, site.baseUrl, recipe.autoDiscovery.navigation.sameOriginOnly)) {
            const canonicalLink = canonicalizeUrl(link.href);
            const existing = visited.has(canonicalLink);
            await this.deps.crawlRepository.recordCrawlLink({
              crawlRunId: crawlRun.id,
              fromUrl: canonicalUrl,
              toUrl: canonicalLink,
              anchorText: link.text || undefined,
              decision: existing ? "duplicate" : "queued",
              reason: existing ? "Already visited" : undefined,
              depth: next.depth + 1,
            });
            if (!existing) {
              queue.push({
                url: canonicalLink,
                depth: next.depth + 1,
                parentUrl: canonicalUrl,
              });
            }
          }
        }

        await page.close();
      }
    } finally {
      await context.close();
      await browser.close();
    }

    return {
      entities: approvedEntities,
      needsReview,
      reviewReason,
    };
  }

  private async captureArtifacts(page: Page, requests: string[], index: number): Promise<Omit<RawArtifact, "id" | "siteId" | "jobId">[]> {
    const artifactPrefix = `page-${String(index).padStart(4, "0")}`;
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
    });
    return [
      {
        artifactType: "html",
        artifactKey: `${artifactPrefix}-html`,
        content: await page.content(),
        metadata: {
          url: page.url(),
        },
      },
      {
        artifactType: "screenshot",
        artifactKey: `${artifactPrefix}-screenshot`,
        content: screenshot.toString("base64"),
        metadata: {
          url: page.url(),
          encoding: "base64",
          format: "png",
        },
      },
      {
        artifactType: "network",
        artifactKey: `${artifactPrefix}-network`,
        content: JSON.stringify(requests, null, 2),
        metadata: {
          url: page.url(),
          count: requests.length,
        },
      },
    ];
  }

  private async extractRecordsForPage(
    site: SiteDefinition,
    recipe: SourceRecipe,
    page: Page,
    profile: PageHeuristicProfile,
    pageKind: CrawlPageKind,
  ): Promise<ExtractedRecord[]> {
    const auto = recipe.autoDiscovery;
    if (!auto) {
      return [];
    }

    if (pageKind === "list") {
      const listPage = auto.pageKinds.find((entry) => entry.kind === "list");
      if (!listPage?.itemSelector) {
        return [];
      }
      const items = page.locator(listPage.itemSelector);
      const count = Math.min(await items.count(), auto.navigation.maxRecords);
      const records: ExtractedRecord[] = [];
      for (let index = 0; index < count; index += 1) {
        const item = items.nth(index);
        const title =
          (listPage.titleSelector ? await readText(item, listPage.titleSelector) : undefined) ??
          (await readText(item, "a[href], h1, h2, h3, h4")) ??
          `Item ${index + 1}`;
        const href =
          (listPage.detailLinkSelector ? await readHref(item, listPage.detailLinkSelector) : undefined) ??
          (await readHref(item, "a[href]"));
        const absoluteUrl = href ? new URL(href, site.baseUrl).toString() : page.url();
        const summary =
          (listPage.summarySelector ? await readText(item, listPage.summarySelector) : undefined) ??
          normalizeInlineText(await item.textContent());
        const externalId = canonicalizeUrl(absoluteUrl);
        records.push({
          externalId,
          data: {
            title,
            url: absoluteUrl,
            sourceUrl: absoluteUrl,
            summary: summary?.slice(0, 300),
            discoveredOn: page.url(),
            pageKind,
          },
          confidence: title ? 0.88 : 0.55,
          status: title ? "approved" : "needs_review",
          reviewNotes: title ? undefined : "Missing title on list item extraction.",
        });
      }
      return records;
    }

    if (pageKind === "detail" || pageKind === "seed" || profile.textLength > 200) {
      const detailPage = auto.pageKinds.find((entry) => entry.kind === "detail");
      const title =
        (detailPage?.titleSelector ? await readText(page.locator("body"), detailPage.titleSelector) : undefined) ??
        profile.title;
      const contentLocator =
        detailPage?.contentSelector && (await page.locator(detailPage.contentSelector).count()) > 0
          ? page.locator(detailPage.contentSelector).first()
          : page.locator("main, article, body").first();
      const contentText = normalizeInlineText(await contentLocator.textContent());
      const contentHtml =
        (await contentLocator.count()) > 0 ? await contentLocator.evaluate((node) => node.innerHTML) : await page.content();
      return [
        {
          externalId: canonicalizeUrl(page.url()),
          data: {
            title,
            url: page.url(),
            sourceUrl: page.url(),
            summary: contentText?.slice(0, 300),
            content: contentText,
            contentHtml,
            pageKind,
          },
          confidence: title && contentText ? 0.92 : 0.58,
          status: title && contentText ? "approved" : "needs_review",
          reviewNotes: title && contentText ? undefined : "Detail page extraction is missing title or content.",
        },
      ];
    }

    return [];
  }

  private async writeExports(
    crawlRun: CrawlRun,
    site: SiteDefinition,
    crawlResult: { entities: NormalizedEntity[]; needsReview: boolean; reviewReason?: string },
  ): Promise<{ outputDir: string; exports: Array<{ type: string; path: string }> }> {
    const outputDir = path.resolve(env.CRAWL_EXPORT_DIR, crawlRun.id);
    await mkdir(outputDir, {
      recursive: true,
    });

    const entities = await this.deps.crawlRepository.listEntitiesByJobId(crawlRun.jobId);
    const artifacts = await this.deps.crawlRepository.listArtifactsByJobId(crawlRun.jobId);
    const artifactIndex = artifacts.map((artifact) => ({
      artifactType: artifact.artifactType,
      artifactKey: artifact.artifactKey,
      metadata: artifact.metadata,
    }));

    const jsonPath = path.join(outputDir, "records.json");
    const csvPath = path.join(outputDir, "records.csv");
    const summaryPath = path.join(outputDir, "summary.json");
    const artifactIndexPath = path.join(outputDir, "artifact-index.json");

    const rows = entities.map((entity) => ({
      externalId: entity.externalId,
      title: entity.data.title,
      url: entity.data.url,
      sourceUrl: entity.data.sourceUrl,
      summary: entity.data.summary,
      status: entity.status,
      confidence: entity.confidence,
    }));

    const summary = {
      crawlRunId: crawlRun.id,
      siteId: site.id,
      seedUrl: crawlRun.seedUrl,
      entityType: crawlRun.entityType ?? site.entityType,
      totalEntities: entities.length,
      approvedEntities: entities.filter((entity) => entity.status === "approved").length,
      needsReviewEntities: entities.filter((entity) => entity.status === "needs_review").length,
      totalArtifacts: artifacts.length,
      status: crawlResult.needsReview ? "needs_review" : "succeeded",
      reviewReason: crawlResult.reviewReason ?? null,
    };

    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify(entities, null, 2)}\n`, "utf8"),
      writeFile(csvPath, `${renderCsv(rows)}\n`, "utf8"),
      writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
      writeFile(artifactIndexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`, "utf8"),
    ]);

    await Promise.all([
      this.deps.crawlRepository.createExport({
        crawlRunId: crawlRun.id,
        exportType: "records.json",
        path: jsonPath,
        metadata: {
          count: entities.length,
        },
      }),
      this.deps.crawlRepository.createExport({
        crawlRunId: crawlRun.id,
        exportType: "records.csv",
        path: csvPath,
        metadata: {
          count: rows.length,
        },
      }),
      this.deps.crawlRepository.createExport({
        crawlRunId: crawlRun.id,
        exportType: "summary.json",
        path: summaryPath,
      }),
      this.deps.crawlRepository.createExport({
        crawlRunId: crawlRun.id,
        exportType: "artifact-index.json",
        path: artifactIndexPath,
        metadata: {
          count: artifactIndex.length,
        },
      }),
    ]);

    return {
      outputDir,
      exports: [
        { type: "records.json", path: jsonPath },
        { type: "records.csv", path: csvPath },
        { type: "summary.json", path: summaryPath },
        { type: "artifact-index.json", path: artifactIndexPath },
      ],
    };
  }

  private async deliver(
    site: SiteDefinition,
    crawlRun: CrawlRun,
    entities: NormalizedEntity[],
    sinkConfig: CrawlSinkInput,
    jobId: string,
  ): Promise<{ status: CrawlRun["deliveryStatus"]; partialFailure: boolean }> {
    if (!sinkConfig.enabled) {
      return {
        status: "skipped",
        partialFailure: false,
      };
    }

    const sinkBundle = await this.deps.crawlRepository.upsertDefaultSink(
      site.id,
      crawlRun.entityType ?? site.entityType,
      sinkConfig,
    );

    if (!sinkBundle) {
      return {
        status: "skipped",
        partialFailure: false,
      };
    }

    const connector = this.deps.sinkConnectors.get(sinkBundle.sink.sinkType);
    if (!connector) {
      throw new Error(`Sink connector ${sinkBundle.sink.sinkType} is not registered`);
    }

    let hasFailure = false;
    for (const entity of entities.filter((entry) => entry.status === "approved")) {
      const requestPayload = renderTemplate(sinkBundle.template.template, {
        entity,
        site,
      });

      const result = await connector.deliver({
        site,
        entity,
        sink: sinkBundle.sink,
        template: sinkBundle.template,
      });

      await this.deps.crawlRepository.createDeliveryRun({
        entityId: entity.id,
        sinkId: sinkBundle.sink.id,
        jobId,
        status: result.status,
        requestPayload,
        responsePayload: result.responsePayload,
        error: result.error,
      });

      if (result.status === "failed") {
        hasFailure = true;
      }
    }

    return {
      status: hasFailure ? "partial_success" : "succeeded",
      partialFailure: hasFailure,
    };
  }

  private async openPage(context: BrowserContext, url: string): Promise<{ page: Page; requests: string[] }> {
    const page = await context.newPage();
    const requests: string[] = [];
    page.setDefaultTimeout(env.PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
    page.on("request", (request) => {
      requests.push(request.url());
    });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });
    return {
      page,
      requests,
    };
  }

  private async requireCrawlRun(crawlRunId: string): Promise<CrawlRun> {
    const crawlRun = await this.deps.crawlRepository.getCrawlRun(crawlRunId);
    if (!crawlRun) {
      throw new Error(`Crawl run ${crawlRunId} not found`);
    }
    return crawlRun;
  }

  private async requireSite(siteId: string): Promise<SiteDefinition> {
    const site = await this.deps.platformRepository.getSite(siteId);
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }
    return site;
  }
}

function normalizeInlineText(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}
