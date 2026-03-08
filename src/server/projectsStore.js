const { listProjects: listProjectsRaw, getProject: getProjectRaw } = require("../api/projects");
const { parseProjectSharedEnvironmentJson } = require("../api/projects");
const { KINDS, buildPublicId, parsePublicIdFor, isUuid } = require("../id/publicIds");

function toProjectView(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const internalProjectId = typeof row.id === "string" && row.id ? row.id : String(row.project_id || "");
  const projectId = internalProjectId ? buildPublicId(KINDS.project, internalProjectId) : "";
  const status = typeof row.status === "string" && row.status ? row.status : "active";
  const owner = typeof row.owner === "string" && row.owner ? row.owner : null;
  const updatedAt = typeof row.updated_at === "string" && row.updated_at ? row.updated_at : null;
  const createdAt = typeof row.created_at === "string" && row.created_at ? row.created_at : null;
  const description = typeof row.description === "string" ? row.description : "";
  const stagingUrl = typeof row.staging_url === "string" ? row.staging_url : "";
  const driveFolderId = typeof row.drive_folder_id === "string" && row.drive_folder_id ? row.drive_folder_id : null;
  const sharedEnvironment = parseProjectSharedEnvironmentJson(row.project_shared_env_json);

  return {
    project_id: projectId,
    id: projectId,
    name: typeof row.name === "string" ? row.name : "",
    status,
    updated_at: updatedAt,
    owner,
    description,
    staging_url: stagingUrl,
    drive_folder_id: driveFolderId,
    created_at: createdAt,
    shared_environment: sharedEnvironment,
    meta: {
      description,
      staging_url: stagingUrl,
      drive_folder_id: driveFolderId,
      shared_environment: sharedEnvironment,
    },
  };
}

function parseProjectIdInput(projectId) {
  const text = typeof projectId === "string" ? projectId.trim() : "";
  if (!text) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "project_id is required", details: { failure_code: "validation_error" } };
  }
  if (isUuid(text)) {
    return { ok: true, internalId: text, publicId: buildPublicId(KINDS.project, text), mode: "legacy_uuid" };
  }
  const parsed = parsePublicIdFor(KINDS.project, text);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: parsed.message,
      details: parsed.details || { failure_code: "validation_error" },
    };
  }
  return { ok: true, internalId: parsed.internalId, publicId: parsed.publicId, mode: "public_id" };
}

function loadProjects(db) {
  const rows = listProjectsRaw(db);
  return Array.isArray(rows) ? rows : [];
}

function listProjects(db) {
  return {
    projects: loadProjects(db).map((row) => toProjectView(row)).filter(Boolean),
  };
}

function getProjectById(db, projectId) {
  const parsed = parseProjectIdInput(projectId);
  if (!parsed.ok) {
    return parsed;
  }
  const item = toProjectView(getProjectRaw(db, parsed.internalId));
  return item ? { ok: true, item, internalId: parsed.internalId, publicId: parsed.publicId } : { ok: true, item: null, internalId: parsed.internalId, publicId: parsed.publicId };
}

module.exports = {
  toProjectView,
  parseProjectIdInput,
  loadProjects,
  listProjects,
  getProjectById,
};
