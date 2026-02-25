const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("./index");

const DEFAULT_TIMEOUT_MS = 1800000;

function nowIso() {
  return new Date().toISOString();
}

function getRunTimeoutMs(env = process.env) {
  const raw = env && env.RUN_TIMEOUT_MS ? Number(env.RUN_TIMEOUT_MS) : NaN;
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_TIMEOUT_MS;
}

function createRunRecord({
  tenantId = DEFAULT_TENANT,
  projectId,
  inputsJson,
  dbConn = db,
} = {}) {
  if (!projectId) {
    throw new Error("projectId is required");
  }
  const runId = crypto.randomUUID();
  const ts = nowIso();
  dbConn
    .prepare(
      "INSERT INTO runs(tenant_id,id,project_id,status,inputs_json,created_at,updated_at,failure_code) VALUES(?,?,?,?,?,?,?,?)"
    )
    .run(tenantId, runId, projectId, "queued", JSON.stringify(inputsJson || {}), ts, ts, null);
  return runId;
}

function getRunById({
  tenantId = DEFAULT_TENANT,
  runId,
  dbConn = db,
} = {}) {
  if (!runId) {
    throw new Error("runId is required");
  }
  return dbConn
    .prepare(
      "SELECT tenant_id,id,project_id,status,inputs_json,created_at,updated_at,failure_code FROM runs WHERE tenant_id=? AND id=?"
    )
    .get(tenantId, runId);
}

function transitionToRunning({
  tenantId = DEFAULT_TENANT,
  runId,
  dbConn = db,
} = {}) {
  if (!runId) {
    throw new Error("runId is required");
  }
  const info = dbConn
    .prepare("UPDATE runs SET status=?, updated_at=? WHERE tenant_id=? AND id=? AND status='queued'")
    .run("running", nowIso(), tenantId, runId);
  return info.changes > 0;
}

function transitionToFinal({
  tenantId = DEFAULT_TENANT,
  runId,
  status,
  failureCode = null,
  dbConn = db,
} = {}) {
  if (!runId) {
    throw new Error("runId is required");
  }
  if (!["succeeded", "failed", "cancelled"].includes(status)) {
    throw new Error("invalid status");
  }
  const failure = status === "failed" ? failureCode || null : null;
  const info = dbConn
    .prepare(
      "UPDATE runs SET status=?, failure_code=?, updated_at=? WHERE tenant_id=? AND id=? AND status='running'"
    )
    .run(status, failure, nowIso(), tenantId, runId);
  return info.changes > 0;
}

function expireTimedOutRuns({
  tenantId = DEFAULT_TENANT,
  dbConn = db,
  env = process.env,
} = {}) {
  const timeoutMs = getRunTimeoutMs(env);
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const info = dbConn
    .prepare(
      "UPDATE runs SET status='failed', failure_code='service_unavailable', updated_at=? WHERE tenant_id=? AND status='running' AND updated_at <= ?"
    )
    .run(nowIso(), tenantId, cutoff);
  return info.changes;
}

module.exports = {
  getRunTimeoutMs,
  createRunRecord,
  getRunById,
  transitionToRunning,
  transitionToFinal,
  expireTimedOutRuns,
};
