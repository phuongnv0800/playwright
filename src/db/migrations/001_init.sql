CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  objective TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  field_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_accounts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  credentials_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS site_accounts_default_idx
  ON site_accounts(site_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS source_recipes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  recipe JSONB NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  ai_provider TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS source_recipes_version_idx
  ON source_recipes(site_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS source_recipes_published_idx
  ON source_recipes(site_id)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS session_states (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES site_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new',
  storage_state_path TEXT,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_authenticated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS session_states_account_idx
  ON session_states(account_id);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS raw_artifacts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS normalized_entities (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 1,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS normalized_entities_site_idx
  ON normalized_entities(site_id, entity_type);

CREATE UNIQUE INDEX IF NOT EXISTS normalized_entities_external_idx
  ON normalized_entities(site_id, entity_type, external_id);

CREATE TABLE IF NOT EXISTS sink_definitions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  sink_type TEXT NOT NULL,
  config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sink_definitions_default_idx
  ON sink_definitions(site_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS mapping_templates (
  id TEXT PRIMARY KEY,
  sink_id TEXT NOT NULL REFERENCES sink_definitions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  template JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mapping_templates_unique_idx
  ON mapping_templates(sink_id, entity_type);

CREATE TABLE IF NOT EXISTS delivery_runs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES normalized_entities(id) ON DELETE CASCADE,
  sink_id TEXT NOT NULL REFERENCES sink_definitions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
