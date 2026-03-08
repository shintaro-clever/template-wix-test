const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { KINDS, parsePublicIdFor } = require("../../src/id/publicIds");
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

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "workspace-chat-start-test", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, `project create should return 201, got ${createProjectRes.statusCode}`);
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public project id");
    createdProjectIds.push(parsedProject.internalId);

    const firstSendRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({ content: "first message from workspace", title: "First conversation" }),
    });
    assert(firstSendRes.statusCode === 201, `first workspace send should return 201, got ${firstSendRes.statusCode}`);
    const firstSend = JSON.parse(firstSendRes.body.toString("utf8"));
    assert(firstSend.project_id === project.id, "project id should match");
    assert(firstSend.created_thread === true, "first send should create thread");
    assert(typeof firstSend.message_id === "string" && firstSend.message_id.length > 0, "message_id should exist");
    const parsedThread = parsePublicIdFor(KINDS.thread, firstSend.thread_id);
    assert(parsedThread.ok, "first send should return public thread id");
    createdThreadIds.push(parsedThread.internalId);
    const parsedRun = parsePublicIdFor(KINDS.run, firstSend.run_id);
    assert(parsedRun.ok, "first send should return public run id");
    createdRunIds.push(parsedRun.internalId);

    const secondSendRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({ thread_id: firstSend.thread_id, content: "second message same thread" }),
    });
    assert(secondSendRes.statusCode === 201, `second workspace send should return 201, got ${secondSendRes.statusCode}`);
    const secondSend = JSON.parse(secondSendRes.body.toString("utf8"));
    assert(secondSend.thread_id === firstSend.thread_id, "second send should keep same thread");
    assert(secondSend.created_thread === false, "second send should not create new thread");
    const parsedRun2 = parsePublicIdFor(KINDS.run, secondSend.run_id);
    assert(parsedRun2.ok, "second send should return public run id");
    createdRunIds.push(parsedRun2.internalId);

    const detailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${firstSend.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detailRes.statusCode === 200, `thread detail should return 200, got ${detailRes.statusCode}`);
    const detail = JSON.parse(detailRes.body.toString("utf8"));
    assert(Array.isArray(detail.thread.messages), "messages should be array");
    const firstUser = detail.thread.messages.find((m) => m.content === "first message from workspace");
    const secondUser = detail.thread.messages.find((m) => m.content === "second message same thread");
    assert(firstUser && firstUser.role === "user", "first user message should be stored");
    assert(secondUser && secondUser.role === "user", "second user message should be stored");
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
