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

    const listEmptyRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/me/ai-settings",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listEmptyRes.statusCode === 200, `empty list should return 200, got ${listEmptyRes.statusCode}`);
    const listEmptyBody = JSON.parse(listEmptyRes.body.toString("utf8"));
    assert(Array.isArray(listEmptyBody.items), "items should be array");
    assert(listEmptyBody.items.length === 0, "items should be empty initially");
    assert(listEmptyBody.default_ai_setting_id === null, "default should be null initially");

    const createARes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5-codex",
        secret_ref: "vault://openai/default",
        enabled: true,
        is_default: true,
        config: { temperature: 0.1 },
      }),
    });
    assert(createARes.statusCode === 201, `create A should return 201, got ${createARes.statusCode}`);
    const createABody = JSON.parse(createARes.body.toString("utf8"));
    const parsedA = parsePublicIdFor(KINDS.ai_setting, createABody.ai_setting_id);
    assert(parsedA.ok, "ai setting id should be prefixed public id");
    assert(createABody.is_default === true, "first default should be true");

    const createBRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({
        provider: "anthropic",
        model: "claude-4.1",
        enabled: true,
        config: { temperature: 0.2 },
      }),
    });
    assert(createBRes.statusCode === 201, `create B should return 201, got ${createBRes.statusCode}`);
    const createBBody = JSON.parse(createBRes.body.toString("utf8"));
    assert(createBBody.is_default === false, "second setting should not be default by default");

    const listRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/me/ai-settings",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(listRes.statusCode === 200, `list should return 200, got ${listRes.statusCode}`);
    const listBody = JSON.parse(listRes.body.toString("utf8"));
    assert(listBody.items.length === 2, `items should have 2 entries, got ${listBody.items.length}`);
    assert(listBody.default_ai_setting_id === createABody.ai_setting_id, "default id should point to first setting");

    const patchBRes = await requestLocal(handler, {
      method: "PATCH",
      url: `/api/me/ai-settings/${createBBody.ai_setting_id}`,
      headers: authz,
      body: JSON.stringify({ is_default: true, model: "claude-4.2" }),
    });
    assert(patchBRes.statusCode === 200, `patch B should return 200, got ${patchBRes.statusCode}`);
    const patchBBody = JSON.parse(patchBRes.body.toString("utf8"));
    assert(patchBBody.item && patchBBody.item.is_default === true, "patched setting should be default");
    assert(patchBBody.item.model === "claude-4.2", "model should be updated");

    const getARes = await requestLocal(handler, {
      method: "GET",
      url: `/api/me/ai-settings/${createABody.ai_setting_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getARes.statusCode === 200, `get A should return 200, got ${getARes.statusCode}`);
    const getABody = JSON.parse(getARes.body.toString("utf8"));
    assert(getABody.item && getABody.item.is_default === false, "old default should be unset after switch");

    const getDefaultRes = await requestLocal(handler, {
      method: "GET",
      url: "/api/me/ai-settings/default",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(getDefaultRes.statusCode === 200, `default endpoint should return 200, got ${getDefaultRes.statusCode}`);
    const getDefaultBody = JSON.parse(getDefaultRes.body.toString("utf8"));
    assert(getDefaultBody.item && getDefaultBody.item.ai_setting_id === createBBody.ai_setting_id, "default endpoint should return switched default");

    const invalidCreateRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/me/ai-settings",
      headers: authz,
      body: JSON.stringify({ model: "gpt-5" }),
    });
    assert(invalidCreateRes.statusCode === 400, `missing provider should return 400, got ${invalidCreateRes.statusCode}`);

    const invalidIdRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/me/ai-settings/workspace_${crypto.randomUUID()}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(invalidIdRes.statusCode === 400, `unknown prefix should return 400, got ${invalidIdRes.statusCode}`);
    const invalidIdBody = JSON.parse(invalidIdRes.body.toString("utf8"));
    assert(invalidIdBody.details && invalidIdBody.details.failure_code === "validation_error", "invalid prefix should be validation_error");
  } finally {
    db.prepare("DELETE FROM personal_ai_settings WHERE tenant_id=? AND user_id=?").run(DEFAULT_TENANT, userId);
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
