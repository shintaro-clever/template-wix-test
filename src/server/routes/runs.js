const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { listRuns, createRun, toPublicRunId } = require("../../api/runs");
const { validateRunInputs } = require("../../validation/runInputs");
const { DEFAULT_TENANT } = require("../../db/sqlite");
const { loadProjectSharedContext } = require("../projectSharedContext");

async function handleRunsCollection(req, res, db, { onRunQueued } = {}) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET") {
    return sendJson(res, 200, listRuns(db));
  }
  if (method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
  }
  const jobType = typeof body.job_type === "string" ? body.job_type.trim() : "";
  const targetPath = typeof body.target_path === "string" ? body.target_path.trim() : "";
  if (!jobType || !targetPath) {
    return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です");
  }
  const inputs = body && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {};
  const requestedProjectId =
    typeof body.project_id === "string" && body.project_id.trim()
      ? body.project_id.trim()
      : typeof inputs.project_id === "string" && inputs.project_id.trim()
        ? inputs.project_id.trim()
        : null;
  const validation = validateRunInputs(DEFAULT_TENANT, {
    ...inputs,
    project_id: requestedProjectId,
    target_path: targetPath,
    export_provider: body.export_provider,
    google_native_type: body.google_native_type,
    thread_title: body.thread_title,
  });
  if (!validation.valid) {
    return jsonError(res, validation.status || 400, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: validation.failure_code || "validation_error",
      error: validation.error || "INVALID_INPUT",
      ...(validation.details || {}),
    });
  }

  const runMode = typeof body.run_mode === "string" && body.run_mode.trim() ? body.run_mode.trim() : "mcp";
  const figmaFileKey =
    typeof body.figma_file_key === "string" && body.figma_file_key.trim()
      ? body.figma_file_key.trim()
      : typeof inputs.figma_file_key === "string" && inputs.figma_file_key.trim()
        ? inputs.figma_file_key.trim()
        : null;
  const ingestArtifactPath =
    typeof body.ingest_artifact_path === "string" && body.ingest_artifact_path.trim()
      ? body.ingest_artifact_path.trim()
      : typeof inputs.ingest_artifact_path === "string" && inputs.ingest_artifact_path.trim()
        ? inputs.ingest_artifact_path.trim()
        : null;
  const sharedContext = loadProjectSharedContext(db, validation.normalized.project_id || requestedProjectId);
  if (!sharedContext.ok) {
    return jsonError(
      res,
      sharedContext.status || 400,
      sharedContext.code || "VALIDATION_ERROR",
      sharedContext.message || "入力が不正です",
      sharedContext.details || { failure_code: "validation_error" }
    );
  }
  const runId = createRun(db, {
    job_type: jobType,
    run_mode: runMode,
    inputs: {
      ...inputs,
      ...validation.normalized,
      ...(sharedContext.publicProjectId ? { project_id: sharedContext.publicProjectId } : {}),
      shared_environment: sharedContext.shared_environment,
    },
    project_id: sharedContext.internalProjectId || validation.normalized.project_id || null,
    thread_id:
      typeof body.thread_id === "string" && body.thread_id.trim()
        ? body.thread_id.trim()
        : typeof inputs.thread_id === "string" && inputs.thread_id.trim()
          ? inputs.thread_id.trim()
          : null,
    ai_setting_id:
      typeof body.ai_setting_id === "string" && body.ai_setting_id.trim()
        ? body.ai_setting_id.trim()
        : typeof inputs.ai_setting_id === "string" && inputs.ai_setting_id.trim()
          ? inputs.ai_setting_id.trim()
          : null,
    target_path: targetPath,
    figma_file_key: figmaFileKey,
    ingest_artifact_path: ingestArtifactPath,
  });
  if (typeof onRunQueued === "function") {
    onRunQueued(runId);
  }
  return sendJson(res, 201, { run_id: toPublicRunId(runId), status: "queued" });
}

module.exports = {
  handleRunsCollection,
};
