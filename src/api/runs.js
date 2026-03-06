const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { withRetry } = require("../db/retry");

const API_RUNS_PROJECT_ID = "api:runs";

function nowIso() {
  return new Date().toISOString();
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
        "SELECT id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT)
      .map((row) => ({
        run_id: row.id,
        status: row.status,
        job_type: row.job_type || null,
        run_mode: row.run_mode || null,
        inputs: parseInputs(row.inputs_json),
        target_path: row.target_path || null,
        artifacts: resolveArtifacts(row.id, row.target_path || null),
        failure_code: row.failure_code || null,
        figma_file_key: row.figma_file_key || null,
        ingest_artifact_path: row.ingest_artifact_path || null,
        github_pr_url: row.github_pr_url || null,
        github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
  );
}

function listRunsByProject(db, projectId) {
  return withRetry(() =>
    db
      .prepare(
        "SELECT id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND project_id=? ORDER BY created_at DESC"
      )
      .all(DEFAULT_TENANT, projectId)
      .map((row) => ({
        run_id: row.id,
        status: row.status,
        job_type: row.job_type || null,
        run_mode: row.run_mode || null,
        inputs: parseInputs(row.inputs_json),
        target_path: row.target_path || null,
        artifacts: resolveArtifacts(row.id, row.target_path || null),
        failure_code: row.failure_code || null,
        figma_file_key: row.figma_file_key || null,
        ingest_artifact_path: row.ingest_artifact_path || null,
        github_pr_url: row.github_pr_url || null,
        github_pr_number: typeof row.github_pr_number === "number" ? row.github_pr_number : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
  );
}

function createRun(
  db,
  { job_type, run_mode, inputs, target_path, project_id = null, figma_file_key = null, ingest_artifact_path = null }
) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  const inputsJson = JSON.stringify(inputs || {});
  withRetry(() =>
    db
      .prepare(
        "INSERT INTO runs(tenant_id,id,project_id,status,inputs_json,job_type,run_mode,target_path,figma_file_key,ingest_artifact_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        DEFAULT_TENANT,
        runId,
        project_id || API_RUNS_PROJECT_ID,
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
        "SELECT id,status,job_type,run_mode,inputs_json,target_path,failure_code,figma_file_key,ingest_artifact_path,github_pr_url,github_pr_number,created_at,updated_at FROM runs WHERE tenant_id=? AND id=?"
      )
      .get(DEFAULT_TENANT, runId)
  );
  if (!row) {
    return null;
  }
  return {
    run_id: row.id,
    status: row.status,
    job_type: row.job_type || null,
    run_mode: row.run_mode || null,
    inputs: parseInputs(row.inputs_json),
    target_path: row.target_path || null,
    artifacts: resolveArtifacts(row.id, row.target_path || null),
    failure_code: row.failure_code || null,
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
        "SELECT id,job_type,run_mode,inputs_json,target_path,figma_file_key,ingest_artifact_path,created_at,updated_at FROM runs WHERE tenant_id=? AND status='queued' ORDER BY created_at ASC LIMIT 1"
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

function markRunFinished(db, runId, { status, failureCode = null }) {
  if (status === "failed" && (!failureCode || !String(failureCode).trim())) {
    throw new Error("failureCode is required when status=failed");
  }
  const normalizedFailure = status === "failed" ? String(failureCode).trim() : null;
  const ts = nowIso();
  withRetry(() =>
    db
      .prepare("UPDATE runs SET status=?, failure_code=?, updated_at=? WHERE tenant_id=? AND id=? AND status='running'")
      .run(status, normalizedFailure, ts, DEFAULT_TENANT, runId)
  );
}

module.exports = {
  listRuns,
  listRunsByProject,
  getRun,
  createRun,
  claimNextQueuedRun,
  markRunFinished,
};
