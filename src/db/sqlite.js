const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_TENANT = "internal";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getDbPath() {
  const root = process.cwd();
  const dir = path.join(root, ".hub");
  ensureDir(dir);
  return path.join(dir, "hub.sqlite");
}

function openDb() {
  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      tenant_id   TEXT NOT NULL,
      id          TEXT NOT NULL,
      name        TEXT NOT NULL,
      staging_url TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS connections (
      tenant_id  TEXT NOT NULL,
      id         TEXT NOT NULL,
      provider   TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      tenant_id   TEXT NOT NULL,
      id          TEXT NOT NULL,
      project_id  TEXT NOT NULL,
      status      TEXT NOT NULL,
      inputs_json TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      tenant_id  TEXT NOT NULL,
      name       TEXT NOT NULL,
      path       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, name)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      tenant_id  TEXT NOT NULL,
      run_id     TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      tenant_id  TEXT NOT NULL,
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
  `);
  ensureRunColumns(db);
  ensureJobTemplates(db);
  return db;
}

function ensureRunColumns(db) {
  const columns = db.prepare("PRAGMA table_info(runs)").all().map((row) => row.name);
  if (!columns.includes("failure_code")) {
    db.exec("ALTER TABLE runs ADD COLUMN failure_code TEXT");
  }
  if (!columns.includes("job_type")) {
    db.exec("ALTER TABLE runs ADD COLUMN job_type TEXT");
  }
  if (!columns.includes("target_path")) {
    db.exec("ALTER TABLE runs ADD COLUMN target_path TEXT");
  }
  if (!columns.includes("run_mode")) {
    db.exec("ALTER TABLE runs ADD COLUMN run_mode TEXT");
  }
  if (!columns.includes("figma_file_key")) {
    db.exec("ALTER TABLE runs ADD COLUMN figma_file_key TEXT");
  }
  if (!columns.includes("ingest_artifact_path")) {
    db.exec("ALTER TABLE runs ADD COLUMN ingest_artifact_path TEXT");
  }
  if (!columns.includes("github_pr_url")) {
    db.exec("ALTER TABLE runs ADD COLUMN github_pr_url TEXT");
  }
  if (!columns.includes("github_pr_number")) {
    db.exec("ALTER TABLE runs ADD COLUMN github_pr_number INTEGER");
  }
}

function ensureJobTemplates(db) {
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='job_templates'")
    .get();
  if (!hasTable) {
    return;
  }
  const existing = db.prepare("SELECT name FROM job_templates").all().map((row) => row.name);
  const existingSet = new Set(existing);
  const templates = [
    {
      name: "figma_read",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read"],
      required_inputs: [],
      description: "Figma read",
    },
    {
      name: "figma_plan",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read"],
      required_inputs: [],
      description: "Figma plan",
    },
    {
      name: "figma_apply",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read", "apply"],
      required_inputs: [],
      description: "Figma apply",
    },
    {
      name: "figma_verify",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read", "verify"],
      required_inputs: [],
      description: "Figma verify",
    },
  ];
  const insert = db.prepare(
    "INSERT INTO job_templates(name,direction,required_mode,required_capabilities,required_inputs,description) VALUES(?,?,?,?,?,?)"
  );
  templates.forEach((tpl) => {
    if (existingSet.has(tpl.name)) {
      return;
    }
    insert.run(
      tpl.name,
      tpl.direction,
      tpl.required_mode,
      JSON.stringify(tpl.required_capabilities),
      JSON.stringify(tpl.required_inputs),
      tpl.description
    );
  });
}

module.exports = { openDb, DEFAULT_TENANT };
