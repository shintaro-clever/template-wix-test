const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);
  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token = `Bearer ${jwtToken}`;

    const ingestRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ingest/figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: `trace-${Date.now()}.json`,
        json: { figma_file_key: "FIGMA_TRACE_KEY", title: "trace" },
      }),
    });
    assert(ingestRes.statusCode === 201, "ingest should return 201");
    const ingested = JSON.parse(ingestRes.body.toString("utf8"));

    const runCreate = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        job_type: "integration_hub.phase2.repo_patch",
        run_mode: "mcp",
        target_path: ".ai-runs/{{run_id}}/trace.json",
        inputs: {
          message: "trace",
          target_path: ".ai-runs/{{run_id}}/trace.json",
        },
      }),
    });
    assert(runCreate.statusCode === 201, "run create should return 201");
    const runPayload = JSON.parse(runCreate.body.toString("utf8"));
    assert(runPayload.run_id, "run_id should exist");

    const fromFigma = await requestLocal(handler, {
      method: "POST",
      url: "/api/jobs/from-figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        ingest_artifact_path: ingested.artifact_path,
      }),
    });
    assert(fromFigma.statusCode === 201, "jobs from figma should return 201");

    const runDetail = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: token },
    });
    assert(runDetail.statusCode === 200, "run detail should return 200");
    const detail = JSON.parse(runDetail.body.toString("utf8"));
    assert(detail.figma_file_key === "FIGMA_TRACE_KEY", "run should store figma_file_key trace");
    assert(detail.ingest_artifact_path === ingested.artifact_path, "run should store ingest_artifact_path trace");

    const dryRunPr = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "example",
        repo: "demo",
        title: "dry-run-pr",
        dry_run: true,
      }),
    });
    assert(dryRunPr.statusCode === 201, "github pr dry-run should return 201");
    const dryPayload = JSON.parse(dryRunPr.body.toString("utf8"));
    assert(dryPayload.dry_run === true, "dry-run flag should be true");

    const realPr = await requestLocal(handler, {
      method: "POST",
      url: "/api/github/pr",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runPayload.run_id,
        owner: "example",
        repo: "demo",
        title: "real-pr-attempt",
        github_token: "dummy-token",
        dry_run: false,
      }),
    });
    assert([401, 503].includes(realPr.statusCode), "github pr real call should fail clearly");
    const errPayload = JSON.parse(realPr.body.toString("utf8"));
    assert(typeof errPayload.message === "string", "error.message should exist");
    assert(typeof errPayload.message_en === "string", "error.message_en should exist");
    assert(errPayload.details && typeof errPayload.details.failure_code === "string", "failure_code should exist");

    db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runPayload.run_id);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
