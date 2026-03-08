const UUID_V4ish_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KINDS = Object.freeze({
  project: "project",
  thread: "thread",
  run: "run",
  ai_setting: "ai_setting",
});

const PREFIX_SET = new Set(Object.values(KINDS));

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value) {
  const text = normalizeText(value);
  return UUID_V4ish_RE.test(text);
}

function splitPublicId(value) {
  const text = normalizeText(value);
  const idx = text.lastIndexOf("_");
  if (idx <= 0 || idx >= text.length - 1) {
    return null;
  }
  return {
    prefix: text.slice(0, idx),
    internalId: text.slice(idx + 1),
  };
}

function buildPublicId(kind, internalId) {
  const normalizedKind = normalizeText(kind);
  const normalizedInternalId = normalizeText(internalId);
  if (!PREFIX_SET.has(normalizedKind)) {
    throw new Error(`unknown_public_id_prefix:${normalizedKind || "-"}`);
  }
  if (!isUuid(normalizedInternalId)) {
    throw new Error("invalid_internal_id");
  }
  return `${normalizedKind}_${normalizedInternalId}`;
}

function parsePublicId(value) {
  const text = normalizeText(value);
  const pair = splitPublicId(text);
  if (!pair) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "public_id format is invalid",
      details: { failure_code: "validation_error", error: "invalid_format" },
    };
  }
  if (!PREFIX_SET.has(pair.prefix)) {
    return {
      ok: false,
      reason: "unknown_prefix",
      message: "public_id prefix is unknown",
      details: { failure_code: "validation_error", error: "unknown_prefix", prefix: pair.prefix },
    };
  }
  if (!isUuid(pair.internalId)) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "public_id format is invalid",
      details: { failure_code: "validation_error", error: "invalid_format" },
    };
  }
  return {
    ok: true,
    kind: pair.prefix,
    internalId: pair.internalId,
    publicId: `${pair.prefix}_${pair.internalId}`,
  };
}

function parsePublicIdFor(kind, value) {
  const normalizedKind = normalizeText(kind);
  if (!PREFIX_SET.has(normalizedKind)) {
    return {
      ok: false,
      reason: "unknown_prefix",
      message: "public_id prefix is unknown",
      details: { failure_code: "validation_error", error: "unknown_prefix", prefix: normalizedKind || "-" },
    };
  }
  const parsed = parsePublicId(value);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.kind !== normalizedKind) {
    return {
      ok: false,
      reason: "invalid_format",
      message: `${normalizedKind}_id format is invalid`,
      details: {
        failure_code: "validation_error",
        error: "invalid_format",
        expected_prefix: normalizedKind,
      },
    };
  }
  return parsed;
}

module.exports = {
  KINDS,
  isUuid,
  buildPublicId,
  parsePublicId,
  parsePublicIdFor,
};
