const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { validateRunInputs } = require("../validation/runInputs");
const { validateCapability } = require("../validation/capabilityCheck");
const { validatePreflightLocal, deepVerify } = require("../runner/preflight");
const { recordRunEvent } = require("../db/runEvents");
const { withRetry } = require("../db/retry");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");
const { emitAuditEvent } = require("../audit/events");
const { sendJson, jsonError, readJsonBody } = require("../api/projects");

const runJobScript = path.join(__dirname, "..", "..", "scripts", "run-job.js");
const PROJECT_RUN_JOB_TYPE = "integration_hub.phase2.project_run";

function nowIso() {
  return new Date().toISOString();
}

function writeTempJobFile(jobPayload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-run-"));
  const jobPath = path.join(tempDir, "job.json");
  fs.writeFileSync(jobPath, JSON.stringify(jobPayload, null, 2));
  return { jobPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function resolveProjectRunTargetPath(inputsJson, runId) {
  const rawTarget = typeof inputsJson?.target_path === "string" ? inputsJson.target_path.trim() : "";
  if (rawTarget && rawTarget.startsWith(".ai-runs/")) {
    return rawTarget;
  }
  const template = ".ai-runs/{{run_id}}/project_run.json";
  if (!runId) {
    return template;
  }
  return template.replace("{{run_id}}", runId);
}

function createRun(db, projectId, inputsJson) {
  const runId = crypto.randomUUID();
  const ts = nowIso();
  const inputsToStore = {
    ...(inputsJson || {}),
  };
  if (projectId && !inputsToStore.project_id) {
    inputsToStore.project_id = projectId;
  }
  const targetPath = resolveProjectRunTargetPath(inputsToStore, runId);
  withRetry(() =>
    db.prepare(
      "INSERT INTO runs(tenant_id,id,project_id,status,inputs_json,job_type,target_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(
      DEFAULT_TENANT,
      runId,
      projectId,
      "queued",
      JSON.stringify(inputsToStore),
      PROJECT_RUN_JOB_TYPE,
      targetPath,
      ts,
      ts
    )
  );
  return runId;
}

function updateRunStatus(db, runId, status) {
  withRetry(() =>
    db.prepare("UPDATE runs SET status=?, updated_at=? WHERE tenant_id=? AND id=?").run(
      status,
      nowIso(),
      DEFAULT_TENANT,
      runId
    )
  );
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getJobTemplate(db, name) {
  if (!name) {
    return null;
  }
  const row = withRetry(() =>
    db
      .prepare(
        `SELECT name, direction, required_mode, required_capabilities, required_inputs, description
       FROM job_templates WHERE name = ?`
      )
      .get(name)
  );
  if (!row) {
    return null;
  }
  return {
    name: row.name,
    direction: row.direction,
    required_mode: row.required_mode,
    required_capabilities: parseJsonArray(row.required_capabilities, []),
    required_inputs: parseJsonArray(row.required_inputs, []),
    description: row.description,
  };
}

function extractTemplateName(body = {}, inputs = {}) {
  const candidates = [
    body.template,
    body.template_name,
    body.job_template,
    body.jobTemplate,
    inputs.template,
    inputs.template_name,
    inputs.job_template,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function extractConnection(body = {}, inputs = {}) {
  if (body.connection && typeof body.connection === "object") {
    return body.connection;
  }
  if (inputs.connection && typeof inputs.connection === "object") {
    return inputs.connection;
  }
  return null;
}

function hasConcurrentRun(db, projectId) {
  if (!projectId) {
    return false;
  }
  const row = withRetry(() =>
    db
      .prepare(
        `SELECT 1 FROM runs WHERE tenant_id = ? AND project_id = ? AND status = 'running' LIMIT 1`
      )
      .get(DEFAULT_TENANT, projectId)
  );
  return Boolean(row);
}

function recordPreflightFailure(runId) {
  try {
    recordRunEvent({ runId, eventType: "run_preflight_failed" });
  } catch (error) {
    console.warn("Failed to record run_preflight_failed:", error.message);
  }
}

function buildProjectJob(projectId, inputs) {
  const payload = typeof inputs === "object" && inputs !== null ? inputs : {};
  const hasPageUrl = typeof payload.page_url === "string" && payload.page_url.trim().length > 0;
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
  if (hasPageUrl) {
    jobInputs.page_url = payload.page_url.trim();
    if (Array.isArray(payload.pages)) {
      jobInputs.pages = payload.pages
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim());
    }
    if (typeof payload.figma_design_url === "string" && payload.figma_design_url.trim()) {
      jobInputs.figma_design_url = payload.figma_design_url.trim();
    }
    if (typeof payload.figma_file_key === "string" && payload.figma_file_key.trim()) {
      jobInputs.figma_file_key = payload.figma_file_key.trim();
    }
    return {
      job_type: "integration_hub.phase1.code_to_figma_from_url",
      goal: "Code to Figma (single page from URL)",
      inputs: {
        ...jobInputs,
        target_path:
          rawTarget && rawTarget.startsWith(".ai-runs/")
            ? rawTarget
            : ".ai-runs/{{run_id}}/code_to_figma_report.json",
      },
      constraints: {
        allowed_paths: [".ai-runs/"],
        max_files_changed: 1,
        no_destructive_ops: true,
      },
      acceptance_criteria: [
        "run.json and summary.md are written under .ai-runs/<run_id>/",
      ],
      provenance: {
        issue: "",
        operator: "operator",
      },
      run_mode: "mcp",
      output_language: "ja",
      expected_artifacts: [
        {
          name: "code_to_figma_report.json",
          description: "code to figma report",
        },
        {
          name: "summary.md",
          description: "code to figma summary",
        },
      ],
    };
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

function runJobAsync(jobPayload, { onStart, onDone } = {}) {
  const normalizedJob =
    jobPayload && typeof jobPayload === "object"
      ? { ...jobPayload, run_mode: jobPayload.run_mode || "mcp" }
      : { run_mode: "mcp" };
  const { jobPath, cleanup } = writeTempJobFile(normalizedJob);
  const child = spawn(process.execPath, [runJobScript, "--job", jobPath, "--role", "operator"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
  let settled = false;
  const finalize = (code, error) => {
    if (settled) {
      return;
    }
    settled = true;
    if (typeof onDone === "function") {
      onDone(code, error);
    }
    cleanup();
  };
  if (typeof onStart === "function") {
    onStart();
  }
  child.on("error", (error) => finalize(1, error));
  child.on("close", (code) => finalize(code, null));
}

async function handleProjectRunsPost(req, res, db, projectId) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
  }

  const inputs = body && typeof body === "object" ? body.inputs : null;
  const normalizedInputsPayload = {
    ...(inputs || {}),
  };
  const baseValidation = validateRunInputs(DEFAULT_TENANT, normalizedInputsPayload);
  if (!baseValidation.valid) {
    const status = baseValidation.status || 400;
    return jsonError(res, status, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: baseValidation.failure_code,
      error: baseValidation.error,
    });
  }

  const templateName = extractTemplateName(body || {}, inputs || {});
  if (!templateName) {
    return jsonError(res, 400, "VALIDATION_ERROR", "template is required", {
      failure_code: "validation_error",
      error: "TEMPLATE_REQUIRED",
    });
  }
  const jobTemplate = getJobTemplate(db, templateName);
  if (!jobTemplate) {
    return jsonError(res, 404, "VALIDATION_ERROR", "template not found", {
      failure_code: "not_found",
      error: "TEMPLATE_NOT_FOUND",
    });
  }

  const connection = extractConnection(body || {}, inputs || {});
  if (!connection) {
    return jsonError(res, 400, "VALIDATION_ERROR", "connection is required", {
      failure_code: "validation_error",
      error: "CONNECTION_REQUIRED",
    });
  }

  const capabilityResult = validateCapability(connection, jobTemplate);
  if (!capabilityResult.valid) {
    return jsonError(res, 400, "VALIDATION_ERROR", "capability check failed", {
      failure_code: capabilityResult.failure_code,
      error: capabilityResult.message || "CAPABILITY_CHECK_FAILED",
    });
  }

  const localPreflight = validatePreflightLocal(connection, jobTemplate, normalizedInputsPayload);
  if (!localPreflight.valid) {
    const runId = crypto.randomUUID();
    recordPreflightFailure(runId);
    return jsonError(res, 400, "VALIDATION_ERROR", "preflight failed", {
      failure_code: localPreflight.failure_code,
      error: localPreflight.message || "PREFLIGHT_FAILED",
      run_id: runId,
    });
  }

  const deepResult = await deepVerify(connection, normalizedInputsPayload);
  if (!deepResult.valid) {
    const runId = crypto.randomUUID();
    recordPreflightFailure(runId);
    return jsonError(res, 400, "VALIDATION_ERROR", "deep verify failed", {
      failure_code: deepResult.failure_code || "preflight_failed",
      error: deepResult.message || "DEEP_VERIFY_FAILED",
      run_id: runId,
    });
  }

  if (hasConcurrentRun(db, projectId)) {
    return jsonError(res, 409, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: "concurrent_run_limit",
      error: "RUN_ALREADY_IN_PROGRESS",
    });
  }

  const inputsJson = baseValidation.normalized;
  const runId = createRun(db, projectId, inputsJson);
  const jobPayload = buildProjectJob(projectId, inputsJson);
  try {
    emitAuditEvent({
      req,
      type: "RUN_CREATED",
      runId,
      actor: { userId: req.user?.id || "unknown", role: req.user?.role || "unknown" },
      meta: { status: "queued", project_id: projectId, source: "api/projects/:id/runs" },
    });
  } catch (error) {
    console.warn("audit RUN_CREATED failed:", error.message);
  }

  runJobAsync(jobPayload, {
    onStart: () => {
      updateRunStatus(db, runId, "running");
      try {
        emitAuditEvent({
          req,
          type: "RUN_STATUS_CHANGED",
          runId,
          actor: { userId: req.user?.id || "unknown", role: req.user?.role || "unknown" },
          meta: {
            from_status: "queued",
            to_status: "running",
            project_id: projectId,
            source: "api/projects/:id/runs",
          },
        });
      } catch (error) {
        console.warn("audit RUN_STATUS_CHANGED failed:", error.message);
      }
      recordAudit({
        db,
        action: AUDIT_ACTIONS.RUN_START,
        tenantId: DEFAULT_TENANT,
        actorId: req.user?.id || null,
        meta: { run_id: runId, project_id: projectId },
      });
    },
    onDone: (code) => {
      const status = code === 0 ? "completed" : "failed";
      updateRunStatus(db, runId, status);
      try {
        emitAuditEvent({
          req,
          type: "RUN_STATUS_CHANGED",
          runId,
          actor: { userId: req.user?.id || "unknown", role: req.user?.role || "unknown" },
          meta: {
            from_status: "running",
            to_status: status,
            project_id: projectId,
            source: "api/projects/:id/runs",
          },
        });
      } catch (error) {
        console.warn("audit RUN_STATUS_CHANGED failed:", error.message);
      }
      recordRunEvent({ runId, eventType: status === "completed" ? "run_completed" : "run_failed" });
      recordAudit({
        db,
        action: AUDIT_ACTIONS.RUN_UPDATE,
        tenantId: DEFAULT_TENANT,
        actorId: req.user?.id || null,
        meta: { run_id: runId, project_id: projectId, status },
      });
    },
  });

  return sendJson(res, 202, { runId, status: "queued" });
}

module.exports = {
  handleProjectRunsPost,
};
