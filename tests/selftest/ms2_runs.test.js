const { validateRunInputs } = require("../../src/validation/runInputs");
const {
  createRunRecord,
  getRunById,
  transitionToRunning,
  transitionToFinal,
  expireTimedOutRuns,
} = require("../../src/db/runs");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert } = require("./_helpers");

async function run() {
  const missingConnectionId = `missing-${Date.now()}`;
  db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, missingConnectionId);

  const notFound = validateRunInputs(DEFAULT_TENANT, { connection_id: missingConnectionId });
  assert(notFound.valid === false, "missing connection should be invalid");
  assert(notFound.error === "CONNECTION_NOT_FOUND", "missing connection should return not_found");

  const invalidPath = validateRunInputs(DEFAULT_TENANT, { target_path: "../secret" });
  assert(invalidPath.valid === false, "invalid path should be invalid");
  assert(invalidPath.error === "INVALID_PATH", "invalid path should return INVALID_PATH");

  const projectId = `project-${Date.now()}`;
  const runningId = createRunRecord({ projectId, inputsJson: {} });
  transitionToRunning({ runId: runningId });
  const concurrent = validateRunInputs(DEFAULT_TENANT, { project_id: projectId });
  assert(concurrent.valid === false, "concurrent run should be rejected");
  assert(concurrent.error === "RUN_ALREADY_IN_PROGRESS", "concurrent run should return RUN_ALREADY_IN_PROGRESS");
  db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runningId);

  const runId = createRunRecord({ projectId: `project-${Date.now()}`, inputsJson: {} });
  const moved = transitionToRunning({ runId });
  assert(moved, "queued -> running should succeed");
  const finished = transitionToFinal({ runId, status: "succeeded" });
  assert(finished, "running -> succeeded should succeed");
  const runRow = getRunById({ runId });
  assert(runRow.status === "succeeded", "run status should be succeeded");
  db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);

  const timeoutRunId = createRunRecord({ projectId: `project-${Date.now()}`, inputsJson: {} });
  transitionToRunning({ runId: timeoutRunId });
  const past = new Date(Date.now() - 500).toISOString();
  db.prepare("UPDATE runs SET updated_at=? WHERE tenant_id=? AND id=?").run(past, DEFAULT_TENANT, timeoutRunId);
  const prevTimeout = process.env.RUN_TIMEOUT_MS;
  process.env.RUN_TIMEOUT_MS = "100";
  try {
    const expired = expireTimedOutRuns();
    assert(expired >= 1, "timeout should expire runs");
    const timed = getRunById({ runId: timeoutRunId });
    assert(timed.status === "failed", "timed out run should be failed");
    assert(timed.failure_code === "service_unavailable", "timed out run should set failure_code");
  } finally {
    if (prevTimeout === undefined) {
      delete process.env.RUN_TIMEOUT_MS;
    } else {
      process.env.RUN_TIMEOUT_MS = prevTimeout;
    }
    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, timeoutRunId);
  }
}

module.exports = { run };
