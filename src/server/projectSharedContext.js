const { getProject, parseProjectSharedEnvironmentJson } = require("../api/projects");
const { parseProjectIdInput } = require("./projectsStore");

function defaultSharedEnvironment() {
  return {
    github_repository: "",
    figma_file: "",
    drive_url: "",
  };
}

function toFlatSharedEnvironment(sharedEnvironment) {
  if (!sharedEnvironment || typeof sharedEnvironment !== "object") {
    return defaultSharedEnvironment();
  }
  const githubRepository =
    typeof sharedEnvironment.github?.repository === "string" ? sharedEnvironment.github.repository.trim() : "";
  const figmaFile = typeof sharedEnvironment.figma?.file === "string" ? sharedEnvironment.figma.file.trim() : "";
  const driveUrl = typeof sharedEnvironment.drive?.url === "string" ? sharedEnvironment.drive.url.trim() : "";
  return {
    github_repository: githubRepository,
    figma_file: figmaFile,
    drive_url: driveUrl,
  };
}

function loadProjectSharedContext(db, projectIdInput) {
  const text = typeof projectIdInput === "string" ? projectIdInput.trim() : "";
  if (!text) {
    return {
      ok: true,
      internalProjectId: null,
      publicProjectId: null,
      shared_environment: defaultSharedEnvironment(),
    };
  }
  const parsed = parseProjectIdInput(text);
  if (!parsed.ok) {
    return parsed;
  }
  const project = getProject(db, parsed.internalId);
  if (!project) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "project not found",
      details: { failure_code: "not_found" },
    };
  }
  return {
    ok: true,
    internalProjectId: parsed.internalId,
    publicProjectId: parsed.publicId,
    shared_environment: toFlatSharedEnvironment(parseProjectSharedEnvironmentJson(project.project_shared_env_json)),
  };
}

module.exports = {
  defaultSharedEnvironment,
  toFlatSharedEnvironment,
  loadProjectSharedContext,
};
