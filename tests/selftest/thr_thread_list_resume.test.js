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
      body: JSON.stringify({ name: "thr-list-resume-test", staging_url: "https://example.com" }),
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
      body: JSON.stringify({ title: "Resume Thread" }),
    });
    assert(threadRes.statusCode === 201, `thread create should return 201, got ${threadRes.statusCode}`);
    const thread = JSON.parse(threadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public thread id");
    createdThreadIds.push(parsedThread.internalId);

    await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${thread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ role: "user", content: "first user message" }),
    });
    await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${thread.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ role: "assistant", content: "assistant summary for resume card" }),
    });

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}/threads`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRes.statusCode === 200, `thread list should return 200, got ${listRes.statusCode}`);
    const listBody = JSON.parse(listRes.body.toString("utf8"));
    assert(Array.isArray(listBody.threads), "threads should be array");
    const row = listBody.threads.find((item) => item.thread_id === thread.thread_id);
    assert(row, "created thread should be listed");

    assert(typeof row.title === "string" && row.title.length > 0, "title should exist");
    assert(typeof row.updated_at === "string" && row.updated_at.length > 0, "updated_at should exist");
    assert(typeof row.latest_summary === "string", "latest_summary should exist");
    assert(row.latest_summary.includes("assistant summary"), "latest_summary should reflect latest message");
    assert(row.latest_message_role === "assistant", "latest_message_role should be assistant");
    assert(typeof row.latest_message_created_at === "string" && row.latest_message_created_at.length > 0, "latest_message_created_at should exist");
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
