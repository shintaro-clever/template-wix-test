const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { validateRunInputs } = require("../validation/runInputs");
const { sendJson, jsonError, readJsonBody } = require("../api/projects");

const runJobScript = path.join(__dirname, "..", "..", "scripts", "run-job.js");

function nowIso() {
  return new Date().toISOString();
}

function writeTempJobFile(jobPayload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-run-"));
  const jobPath = path.join(tempDir, "job.json");
  fs.writeFileSync(jobPath, JSON.stringify(jobPayload, null, 2));
  return { jobPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function createRun(db, projectId, inputsJson) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    "INSERT INTO runs(tenant_id,id,project_id,status,inputs_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run(DEFAULT_TENANT, runId, projectId, "queued", JSON.stringify(inputsJson), ts, ts);
  return runId;
}

function updateRunStatus(db, runId, status) {
  db.prepare("UPDATE runs SET status=?, updated_at=? WHERE tenant_id=? AND id=?").run(
    status,
    nowIso(),
    DEFAULT_TENANT,
    runId
  );
}

function buildProjectJob(projectId, inputs) {
  const payload = typeof inputs === "object" && inputs !== null ? inputs : {};
  const rawTarget = typeof payload.target_path === "string" ? payload.target_path.trim() : "";
  const targetPath =
    rawTarget && rawTarget.startsWith(".ai-runs/")
      ? rawTarget
      : ".ai-runs/{{run_id}}/project_run.json";
  const message =
    typeof payload.message === "string" && payload.message.trim().length > 0
      ? payload.message.trim()
      : "project run";
  const jobInputs = {
    message,
    target_path: targetPath,
    project_id: projectId,
  };
  if (payload.connection_id) {
    jobInputs.connection_id = payload.connection_id;
  }
  return {
    job_type: "integration_hub.phase2.project_run",
    goal: "Project run",
    inputs: jobInputs,
    constraints: {
      allowed_paths: [".ai-runs/"],
      max_files_changed: 1,
      no_destructive_ops: true,
    },
    acceptance_criteria: ["run.json and audit.jsonl are written under .ai-runs/<run_id>/"],
    provenance: {
      issue: "",
      operator: "operator",
    },
    run_mode: "mcp",
    output_language: "ja",
    expected_artifacts: [
      {
        name: path.basename(targetPath),
        description: "project run artifact",
      },
    ],
  };
}

function runJobAsync(jobPayload, onStart) {
  const { jobPath, cleanup } = writeTempJobFile(jobPayload);
  const child = spawn(process.execPath, [runJobScript, "--job", jobPath, "--role", "operator"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
  if (typeof onStart === "function") {
    onStart();
  }
  child.on("error", () => cleanup());
  child.on("close", () => cleanup());
}

async function handleProjectRunsPost(req, res, db, projectId) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
  }

  const inputs = body && typeof body === "object" ? body.inputs : null;
  const validation = validateRunInputs(DEFAULT_TENANT, {
    ...(inputs || {}),
    project_id: projectId,
  });
  if (!validation.valid) {
    const status = validation.status || 400;
    return jsonError(res, status, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: validation.failure_code,
      error: validation.error,
    });
  }

  const inputsJson = validation.normalized;
  const runId = createRun(db, projectId, inputsJson);
  const jobPayload = buildProjectJob(projectId, inputsJson);

  runJobAsync(jobPayload, () => {
    updateRunStatus(db, runId, "running");
  });

  return sendJson(res, 202, { runId, status: "queued" });
}

module.exports = {
  handleProjectRunsPost,
};
