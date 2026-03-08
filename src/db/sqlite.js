const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { encrypt, decrypt } = require("../crypto/secrets");

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
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.existsSync(schemaPath)
    ? fs.readFileSync(schemaPath, "utf8")
    : "";
  if (schemaSql.trim()) {
    db.exec(schemaSql);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        tenant_id   TEXT NOT NULL,
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        staging_url TEXT NOT NULL,
        project_shared_env_json TEXT,
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
        thread_id   TEXT,
        ai_setting_id TEXT,
        status      TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS project_threads (
        tenant_id   TEXT NOT NULL,
        id          TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        title       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS thread_messages (
        tenant_id   TEXT NOT NULL,
        id          TEXT NOT NULL,
        thread_id   TEXT NOT NULL,
        author      TEXT NOT NULL,
        body        TEXT NOT NULL,
        role        TEXT,
        content     TEXT,
        run_id      TEXT,
        created_at  TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS personal_ai_settings (
        tenant_id   TEXT NOT NULL,
        id          TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        provider    TEXT NOT NULL,
        model       TEXT NOT NULL,
        secret_ref  TEXT,
        config_json TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
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
      CREATE INDEX IF NOT EXISTS project_threads_project_updated
        ON project_threads(tenant_id, project_id, updated_at);
      CREATE INDEX IF NOT EXISTS thread_messages_thread_created
        ON thread_messages(tenant_id, thread_id, created_at);
      CREATE INDEX IF NOT EXISTS personal_ai_settings_user
        ON personal_ai_settings(tenant_id, user_id, updated_at DESC);
    `);
  }
  ensureConnectionColumns(db);
  ensureProjectColumns(db);
  ensureRunColumns(db);
  ensureThreadMessageColumns(db);
  ensurePersonalAiSettingColumns(db);
  ensureJobTemplates(db);
  migrateConnectionConfigJsonEncryption(db);
  return db;
}

function ensureProjectColumns(db) {
  const columns = db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name);
  if (!columns.includes("description")) {
    db.exec("ALTER TABLE projects ADD COLUMN description TEXT");
  }
  if (!columns.includes("drive_folder_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN drive_folder_id TEXT");
  }
  if (!columns.includes("project_bindings_json")) {
    db.exec("ALTER TABLE projects ADD COLUMN project_bindings_json TEXT");
  }
  if (!columns.includes("project_drive_json")) {
    db.exec("ALTER TABLE projects ADD COLUMN project_drive_json TEXT");
  }
  if (!columns.includes("project_shared_env_json")) {
    db.exec("ALTER TABLE projects ADD COLUMN project_shared_env_json TEXT");
  }
}

function ensureConnectionColumns(db) {
  const columns = db.prepare("PRAGMA table_info(connections)").all().map((row) => row.name);
  if (!columns.includes("provider_key")) {
    db.exec("ALTER TABLE connections ADD COLUMN provider_key TEXT");
  }
  if (!columns.includes("config_json")) {
    db.exec("ALTER TABLE connections ADD COLUMN config_json TEXT");
  }
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
  if (!columns.includes("thread_id")) {
    db.exec("ALTER TABLE runs ADD COLUMN thread_id TEXT");
  }
  if (!columns.includes("ai_setting_id")) {
    db.exec("ALTER TABLE runs ADD COLUMN ai_setting_id TEXT");
  }
  db.exec("UPDATE runs SET failure_code='unknown_failure' WHERE status='failed' AND (failure_code IS NULL OR trim(failure_code)='')");
}

function ensureThreadMessageColumns(db) {
  const columns = db.prepare("PRAGMA table_info(thread_messages)").all().map((row) => row.name);
  if (!columns.includes("role")) {
    db.exec("ALTER TABLE thread_messages ADD COLUMN role TEXT");
  }
  if (!columns.includes("content")) {
    db.exec("ALTER TABLE thread_messages ADD COLUMN content TEXT");
  }
  if (!columns.includes("run_id")) {
    db.exec("ALTER TABLE thread_messages ADD COLUMN run_id TEXT");
  }
}

function ensurePersonalAiSettingColumns(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_ai_settings (
      tenant_id   TEXT NOT NULL DEFAULT 'internal',
      id          TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      provider    TEXT NOT NULL,
      model       TEXT NOT NULL,
      secret_ref  TEXT,
      config_json TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS personal_ai_settings_user
      ON personal_ai_settings(tenant_id, user_id, updated_at DESC);
  `);
  const columns = db.prepare("PRAGMA table_info(personal_ai_settings)").all().map((row) => row.name);
  if (!columns.includes("secret_ref")) {
    db.exec("ALTER TABLE personal_ai_settings ADD COLUMN secret_ref TEXT");
  }
  if (!columns.includes("config_json")) {
    db.exec("ALTER TABLE personal_ai_settings ADD COLUMN config_json TEXT");
  }
  if (!columns.includes("enabled")) {
    db.exec("ALTER TABLE personal_ai_settings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.includes("is_default")) {
    db.exec("ALTER TABLE personal_ai_settings ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
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

function migrateConnectionConfigJsonEncryption(db) {
  const rows = db
    .prepare(
      "SELECT tenant_id, id, config_json FROM connections WHERE config_json IS NOT NULL AND trim(config_json) <> ''"
    )
    .all();
  const update = db.prepare(
    "UPDATE connections SET config_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  );
  const now = new Date().toISOString();
  rows.forEach((row) => {
    const text = typeof row.config_json === "string" ? row.config_json : "";
    if (!text) return;
    try {
      decrypt(text);
      return;
    } catch {
      const encrypted = encrypt(text);
      update.run(encrypted, now, row.tenant_id, row.id);
    }
  });
}

module.exports = { openDb, DEFAULT_TENANT, migrateConnectionConfigJsonEncryption };
