const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS, isUuid } = require("../../src/id/publicIds");
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

    // テスト用プロジェクトを作成
    const projRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "thread-create-test", staging_url: "https://example.com" }),
    });
    assert(projRes.statusCode === 201, `project create should return 201, got ${projRes.statusCode}`);
    const project = JSON.parse(projRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project.id should be public project ID");
    createdProjectIds.push(parsedProject.internalId);
    const pid = project.id;

    // 1. POST /api/projects/:id/threads 正常系 → 201
    const createRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "最初のスレッド" }),
    });
    assert(createRes.statusCode === 201, `POST threads should return 201, got ${createRes.statusCode}`);
    const created = JSON.parse(createRes.body.toString("utf8"));
    assert(created.thread_id, "response should have thread_id");
    assert(/^thread_[0-9a-f-]{36}$/i.test(created.thread_id), "thread_id should be public thread ID");
    assert(created.project_id === pid, "response project_id should match");
    assert(created.title === "最初のスレッド", "response title should match");
    assert(created.created_at, "response should have created_at");
    createdThreadIds.push(created.thread_id);

    // 2. POST 後 GET で一覧に反映
    const listRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/threads`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRes.statusCode === 200, `GET threads should return 200`);
    const listBody = JSON.parse(listRes.body.toString("utf8"));
    const found = listBody.threads.find((t) => t.thread_id === created.thread_id);
    assert(found, "created thread should appear in list");
    assert(found.title === "最初のスレッド", "title should match in list");

    // 3. GET /api/threads/:id で詳細取得
    const detailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/${created.thread_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detailRes.statusCode === 200, `GET thread detail should return 200`);
    const detailBody = JSON.parse(detailRes.body.toString("utf8"));
    assert(detailBody.thread.thread_id === created.thread_id, "detail thread_id should match");
    assert(Array.isArray(detailBody.thread.messages), "messages should be array");

    // 4. POST /api/threads/:id/messages で投稿継続動作
    const msgRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/threads/${created.thread_id}/messages`,
      headers: authz,
      body: JSON.stringify({ body: "テストメッセージです" }),
    });
    assert(msgRes.statusCode === 201, `POST message should return 201, got ${msgRes.statusCode}`);
    const msgBody = JSON.parse(msgRes.body.toString("utf8"));
    assert(msgBody.message_id, "response should have message_id");

    // 4.5 unknown prefix thread id → 400 validation_error
    const invalidThreadPrefix = await requestLocal(handler, {
      method: "GET",
      url: `/api/threads/workspace_${crypto.randomUUID()}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidThreadPrefix.statusCode === 400, `unknown thread prefix should return 400, got ${invalidThreadPrefix.statusCode}`);

    // 5. 空タイトル → 400
    const emptyTitle = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "" }),
    });
    assert(emptyTitle.statusCode === 400, `empty title should return 400, got ${emptyTitle.statusCode}`);

    // 6. タイトル未指定 → 400
    const noTitle = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({}),
    });
    assert(noTitle.statusCode === 400, `missing title should return 400, got ${noTitle.statusCode}`);

    // 7. タイトル 101 文字 → 400
    const longTitle = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "a".repeat(101) }),
    });
    assert(longTitle.statusCode === 400, `101-char title should return 400, got ${longTitle.statusCode}`);

    // 8. タイトル 100 文字 → 201 (境界値)
    const maxTitle = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "a".repeat(100) }),
    });
    assert(maxTitle.statusCode === 201, `100-char title should return 201, got ${maxTitle.statusCode}`);
    const maxCreated = JSON.parse(maxTitle.body.toString("utf8"));
    createdThreadIds.push(maxCreated.thread_id);

    // 9. 存在しないプロジェクト → 404
    const notFoundProjectId = `project_${crypto.randomUUID()}`;
    const notFoundRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${notFoundProjectId}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "test" }),
    });
    assert(notFoundRes.statusCode === 404, `nonexistent project should return 404, got ${notFoundRes.statusCode}`);

    // 10. タイトルの前後空白はトリムされる
    const trimRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${pid}/threads`,
      headers: authz,
      body: JSON.stringify({ title: "  trimmed title  " }),
    });
    assert(trimRes.statusCode === 201, `trimmed title should return 201`);
    const trimCreated = JSON.parse(trimRes.body.toString("utf8"));
    assert(trimCreated.title === "trimmed title", "title should be trimmed");
    createdThreadIds.push(trimCreated.thread_id);
  } finally {
    createdThreadIds.forEach((id) => {
      const parsed = parsePublicIdFor(KINDS.thread, id);
      const internalId = parsed.ok ? parsed.internalId : (isUuid(id) ? id : null);
      if (!internalId) return;
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, internalId);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, internalId);
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
