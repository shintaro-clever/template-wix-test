const { db, DEFAULT_TENANT } = require("../../src/db");
const { recordRunEvent } = require("../../src/db/runEvents");
const { assert } = require("./_helpers");

async function run() {
  const runId = `run-${Date.now()}`;
  const before = db
    .prepare("SELECT COUNT(*) as cnt FROM run_events WHERE tenant_id=? AND run_id=?")
    .get(DEFAULT_TENANT, runId).cnt;

  recordRunEvent({ runId, eventType: "run_created" });

  const after = db
    .prepare("SELECT COUNT(*) as cnt FROM run_events WHERE tenant_id=? AND run_id=?")
    .get(DEFAULT_TENANT, runId).cnt;

  assert(after === before + 1, "run_events should increment");

  db.prepare("DELETE FROM run_events WHERE tenant_id=? AND run_id=?").run(DEFAULT_TENANT, runId);
}

module.exports = { run };
