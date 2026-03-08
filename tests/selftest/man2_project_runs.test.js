const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun, toPublicRunId } = require("../../src/api/runs");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdRunIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    // プロジェクト A 作成
    const projARes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "runs-test-proj-a", staging_url: "https://example.com" }),
    });
    assert(projARes.statusCode === 201, `project A create should return 201, got ${projARes.statusCode}`);
    const projA = JSON.parse(projARes.body.toString("utf8"));
    const parsedProjA = parsePublicIdFor(KINDS.project, projA.id);
    assert(parsedProjA.ok, "project A id should be public project ID");
    createdProjectIds.push(parsedProjA.internalId);
    const pidA = projA.id;

    // プロジェクト B 作成
    const projBRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "runs-test-proj-b", staging_url: "https://example.com" }),
    });
    assert(projBRes.statusCode === 201, `project B create should return 201, got ${projBRes.statusCode}`);
    const projB = JSON.parse(projBRes.body.toString("utf8"));
    const parsedProjB = parsePublicIdFor(KINDS.project, projB.id);
    assert(parsedProjB.ok, "project B id should be public project ID");
    createdProjectIds.push(parsedProjB.internalId);
    const pidB = projB.id;

    // 1. GET /api/projects/:idA/runs → 200, runs 空配列
    const emptyRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pidA}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(emptyRes.statusCode === 200, `GET runs should return 200, got ${emptyRes.statusCode}`);
    const emptyBody = JSON.parse(emptyRes.body.toString("utf8"));
    assert(emptyBody.project_id === pidA, "project_id should match");
    assert(Array.isArray(emptyBody.runs), "runs should be array");
    assert(emptyBody.runs.length === 0, "runs should be empty for new project");

    // 2. プロジェクト A の run を DB に直接作成
    const runIdA = createRun(db, {
      project_id: parsedProjA.internalId,
      job_type: "test.project_runs_selftest",
      run_mode: "mcp",
      inputs: { test: true },
    });
    createdRunIds.push(runIdA);
    const runIdAPublic = toPublicRunId(runIdA);

    // 3. GET /api/projects/:idA/runs → 1件、run_id が一致
    const oneRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pidA}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(oneRes.statusCode === 200, `GET runs should return 200`);
    const oneBody = JSON.parse(oneRes.body.toString("utf8"));
    assert(oneBody.runs.length === 1, `runs should have 1 item, got ${oneBody.runs.length}`);
    assert(oneBody.runs[0].run_id === runIdAPublic, "run_id should match");
    assert(oneBody.runs[0].job_type === "test.project_runs_selftest", "job_type should match");

    // 4. プロジェクト B の run を作成
    const runIdB = createRun(db, {
      project_id: parsedProjB.internalId,
      job_type: "test.project_runs_selftest_b",
      run_mode: "mcp",
      inputs: { test: true },
    });
    createdRunIds.push(runIdB);
    const runIdBPublic = toPublicRunId(runIdB);

    // 5. GET /api/projects/:idA/runs → B の run が混ざらない
    const isolatedRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pidA}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(isolatedRes.statusCode === 200, "GET runs A should return 200");
    const isolatedBody = JSON.parse(isolatedRes.body.toString("utf8"));
    assert(isolatedBody.runs.length === 1, "only A's run should appear");
    assert(isolatedBody.runs[0].run_id === runIdAPublic, "only runA should appear in project A");

    // 6. GET /api/projects/:idB/runs → B の run のみ
    const bRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pidB}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(bRes.statusCode === 200, "GET runs B should return 200");
    const bBody = JSON.parse(bRes.body.toString("utf8"));
    assert(bBody.runs.length === 1, "only B's run should appear");
    assert(bBody.runs[0].run_id === runIdBPublic, "only runB should appear in project B");

    // 7. 存在しないプロジェクト → 404
    const notFoundProjectId = `project_${crypto.randomUUID()}`;
    const notFoundRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${notFoundProjectId}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(notFoundRes.statusCode === 404, `nonexistent project should return 404, got ${notFoundRes.statusCode}`);

    // 8. GET /api/runs (グローバル) は壊れていない
    const globalRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(globalRes.statusCode === 200, `GET /api/runs should return 200, got ${globalRes.statusCode}`);
    const globalBody = JSON.parse(globalRes.body.toString("utf8"));
    // /api/runs returns a plain array (not wrapped in { runs: [] })
    assert(Array.isArray(globalBody), "global /api/runs should return an array");
    const foundA = globalBody.some((r) => r.run_id === runIdAPublic);
    const foundB = globalBody.some((r) => r.run_id === runIdBPublic);
    assert(foundA, "runA should appear in global /api/runs");
    assert(foundB, "runB should appear in global /api/runs");

    // 9. A に 2 件目の run を追加して件数が正しく増える
    const runIdA2 = createRun(db, {
      project_id: parsedProjA.internalId,
      job_type: "test.project_runs_selftest_a2",
      run_mode: "mcp",
      inputs: {},
    });
    createdRunIds.push(runIdA2);

    const twoRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pidA}/runs`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(twoRes.statusCode === 200, "GET runs A should return 200 after 2nd run");
    const twoBody = JSON.parse(twoRes.body.toString("utf8"));
    assert(twoBody.runs.length === 2, `runs should have 2 items, got ${twoBody.runs.length}`);
  } finally {
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
