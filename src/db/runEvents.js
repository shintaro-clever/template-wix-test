const { db, DEFAULT_TENANT } = require("./index");

const ALLOWED_EVENTS = new Set([
  "run_created",
  "run_started",
  "run_completed",
  "run_failed",
  "run_cancelled",
]);

function nowIso() {
  return new Date().toISOString();
}

function recordRunEvent({
  runId,
  eventType,
  tenantId = DEFAULT_TENANT,
  dbConn = db,
} = {}) {
  if (!runId) {
    throw new Error("run_id is required");
  }
  if (!ALLOWED_EVENTS.has(eventType)) {
    throw new Error("invalid event_type");
  }
  dbConn
    .prepare("INSERT INTO run_events(tenant_id, run_id, event_type, created_at) VALUES(?,?,?,?)")
    .run(tenantId, runId, eventType, nowIso());
}

module.exports = {
  recordRunEvent,
  ALLOWED_EVENTS,
};
