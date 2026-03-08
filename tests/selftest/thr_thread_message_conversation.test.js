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
  const createdThreadIds = [];
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

    const projectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "thr-conversation-test", staging_url: "https://example.com" }),
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
      body: JSON.stringify({ title: "Conversation Thread" }),
    });
    assert(threadRes.statusCode === 201, `thread create should return 201, got ${threadRes.statusCode}`);
    const thread = JSON.parse(threadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public thread id");
    createdThreadIds.push(parsedThread.internalId);

    const runId = createRun(db, {
      project_id: parsedProject.internalId,
      job_type: "test.thread_message_conversation",
      run_mode: "mcp",
      inputs: {},
    });
    createdRunIds.push(runId);
    const runPublicId = toPublicRunId(runId);

    const userMsgRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${thread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ role: "user", content: "hello from user" }),
    });
    assert(userMsgRes.statusCode === 201, `user message should return 201, got ${userMsgRes.statusCode}`);

    const assistantMsgRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${thread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ role: "assistant", content: "hello from assistant", run_id: runPublicId }),
    });
    assert(assistantMsgRes.statusCode === 201, `assistant message should return 201, got ${assistantMsgRes.statusCode}`);

    const detailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${thread.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detailRes.statusCode === 200, `thread detail should return 200, got ${detailRes.statusCode}`);
    const detail = JSON.parse(detailRes.body.toString("utf8"));
    assert(Array.isArray(detail.thread.messages), "messages should be array");
    assert(detail.thread.messages.length >= 2, "messages should include user+assistant");
    detail.thread.messages.forEach((message) => {
      assert(typeof message.role === "string" && message.role.length > 0, "message.role should exist");
      assert(typeof message.content === "string" && message.content.length > 0, "message.content should exist");
      assert(typeof message.created_at === "string" && message.created_at.length > 0, "message.created_at should exist");
      assert(Object.prototype.hasOwnProperty.call(message, "run_id"), "message.run_id should exist");
    });

    const userMessage = detail.thread.messages.find((m) => m.role === "user" && m.content === "hello from user");
    assert(userMessage, "user message should be saved with role/content");
    assert(userMessage.run_id === null, "user message run_id should be null");

    const assistantMessage = detail.thread.messages.find((m) => m.role === "assistant" && m.content === "hello from assistant");
    assert(assistantMessage, "assistant message should be saved with role/content");
    assert(assistantMessage.run_id === runPublicId, "assistant message should keep run_id");

    const invalidRoleRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${thread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ role: "system", content: "x" }),
    });
    assert(invalidRoleRes.statusCode === 400, `invalid role should return 400, got ${invalidRoleRes.statusCode}`);
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
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
