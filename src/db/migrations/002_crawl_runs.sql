ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES job_runs(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_runs_job_sink_entity_idx
  ON delivery_runs(job_id, sink_id, entity_id)
  WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  seed_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  discovery_status TEXT NOT NULL DEFAULT 'queued',
  auth_status TEXT NOT NULL DEFAULT 'queued',
  crawl_status TEXT NOT NULL DEFAULT 'queued',
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  entity_type TEXT,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  review_reason TEXT,
  published_recipe_version INTEGER,
  export_dir TEXT,
  auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  crawl_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sink_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS crawl_runs_job_idx
  ON crawl_runs(job_id);

CREATE INDEX IF NOT EXISTS crawl_runs_site_idx
  ON crawl_runs(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discovered_page_profiles (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  page_kind TEXT NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  profile JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discovered_page_profiles_run_idx
  ON discovered_page_profiles(crawl_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crawl_pages (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  page_kind TEXT NOT NULL DEFAULT 'other',
  depth INTEGER NOT NULL DEFAULT 0,
  parent_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS crawl_pages_unique_idx
  ON crawl_pages(crawl_run_id, canonical_url);

CREATE TABLE IF NOT EXISTS crawl_links (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  from_url TEXT NOT NULL,
  to_url TEXT NOT NULL,
  anchor_text TEXT,
  decision TEXT NOT NULL,
  reason TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crawl_links_run_idx
  ON crawl_links(crawl_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenge_attempts (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  challenge_type TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS challenge_attempts_run_idx
  ON challenge_attempts(crawl_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crawl_exports (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL,
  path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crawl_exports_run_idx
  ON crawl_exports(crawl_run_id, created_at DESC);
