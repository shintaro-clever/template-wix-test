const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { createRun, toPublicRunId, parseRunIdInput } = require("../../src/api/runs");
const { KINDS, buildPublicId, parsePublicIdFor } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const sample = crypto.randomUUID();
  const projectId = buildPublicId(KINDS.project, sample);
  const threadId = buildPublicId(KINDS.thread, sample);
  const runId = buildPublicId(KINDS.run, sample);
  const aiSettingId = buildPublicId(KINDS.ai_setting, sample);

  assert(projectId === `project_${sample}`, "project public ID should be generated");
  assert(threadId === `thread_${sample}`, "thread public ID should be generated");
  assert(runId === `run_${sample}`, "run public ID should be generated");
  assert(aiSettingId === `ai_setting_${sample}`, "ai_setting public ID should be generated");

  const parsedProject = parsePublicIdFor(KINDS.project, projectId);
  assert(parsedProject.ok && parsedProject.internalId === sample, "project public ID should be parsed");
  const parsedThread = parsePublicIdFor(KINDS.thread, threadId);
  assert(parsedThread.ok && parsedThread.internalId === sample, "thread public ID should be parsed");
  const parsedRun = parsePublicIdFor(KINDS.run, runId);
  assert(parsedRun.ok && parsedRun.internalId === sample, "run public ID should be parsed");
  const parsedAi = parsePublicIdFor(KINDS.ai_setting, aiSettingId);
  assert(parsedAi.ok && parsedAi.internalId === sample, "ai_setting public ID should be parsed");

  const invalidFormat = parsePublicIdFor(KINDS.project, "project_not-a-uuid");
  assert(!invalidFormat.ok, "invalid format should be rejected");
  assert(invalidFormat.details && invalidFormat.details.failure_code === "validation_error", "invalid format should be validation_error");

  const unknownPrefix = parsePublicIdFor(KINDS.project, `workspace_${sample}`);
  assert(!unknownPrefix.ok, "unknown prefix should be rejected");
  assert(unknownPrefix.details && unknownPrefix.details.failure_code === "validation_error", "unknown prefix should be validation_error");

  const invalidRunId = parseRunIdInput(`workspace_${sample}`);
  assert(!invalidRunId.ok, "run parser should reject unknown prefix");
  assert(invalidRunId.status === 400, "run parser should return status 400 for invalid format");

  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  let createdProjectInternalId = null;
  let createdThreadInternalId = null;
  const createdRunInternalIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "public-id-selftest", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, `project create should return 201, got ${createProjectRes.statusCode}`);
    const createdProject = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedCreatedProject = parsePublicIdFor(KINDS.project, createdProject.id);
    assert(parsedCreatedProject.ok, "project create response should use public project ID");
    createdProjectInternalId = parsedCreatedProject.internalId;

    const getProjectRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${createdProject.id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getProjectRes.statusCode === 200, `project detail should return 200, got ${getProjectRes.statusCode}`);
    const gotProject = JSON.parse(getProjectRes.body.toString("utf8"));
    assert(gotProject.id === createdProject.id, "project detail should keep public project ID");

    const badProjectPrefixRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/workspace_${sample}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(badProjectPrefixRes.statusCode === 400, `unknown project prefix should return 400, got ${badProjectPrefixRes.statusCode}`);
    const badProjectBody = JSON.parse(badProjectPrefixRes.body.toString("utf8"));
    assert(
      badProjectBody.details && badProjectBody.details.failure_code === "validation_error",
      "project API should return validation_error for unknown prefix"
    );

    const createThreadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${createdProject.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "public id thread" }),
    });
    assert(createThreadRes.statusCode === 201, `thread create should return 201, got ${createThreadRes.statusCode}`);
    const createdThread = JSON.parse(createThreadRes.body.toString("utf8"));
    const parsedCreatedThread = parsePublicIdFor(KINDS.thread, createdThread.thread_id);
    assert(parsedCreatedThread.ok, "thread create response should use public thread ID");
    createdThreadInternalId = parsedCreatedThread.internalId;

    const getThreadRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${createdThread.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getThreadRes.statusCode === 200, `thread detail should return 200, got ${getThreadRes.statusCode}`);
    const gotThread = JSON.parse(getThreadRes.body.toString("utf8"));
    assert(gotThread.thread && gotThread.thread.thread_id === createdThread.thread_id, "thread detail should keep public thread ID");

    const postMessageRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${createdThread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ body: "hello" }),
    });
    assert(postMessageRes.statusCode === 201, `thread message post should return 201, got ${postMessageRes.statusCode}`);

    const badThreadPrefixRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/workspace_${sample}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(badThreadPrefixRes.statusCode === 400, `unknown thread prefix should return 400, got ${badThreadPrefixRes.statusCode}`);
    const badThreadBody = JSON.parse(badThreadPrefixRes.body.toString("utf8"));
    assert(
      badThreadBody.details && badThreadBody.details.failure_code === "validation_error",
      "thread API should return validation_error for unknown prefix"
    );

    const createdRunInternalId = createRun(db, {
      project_id: createdProjectInternalId,
      job_type: "test.id_public_ids",
      run_mode: "mcp",
      inputs: { smoke: true },
    });
    createdRunInternalIds.push(createdRunInternalId);
    const createdRunPublicId = toPublicRunId(createdRunInternalId);

    const getRunRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRunPublicId}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getRunRes.statusCode === 200, `run detail should return 200, got ${getRunRes.statusCode}`);
    const gotRun = JSON.parse(getRunRes.body.toString("utf8"));
    assert(gotRun.run_id === createdRunPublicId, "run detail should keep public run ID");

    const listRunsRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/runs",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRunsRes.statusCode === 200, `run list should return 200, got ${listRunsRes.statusCode}`);
    const runs = JSON.parse(listRunsRes.body.toString("utf8"));
    assert(Array.isArray(runs), "run list should return an array");
    const listed = runs.find((row) => row && row.run_id === createdRunPublicId);
    assert(listed, "run list should include created public run ID");

    const badRunPrefixRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/workspace_${sample}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(badRunPrefixRes.statusCode === 400, `unknown run prefix should return 400, got ${badRunPrefixRes.statusCode}`);
    const badRunBody = JSON.parse(badRunPrefixRes.body.toString("utf8"));
    assert(badRunBody.details && badRunBody.details.failure_code === "validation_error", "run API should return validation_error for unknown prefix");
  } finally {
    createdRunInternalIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (createdThreadInternalId) {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, createdThreadInternalId);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, createdThreadInternalId);
    }
    if (createdProjectInternalId) {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, createdProjectInternalId);
    }

    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
