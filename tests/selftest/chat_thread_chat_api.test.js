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

    const projectRes1 = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "chat-api-project-1", staging_url: "https://example.com" }),
    });
    assert(projectRes1.statusCode === 201, "project 1 create should return 201");
    const project1 = JSON.parse(projectRes1.body.toString("utf8"));
    const parsedProject1 = parsePublicIdFor(KINDS.project, project1.id);
    assert(parsedProject1.ok, "project 1 id should be public");
    createdProjectIds.push(parsedProject1.internalId);

    const projectRes2 = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "chat-api-project-2", staging_url: "https://example.net" }),
    });
    assert(projectRes2.statusCode === 201, "project 2 create should return 201");
    const project2 = JSON.parse(projectRes2.body.toString("utf8"));
    const parsedProject2 = parsePublicIdFor(KINDS.project, project2.id);
    assert(parsedProject2.ok, "project 2 id should be public");
    createdProjectIds.push(parsedProject2.internalId);

    const putSettingsRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project1.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        figma_file: "https://www.figma.com/file/abc123/Design",
        drive_url: "https://drive.google.com/drive/folders/folder123",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "project settings put should return 200");

    const createAiRes = await requestLocal(handler, {
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
    assert(createAiRes.statusCode === 201, "ai setting create should return 201");
    const createdAi = JSON.parse(createAiRes.body.toString("utf8"));
    assert(createdAi.ai_setting_id, "ai setting id should exist");
    const parsedAi = parsePublicIdFor(KINDS.ai_setting, createdAi.ai_setting_id);
    assert(parsedAi.ok, "ai setting id should be public");
    createdAiSettingIds.push(parsedAi.internalId);

    const createThreadRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project1.id}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "Existing Thread" }),
    });
    assert(createThreadRes.statusCode === 201, "thread create should return 201");
    const thread = JSON.parse(createThreadRes.body.toString("utf8"));
    const parsedThread = parsePublicIdFor(KINDS.thread, thread.thread_id);
    assert(parsedThread.ok, "thread id should be public");
    createdThreadIds.push(parsedThread.internalId);

    const chatRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project1.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({ content: "hello from chat endpoint" }),
    });
    assert(chatRes.statusCode === 201, `chat should return 201, got ${chatRes.statusCode}`);
    const chatBody = JSON.parse(chatRes.body.toString("utf8"));
    assert(chatBody.project_id === project1.id, "chat response project_id should match");
    assert(chatBody.thread_id === thread.thread_id, "chat response thread_id should match");
    assert(typeof chatBody.message_id === "string" && chatBody.message_id, "chat response should contain message_id");
    const parsedRun = parsePublicIdFor(KINDS.run, chatBody.run_id);
    assert(parsedRun.ok, "chat response run_id should be public");
    createdRunIds.push(parsedRun.internalId);
    assert(chatBody.ai_setting_id === createdAi.ai_setting_id, "chat should use default ai setting");
    assert(chatBody.status === "succeeded", "chat should complete with succeeded status");
    assert(typeof chatBody.assistant_message_id === "string" && chatBody.assistant_message_id, "assistant message id should be returned");

    const threadDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${thread.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(threadDetailRes.statusCode === 200, "thread detail should return 200");
    const threadDetail = JSON.parse(threadDetailRes.body.toString("utf8"));
    const userMessage = threadDetail.thread.messages.find((m) => m.content === "hello from chat endpoint");
    assert(userMessage && userMessage.role === "user", "chat should save user message on existing thread");
    const assistantMessage = threadDetail.thread.messages.find((m) => m.message_id === chatBody.assistant_message_id);
    assert(assistantMessage && assistantMessage.role === "assistant", "chat should save assistant message");

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${chatBody.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(runDetail.project_id === project1.id, "run should reference project public id");
    assert(runDetail.thread_id === thread.thread_id, "run should reference thread public id");
    assert(runDetail.ai_setting_id === createdAi.ai_setting_id, "run should reference default ai setting");
    assert(runDetail.inputs && runDetail.inputs.content === "hello from chat endpoint", "run inputs should include content");
    assert(
      runDetail.inputs &&
        runDetail.inputs.shared_environment &&
        runDetail.inputs.shared_environment.github_repository === "octocat/hello-world",
      "run inputs should include normalized shared environment"
    );
    assert(runDetail.status === "succeeded", "run should be succeeded on local stub success");

    const patchAiRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/me/ai-settings/${createdAi.ai_setting_id}`,
      headers: authz,
      body: JSON.stringify({ model: "local_stub_fail", is_default: true, enabled: true }),
    });
    assert(patchAiRes.statusCode === 200, "ai setting patch should return 200");

    const failChatRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project1.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({ content: "this should fail via local stub model" }),
    });
    assert(failChatRes.statusCode === 201, "failed chat still returns 201 with run id");
    const failChatBody = JSON.parse(failChatRes.body.toString("utf8"));
    const parsedFailRun = parsePublicIdFor(KINDS.run, failChatBody.run_id);
    assert(parsedFailRun.ok, "failed chat run id should be public");
    createdRunIds.push(parsedFailRun.internalId);
    assert(failChatBody.status === "failed", "failed chat should report failed status");
    assert(failChatBody.failure_code === "local_stub_error", "failed chat should report failure_code");
    assert(failChatBody.assistant_message_id === null, "failed chat should not create assistant message");

    const failRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${failChatBody.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(failRunDetailRes.statusCode === 200, "failed run detail should return 200");
    const failRunDetail = JSON.parse(failRunDetailRes.body.toString("utf8"));
    assert(failRunDetail.status === "failed", "run should be failed when local stub fails");
    assert(failRunDetail.failure_code === "local_stub_error", "failed run should keep failure_code");

    const wrongProjectRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project2.id}/threads/${thread.thread_id}/chat`,
      headers: authz,
      body: JSON.stringify({ content: "should fail" }),
    });
    assert(wrongProjectRes.statusCode === 400, "chat should reject thread/project mismatch");
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
