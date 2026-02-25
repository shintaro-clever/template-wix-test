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
    CREATE INDEX IF NOT EXISTS runs_project_status
      ON runs(tenant_id, project_id, status);
  `);
  ensureRunColumns(db);
  return db;
}

function ensureRunColumns(db) {
  const columns = db.prepare("PRAGMA table_info(runs)").all().map((row) => row.name);
  if (!columns.includes("failure_code")) {
    db.exec("ALTER TABLE runs ADD COLUMN failure_code TEXT");
  }
}

module.exports = { openDb, DEFAULT_TENANT };
