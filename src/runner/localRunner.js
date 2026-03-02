const fs = require("fs");
const path = require("path");
const { validateTargetPath } = require("../validation/targetPath");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const RUNS_DIR = path.join(ROOT_DIR, ".ai-runs");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveRunTargetPath(runId, rawTargetPath) {
  const fallback = `.ai-runs/${runId}/run_result.json`;
  const templated = String(rawTargetPath || fallback).replace(/\{\{run_id\}\}/g, runId);
  const validation = validateTargetPath(templated);
  if (!validation.valid || !validation.normalized || !String(validation.normalized).startsWith(".ai-runs/")) {
    return { ok: false, failure_code: "validation_error" };
  }
  return { ok: true, relative: validation.normalized };
}

function writeJson(relativePath, payload) {
  const absolute = path.join(ROOT_DIR, relativePath);
  ensureDir(path.dirname(absolute));
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2), "utf8");
}

function writeText(relativePath, body) {
  const absolute = path.join(ROOT_DIR, relativePath);
  ensureDir(path.dirname(absolute));
  fs.writeFileSync(absolute, String(body || ""), "utf8");
}

function executeLocalRun({ runId, jobType, runMode, inputs, targetPath }) {
  const safeRunId = String(runId || "").trim();
  if (!safeRunId) {
    return { status: "failed", failure_code: "validation_error", artifacts: [] };
  }
  const runDir = path.join(RUNS_DIR, safeRunId);
  ensureDir(runDir);

  const target = resolveRunTargetPath(safeRunId, targetPath);
  if (!target.ok) {
    return { status: "failed", failure_code: target.failure_code, artifacts: [] };
  }

  const startedAt = new Date().toISOString();
  const logPath = `.ai-runs/${safeRunId}/runner.log`;
  const summaryPath = `.ai-runs/${safeRunId}/run.summary.json`;
  writeText(logPath, `[local-runner] start run_id=${safeRunId} job_type=${jobType || "-"} run_mode=${runMode || "mcp"}\n`);
  writeJson(target.relative, {
    run_id: safeRunId,
    status: "completed",
    job_type: jobType || null,
    run_mode: runMode || "mcp",
    inputs: inputs || {},
    finished_at: new Date().toISOString(),
  });
  writeJson(summaryPath, {
    run_id: safeRunId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    artifacts: [target.relative, logPath],
  });

  return {
    status: "completed",
    failure_code: null,
    artifacts: [target.relative, logPath, summaryPath],
  };
}

module.exports = {
  executeLocalRun,
  resolveRunTargetPath,
};
