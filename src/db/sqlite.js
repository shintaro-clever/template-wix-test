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
  `);
  return db;
}

module.exports = { openDb, DEFAULT_TENANT };

