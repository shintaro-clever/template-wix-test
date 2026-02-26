const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  process.env.JWT_SECRET = "x".repeat(32);

  const server = createApiServer();
  const handler = server.listeners("request")[0];

  const jwtToken = jwt.sign(
    { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const token = `Bearer ${jwtToken}`;

  const listRes = await requestLocal(handler, {
    method: "GET",
    url: "/api/runs",
    headers: { Authorization: token },
  });
  assert(listRes.statusCode === 200, "runs list should return 200");
  const initialList = JSON.parse(listRes.body.toString("utf8"));
  assert(Array.isArray(initialList), "runs list should be array");

  const payload = {
    job_type: "selftest.ms2.api_runs",
    inputs: { sample: true },
    target_path: ".ai-runs/selftest-ms2-run.json",
  };
  const postRes = await requestLocal(handler, {
    method: "POST",
    url: "/api/runs",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert(postRes.statusCode === 201, "runs create should return 201");
  const created = JSON.parse(postRes.body.toString("utf8"));
  assert(created.run_id, "run_id should be returned");

  const afterRes = await requestLocal(handler, {
    method: "GET",
    url: "/api/runs",
    headers: { Authorization: token },
  });
  assert(afterRes.statusCode === 200, "runs list should return 200");
  const afterList = JSON.parse(afterRes.body.toString("utf8"));
  const found = afterList.find((row) => row.run_id === created.run_id);
  assert(found, "created run should be listed");

  db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.run_id);
}

module.exports = { run };
