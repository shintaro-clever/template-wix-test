const { DEFAULT_TENANT } = require("../db");
const {
  validateGithubRepository,
  validateFigmaFile,
  validateDriveUrl,
  getProjectSharedEnvironment,
  putProjectSharedEnvironment,
} = require("../api/projects");

const ALLOWED_BINDING_KEYS = ["ai", "github", "figma"];

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function projectExists(db, projectId) {
  return !!db
    .prepare("SELECT id FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
}

// --- Connections ---
function defaultConnections(projectId) {
  return {
    project_id: projectId,
    items: ALLOWED_BINDING_KEYS.map((key) => ({ key, enabled: false })),
  };
}

function getProjectConnections(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_bindings_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_bindings_json) return defaultConnections(projectId);
  try {
    const parsed = JSON.parse(row.project_bindings_json);
    if (!Array.isArray(parsed.items)) return defaultConnections(projectId);
    return { project_id: projectId, items: parsed.items };
  } catch {
    return defaultConnections(projectId);
  }
}

function readProjectBindingsRaw(db, projectId) {
  const row = db
    .prepare("SELECT project_bindings_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_bindings_json) return {};
  try {
    const parsed = JSON.parse(row.project_bindings_json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function putProjectConnections(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (!Array.isArray(body.items)) throw validationError("items must be an array");
  const seen = new Set();
  for (const item of body.items) {
    if (!item || typeof item !== "object") throw validationError("invalid item");
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!ALLOWED_BINDING_KEYS.includes(key)) throw validationError(`unknown key: ${key}`);
    if (seen.has(key)) throw validationError(`duplicate key: ${key}`);
    seen.add(key);
    if (typeof item.enabled !== "boolean") throw validationError("enabled must be boolean");
  }
  const now = new Date().toISOString();
  const current = readProjectBindingsRaw(db, projectId);
  const data = {
    ...current,
    items: body.items.map(({ key, enabled }) => ({ key, enabled })),
  };
  db.prepare(
    "UPDATE projects SET project_bindings_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, items: data.items };
}

// --- Drive ---
function defaultDrive(projectId) {
  return { project_id: projectId, folder_id: "", folder_url: "", enabled: false };
}

function getProjectDrive(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const row = db
    .prepare("SELECT project_drive_json FROM projects WHERE tenant_id=? AND id=? LIMIT 1")
    .get(DEFAULT_TENANT, projectId);
  if (!row || !row.project_drive_json) return defaultDrive(projectId);
  try {
    const parsed = JSON.parse(row.project_drive_json);
    return {
      project_id: projectId,
      folder_id: typeof parsed.folder_id === "string" ? parsed.folder_id : "",
      folder_url: typeof parsed.folder_url === "string" ? parsed.folder_url : "",
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
    };
  } catch {
    return defaultDrive(projectId);
  }
}

function getProjectSettings(db, projectId) {
  if (!projectExists(db, projectId)) return null;
  const shared = getProjectSharedEnvironment(db, projectId);
  const bindings = readProjectBindingsRaw(db, projectId);
  const drive = getProjectDrive(db, projectId) || defaultDrive(projectId);
  const settings = bindings.settings && typeof bindings.settings === "object" ? bindings.settings : {};
  const githubRepository = shared?.github?.repository || normalizeText(settings.github_repository);
  const figmaFile = shared?.figma?.file || normalizeText(settings.figma_file);
  const driveUrl = shared?.drive?.url || normalizeText(drive.folder_url);
  return {
    project_id: projectId,
    github_repository: githubRepository,
    figma_file: figmaFile,
    drive_url: driveUrl,
  };
}

function putProjectDrive(db, projectId, body) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (body.folder_id !== undefined && typeof body.folder_id !== "string")
    throw validationError("folder_id must be string");
  if (body.folder_url !== undefined && typeof body.folder_url !== "string")
    throw validationError("folder_url must be string");
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    throw validationError("enabled must be boolean");

  const current = getProjectDrive(db, projectId) || defaultDrive(projectId);
  const data = {
    folder_id: typeof body.folder_id === "string" ? body.folder_id : current.folder_id,
    folder_url: typeof body.folder_url === "string" ? body.folder_url : current.folder_url,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE projects SET project_drive_json=?, updated_at=? WHERE tenant_id=? AND id=?"
  ).run(JSON.stringify(data), now, DEFAULT_TENANT, projectId);
  return { project_id: projectId, ...data };
}

function putProjectSettings(db, projectId, body = {}) {
  if (!projectExists(db, projectId)) {
    const err = new Error("Project not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    err.failure_code = "not_found";
    throw err;
  }
  if (body.github_repository !== undefined && typeof body.github_repository !== "string") {
    throw validationError("github_repository must be string");
  }
  if (body.figma_file !== undefined && typeof body.figma_file !== "string") {
    throw validationError("figma_file must be string");
  }
  if (body.drive_url !== undefined && typeof body.drive_url !== "string") {
    throw validationError("drive_url must be string");
  }
  const repoErr = validateGithubRepository(body.github_repository);
  const figmaErr = validateFigmaFile(body.figma_file);
  const driveErr = validateDriveUrl(body.drive_url);
  if (repoErr || figmaErr || driveErr) {
    throw validationError(repoErr || figmaErr || driveErr);
  }

  const currentSettings = getProjectSettings(db, projectId) || {
    project_id: projectId,
    github_repository: "",
    figma_file: "",
    drive_url: "",
  };
  const nextSettings = {
    github_repository:
      body.github_repository !== undefined ? normalizeText(body.github_repository) : currentSettings.github_repository,
    figma_file: body.figma_file !== undefined ? normalizeText(body.figma_file) : currentSettings.figma_file,
    drive_url: body.drive_url !== undefined ? normalizeText(body.drive_url) : currentSettings.drive_url,
  };

  putProjectSharedEnvironment(db, projectId, {
    github_repository: nextSettings.github_repository,
    figma_file: nextSettings.figma_file,
    drive_url: nextSettings.drive_url,
  });

  const now = new Date().toISOString();
  const bindings = readProjectBindingsRaw(db, projectId);
  const mergedBindings = {
    ...bindings,
    settings: {
      ...(bindings.settings && typeof bindings.settings === "object" ? bindings.settings : {}),
      github_repository: nextSettings.github_repository,
      figma_file: nextSettings.figma_file,
    },
  };
  db.prepare("UPDATE projects SET project_bindings_json=?, updated_at=? WHERE tenant_id=? AND id=?").run(
    JSON.stringify(mergedBindings),
    now,
    DEFAULT_TENANT,
    projectId
  );

  const drivePayload = {
    folder_url: nextSettings.drive_url,
  };
  putProjectDrive(db, projectId, drivePayload);
  return getProjectSettings(db, projectId);
}

module.exports = {
  getProjectConnections,
  putProjectConnections,
  getProjectDrive,
  putProjectDrive,
  getProjectSettings,
  putProjectSettings,
};
