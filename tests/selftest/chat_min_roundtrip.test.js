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
  const createdAiSettingIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const userId = `u-${crypto.randomUUID()}`;
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
      body: JSON.stringify({ name: "chat-min-roundtrip", staging_url: "https://example.com" }),
    });
    assert(projectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(projectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public");
    createdProjectIds.push(parsedProject.internalId);

    const settingsRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        figma_file: "https://www.figma.com/file/abc123/Design",
        drive_url: "https://drive.google.com/drive/folders/folder123",
      }),
    });
    assert(settingsRes.statusCode === 200, "project settings put should return 200");

    const aiRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({ provider: "openai", model: "gpt-5-codex", enabled: true, is_default: true }),
    });
    assert(aiRes.statusCode === 201, "default ai setting create should return 201");
    const ai = JSON.parse(aiRes.body.toString("utf8"));
    const parsedAi = parsePublicIdFor(KINDS.ai_setting, ai.ai_setting_id);
    assert(parsedAi.ok, "ai_setting_id should be public");
    createdAiSettingIds.push(parsedAi.internalId);

    const threadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "Roundtrip Thread" }),
    });
    assert(threadRes.statusCode === 201, "thread create should return 201");
    const thread = JSON.parse(threadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    createdThreadIds.push(parsedThread.internalId);

    const chatRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({ content: "hello minimal roundtrip" }),
    });
    assert(chatRes.statusCode === 201, "chat should return 201");
    const chat = JSON.parse(chatRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, chat.run_id);
    assert(parsedRun.ok, "run_id should be public");
    createdRunIds.push(parsedRun.internalId);
    assert(chat.status === "succeeded", "chat status should be succeeded");
    assert(typeof chat.message_id === "string" && chat.message_id, "chat should return user message id");
    assert(typeof chat.assistant_message_id === "string" && chat.assistant_message_id, "chat should return assistant message id");
    assert(chat.ai_setting_id === ai.ai_setting_id, "chat should use default ai setting");

    const threadDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${thread.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(threadDetailRes.statusCode === 200, "thread detail should return 200");
    const threadDetail = JSON.parse(threadDetailRes.body.toString("utf8"));
    const userMessage = threadDetail.thread.messages.find((m) => m.message_id === chat.message_id);
    const assistantMessage = threadDetail.thread.messages.find((m) => m.message_id === chat.assistant_message_id);
    assert(userMessage && userMessage.role === "user", "user message should be stored");
    assert(assistantMessage && assistantMessage.role === "assistant", "assistant message should be stored");

    const runRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${chat.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runRes.statusCode === 200, "run detail should return 200");
    const run = JSON.parse(runRes.body.toString("utf8"));
    assert(run.status === "succeeded", "run should be succeeded");
    assert(run.project_id === project.id, "run should reference project public id");
    assert(run.thread_id === thread.thread_id, "run should reference thread public id");
    assert(run.ai_setting_id === ai.ai_setting_id, "run should reference ai_setting_id");
    assert(
      run.context_used &&
        run.context_used.shared_environment &&
        run.context_used.shared_environment.github_repository === "octocat/hello-world",
      "run should record project shared context"
    );
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    createdAiSettingIds.forEach((id) => {
      db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
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
