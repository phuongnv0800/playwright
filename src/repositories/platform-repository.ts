import type { Pool, PoolClient, QueryResultRow } from "pg";

import { createId } from "../lib/ids.js";
import type {
  DeliveryRun,
  EntityType,
  JobRun,
  JobStatus,
  JobType,
  MappingTemplate,
  NormalizedEntity,
  RawArtifact,
  SessionState,
  SinkDefinition,
  SiteAccount,
  SiteDefinition,
  StoredRecipe,
  SourceRecipe,
} from "../types.js";

interface SiteCreationInput {
  slug: string;
  name: string;
  baseUrl: string;
  objective: string;
  entityType: EntityType;
  fieldList: string[];
  account?: {
    label?: string;
    authMode?: SiteAccount["authMode"];
    credentials?: Record<string, unknown>;
  };
  sink?: {
    sinkType: SinkDefinition["sinkType"];
    config: Record<string, unknown>;
    template: Record<string, unknown>;
  };
}

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

function mapRecipe(row: QueryResultRow): StoredRecipe {
  return {
    id: row.id,
    siteId: row.site_id,
    version: row.version,
    status: row.status,
    recipe: row.recipe,
    confidence: Number(row.confidence),
    aiProvider: row.ai_provider,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    publishedAt: asIso(row.published_at),
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

function mapJob(row: QueryResultRow): JobRun {
  return {
    id: row.id,
    siteId: row.site_id ?? undefined,
    jobType: row.job_type,
    status: row.status,
    payload: row.payload ?? {},
    result: row.result ?? {},
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at),
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

function mapDelivery(row: QueryResultRow): DeliveryRun {
  return {
    id: row.id,
    entityId: row.entity_id,
    sinkId: row.sink_id,
    status: row.status,
    requestPayload: row.request_payload ?? {},
    responsePayload: row.response_payload ?? {},
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: asIso(row.finished_at),
  };
}

export class PlatformRepository {
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

  async createSite(input: SiteCreationInput): Promise<{
    site: SiteDefinition;
    account?: SiteAccount;
    sink: SinkDefinition;
    template: MappingTemplate;
  }> {
    return this.withClient(async (client) => {
      const siteId = createId("site");
      const sinkId = createId("sink");
      const templateId = createId("map");

      const siteResult = await client.query(
        `
          INSERT INTO sites (id, slug, name, base_url, objective, entity_type, field_list)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          RETURNING *
        `,
        [siteId, input.slug, input.name, input.baseUrl, input.objective, input.entityType, JSON.stringify(input.fieldList)],
      );

      let account: SiteAccount | undefined;
      if (input.account) {
        const accountId = createId("acct");
        const accountResult = await client.query(
          `
            INSERT INTO site_accounts (id, site_id, label, auth_mode, credentials_json, is_default)
            VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)
            RETURNING *
          `,
          [
            accountId,
            siteId,
            input.account.label ?? `${input.name} default`,
            input.account.authMode ?? "none",
            JSON.stringify(input.account.credentials ?? {}),
          ],
        );
        account = mapAccount(accountResult.rows[0]);
      }

      const sinkInput = input.sink ?? {
        sinkType: "echo",
        config: {},
        template: {
          site: "{{site.slug}}",
          entityType: "{{entity.entityType}}",
          externalId: "{{entity.externalId}}",
          data: "{{entity.data}}",
        },
      };

      const sinkResult = await client.query(
        `
          INSERT INTO sink_definitions (id, site_id, sink_type, config, is_default)
          VALUES ($1, $2, $3, $4::jsonb, TRUE)
          RETURNING *
        `,
        [sinkId, siteId, sinkInput.sinkType, JSON.stringify(sinkInput.config)],
      );

      const templateResult = await client.query(
        `
          INSERT INTO mapping_templates (id, sink_id, entity_type, template)
          VALUES ($1, $2, $3, $4::jsonb)
          RETURNING *
        `,
        [templateId, sinkId, input.entityType, JSON.stringify(sinkInput.template)],
      );

      return {
        site: mapSite(siteResult.rows[0]),
        account,
        sink: mapSink(sinkResult.rows[0]),
        template: mapTemplate(templateResult.rows[0]),
      };
    });
  }

  async getSite(siteId: string): Promise<SiteDefinition | null> {
    const result = await this.pool.query("SELECT * FROM sites WHERE id = $1", [siteId]);
    return result.rows[0] ? mapSite(result.rows[0]) : null;
  }

  async getDefaultAccountBySiteId(siteId: string): Promise<SiteAccount | null> {
    const result = await this.pool.query(
      "SELECT * FROM site_accounts WHERE site_id = $1 AND is_default = TRUE LIMIT 1",
      [siteId],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async getAccountById(accountId: string): Promise<SiteAccount | null> {
    const result = await this.pool.query("SELECT * FROM site_accounts WHERE id = $1", [accountId]);
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async createRecipe(params: {
    siteId: string;
    version: number;
    recipe: SourceRecipe;
    confidence: number;
    aiProvider: string;
    notes?: string;
  }): Promise<StoredRecipe> {
    const result = await this.pool.query(
      `
        INSERT INTO source_recipes (id, site_id, version, status, recipe, confidence, ai_provider, notes)
        VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $6, $7)
        RETURNING *
      `,
      [
        createId("recipe"),
        params.siteId,
        params.version,
        JSON.stringify(params.recipe),
        params.confidence,
        params.aiProvider,
        params.notes ?? null,
      ],
    );

    return mapRecipe(result.rows[0]);
  }

  async getNextRecipeVersion(siteId: string): Promise<number> {
    const result = await this.pool.query("SELECT COALESCE(MAX(version), 0) AS max_version FROM source_recipes WHERE site_id = $1", [
      siteId,
    ]);
    return Number(result.rows[0]?.max_version ?? 0) + 1;
  }

  async getRecipeByVersion(siteId: string, version: number): Promise<StoredRecipe | null> {
    const result = await this.pool.query("SELECT * FROM source_recipes WHERE site_id = $1 AND version = $2", [siteId, version]);
    return result.rows[0] ? mapRecipe(result.rows[0]) : null;
  }

  async getPublishedRecipe(siteId: string): Promise<StoredRecipe | null> {
    const result = await this.pool.query(
      "SELECT * FROM source_recipes WHERE site_id = $1 AND status = 'published' ORDER BY version DESC LIMIT 1",
      [siteId],
    );
    return result.rows[0] ? mapRecipe(result.rows[0]) : null;
  }

  async publishRecipe(siteId: string, version: number): Promise<StoredRecipe> {
    return this.withClient(async (client) => {
      await client.query("UPDATE source_recipes SET status = 'draft', published_at = NULL WHERE site_id = $1", [siteId]);
      const result = await client.query(
        `
          UPDATE source_recipes
          SET status = 'published', published_at = NOW()
          WHERE site_id = $1 AND version = $2
          RETURNING *
        `,
        [siteId, version],
      );

      if (!result.rows[0]) {
        throw new Error(`Recipe version ${version} not found for site ${siteId}`);
      }

      return mapRecipe(result.rows[0]);
    });
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

  async getSessionByAccountId(accountId: string): Promise<SessionState | null> {
    const result = await this.pool.query("SELECT * FROM session_states WHERE account_id = $1", [accountId]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async getSessionById(sessionId: string): Promise<SessionState | null> {
    const result = await this.pool.query("SELECT * FROM session_states WHERE id = $1", [sessionId]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async createJob(params: {
    siteId?: string;
    jobType: JobType;
    status?: JobStatus;
    payload?: Record<string, unknown>;
  }): Promise<JobRun> {
    const result = await this.pool.query(
      `
        INSERT INTO job_runs (id, site_id, job_type, status, payload, result)
        VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb)
        RETURNING *
      `,
      [
        createId("job"),
        params.siteId ?? null,
        params.jobType,
        params.status ?? "queued",
        JSON.stringify(params.payload ?? {}),
      ],
    );

    return mapJob(result.rows[0]);
  }

  async getJob(jobId: string): Promise<JobRun | null> {
    const result = await this.pool.query("SELECT * FROM job_runs WHERE id = $1", [jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async updateJobStatus(params: {
    jobId: string;
    status: JobStatus;
    result?: Record<string, unknown>;
    error?: string;
    markStarted?: boolean;
    markFinished?: boolean;
  }): Promise<JobRun> {
    const startedAtSql = params.markStarted ? ", started_at = COALESCE(started_at, NOW())" : "";
    const finishedAtSql = params.markFinished ? ", finished_at = NOW()" : "";
    const result = await this.pool.query(
      `
        UPDATE job_runs
        SET
          status = $2,
          result = COALESCE($3::jsonb, result),
          error = $4
          ${startedAtSql}
          ${finishedAtSql}
        WHERE id = $1
        RETURNING *
      `,
      [params.jobId, params.status, params.result ? JSON.stringify(params.result) : null, params.error ?? null],
    );

    if (!result.rows[0]) {
      throw new Error(`Job ${params.jobId} not found`);
    }

    return mapJob(result.rows[0]);
  }

  async createArtifacts(siteId: string, jobId: string, artifacts: Omit<RawArtifact, "id" | "siteId" | "jobId">[]): Promise<void> {
    for (const artifact of artifacts) {
      await this.pool.query(
        `
          INSERT INTO raw_artifacts (id, site_id, job_id, artifact_type, artifact_key, content, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        [
          createId("artifact"),
          siteId,
          jobId,
          artifact.artifactType,
          artifact.artifactKey,
          artifact.content ?? null,
          JSON.stringify(artifact.metadata ?? {}),
        ],
      );
    }
  }

  async upsertNormalizedEntity(params: {
    siteId: string;
    jobId: string;
    entityType: EntityType;
    externalId: string;
    data: Record<string, unknown>;
    status: NormalizedEntity["status"];
    confidence: number;
    reviewNotes?: string;
  }): Promise<NormalizedEntity> {
    const result = await this.pool.query(
      `
        INSERT INTO normalized_entities (
          id, site_id, job_id, entity_type, external_id, data, status, confidence, review_notes, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())
        ON CONFLICT (site_id, entity_type, external_id)
        DO UPDATE SET
          job_id = EXCLUDED.job_id,
          data = EXCLUDED.data,
          status = EXCLUDED.status,
          confidence = EXCLUDED.confidence,
          review_notes = EXCLUDED.review_notes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        createId("entity"),
        params.siteId,
        params.jobId,
        params.entityType,
        params.externalId,
        JSON.stringify(params.data),
        params.status,
        params.confidence,
        params.reviewNotes ?? null,
      ],
    );

    return mapEntity(result.rows[0]);
  }

  async getEntity(entityId: string): Promise<NormalizedEntity | null> {
    const result = await this.pool.query("SELECT * FROM normalized_entities WHERE id = $1", [entityId]);
    return result.rows[0] ? mapEntity(result.rows[0]) : null;
  }

  async approveEntity(entityId: string): Promise<NormalizedEntity> {
    const result = await this.pool.query(
      `
        UPDATE normalized_entities
        SET status = 'approved', review_notes = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [entityId],
    );

    if (!result.rows[0]) {
      throw new Error(`Entity ${entityId} not found`);
    }

    return mapEntity(result.rows[0]);
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

  async createDeliveryRun(params: {
    entityId: string;
    sinkId: string;
    status: DeliveryRun["status"];
    requestPayload: Record<string, unknown>;
    responsePayload?: Record<string, unknown>;
    error?: string;
  }): Promise<DeliveryRun> {
    const result = await this.pool.query(
      `
        INSERT INTO delivery_runs (id, entity_id, sink_id, status, request_payload, response_payload, error, finished_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, CASE WHEN $4 = 'queued' THEN NULL ELSE NOW() END)
        RETURNING *
      `,
      [
        createId("delivery"),
        params.entityId,
        params.sinkId,
        params.status,
        JSON.stringify(params.requestPayload),
        JSON.stringify(params.responsePayload ?? {}),
        params.error ?? null,
      ],
    );

    return mapDelivery(result.rows[0]);
  }

  async logEvent(params: {
    entityType: string;
    entityId: string;
    level: "info" | "warn" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO event_logs (id, entity_type, entity_id, level, message, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [createId("event"), params.entityType, params.entityId, params.level, params.message, JSON.stringify(params.metadata ?? {})],
    );
  }
}

export type { SiteCreationInput };
