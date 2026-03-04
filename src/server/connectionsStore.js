const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const connectionsDataDir = path.join(ROOT_DIR, "apps", "hub", "data");
const connectionsDataPath = path.join(connectionsDataDir, "connections.json");
const connectorsCatalogPath = path.join(ROOT_DIR, "apps", "hub", "data", "connectors.catalog.json");
const CONNECTION_SCHEMA_VERSION = "1.0";

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function createEmptyConnections() {
  return {
    ai: { provider: "", name: "", apiKey: "" },
    github: { repo: "", token: "" },
    figma: { fileUrl: "", token: "" },
  };
}

function coerceString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeConnectionsPayload(payload = {}) {
  return {
    ai: {
      provider: coerceString(payload.ai?.provider),
      name: coerceString(payload.ai?.name),
      apiKey: coerceString(payload.ai?.apiKey),
    },
    github: {
      repo: coerceString(payload.github?.repo),
      token: coerceString(payload.github?.token),
    },
    figma: {
      fileUrl: coerceString(payload.figma?.fileUrl),
      token: coerceString(payload.figma?.token),
    },
  };
}

function tokenNote(label, value) {
  if (!hasValue(value)) return `${label}: missing`;
  return `${label}: present len=${String(value).length}`;
}

function secretMeta(value) {
  const present = hasValue(value);
  return {
    has_secret: present,
    secret_len: present ? String(value).length : 0,
  };
}

function buildConnectionItems(connections, updatedAt) {
  return [
    {
      schema_version: CONNECTION_SCHEMA_VERSION,
      id: "conn-ai",
      key: "ai",
      name: "AI Provider",
      enabled: hasValue(connections.ai?.provider) || hasValue(connections.ai?.name) || hasValue(connections.ai?.apiKey),
      connected: hasValue(connections.ai?.apiKey),
      last_checked_at: updatedAt,
      ...secretMeta(connections.ai?.apiKey),
      notes: [tokenNote("api_key", connections.ai?.apiKey), `provider=${connections.ai?.provider || "(none)"}`],
    },
    {
      schema_version: CONNECTION_SCHEMA_VERSION,
      id: "conn-github",
      key: "github",
      name: "GitHub",
      enabled: hasValue(connections.github?.repo) || hasValue(connections.github?.token),
      connected: hasValue(connections.github?.token),
      last_checked_at: updatedAt,
      ...secretMeta(connections.github?.token),
      notes: [tokenNote("token", connections.github?.token), `repo=${connections.github?.repo || "(none)"}`],
    },
    {
      schema_version: CONNECTION_SCHEMA_VERSION,
      id: "conn-figma",
      key: "figma",
      name: "Figma",
      enabled: hasValue(connections.figma?.fileUrl) || hasValue(connections.figma?.token),
      connected: hasValue(connections.figma?.token),
      last_checked_at: updatedAt,
      ...secretMeta(connections.figma?.token),
      notes: [tokenNote("token", connections.figma?.token), `file_url=${connections.figma?.fileUrl || "(none)"}`],
    },
  ];
}

function sanitizeConnectionsForGet(connections) {
  return {
    ai: {
      provider: connections.ai?.provider || "",
      name: connections.ai?.name || "",
      apiKey: "",
    },
    github: {
      repo: connections.github?.repo || "",
      token: "",
    },
    figma: {
      fileUrl: connections.figma?.fileUrl || "",
      token: "",
    },
  };
}

function getConnectionsResponseBody(connections, updatedAt) {
  return {
    schema_version: CONNECTION_SCHEMA_VERSION,
    ...sanitizeConnectionsForGet(connections),
    items: buildConnectionItems(connections, updatedAt),
    updated_at: updatedAt,
  };
}

function readConnections() {
  if (!fs.existsSync(connectionsDataPath)) {
    return createEmptyConnections();
  }
  try {
    const raw = fs.readFileSync(connectionsDataPath, "utf8");
    return normalizeConnectionsPayload(JSON.parse(raw));
  } catch {
    return createEmptyConnections();
  }
}

function writeConnections(data) {
  fs.mkdirSync(connectionsDataDir, { recursive: true });
  fs.writeFileSync(connectionsDataPath, JSON.stringify(data, null, 2), "utf8");
}

function getConnectionsUpdatedAt() {
  if (!fs.existsSync(connectionsDataPath)) return null;
  try {
    return fs.statSync(connectionsDataPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readConnectorsCatalog() {
  if (!fs.existsSync(connectorsCatalogPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(connectorsCatalogPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validationError(message, details = {}) {
  const error = new Error(message);
  error.status = 400;
  error.code = "VALIDATION_ERROR";
  error.failure_code = "validation_error";
  error.details = { failure_code: "validation_error", ...details };
  return error;
}

function ensureObject(value, label) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${label} must be object`);
  }
}

function setIfPresent(target, source, fieldPath, detailsKey) {
  if (!Object.prototype.hasOwnProperty.call(source, fieldPath)) return;
  const value = source[fieldPath];
  if (typeof value !== "string") {
    throw validationError(`${detailsKey} must be string`, { field: detailsKey });
  }
  target[fieldPath] = value.trim();
}

function applyConnectionsUpdate(existing, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("入力が不正です", { field: "body" });
  }

  ensureObject(payload.ai, "ai");
  ensureObject(payload.github, "github");
  ensureObject(payload.figma, "figma");

  if (payload.items !== undefined && !Array.isArray(payload.items)) {
    throw validationError("items must be array", { field: "items" });
  }
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw validationError("items entry must be object", { field: `items[${index}]` });
      }
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
        throw validationError("items[].enabled must be boolean", { field: `items[${index}].enabled` });
      }
    });
  }

  const next = normalizeConnectionsPayload(existing);
  if (payload.ai) {
    setIfPresent(next.ai, payload.ai, "provider", "ai.provider");
    setIfPresent(next.ai, payload.ai, "name", "ai.name");
    setIfPresent(next.ai, payload.ai, "apiKey", "ai.apiKey");
  }
  if (payload.github) {
    setIfPresent(next.github, payload.github, "repo", "github.repo");
    setIfPresent(next.github, payload.github, "token", "github.token");
  }
  if (payload.figma) {
    setIfPresent(next.figma, payload.figma, "fileUrl", "figma.fileUrl");
    setIfPresent(next.figma, payload.figma, "token", "figma.token");
  }

  return next;
}

function updateConnections(payload) {
  const existing = readConnections();
  const next = applyConnectionsUpdate(existing, payload);
  writeConnections(next);
  const updatedAt = getConnectionsUpdatedAt();
  return {
    data: next,
    updatedAt,
    body: getConnectionsResponseBody(next, updatedAt),
  };
}

function sanitizeConnectionsPayloadForLog(payload = {}) {
  const aiApiKey = typeof payload.ai?.apiKey === "string" ? payload.ai.apiKey.trim() : "";
  const githubToken = typeof payload.github?.token === "string" ? payload.github.token.trim() : "";
  const figmaToken = typeof payload.figma?.token === "string" ? payload.figma.token.trim() : "";
  return {
    ai: {
      provider: typeof payload.ai?.provider === "string" ? payload.ai.provider.trim() : "",
      name: typeof payload.ai?.name === "string" ? payload.ai.name.trim() : "",
      apiKey: secretMeta(aiApiKey),
    },
    github: {
      repo: typeof payload.github?.repo === "string" ? payload.github.repo.trim() : "",
      token: secretMeta(githubToken),
    },
    figma: {
      fileUrl: typeof payload.figma?.fileUrl === "string" ? payload.figma.fileUrl.trim() : "",
      token: secretMeta(figmaToken),
    },
    items_count: Array.isArray(payload.items) ? payload.items.length : 0,
  };
}

module.exports = {
  CONNECTION_SCHEMA_VERSION,
  hasValue,
  tokenNote,
  secretMeta,
  readConnections,
  readConnectorsCatalog,
  getConnectionsUpdatedAt,
  getConnectionsResponseBody,
  applyConnectionsUpdate,
  updateConnections,
  validationError,
  sanitizeConnectionsPayloadForLog,
};
