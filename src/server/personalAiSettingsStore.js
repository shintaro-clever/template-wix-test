const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db");
const { KINDS, buildPublicId, parsePublicIdFor, isUuid } = require("../id/publicIds");

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function validationError(message, details = {}) {
  return {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details: { failure_code: "validation_error", ...details },
  };
}

function toBoolOrDefault(value, fallback) {
  if (value === undefined) return fallback;
  return Boolean(value);
}

function toPublicAiSettingId(internalId) {
  return isUuid(internalId) ? buildPublicId(KINDS.ai_setting, internalId) : internalId;
}

function parseAiSettingIdInput(input) {
  const id = normalizeText(input);
  if (!id) {
    return { ok: false, ...validationError("ai_setting_id is required") };
  }
  if (isUuid(id)) {
    return { ok: true, internalId: id, publicId: toPublicAiSettingId(id), mode: "legacy_uuid" };
  }
  const parsed = parsePublicIdFor(KINDS.ai_setting, id);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: parsed.message || "ai_setting_id format is invalid",
      details: parsed.details || { failure_code: "validation_error" },
    };
  }
  return { ok: true, internalId: parsed.internalId, publicId: parsed.publicId, mode: "public_id" };
}

function parseConfig(input) {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw validationError("config must be an object", { field: "config" });
  }
  return input;
}

function sanitizeWritableInput(input = {}, mode = "create") {
  const provider = normalizeText(input.provider);
  const model = normalizeText(input.model);

  if (mode === "create") {
    if (!provider) throw validationError("provider is required", { field: "provider" });
    if (!model) throw validationError("model is required", { field: "model" });
  }

  const next = {};
  if (input.provider !== undefined) {
    if (!provider) throw validationError("provider is required", { field: "provider" });
    next.provider = provider;
  }
  if (input.model !== undefined) {
    if (!model) throw validationError("model is required", { field: "model" });
    next.model = model;
  }
  if (input.secret_ref !== undefined) {
    next.secret_ref = normalizeOptionalText(input.secret_ref);
  }
  if (input.config !== undefined) {
    next.config = parseConfig(input.config);
  }
  if (input.enabled !== undefined) {
    next.enabled = Boolean(input.enabled);
  }
  if (input.is_default !== undefined) {
    next.is_default = Boolean(input.is_default);
  }

  return next;
}

function mapRow(row) {
  const configText = normalizeText(row.config_json);
  let config = {};
  if (configText) {
    try {
      const parsed = JSON.parse(configText);
      config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      config = {};
    }
  }
  return {
    ai_setting_id: toPublicAiSettingId(row.id),
    provider: normalizeText(row.provider),
    model: normalizeText(row.model),
    secret_ref: normalizeOptionalText(row.secret_ref),
    config,
    enabled: Number(row.enabled || 0) === 1,
    is_default: Number(row.is_default || 0) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listPersonalAiSettings(db, userId) {
  const uid = normalizeText(userId);
  if (!uid) throw validationError("user_id is required");
  const rows = db
    .prepare(
      `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
       FROM personal_ai_settings
       WHERE tenant_id=? AND user_id=?
       ORDER BY is_default DESC, updated_at DESC`
    )
    .all(DEFAULT_TENANT, uid);
  const items = rows.map(mapRow);
  const defaultItem = items.find((item) => item.is_default) || null;
  return { items, default_ai_setting_id: defaultItem ? defaultItem.ai_setting_id : null };
}

function getPersonalAiSetting(db, userId, aiSettingIdInput) {
  const uid = normalizeText(userId);
  if (!uid) throw validationError("user_id is required");
  const parsed = parseAiSettingIdInput(aiSettingIdInput);
  if (!parsed.ok) {
    throw {
      status: parsed.status,
      code: parsed.code,
      message: parsed.message,
      details: parsed.details,
    };
  }
  const row = db
    .prepare(
      `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
       FROM personal_ai_settings
       WHERE tenant_id=? AND user_id=? AND id=?
       LIMIT 1`
    )
    .get(DEFAULT_TENANT, uid, parsed.internalId);
  return row ? mapRow(row) : null;
}

function createPersonalAiSetting(db, userId, payload = {}) {
  const uid = normalizeText(userId);
  if (!uid) throw validationError("user_id is required");
  const data = sanitizeWritableInput(payload, "create");

  const tx = db.transaction(() => {
    const ts = nowIso();
    const id = crypto.randomUUID();
    const exists = db
      .prepare("SELECT 1 FROM personal_ai_settings WHERE tenant_id=? AND user_id=? LIMIT 1")
      .get(DEFAULT_TENANT, uid);
    const isDefault = toBoolOrDefault(data.is_default, !exists);

    if (isDefault) {
      db.prepare("UPDATE personal_ai_settings SET is_default=0, updated_at=? WHERE tenant_id=? AND user_id=?").run(
        ts,
        DEFAULT_TENANT,
        uid
      );
    }

    db.prepare(
      `INSERT INTO personal_ai_settings(
         tenant_id,id,user_id,provider,model,secret_ref,config_json,enabled,is_default,created_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      DEFAULT_TENANT,
      id,
      uid,
      data.provider,
      data.model,
      data.secret_ref || null,
      JSON.stringify(data.config || {}),
      data.enabled === undefined ? 1 : data.enabled ? 1 : 0,
      isDefault ? 1 : 0,
      ts,
      ts
    );

    const row = db
      .prepare(
        `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
         FROM personal_ai_settings
         WHERE tenant_id=? AND user_id=? AND id=?`
      )
      .get(DEFAULT_TENANT, uid, id);
    return mapRow(row);
  });

  return tx();
}

function patchPersonalAiSetting(db, userId, aiSettingIdInput, payload = {}) {
  const uid = normalizeText(userId);
  if (!uid) throw validationError("user_id is required");
  const parsed = parseAiSettingIdInput(aiSettingIdInput);
  if (!parsed.ok) {
    throw {
      status: parsed.status,
      code: parsed.code,
      message: parsed.message,
      details: parsed.details,
    };
  }
  const data = sanitizeWritableInput(payload, "patch");

  const tx = db.transaction(() => {
    const current = db
      .prepare(
        `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
         FROM personal_ai_settings
         WHERE tenant_id=? AND user_id=? AND id=?
         LIMIT 1`
      )
      .get(DEFAULT_TENANT, uid, parsed.internalId);
    if (!current) {
      return null;
    }

    const next = {
      provider: data.provider !== undefined ? data.provider : current.provider,
      model: data.model !== undefined ? data.model : current.model,
      secret_ref: data.secret_ref !== undefined ? data.secret_ref : current.secret_ref,
      config_json: data.config !== undefined ? JSON.stringify(data.config) : current.config_json,
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : Number(current.enabled || 0) === 1 ? 1 : 0,
      is_default: data.is_default !== undefined ? (data.is_default ? 1 : 0) : Number(current.is_default || 0) === 1 ? 1 : 0,
      updated_at: nowIso(),
    };

    if (next.is_default === 1) {
      db.prepare("UPDATE personal_ai_settings SET is_default=0, updated_at=? WHERE tenant_id=? AND user_id=? AND id<>?").run(
        next.updated_at,
        DEFAULT_TENANT,
        uid,
        parsed.internalId
      );
    }

    db.prepare(
      `UPDATE personal_ai_settings
       SET provider=?, model=?, secret_ref=?, config_json=?, enabled=?, is_default=?, updated_at=?
       WHERE tenant_id=? AND user_id=? AND id=?`
    ).run(
      next.provider,
      next.model,
      next.secret_ref,
      next.config_json,
      next.enabled,
      next.is_default,
      next.updated_at,
      DEFAULT_TENANT,
      uid,
      parsed.internalId
    );

    const row = db
      .prepare(
        `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
         FROM personal_ai_settings
         WHERE tenant_id=? AND user_id=? AND id=?`
      )
      .get(DEFAULT_TENANT, uid, parsed.internalId);
    return mapRow(row);
  });

  return tx();
}

function getDefaultPersonalAiSetting(db, userId) {
  const uid = normalizeText(userId);
  if (!uid) throw validationError("user_id is required");
  const row = db
    .prepare(
      `SELECT id, provider, model, secret_ref, config_json, enabled, is_default, created_at, updated_at
       FROM personal_ai_settings
       WHERE tenant_id=? AND user_id=? AND enabled=1 AND is_default=1
       LIMIT 1`
    )
    .get(DEFAULT_TENANT, uid);
  return row ? mapRow(row) : null;
}

module.exports = {
  listPersonalAiSettings,
  getPersonalAiSetting,
  createPersonalAiSetting,
  patchPersonalAiSetting,
  getDefaultPersonalAiSetting,
  parseAiSettingIdInput,
  toPublicAiSettingId,
  validationError,
};
