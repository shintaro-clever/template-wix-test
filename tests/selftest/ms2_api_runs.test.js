const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  const prevRunnerMode = process.env.RUNNER_MODE;
  const prevFigmaMock = process.env.FIGMA_API_MOCK;
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  process.env.RUNNER_MODE = "inline";
  process.env.FIGMA_API_MOCK = "1";

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];

  const jwtToken = jwt.sign(
    { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const token = `Bearer ${jwtToken}`;

  db.prepare("DELETE FROM runs WHERE tenant_id=? AND project_id='api:runs'").run(DEFAULT_TENANT);

  const listRes = await requestLocal(handler, {
    method: "GET",
    url: "/api/runs",
    headers: { Authorization: token },
  });
  assert(listRes.statusCode === 200, "runs list should return 200");
  const initialList = JSON.parse(listRes.body.toString("utf8"));
  assert(Array.isArray(initialList), "runs list should be array");

  const payload = {
    job_type: "integration_hub.phase1.code_to_figma_from_url",
    run_mode: "mcp",
    inputs: {
      mcp_provider: "local_stub",
      page_url: "https://example.com",
      target_path: "vault/tmp",
    },
    target_path: "vault/tmp",
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

  let found = null;
  for (let i = 0; i < 100; i += 1) {
    const pollRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/runs",
      headers: { Authorization: token },
    });
    assert(pollRes.statusCode === 200, "runs list should return 200");
    const pollList = JSON.parse(pollRes.body.toString("utf8"));
    found = pollList.find((row) => row.run_id === created.run_id);
    if (found && (found.status === "completed" || found.status === "failed")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(found, "created run should be listed");
  assert(found.status === "completed", "inline runner should complete queued run");

  const summaryPath = path.join(process.cwd(), ".ai-runs", created.run_id, "summary.md");
  const auditPath = path.join(process.cwd(), ".ai-runs", created.run_id, "audit.jsonl");
  assert(fs.existsSync(summaryPath), "summary.md should be generated for completed run");
  assert(fs.existsSync(auditPath), "audit.jsonl should be generated for completed run");
  const summary = fs.readFileSync(summaryPath, "utf8");
  assert(summary.includes("mcp_attempt: { status: ok"), "summary should include successful mcp_attempt");
  assert(summary.includes("- frames[]:"), "summary should include frames[]");
  const auditLines = fs
    .readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const picked = auditLines.filter((line) => line.includes('"event":"RUNNER_PICKED"')).length;
  const done = auditLines.filter((line) => line.includes('"event":"RUNNER_DONE"')).length;
  assert(picked === 1, "RUNNER_PICKED should be emitted once per run");
  assert(done === 1, "RUNNER_DONE should be emitted once per run");

  db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.run_id);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
    if (prevRunnerMode === undefined) delete process.env.RUNNER_MODE;
    else process.env.RUNNER_MODE = prevRunnerMode;
    if (prevFigmaMock === undefined) delete process.env.FIGMA_API_MOCK;
    else process.env.FIGMA_API_MOCK = prevFigmaMock;
  }
}

module.exports = { run };
