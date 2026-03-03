const AUDIT_ACTIONS = require("../audit/actions");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { db: hubDb } = require("../db");
const { withRetry } = require("../db/retry");

function nowIso() {
  return new Date().toISOString();
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function isRealDb(candidate) {
  return (
    candidate &&
    candidate.constructor &&
    candidate.constructor.name === "Database" &&
    typeof candidate.prepare === "function"
  );
}

function recordAudit({
  db,
  action,
  tenantId = DEFAULT_TENANT,
  actorId = null,
  meta = null,
} = {}) {
  if (!action) return;
  const allowedActions = new Set(Object.values(AUDIT_ACTIONS));
  if (!allowedActions.has(action)) {
    console.warn(`[AUDIT_WARN] unsupported action=${action}`);
    return;
  }

  const effectiveDb = isRealDb(db) ? db : isRealDb(hubDb) ? hubDb : null;
  if (!effectiveDb) return;

  try {
    const payload = meta ? JSON.stringify(meta) : null;
    withRetry(() =>
      effectiveDb
        .prepare(
          "INSERT INTO audit_logs(tenant_id, actor_id, action, meta_json, created_at) VALUES(?,?,?,?,?)"
        )
        .run(
          safeString(tenantId),
          actorId ? safeString(actorId) : null,
          safeString(action),
          payload,
          nowIso()
        )
    );
  } catch (error) {
    console.warn(
      `[AUDIT_WARN] action=${action} error=${error.message}`,
      { code: error.code, name: error.name }
    );
  }
}

module.exports = {
  AUDIT_ACTIONS,
  recordAudit,
};
