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

    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/connectors/connections",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_key: "figma",
        config_json: { token: "figma-token-selftest" },
      }),
    });
    assert(createRes.statusCode === 201, "figma connector create should return 201");
    const created = JSON.parse(createRes.body.toString("utf8"));
    assert(created.id, "connection id should be present");
    assert(created.config_json && created.config_json.figma_token, "figma token key should be fixed");

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/connectors/connections?provider_key=figma",
      headers: { Authorization: token },
    });
    assert(listRes.statusCode === 200, "connector list should return 200");
    const listed = JSON.parse(listRes.body.toString("utf8"));
    assert(Array.isArray(listed) && listed.some((row) => row.id === created.id), "created connector should be listed");

    const ingestRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/ingest/figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: `ingest-${Date.now()}.json`,
        json: { title: "selftest ingest" },
      }),
    });
    assert(ingestRes.statusCode === 201, "figma ingest should return 201");
    const ingested = JSON.parse(ingestRes.body.toString("utf8"));
    assert(typeof ingested.artifact_path === "string", "ingest should return artifact_path");
    assert(ingested.artifact_path.startsWith("vault/tmp/"), "ingest artifact must be under vault/tmp/");

    const jobsRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/jobs/from-figma",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        ingest_artifact_path: ingested.artifact_path,
      }),
    });
    assert(jobsRes.statusCode === 201, "jobs from figma should return 201");
    const jobResult = JSON.parse(jobsRes.body.toString("utf8"));
    assert(jobResult.plan_path && jobResult.job_path && jobResult.patch_path, "plan/job/patch paths should be returned");
    assert(fs.existsSync(path.join(process.cwd(), jobResult.plan_path)), "plan artifact should exist");
    assert(fs.existsSync(path.join(process.cwd(), jobResult.job_path)), "job artifact should exist");
    assert(fs.existsSync(path.join(process.cwd(), jobResult.patch_path)), "patch artifact should exist");

    const delRes = await requestLocal(handler, {
      method: "DELETE",
      url: `/api/connectors/connections/${created.id}`,
      headers: { Authorization: token },
    });
    assert(delRes.statusCode === 204, "connector delete should return 204");
    db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.id);
  } finally {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
