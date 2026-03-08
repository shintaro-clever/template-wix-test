const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");
const { KINDS, buildPublicId, parsePublicIdFor, isUuid } = require("../id/publicIds");

const API_RUNS_PROJECT_ID = "api:runs";
const RUN_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
});

function nowIso() {
  return new Date().toISOString();
}

function toPublicRunId(internalId) {
  return isUuid(internalId) ? buildPublicId(KINDS.run, internalId) : internalId;
}

function toPublicProjectId(projectId) {
  return isUuid(projectId) ? buildPublicId(KINDS.project, projectId) : projectId;
}

function toPublicThreadId(threadId) {
  return isUuid(threadId) ? buildPublicId(KINDS.thread, threadId) : threadId;
}

function toPublicAiSettingId(aiSettingId) {
  return isUuid(aiSettingId) ? buildPublicId(KINDS.ai_setting, aiSettingId) : aiSettingId;
}

function parseTrackingId(kind, input, { nullable = true } = {}) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) {
    return nullable ? { ok: true, internalId: null } : { ok: false, message: `${kind}_id is required` };
  }
  if (isUuid(text)) {
    return { ok: true, internalId: text };
  }
  const parsed = parsePublicIdFor(kind, text);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message || `${kind}_id format is invalid`, details: parsed.details || { failure_code: "validation_error" } };
  }
  return { ok: true, internalId: parsed.internalId };
}

function parseRunIdInput(runId) {
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "run_id is required",
      details: { failure_code: "validation_error" },
    };
  }
  if (isUuid(id)) {
    return { ok: true, internalId: id, publicId: toPublicRunId(id), mode: "legacy_uuid" };
  }
  const parsed = parsePublicIdFor(KINDS.run, id);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: parsed.message || "run_id format is invalid",
      details: parsed.details || { failure_code: "validation_error" },
    };
  }
  return { ok: true, internalId: parsed.internalId, publicId: parsed.publicId, mode: "public_id" };
}

function parseInputs(inputsJson) {
  if (typeof inputsJson !== "string" || inputsJson.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(inputsJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeSharedEnvironment(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const githubRepository = typeof source.github_repository === "string" ? source.github_repository.trim() : "";
  const figmaFile = typeof source.figma_file === "string" ? source.figma_file.trim() : "";
  const driveUrl = typeof source.drive_url === "string" ? source.drive_url.trim() : "";
  return {
    github_repository: githubRepository,
    figma_file: figmaFile,
    drive_url: driveUrl,
  };
}

function extractRunContextUsed(inputs) {
  const payload = inputs && typeof inputs === "object" ? inputs : {};
  const legacyContext = payload.context_used && typeof payload.context_used === "object" ? payload.context_used : {};
  const shared = legacyContext.shared_environment || payload.shared_environment;
  return {
    shared_environment: normalizeSharedEnvironment(shared),
  };
}

function normalizeRunStatus(status) {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (raw === "completed") return RUN_STATUS.succeeded;
  if (raw === RUN_STATUS.queued || raw === RUN_STATUS.running || raw === RUN_STATUS.succeeded || raw === RUN_STATUS.failed) {
    return raw;
  }
  return RUN_STATUS.failed;
}

function normalizeFailureCode(status, failureCode) {
  if (status !== RUN_STATUS.failed) return null;
  const text = typeof failureCode === "string" ? failureCode.trim() : "";
  return text || "unknown_failure";
}

function resolveArtifacts(runId, targetPath) {
  const artifacts = [];
  if (targetPath && typeof targetPath === "string") {
    const normalizedTarget = targetPath.replace(/\{\{run_id\}\}/g, runId);
    const absolute = path.join(process.cwd(), normalizedTarget);
    if (fs.existsSync(absolute)) {
      artifacts.push(normalizedTarget);
    }
  }
  const logPath = `.ai-runs/${runId}/runner.log`;
  if (fs.existsSync(path.join(process.cwd(), logPath))) {
    artifacts.push(logPath);
  }
  return artifacts;
}

function listRuns(db) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
      .map((row) => {
        const parsedInputs = parseInputs(row.inputs_json);
        return {
          status: normalizeRunStatus(row.status),
          run_id: toPublicRunId(row.id),
          project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
          thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
          ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
          failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
          job_type: row.job_type || null,
          run_mode: row.run_mode || null,
          inputs: parsedInputs,
          context_used: extractRunContextUsed(parsedInputs),
          target_path: row.target_path || null,
          artifacts: resolveArtifacts(row.id, row.target_path || null),
          figma_file_key: row.figma_file_key || null,
          ingest_artifact_path: row.ingest_artifact_path || null,
          github_pr_url: row.github_pr_url || null,
          github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      })
  );
}

function listRunsByProject(db, projectId) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND project_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT, projectId)
      .map((row) => {
        const parsedInputs = parseInputs(row.inputs_json);
        return {
          status: normalizeRunStatus(row.status),
          run_id: toPublicRunId(row.id),
          project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
          thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
          ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
          failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
          job_type: row.job_type || null,
          run_mode: row.run_mode || null,
          inputs: parsedInputs,
          context_used: extractRunContextUsed(parsedInputs),
          target_path: row.target_path || null,
          artifacts: resolveArtifacts(row.id, row.target_path || null),
          figma_file_key: row.figma_file_key || null,
          ingest_artifact_path: row.ingest_artifact_path || null,
          github_pr_url: row.github_pr_url || null,
          github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      })
  );
}

function createRun(
  db,
  { job_type, run_mode, inputs, target_path, project_id = null, thread_id = null, ai_setting_id = null, figma_file_key = null, ingest_artifact_path = null }
) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  const inputPayload = inputs && typeof inputs === "object" ? inputs : {};
  const projectIdInput = project_id || inputPayload.project_id || null;
  const threadIdInput = thread_id || inputPayload.thread_id || null;
  const aiSettingIdInput = ai_setting_id || inputPayload.ai_setting_id || null;

  const projectResolved = isUuid(projectIdInput)
    ? { ok: true, internalId: projectIdInput }
    : parseTrackingId(KINDS.project, projectIdInput || "", { nullable: true });
  if (!projectResolved.ok) {
    throw new Error(projectResolved.message || "project_id format is invalid");
  }
  const threadResolved = parseTrackingId(KINDS.thread, threadIdInput, { nullable: true });
  if (!threadResolved.ok) {
    throw new Error(threadResolved.message || "thread_id format is invalid");
  }
  const aiResolved = parseTrackingId(KINDS.ai_setting, aiSettingIdInput, { nullable: true });
  if (!aiResolved.ok) {
    throw new Error(aiResolved.message || "ai_setting_id format is invalid");
  }

  const normalizedProjectId = projectResolved.internalId || API_RUNS_PROJECT_ID;
  const normalizedThreadId = threadResolved.internalId || null;
  const normalizedAiSettingId = aiResolved.internalId || null;
  const normalizedInputs = { ...inputPayload };
  if (normalizedProjectId && normalizedProjectId !== API_RUNS_PROJECT_ID) {
    normalizedInputs.project_id = toPublicProjectId(normalizedProjectId);
  }
  if (normalizedThreadId) {
    normalizedInputs.thread_id = toPublicThreadId(normalizedThreadId);
  }
  if (normalizedAiSettingId) {
    normalizedInputs.ai_setting_id = toPublicAiSettingId(normalizedAiSettingId);
  }
  const sharedEnvironment = normalizeSharedEnvironment(normalizedInputs.shared_environment);
  normalizedInputs.shared_environment = sharedEnvironment;
  normalizedInputs.context_used = {
    ...(normalizedInputs.context_used && typeof normalizedInputs.context_used === "object" ? normalizedInputs.context_used : {}),
    shared_environment: sharedEnvironment,
  };
  const inputsJson = JSON.stringify(normalizedInputs);
  withRetry(() =>
    db
      .prepare(
        "INSERT INTO runs(tenant_id,id,project_id,thread_id,ai_setting_id,status,inputs_json,job_type,run_mode,target_path,figma_file_key,ingest_artifact_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        DEFAULT_TENANT,
        runId,
        normalizedProjectId,
        normalizedThreadId,
        normalizedAiSettingId,
        "queued",
        inputsJson,
        job_type,
        run_mode || "mcp",
        target_path,
        figma_file_key,
        ingest_artifact_path,
        ts,
        ts
      )
  );
  return runId;
}

function getRun(db, runId) {
  const row = withRetry(() =>
    db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) {
    return null;
  }
  const parsedInputs = parseInputs(row.inputs_json);
  return {
    status: normalizeRunStatus(row.status),
    run_id: toPublicRunId(row.id),
    project_id: row.project_id ? toPublicProjectId(row.project_id) : null,
    thread_id: row.thread_id ? toPublicThreadId(row.thread_id) : null,
    ai_setting_id: row.ai_setting_id ? toPublicAiSettingId(row.ai_setting_id) : null,
    failure_code: normalizeFailureCode(normalizeRunStatus(row.status), row.failure_code),
    job_type: row.job_type || null,
    run_mode: row.run_mode || null,
    inputs: parsedInputs,
    context_used: extractRunContextUsed(parsedInputs),
    target_path: row.target_path || null,
    artifacts: resolveArtifacts(row.id, row.target_path || null),
    figma_file_key: row.figma_file_key || null,
    ingest_artifact_path: row.ingest_artifact_path || null,
    github_pr_url: row.github_pr_url || null,
    github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function claimNextQueuedRun(db) {
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        "SELECT id,project_id,thread_id,ai_setting_id,job_type,run_mode,inputs_json,target_path,figma_file_key,ingest_artifact_path,created_at,updated_at FROM runs WHERE tenant_id=? AND status='queued' ORDER BY created_at ASC LIMIT 1"
      )
      .get(DEFAULT_TENANT);
    if (!row || !row.id) {
      return null;
    }
    const ts = nowIso();
    const changed = db
      .prepare(
        "UPDATE runs SET status='running', failure_code=NULL, updated_at=? WHERE tenant_id=? AND id=? AND status='queued'"
      )
      .run(ts, DEFAULT_TENANT, row.id).changes;
    if (changed < 1) {
      return null;
    }
    return {
      ...row,
      status: "running",
      updated_at: ts,
      failure_code: null,
    };
  });
  return withRetry(() => tx());
}

function markRunRunning(db, runId) {
  const ts = nowIso();
  const changes = withRetry(() =>
    db
      .prepare("UPDATE runs SET status='running', failure_code=NULL, updated_at=? WHERE tenant_id=? AND id=? AND status='queued'")
      .run(ts, DEFAULT_TENANT, runId).changes
  );
  return changes > 0;
}

function markRunFinished(db, runId, { status, failureCode = null }) {
  const normalizedStatus = normalizeRunStatus(status);
  if (normalizedStatus === RUN_STATUS.failed && (!failureCode || !String(failureCode).trim())) {
    throw new Error("failureCode is required when status=failed");
  }
  const normalizedFailure = normalizedStatus === RUN_STATUS.failed ? String(failureCode).trim() : null;
  const ts = nowIso();
  withRetry(() =>
    db
      .prepare("UPDATE runs SET status=?, failure_code=?, updated_at=? WHERE tenant_id=? AND id=? AND status='running'")
      .run(normalizedStatus, normalizedFailure, ts, DEFAULT_TENANT, runId)
  );
}

module.exports = {
  listRuns,
  listRunsByProject,
  getRun,
  createRun,
  toPublicRunId,
  parseRunIdInput,
  claimNextQueuedRun,
  markRunRunning,
  markRunFinished,
};
