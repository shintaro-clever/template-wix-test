const { DEFAULT_TENANT } = require("../db/sqlite");
const crypto = require("crypto");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { withRetry } = require("../db/retry");
const { buildErrorBody } = require("../server/errors");
const PROJECT_SHARED_ENV_SCHEMA_VERSION = "project_shared_env/v1";

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(res, status, code, message, details) {
  sendJson(
    res,
    status,
    buildErrorBody({
      code,
      message,
      details: details || {},
    })
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        req._logBody = parsed;
        resolve(parsed);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function validateHttpsUrl(url) {
  if (typeof url !== "string" || url.trim().length === 0) return "staging_url is required";
  if (url.length > 2048) return "staging_url too long";
  if (!/^https:\/\//i.test(url)) return "staging_url must start with https://";
  return null;
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length === 0) return "name is required";
  if (name.length > 200) return "name too long";
  return null;
}

function normalizeDriveFolderId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const urlMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  const queryMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1];
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) {
    return text;
  }
  return "";
}

function validateDriveFolderId(value, { required = false } = {}) {
  const normalized = normalizeDriveFolderId(value);
  if (!normalized) {
    return required ? "drive_folder_id is required" : null;
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(normalized)) {
    return "drive_folder_id is invalid";
  }
  return null;
}

function validateGithubRepository(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "github_repository is required" : null;
  if (text.length > 300) return "github_repository too long";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return "github_repository is invalid";
  return null;
}

function validateFigmaFile(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "figma_file is required" : null;
  if (text.length > 2048) return "figma_file too long";
  return null;
}

function validateDriveUrl(value, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? "drive_url is required" : null;
  if (text.length > 2048) return "drive_url too long";
  if (!/^https:\/\//i.test(text)) return "drive_url must start with https://";
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultProjectSharedEnvironment() {
  return {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: { repository: "" },
    figma: { file: "" },
    drive: { url: "" },
  };
}

function parseProjectSharedEnvironment(raw) {
  const base = defaultProjectSharedEnvironment();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return base;
  }
  const githubRepository = typeof raw.github?.repository === "string" ? raw.github.repository.trim() : "";
  const figmaFile = typeof raw.figma?.file === "string" ? raw.figma.file.trim() : "";
  const driveUrl = typeof raw.drive?.url === "string" ? raw.drive.url.trim() : "";
  return {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: { repository: githubRepository },
    figma: { file: figmaFile },
    drive: { url: driveUrl },
  };
}

function parseProjectSharedEnvironmentJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return defaultProjectSharedEnvironment();
  }
  try {
    return parseProjectSharedEnvironment(JSON.parse(text));
  } catch {
    return defaultProjectSharedEnvironment();
  }
}

function listProjects(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
  );
}

function getProject(db, id) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at FROM projects WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, id)
  );
}

function createProject(db, name, stagingUrl, actorId, options = {}) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const description = typeof options.description === "string" ? options.description.trim() : "";
  const driveFolderId = normalizeDriveFolderId(options.drive_folder_id);
  withRetry(() =>
    db.prepare(
      "INSERT INTO projects(tenant_id,id,name,description,staging_url,drive_folder_id,project_shared_env_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(
      DEFAULT_TENANT,
      id,
      name,
      description,
      stagingUrl,
      driveFolderId || null,
      JSON.stringify(defaultProjectSharedEnvironment()),
      ts,
      ts
    )
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_CREATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function getProjectSharedEnvironment(db, id) {
  const project = getProject(db, id);
  if (!project) return null;
  return parseProjectSharedEnvironmentJson(project.project_shared_env_json);
}

function putProjectSharedEnvironment(db, id, patch = {}) {
  const current = getProject(db, id);
  if (!current) return null;
  if (patch && typeof patch !== "object") {
    throw new Error("project_shared_environment patch must be object");
  }
  const githubRepository =
    patch.github_repository !== undefined ? String(patch.github_repository || "").trim() : undefined;
  const figmaFile = patch.figma_file !== undefined ? String(patch.figma_file || "").trim() : undefined;
  const driveUrl = patch.drive_url !== undefined ? String(patch.drive_url || "").trim() : undefined;

  const repoErr = validateGithubRepository(githubRepository);
  if (repoErr) throw new Error(repoErr);
  const figmaErr = validateFigmaFile(figmaFile);
  if (figmaErr) throw new Error(figmaErr);
  const driveErr = validateDriveUrl(driveUrl);
  if (driveErr) throw new Error(driveErr);

  const prev = parseProjectSharedEnvironmentJson(current.project_shared_env_json);
  const next = {
    schema_version: PROJECT_SHARED_ENV_SCHEMA_VERSION,
    github: { repository: githubRepository !== undefined ? githubRepository : prev.github.repository },
    figma: { file: figmaFile !== undefined ? figmaFile : prev.figma.file },
    drive: { url: driveUrl !== undefined ? driveUrl : prev.drive.url },
  };
  withRetry(() =>
    db
      .prepare("UPDATE projects SET project_shared_env_json=?, updated_at=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(next), nowIso(), DEFAULT_TENANT, id)
  );
  return next;
}

function patchProject(db, id, patch, actorId) {
  const existing = getProject(db, id);
  if (!existing) return null;

  const nextName = typeof patch.name === "string" ? patch.name : existing.name;
  const nextUrl = typeof patch.staging_url === "string" ? patch.staging_url : existing.staging_url;
  const nextDescription =
    typeof patch.description === "string" ? patch.description : existing.description || "";
  const nextDriveFolderId =
    patch.drive_folder_id !== undefined
      ? normalizeDriveFolderId(patch.drive_folder_id) || null
      : existing.drive_folder_id || null;

  withRetry(() =>
    db
      .prepare(
        "UPDATE projects SET name=?, description=?, staging_url=?, drive_folder_id=?, updated_at=? WHERE tenant_id=? AND id=?"
      )
      .run(nextName, nextDescription, nextUrl, nextDriveFolderId, nowIso(), DEFAULT_TENANT, id)
  );
  recordAudit({
    db,
    action: AUDIT_ACTIONS.PROJECT_UPDATE,
    tenantId: DEFAULT_TENANT,
    actorId,
    meta: { project_id: id },
  });
  return getProject(db, id);
}

function deleteProject(db, id, actorId) {
  const info = withRetry(() =>
    db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id)
  );
  if (info.changes > 0) {
    recordAudit({
      db,
      action: AUDIT_ACTIONS.PROJECT_DELETE,
      tenantId: DEFAULT_TENANT,
      actorId,
      meta: { project_id: id },
    });
  }
  return info.changes > 0;
}

module.exports = {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  validateDriveFolderId,
  validateGithubRepository,
  validateFigmaFile,
  validateDriveUrl,
  normalizeDriveFolderId,
  defaultProjectSharedEnvironment,
  parseProjectSharedEnvironment,
  parseProjectSharedEnvironmentJson,
  getProjectSharedEnvironment,
  putProjectSharedEnvironment,
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
};
