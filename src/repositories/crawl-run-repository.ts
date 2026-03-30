import type { Pool, PoolClient, QueryResultRow } from "pg";

import { createId } from "../lib/ids.js";
import type {
  ChallengeAttempt,
  CrawlAuthInput,
  CrawlConfig,
  CrawlExport,
  CrawlLinkDecision,
  CrawlLinkRecord,
  CrawlPageKind,
  CrawlPageRecord,
  CrawlRun,
  CrawlRunStatus,
  CrawlSinkInput,
  DeliveryRun,
  EntityType,
  JobRun,
  MappingTemplate,
  NormalizedEntity,
  PageHeuristicProfile,
  PhaseStatus,
  RawArtifact,
  SessionState,
  SinkDefinition,
  SiteAccount,
  SiteDefinition,
} from "../types.js";

function asIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(value as string | number | Date).toISOString();
}

function mapSite(row: QueryResultRow): SiteDefinition {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    baseUrl: row.base_url,
    objective: row.objective,
    entityType: row.entity_type,
    fieldList: row.field_list ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapAccount(row: QueryResultRow): SiteAccount {
  return {
    id: row.id,
    siteId: row.site_id,
    label: row.label,
    authMode: row.auth_mode,
    credentials: row.credentials_json ?? {},
    isDefault: row.is_default,
  };
}

function mapSession(row: QueryResultRow): SessionState {
  return {
    id: row.id,
    accountId: row.account_id,
    status: row.status,
    storageStatePath: row.storage_state_path ?? undefined,
    state: row.state ?? {},
    lastAuthenticatedAt: asIso(row.last_authenticated_at),
    expiresAt: asIso(row.expires_at),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapSink(row: QueryResultRow): SinkDefinition {
  return {
    id: row.id,
    siteId: row.site_id,
    sinkType: row.sink_type,
    config: row.config ?? {},
    isDefault: row.is_default,
  };
}

function mapTemplate(row: QueryResultRow): MappingTemplate {
  return {
    id: row.id,
    sinkId: row.sink_id,
    entityType: row.entity_type,
    template: row.template ?? {},
  };
}

function mapCrawlRun(row: QueryResultRow): CrawlRun {
  return {
    id: row.id,
    siteId: row.site_id,
    jobId: row.job_id,
    seedUrl: row.seed_url,
    status: row.status,
    discoveryStatus: row.discovery_status,
    authStatus: row.auth_status,
    crawlStatus: row.crawl_status,
    deliveryStatus: row.delivery_status,
    entityType: row.entity_type ?? undefined,
    confidence: Number(row.confidence),
    reviewReason: row.review_reason ?? undefined,
    publishedRecipeVersion: row.published_recipe_version ?? undefined,
    exportDir: row.export_dir ?? undefined,
    authConfig: row.auth_config ?? { mode: "none" },
    crawlConfig: row.crawl_config ?? {
      maxDepth: 2,
      maxPages: 200,
      maxRecords: 100,
      sameOriginOnly: true,
    },
    sinkConfig: row.sink_config ?? { enabled: false },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at),
  };
}

function mapExport(row: QueryResultRow): CrawlExport {
  return {
    id: row.id,
    crawlRunId: row.crawl_run_id,
    exportType: row.export_type,
    path: row.path,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapPage(row: QueryResultRow): CrawlPageRecord {
  return {
    id: row.id,
    crawlRunId: row.crawl_run_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    pageKind: row.page_kind,
    depth: row.depth,
    parentUrl: row.parent_url ?? undefined,
    status: row.status,
    title: row.title ?? undefined,
    confidence: Number(row.confidence),
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapLink(row: QueryResultRow): CrawlLinkRecord {
  return {
    id: row.id,
    crawlRunId: row.crawl_run_id,
    fromUrl: row.from_url,
    toUrl: row.to_url,
    anchorText: row.anchor_text ?? undefined,
    decision: row.decision,
    reason: row.reason ?? undefined,
    depth: row.depth,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapChallenge(row: QueryResultRow): ChallengeAttempt {
  return {
    id: row.id,
    crawlRunId: row.crawl_run_id,
    challengeType: row.challenge_type,
    status: row.status,
    detail: row.detail ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapEntity(row: QueryResultRow): NormalizedEntity {
  return {
    id: row.id,
    siteId: row.site_id,
    jobId: row.job_id,
    entityType: row.entity_type,
    externalId: row.external_id,
    data: row.data ?? {},
    status: row.status,
    confidence: Number(row.confidence),
    reviewNotes: row.review_notes ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapArtifact(row: QueryResultRow): RawArtifact {
  return {
    id: row.id,
    siteId: row.site_id,
    jobId: row.job_id,
    artifactType: row.artifact_type,
    artifactKey: row.artifact_key,
    content: row.content ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function mapDelivery(row: QueryResultRow): DeliveryRun {
  return {
    id: row.id,
    entityId: row.entity_id,
    sinkId: row.sink_id,
    jobId: row.job_id ?? undefined,
    status: row.status,
    requestPayload: row.request_payload ?? {},
    responsePayload: row.response_payload ?? {},
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: asIso(row.finished_at),
  };
}

function authModeToAccountMode(auth: CrawlAuthInput): SiteAccount["authMode"] {
  if (auth.mode === "oauth") {
    return "oauth";
  }
  if (auth.otp) {
    return "basic+otp";
  }
  if (auth.mode === "none") {
    return "none";
  }
  return "basic";
}

export class CrawlRunRepository {
  constructor(private readonly pool: Pool) {}

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSiteBySlug(slug: string): Promise<SiteDefinition | null> {
    const result = await this.pool.query("SELECT * FROM sites WHERE slug = $1", [slug]);
    return result.rows[0] ? mapSite(result.rows[0]) : null;
  }

  async createOrUpdateAutoSite(params: {
    slug: string;
    name: string;
    baseUrl: string;
    objective: string;
  }): Promise<SiteDefinition> {
    return this.withClient(async (client) => {
      const existing = await client.query("SELECT * FROM sites WHERE slug = $1", [params.slug]);
      if (existing.rows[0]) {
        const updated = await client.query(
          `
            UPDATE sites
            SET name = $2, base_url = $3, objective = $4, updated_at = NOW()
            WHERE slug = $1
            RETURNING *
          `,
          [params.slug, params.name, params.baseUrl, params.objective],
        );
        return mapSite(updated.rows[0]);
      }

      const inserted = await client.query(
        `
          INSERT INTO sites (id, slug, name, base_url, objective, entity_type, field_list)
          VALUES ($1, $2, $3, $4, $5, 'Record', '[]'::jsonb)
          RETURNING *
        `,
        [createId("site"), params.slug, params.name, params.baseUrl, params.objective],
      );

      return mapSite(inserted.rows[0]);
    });
  }

  async updateSiteDiscovery(siteId: string, entityType: EntityType, fieldList: string[], objective?: string): Promise<SiteDefinition> {
    const result = await this.pool.query(
      `
        UPDATE sites
        SET entity_type = $2, field_list = $3::jsonb, objective = COALESCE($4, objective), updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [siteId, entityType, JSON.stringify(fieldList), objective ?? null],
    );

    if (!result.rows[0]) {
      throw new Error(`Site ${siteId} not found`);
    }

    return mapSite(result.rows[0]);
  }

  async upsertDefaultAccount(siteId: string, auth: CrawlAuthInput): Promise<SiteAccount | null> {
    if (auth.mode === "none") {
      return null;
    }

    return this.withClient(async (client) => {
      const current = await client.query(
        "SELECT * FROM site_accounts WHERE site_id = $1 AND is_default = TRUE LIMIT 1",
        [siteId],
      );
      const payload = JSON.stringify({
        ...(auth.credentials ?? {}),
        authMode: auth.mode,
        otp: auth.otp ?? null,
        captcha: auth.captcha ?? null,
      });

      if (current.rows[0]) {
        const updated = await client.query(
          `
            UPDATE site_accounts
            SET auth_mode = $2, credentials_json = $3::jsonb, updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
          [current.rows[0].id, authModeToAccountMode(auth), payload],
        );
        return mapAccount(updated.rows[0]);
      }

      const inserted = await client.query(
        `
          INSERT INTO site_accounts (id, site_id, label, auth_mode, credentials_json, is_default)
          VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)
          RETURNING *
        `,
        [createId("acct"), siteId, "auto-discovered default", authModeToAccountMode(auth), payload],
      );
      return mapAccount(inserted.rows[0]);
    });
  }

  async getDefaultAccountBySiteId(siteId: string): Promise<SiteAccount | null> {
    const result = await this.pool.query(
      "SELECT * FROM site_accounts WHERE site_id = $1 AND is_default = TRUE LIMIT 1",
      [siteId],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async getSessionByAccountId(accountId: string): Promise<SessionState | null> {
    const result = await this.pool.query("SELECT * FROM session_states WHERE account_id = $1", [accountId]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async upsertSession(params: {
    accountId: string;
    status: SessionState["status"];
    state: Record<string, unknown>;
    storageStatePath?: string;
    lastAuthenticatedAt?: string;
    expiresAt?: string;
  }): Promise<SessionState> {
    const existing = await this.getSessionByAccountId(params.accountId);
    const id = existing?.id ?? createId("session");

    const result = await this.pool.query(
      `
        INSERT INTO session_states (
          id, account_id, status, state, storage_state_path, last_authenticated_at, expires_at, updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
        ON CONFLICT (account_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          state = EXCLUDED.state,
          storage_state_path = EXCLUDED.storage_state_path,
          last_authenticated_at = EXCLUDED.last_authenticated_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
        RETURNING *
      `,
      [
        id,
        params.accountId,
        params.status,
        JSON.stringify(params.state),
        params.storageStatePath ?? null,
        params.lastAuthenticatedAt ?? null,
        params.expiresAt ?? null,
      ],
    );

    return mapSession(result.rows[0]);
  }

  async upsertDefaultSink(siteId: string, entityType: EntityType, sink: CrawlSinkInput): Promise<{
    sink: SinkDefinition;
    template: MappingTemplate;
  } | null> {
    if (!sink.enabled || !sink.sinkType) {
      return null;
    }

    return this.withClient(async (client) => {
      const existingSink = await client.query(
        "SELECT * FROM sink_definitions WHERE site_id = $1 AND is_default = TRUE LIMIT 1",
        [siteId],
      );

      let sinkRow: QueryResultRow;
      if (existingSink.rows[0]) {
        const updated = await client.query(
          `
            UPDATE sink_definitions
            SET sink_type = $2, config = $3::jsonb
            WHERE id = $1
            RETURNING *
          `,
          [existingSink.rows[0].id, sink.sinkType, JSON.stringify(sink.config ?? {})],
        );
        sinkRow = updated.rows[0];
      } else {
        const inserted = await client.query(
          `
            INSERT INTO sink_definitions (id, site_id, sink_type, config, is_default)
            VALUES ($1, $2, $3, $4::jsonb, TRUE)
            RETURNING *
          `,
          [createId("sink"), siteId, sink.sinkType, JSON.stringify(sink.config ?? {})],
        );
        sinkRow = inserted.rows[0];
      }

      const templateValue =
        sink.template ?? {
          externalId: "{{entity.externalId}}",
          title: "{{entity.data.title}}",
          sourceUrl: "{{entity.data.sourceUrl}}",
          data: "{{entity.data}}",
        };

      const existingTemplate = await client.query(
        "SELECT * FROM mapping_templates WHERE sink_id = $1 AND entity_type = $2 LIMIT 1",
        [sinkRow.id, entityType],
      );

      let templateRow: QueryResultRow;
      if (existingTemplate.rows[0]) {
        const updatedTemplate = await client.query(
          `
            UPDATE mapping_templates
            SET template = $3::jsonb
            WHERE sink_id = $1 AND entity_type = $2
            RETURNING *
          `,
          [sinkRow.id, entityType, JSON.stringify(templateValue)],
        );
        templateRow = updatedTemplate.rows[0];
      } else {
        const insertedTemplate = await client.query(
          `
            INSERT INTO mapping_templates (id, sink_id, entity_type, template)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING *
          `,
          [createId("map"), sinkRow.id, entityType, JSON.stringify(templateValue)],
        );
        templateRow = insertedTemplate.rows[0];
      }

      return {
        sink: mapSink(sinkRow),
        template: mapTemplate(templateRow),
      };
    });
  }

  async getDefaultSinkBySiteId(siteId: string): Promise<SinkDefinition | null> {
    const result = await this.pool.query(
      "SELECT * FROM sink_definitions WHERE site_id = $1 AND is_default = TRUE LIMIT 1",
      [siteId],
    );
    return result.rows[0] ? mapSink(result.rows[0]) : null;
  }

  async getMappingTemplateBySinkId(sinkId: string, entityType: EntityType): Promise<MappingTemplate | null> {
    const result = await this.pool.query(
      "SELECT * FROM mapping_templates WHERE sink_id = $1 AND entity_type = $2 LIMIT 1",
      [sinkId, entityType],
    );
    return result.rows[0] ? mapTemplate(result.rows[0]) : null;
  }

  async createCrawlRun(params: {
    siteId: string;
    jobId: string;
    seedUrl: string;
    authConfig: CrawlAuthInput;
    crawlConfig: CrawlConfig;
    sinkConfig: CrawlSinkInput;
  }): Promise<CrawlRun> {
    const result = await this.pool.query(
      `
        INSERT INTO crawl_runs (
          id, site_id, job_id, seed_url, status, discovery_status, auth_status, crawl_status, delivery_status,
          auth_config, crawl_config, sink_config
        )
        VALUES ($1, $2, $3, $4, 'queued', 'queued', 'queued', 'queued', 'queued', $5::jsonb, $6::jsonb, $7::jsonb)
        RETURNING *
      `,
      [
        createId("crawl"),
        params.siteId,
        params.jobId,
        params.seedUrl,
        JSON.stringify(params.authConfig),
        JSON.stringify(params.crawlConfig),
        JSON.stringify(params.sinkConfig),
      ],
    );

    return mapCrawlRun(result.rows[0]);
  }

  async getCrawlRun(crawlRunId: string): Promise<CrawlRun | null> {
    const result = await this.pool.query("SELECT * FROM crawl_runs WHERE id = $1", [crawlRunId]);
    return result.rows[0] ? mapCrawlRun(result.rows[0]) : null;
  }

  async listCrawlRuns(limit = 20): Promise<CrawlRun[]> {
    const result = await this.pool.query("SELECT * FROM crawl_runs ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map(mapCrawlRun);
  }

  async updateCrawlRun(crawlRunId: string, patch: {
    status?: CrawlRunStatus;
    discoveryStatus?: PhaseStatus;
    authStatus?: PhaseStatus;
    crawlStatus?: PhaseStatus;
    deliveryStatus?: PhaseStatus | "partial_success";
    authConfig?: CrawlAuthInput;
    entityType?: EntityType;
    confidence?: number;
    reviewReason?: string | null;
    publishedRecipeVersion?: number | null;
    exportDir?: string | null;
    jobId?: string;
    markStarted?: boolean;
    markFinished?: boolean;
  }): Promise<CrawlRun> {
    const assignments: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [crawlRunId];
    let index = values.length;

    const setValue = (column: string, value: unknown) => {
      index += 1;
      assignments.push(`${column} = $${index}`);
      values.push(value);
    };

    if (patch.status) setValue("status", patch.status);
    if (patch.discoveryStatus) setValue("discovery_status", patch.discoveryStatus);
    if (patch.authStatus) setValue("auth_status", patch.authStatus);
    if (patch.crawlStatus) setValue("crawl_status", patch.crawlStatus);
    if (patch.deliveryStatus) setValue("delivery_status", patch.deliveryStatus);
    if (patch.authConfig) setValue("auth_config", JSON.stringify(patch.authConfig));
    if (patch.entityType) setValue("entity_type", patch.entityType);
    if (typeof patch.confidence === "number") setValue("confidence", patch.confidence);
    if (patch.reviewReason !== undefined) setValue("review_reason", patch.reviewReason);
    if (patch.publishedRecipeVersion !== undefined) setValue("published_recipe_version", patch.publishedRecipeVersion);
    if (patch.exportDir !== undefined) setValue("export_dir", patch.exportDir);
    if (patch.jobId) setValue("job_id", patch.jobId);
    if (patch.markStarted) {
      assignments.push("started_at = COALESCE(started_at, NOW())");
    }
    if (patch.markFinished) {
      assignments.push("finished_at = NOW()");
    }

    const result = await this.pool.query(
      `
        UPDATE crawl_runs
        SET ${assignments.join(", ")}
        WHERE id = $1
        RETURNING *
      `,
      values,
    );

    if (!result.rows[0]) {
      throw new Error(`Crawl run ${crawlRunId} not found`);
    }

    return mapCrawlRun(result.rows[0]);
  }

  async recordDiscoveredProfile(params: {
    crawlRunId: string;
    url: string;
    pageKind: CrawlPageKind;
    confidence: number;
    profile: PageHeuristicProfile;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO discovered_page_profiles (id, crawl_run_id, url, page_kind, confidence, profile)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [createId("profile"), params.crawlRunId, params.url, params.pageKind, params.confidence, JSON.stringify(params.profile)],
    );
  }

  async upsertCrawlPage(params: {
    crawlRunId: string;
    url: string;
    canonicalUrl: string;
    pageKind: CrawlPageKind;
    depth: number;
    parentUrl?: string;
    status: "queued" | "visited" | "failed";
    title?: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }): Promise<CrawlPageRecord> {
    const result = await this.pool.query(
      `
        INSERT INTO crawl_pages (
          id, crawl_run_id, url, canonical_url, page_kind, depth, parent_url, status, title, confidence, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (crawl_run_id, canonical_url)
        DO UPDATE SET
          url = EXCLUDED.url,
          page_kind = EXCLUDED.page_kind,
          depth = EXCLUDED.depth,
          parent_url = EXCLUDED.parent_url,
          status = EXCLUDED.status,
          title = EXCLUDED.title,
          confidence = EXCLUDED.confidence,
          metadata = EXCLUDED.metadata
        RETURNING *
      `,
      [
        createId("page"),
        params.crawlRunId,
        params.url,
        params.canonicalUrl,
        params.pageKind,
        params.depth,
        params.parentUrl ?? null,
        params.status,
        params.title ?? null,
        params.confidence,
        JSON.stringify(params.metadata ?? {}),
      ],
    );

    return mapPage(result.rows[0]);
  }

  async listCrawlPages(crawlRunId: string): Promise<CrawlPageRecord[]> {
    const result = await this.pool.query("SELECT * FROM crawl_pages WHERE crawl_run_id = $1 ORDER BY depth, created_at", [crawlRunId]);
    return result.rows.map(mapPage);
  }

  async recordCrawlLink(params: {
    crawlRunId: string;
    fromUrl: string;
    toUrl: string;
    anchorText?: string;
    decision: CrawlLinkDecision;
    reason?: string;
    depth: number;
  }): Promise<CrawlLinkRecord> {
    const result = await this.pool.query(
      `
        INSERT INTO crawl_links (id, crawl_run_id, from_url, to_url, anchor_text, decision, reason, depth)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        createId("link"),
        params.crawlRunId,
        params.fromUrl,
        params.toUrl,
        params.anchorText ?? null,
        params.decision,
        params.reason ?? null,
        params.depth,
      ],
    );

    return mapLink(result.rows[0]);
  }

  async recordChallengeAttempt(params: {
    crawlRunId: string;
    challengeType: ChallengeAttempt["challengeType"];
    status: ChallengeAttempt["status"];
    detail?: Record<string, unknown>;
  }): Promise<ChallengeAttempt> {
    const result = await this.pool.query(
      `
        INSERT INTO challenge_attempts (id, crawl_run_id, challenge_type, status, detail)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING *
      `,
      [createId("challenge"), params.crawlRunId, params.challengeType, params.status, JSON.stringify(params.detail ?? {})],
    );

    return mapChallenge(result.rows[0]);
  }

  async listChallengeAttempts(crawlRunId: string): Promise<ChallengeAttempt[]> {
    const result = await this.pool.query(
      "SELECT * FROM challenge_attempts WHERE crawl_run_id = $1 ORDER BY created_at DESC",
      [crawlRunId],
    );
    return result.rows.map(mapChallenge);
  }

  async createExport(params: {
    crawlRunId: string;
    exportType: CrawlExport["exportType"];
    path: string;
    metadata?: Record<string, unknown>;
  }): Promise<CrawlExport> {
    const result = await this.pool.query(
      `
        INSERT INTO crawl_exports (id, crawl_run_id, export_type, path, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING *
      `,
      [createId("export"), params.crawlRunId, params.exportType, params.path, JSON.stringify(params.metadata ?? {})],
    );

    return mapExport(result.rows[0]);
  }

  async listExports(crawlRunId: string): Promise<CrawlExport[]> {
    const result = await this.pool.query("SELECT * FROM crawl_exports WHERE crawl_run_id = $1 ORDER BY created_at", [crawlRunId]);
    return result.rows.map(mapExport);
  }

  async listEntitiesByJobId(jobId: string): Promise<NormalizedEntity[]> {
    const result = await this.pool.query("SELECT * FROM normalized_entities WHERE job_id = $1 ORDER BY created_at", [jobId]);
    return result.rows.map(mapEntity);
  }

  async listArtifactsByJobId(jobId: string): Promise<RawArtifact[]> {
    const result = await this.pool.query("SELECT * FROM raw_artifacts WHERE job_id = $1 ORDER BY created_at", [jobId]);
    return result.rows.map(mapArtifact);
  }

  async createDeliveryRun(params: {
    entityId: string;
    sinkId: string;
    jobId?: string;
    status: DeliveryRun["status"];
    requestPayload: Record<string, unknown>;
    responsePayload?: Record<string, unknown>;
    error?: string;
  }): Promise<DeliveryRun> {
    if (params.jobId) {
      const existing = await this.pool.query(
        `
          SELECT * FROM delivery_runs
          WHERE job_id = $1 AND sink_id = $2 AND entity_id = $3
          LIMIT 1
        `,
        [params.jobId, params.sinkId, params.entityId],
      );

      if (existing.rows[0]) {
        const updated = await this.pool.query(
          `
            UPDATE delivery_runs
            SET
              status = $2,
              request_payload = $3::jsonb,
              response_payload = $4::jsonb,
              error = $5,
              finished_at = CASE WHEN $2 = 'queued' THEN NULL ELSE NOW() END
            WHERE id = $1
            RETURNING *
          `,
          [
            existing.rows[0].id,
            params.status,
            JSON.stringify(params.requestPayload),
            JSON.stringify(params.responsePayload ?? {}),
            params.error ?? null,
          ],
        );

        return mapDelivery(updated.rows[0]);
      }
    }

    const result = await this.pool.query(
      `
        INSERT INTO delivery_runs (id, entity_id, sink_id, job_id, status, request_payload, response_payload, error, finished_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, CASE WHEN $5 = 'queued' THEN NULL ELSE NOW() END)
        RETURNING *
      `,
      [
        createId("delivery"),
        params.entityId,
        params.sinkId,
        params.jobId ?? null,
        params.status,
        JSON.stringify(params.requestPayload),
        JSON.stringify(params.responsePayload ?? {}),
        params.error ?? null,
      ],
    );

    return mapDelivery(result.rows[0]);
  }

  async getJob(jobId: string): Promise<JobRun | null> {
    const result = await this.pool.query("SELECT * FROM job_runs WHERE id = $1", [jobId]);
    if (!result.rows[0]) {
      return null;
    }

    return {
      id: result.rows[0].id,
      siteId: result.rows[0].site_id ?? undefined,
      jobType: result.rows[0].job_type,
      status: result.rows[0].status,
      payload: result.rows[0].payload ?? {},
      result: result.rows[0].result ?? {},
      error: result.rows[0].error ?? undefined,
      createdAt: new Date(result.rows[0].created_at).toISOString(),
      startedAt: asIso(result.rows[0].started_at),
      finishedAt: asIso(result.rows[0].finished_at),
    };
  }
}
