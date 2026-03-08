const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
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
  const createdThreadIds = [];
  const createdRunIds = [];
  const userId = `u-${crypto.randomUUID()}`;

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: userId, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "run-tracking-test", staging_url: "https://example.com" }),
    });
    assert(projectRes.statusCode === 201, `project create should return 201, got ${projectRes.statusCode}`);
    const project = JSON.parse(projectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public project id");
    createdProjectIds.push(parsedProject.internalId);

    const threadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "Tracking Thread" }),
    });
    assert(threadRes.statusCode === 201, `thread create should return 201, got ${threadRes.statusCode}`);
    const thread = JSON.parse(threadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public thread id");
    createdThreadIds.push(parsedThread.internalId);

    const aiRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5-codex",
        enabled: true,
        is_default: true,
      }),
    });
    assert(aiRes.statusCode === 201, `ai setting create should return 201, got ${aiRes.statusCode}`);
    const ai = JSON.parse(aiRes.body.toString("utf8"));
    const parsedAi = parsePublicIdFor(KINDS.ai_setting, ai.ai_setting_id);
    assert(parsedAi.ok, "ai_setting id should be public ai_setting id");

    const sendRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({
        thread_id: thread.thread_id,
        ai_setting_id: ai.ai_setting_id,
        content: "link tracking message",
      }),
    });
    assert(sendRes.statusCode === 201, `workspace send should return 201, got ${sendRes.statusCode}`);
    const send = JSON.parse(sendRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, send.run_id);
    assert(parsedRun.ok, "workspace send should return public run id");
    createdRunIds.push(parsedRun.internalId);

    const getRunRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${send.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getRunRes.statusCode === 200, `run detail should return 200, got ${getRunRes.statusCode}`);
    const runBody = JSON.parse(getRunRes.body.toString("utf8"));
    assert(runBody.run_id === send.run_id, "run_id should match");
    assert(runBody.project_id === project.id, "run should track project_id");
    assert(runBody.thread_id === thread.thread_id, "run should track thread_id");
    assert(runBody.ai_setting_id === ai.ai_setting_id, "run should track ai_setting_id");

    const listRunsRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/runs",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRunsRes.statusCode === 200, `run list should return 200, got ${listRunsRes.statusCode}`);
    const list = JSON.parse(listRunsRes.body.toString("utf8"));
    const row = Array.isArray(list) ? list.find((item) => item.run_id === send.run_id) : null;
    assert(row, "run list should include created run");
    assert(row.project_id === project.id, "run list should include project_id");
    assert(row.thread_id === thread.thread_id, "run list should include thread_id");
    assert(row.ai_setting_id === ai.ai_setting_id, "run list should include ai_setting_id");
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
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
