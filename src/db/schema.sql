CREATE TABLE IF NOT EXISTS projects (
  tenant_id   TEXT NOT NULL DEFAULT 'internal',
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  staging_url TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS connections (
  tenant_id    TEXT NOT NULL DEFAULT 'internal',
  id           TEXT NOT NULL,
  provider     TEXT,
  provider_key TEXT,
  config_json  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
  tenant_id    TEXT NOT NULL DEFAULT 'internal',
  id           TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  status       TEXT NOT NULL,
  inputs_json  TEXT NOT NULL,
  failure_code TEXT,
  job_type     TEXT,
  target_path  TEXT,
  run_mode     TEXT,
  figma_file_key TEXT,
  ingest_artifact_path TEXT,
  github_pr_url TEXT,
  github_pr_number INTEGER,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS run_events (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  run_id     TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  tenant_id  TEXT NOT NULL DEFAULT 'internal',
  actor_id   TEXT,
  action     TEXT NOT NULL,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_templates (
  name                  TEXT NOT NULL,
  direction             TEXT NOT NULL,
  required_mode         TEXT NOT NULL,
  required_capabilities TEXT NOT NULL,
  required_inputs       TEXT NOT NULL,
  description           TEXT,
  PRIMARY KEY (name)
);

CREATE INDEX IF NOT EXISTS runs_project_status
  ON runs(tenant_id, project_id, status);
