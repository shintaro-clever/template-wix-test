// src/audit/actions.js
// frozen audit action identifiers (SoT for audit action strings)
module.exports = Object.freeze({
  // Generic
  UNKNOWN: "unknown",

  // Projects
  PROJECT_CREATE: "project_create",
  PROJECT_UPDATE: "project_update",
  PROJECT_DELETE: "project_delete",

  // Runs
  RUN_CREATE: "run_create",
  RUN_UPDATE: "run_update",
  RUN_DELETE: "run_delete",

  // Auth
  AUTH_LOGIN: "auth_login",
  AUTH_LOGOUT: "auth_logout",

  // Artifacts
  ARTIFACT_CREATE: "artifact_create",
  ARTIFACT_DELETE: "artifact_delete",
});
