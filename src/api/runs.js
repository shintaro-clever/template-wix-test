const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");

const API_RUNS_PROJECT_ID = "api:runs";

function nowIso() {
  return new Date().toISOString();
}

function parseInputs(inputsJson) {
  if (typeof inputsJson !== "string" || inputsJson.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(inputsJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function listRuns(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,status,job_type,inputs_json,target_path,created_at,updated_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
      .map((row) => ({
        run_id: row.id,
        status: row.status,
        job_type: row.job_type || null,
        inputs: parseInputs(row.inputs_json),
        target_path: row.target_path || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
  );
}

function createRun(db, { job_type, inputs, target_path }) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  const inputsJson = JSON.stringify(inputs || {});
  withRetry(() =>
    db
      .prepare(
        "INSERT INTO runs(tenant_id,id,project_id,status,inputs_json,job_type,target_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .run(DEFAULT_TENANT, runId, API_RUNS_PROJECT_ID, "queued", inputsJson, job_type, target_path, ts, ts)
  );
  return runId;
}

module.exports = {
  listRuns,
  createRun,
};
