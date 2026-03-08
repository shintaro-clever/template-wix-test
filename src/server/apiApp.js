const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { initDB } = require("../db");
const {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  validateDriveFolderId,
  createProject,
  patchProject,
  deleteProject,
} = require("../api/projects");
const { listProjects, getProjectById, toProjectView, parseProjectIdInput } = require("./projectsStore");
const { KINDS, buildPublicId, isUuid } = require("../id/publicIds");
const { listRuns, listRunsByProject, createRun, toPublicRunId, claimNextQueuedRun, markRunFinished, getRun, parseRunIdInput } = require("../api/runs");
const { handleProjectRunsPost } = require("../routes/runs");
const { handleRunsCollection } = require("./routes/runs");
const { handleAuthLogin } = require("../routes/auth");
const { handleArtifactsPost, handleArtifactsGet } = require("../routes/artifacts");
const { handleConnectorConnections } = require("./routes/connectors");
const { handleFigmaIngest } = require("./routes/ingest");
const { handleJobsFromFigma } = require("./routes/jobs");
const { handleGithubPrCreate } = require("./routes/github");
const { processChatTurnWithLocalStub } = require("./chatStub");
const { requireAuth } = require("../middleware/auth");
const { validateEnv } = require("../auth/config");
const { logRequest } = require("../middleware/requestLog");
const { executeLocalRun } = require("../runner/localRunner");
const {
  CONNECTION_SCHEMA_VERSION,
  hasValue,
  tokenNote,
  secretMeta,
  readConnections,
  readConnectorsCatalog,
  getConnectionsUpdatedAt,
  getConnectionsResponseBody,
  updateConnections,
  sanitizeConnectionsPayloadForLog,
} = require("./connectionsStore");
const { createThread, listThreadsByProject, getThread, postMessage, getThreadProjectId, parseThreadIdInput } = require("./threadsStore");
const {
  getProjectConnections,
  putProjectConnections,
  getProjectDrive,
  putProjectDrive,
  getProjectSettings,
  putProjectSettings,
} = require("./projectBindingsStore");
const {
  listPersonalAiSettings,
  getPersonalAiSetting,
  createPersonalAiSetting,
  patchPersonalAiSetting,
  getDefaultPersonalAiSetting,
} = require("../api/personalAiSettings");
const { loadProjectSharedContext } = require("./projectSharedContext");

const ROOT_DIR = path.join(__dirname, "..", "..");
const RUNS_DIR = path.join(ROOT_DIR, ".ai-runs");
const runJobScript = path.join(ROOT_DIR, "scripts", "run-job.js");
const INLINE_RUNNER_TIMEOUT_MS = Number(process.env.RUNNER_TIMEOUT_MS || 45000);

function isServiceUnavailableError(error) {
  return Boolean(error && error.status === 503 && error.failure_code === "service_unavailable");
}

function sanitizeRunnerMeta(meta = {}) {
  const safe = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (/token|secret|password|api[_-]?key/i.test(String(key))) {
      const text = typeof value === "string" ? value : "";
      safe[key] = { has_secret: text.length > 0, secret_len: text.length };
      return;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[key] = value;
      return;
    }
    safe[key] = String(value);
  });
  return safe;
}

function appendInlineAudit(runId, event, meta = {}) {
  if (!runId) {
    return;
  }
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    event,
    ts: new Date().toISOString(),
    run_id: runId,
    ...sanitizeRunnerMeta(meta),
  });
  fs.appendFileSync(path.join(dir, "audit.jsonl"), `${line}\n`);
}

function emitRunnerLog(event, runId, meta = {}) {
  const payload = {
    event,
    run_id: runId,
    ...sanitizeRunnerMeta(meta),
  };
  console.log(JSON.stringify(payload));
  appendInlineAudit(runId, event, meta);
}

function summarizeChecks(checks = []) {
  const failing = checks.filter((entry) => entry && entry.ok === false).map((entry) => entry.id || "unknown");
  return {
    total: checks.length,
    passed: checks.length - failing.length,
    failing,
  };
}

function truncateReason(reason, max = 200) {
  const text = String(reason || "");
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

function toPublicProjectId(internalId) {
  return isUuid(internalId) ? buildPublicId(KINDS.project, internalId) : internalId;
}

function withPublicProjectId(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "project_id")) {
    return payload;
  }
  return { ...payload, project_id: toPublicProjectId(payload.project_id) };
}

function mapRunsWithPublicProjectId(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => withPublicProjectId(row));
}

function mapThreadsWithPublicProjectId(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.threads)) {
    return payload;
  }
  return {
    ...payload,
    threads: payload.threads.map((row) => withPublicProjectId(row)),
  };
}

function writeInlineFailureArtifacts({ runId, jobType, runMode, inputs, reason }) {
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const safeReason = truncateReason(reason, 200);
  const checks = [{ id: "inline_runner", ok: false, reason: safeReason }];
  const runJson = {
    job: {
      job_type: jobType,
      run_mode: runMode,
      inputs: inputs || {},
    },
    runnerResult: {
      status: "error",
      errors: [safeReason],
      checks,
      checks_summary: summarizeChecks(checks),
      logs: [`RUNNER_DONE status=failed reason=${safeReason}`],
    },
    meta: {
      schema_version: "api-inline/v1",
      created_at: new Date().toISOString(),
    },
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(runJson, null, 2), "utf8");
  const summary = [
    "# Inline Runner Summary",
    "",
    `- run_id: ${runId}`,
    "- status: failed",
    "",
    "## Failure",
    `- reason: ${safeReason}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "summary.md"), summary, "utf8");
}

function writeInlineRunnerErrorArtifact({ runId, jobType, runMode, error }) {
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    run_id: runId,
    job_type: jobType || "-",
    run_mode: runMode || "mcp",
    phase: "inline_runner",
    message: String((error && error.message) || "unknown_error"),
    stack: String((error && error.stack) || ""),
  };
  fs.writeFileSync(path.join(dir, "inline_runner_error.json"), JSON.stringify(payload, null, 2), "utf8");
}

function parseRunInputs(raw) {
  if (typeof raw !== "string" || !raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildJobPayloadFromApiRun(row) {
  const inputs = parseRunInputs(row.inputs_json);
  if (row.job_type === "integration_hub.phase1.code_to_figma_from_url") {
    const runMode = row.run_mode || "mcp";
    return {
      job_type: row.job_type,
      goal: "api queued run",
      inputs: {
        message: "api queued run",
        target_path: ".ai-runs/{{run_id}}/code_to_figma_report.json",
        mcp_provider:
          typeof inputs.mcp_provider === "string" && inputs.mcp_provider.trim()
            ? inputs.mcp_provider.trim()
            : "local_stub",
        page_url: typeof inputs.page_url === "string" ? inputs.page_url.trim() : "https://example.com",
        figma_file_key:
          typeof inputs.figma_file_key === "string" && inputs.figma_file_key.trim()
            ? inputs.figma_file_key.trim()
            : "CutkQD2XudkCe8eJ1jDfkZ",
      },
      constraints: {
        allowed_paths: [".ai-runs/"],
        max_files_changed: 1,
        no_destructive_ops: true,
      },
      acceptance_criteria: ["summary.md and run.json are written"],
      provenance: {
        issue: "",
        operator: "operator",
      },
      run_mode: runMode,
      output_language: "ja",
      expected_artifacts: [
        { name: "code_to_figma_report.json", description: "report" },
        { name: "summary.md", description: "summary" },
      ],
    };
  }
  throw new Error(`unsupported_job_type:${row.job_type || "-"}`);
}

function runJobProcess(jobPayload) {
  const beforeRuns = new Set(fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR) : []);
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-inline-run-"));
    const jobPath = path.join(tmpDir, "job.json");
    fs.writeFileSync(jobPath, JSON.stringify(jobPayload, null, 2), "utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(process.execPath, [runJobScript, "--job", jobPath, "--role", "operator"], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const timeoutMs = Number.isFinite(INLINE_RUNNER_TIMEOUT_MS) && INLINE_RUNNER_TIMEOUT_MS > 0 ? INLINE_RUNNER_TIMEOUT_MS : 45000;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      const afterRuns = new Set(fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR) : []);
      const newRuns = [];
      afterRuns.forEach((name) => {
        if (!beforeRuns.has(name)) {
          newRuns.push(name);
        }
      });
      let inferredRunId = null;
      if (newRuns.length > 0) {
        inferredRunId = newRuns[0];
      }
      if (code !== 0) {
        resolve({ code, result: null, stdout, stderr, runId: inferredRunId, timedOut, timeoutMs });
        return;
      }
      const lines = String(stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      const lastLine = lines.length ? lines[lines.length - 1] : "{}";
      let parsed = null;
      try {
        parsed = JSON.parse(lastLine);
      } catch {
        parsed = null;
      }
      if ((!parsed || !parsed.run_id) && inferredRunId) {
        const runJsonPath = path.join(RUNS_DIR, inferredRunId, "run.json");
        if (fs.existsSync(runJsonPath)) {
          try {
            const runJson = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
            const runnerResult = runJson && runJson.runnerResult ? runJson.runnerResult : runJson;
            parsed = { ...(runnerResult || {}), run_id: inferredRunId };
          } catch {
            // ignore parse fallback error
          }
        }
      }
      resolve({ code, result: parsed, stdout, stderr, runId: inferredRunId, timedOut, timeoutMs });
    });
  });
}

function mirrorRunArtifacts(apiRunId, childRunId) {
  if (!apiRunId || !childRunId || apiRunId === childRunId) {
    return;
  }
  const srcDir = path.join(RUNS_DIR, childRunId);
  const dstDir = path.join(RUNS_DIR, apiRunId);
  if (!fs.existsSync(srcDir)) {
    return;
  }
  fs.mkdirSync(dstDir, { recursive: true });
  const files = ["run.json", "summary.md", "audit.jsonl"];
  files.forEach((name) => {
    const src = path.join(srcDir, name);
    const dst = path.join(dstDir, name);
    if (fs.existsSync(src)) {
      if (name === "audit.jsonl" && fs.existsSync(dst)) {
        const body = fs.readFileSync(src, "utf8");
        if (body) {
          fs.appendFileSync(dst, body);
        }
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  });
}

function createInlineRunner(db) {
  let busy = false;
  const tick = async () => {
    if (busy) {
      return;
    }
    const row = claimNextQueuedRun(db);
    if (!row || !row.id) {
      return;
    }
    busy = true;
    emitRunnerLog("RUNNER_PICKED", row.id, { job_type: row.job_type || "-", run_mode: row.run_mode || "mcp" });
    try {
      const payload = buildJobPayloadFromApiRun(row);
      if (String(process.env.RUNNER_MODE || "").toLowerCase() === "local") {
        const localResult = executeLocalRun({
          runId: row.id,
          jobType: row.job_type,
          runMode: row.run_mode,
          inputs: parseRunInputs(row.inputs_json),
          targetPath: row.target_path,
        });
        if (localResult.status === "succeeded") {
          markRunFinished(db, row.id, { status: "succeeded", failureCode: null });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "succeeded", reason: "-" });
        } else {
          const failure = localResult.failure_code || "run_failed";
          markRunFinished(db, row.id, { status: "failed", failureCode: failure });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "failed", reason: failure });
        }
      } else {
        const execResult = await runJobProcess(payload);
        const runnerResult = execResult.result || {};
        const childRunId = runnerResult.run_id || execResult.runId || null;
        if (childRunId) {
          mirrorRunArtifacts(row.id, childRunId);
        }
        if (execResult.timedOut) {
          const reason = `runner_timeout_ms=${execResult.timeoutMs}`;
          writeInlineFailureArtifacts({
            runId: row.id,
            jobType: row.job_type,
            runMode: row.run_mode,
            inputs: parseRunInputs(row.inputs_json),
            reason,
          });
          markRunFinished(db, row.id, { status: "failed", failureCode: "service_unavailable" });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "failed", reason: "timeout" });
        } else if (execResult.code === 0 && runnerResult.status === "ok") {
          markRunFinished(db, row.id, { status: "succeeded", failureCode: null });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "succeeded", reason: "-" });
        } else {
          const reason = (runnerResult.errors && runnerResult.errors[0]) || "inline_runner_failed";
          writeInlineFailureArtifacts({
            runId: row.id,
            jobType: row.job_type,
            runMode: row.run_mode,
            inputs: parseRunInputs(row.inputs_json),
            reason,
          });
          markRunFinished(db, row.id, { status: "failed", failureCode: "service_unavailable" });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "failed", reason });
        }
      }
    } catch (error) {
      writeInlineRunnerErrorArtifact({
        runId: row.id,
        jobType: row.job_type,
        runMode: row.run_mode,
        error,
      });
      emitRunnerLog("INLINE_RUNNER_ERROR", row.id, {
        message: String((error && error.message) || "unknown_error"),
        stack: String((error && error.stack) || ""),
      });
      writeInlineFailureArtifacts({
        runId: row.id,
        jobType: row.job_type,
        runMode: row.run_mode,
        inputs: parseRunInputs(row.inputs_json),
        reason: `inline_runner_exception:${String((error && error.message) || "unknown_error")}`,
      });
      markRunFinished(db, row.id, { status: "failed", failureCode: "service_unavailable" });
      emitRunnerLog("RUNNER_DONE", row.id, { status: "failed", reason: "inline_runner_exception" });
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => {
    tick().catch(() => {
      // ignore runner tick error
    });
  }, 500);
  if (typeof interval.unref === "function") {
    interval.unref();
  }
  return {
    kick: () => tick().catch(() => {}),
    stop: () => clearInterval(interval),
  };
}

function createApiServer(dbConn) {
  validateEnv(process.env);

  const db =
    dbConn && dbConn.constructor && dbConn.constructor.name === "Database"
      ? dbConn
      : initDB();
  const inlineRunner = String(process.env.RUNNER_MODE || "").toLowerCase() === "inline" ? createInlineRunner(db) : null;

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || "").split("?")[0] || "/";
    const method = (req.method || "GET").toUpperCase();
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      logRequest({
        req,
        res,
        body: req._logBody,
        durationMs: elapsedMs,
      });
    });

    try {
      if (urlPath.startsWith("/api/") && !urlPath.startsWith("/api/auth/")) {
        const ok = requireAuth(req, res);
        if (!ok) {
          return;
        }
      }

      if (method === "GET" && urlPath === "/healthz") {
        return sendJson(res, 200, { status: "ok" });
      }

      if (urlPath.startsWith("/api/connectors/connections")) {
        const handled = await handleConnectorConnections(req, res, db);
        if (handled === false) {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        return;
      }

      if (urlPath === "/api/ingest/figma") {
        return handleFigmaIngest(req, res);
      }

      if (urlPath === "/api/jobs/from-figma") {
        return handleJobsFromFigma(req, res);
      }
      if (urlPath === "/api/github/pr") {
        return handleGithubPrCreate(req, res);
      }

      if (urlPath === "/api/connectors") {
        if (method !== "GET") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        const connections = readConnections();
        const updatedAt = getConnectionsUpdatedAt();
        const rows = readConnectorsCatalog().map((item) => ({
          ...item,
          schema_version: CONNECTION_SCHEMA_VERSION,
          key: item.provider_key,
          enabled: true,
          connected:
            item.provider_key === "ai"
              ? hasValue(connections.ai?.apiKey)
              : item.provider_key === "github"
                ? hasValue(connections.github?.token)
                : item.provider_key === "figma"
                  ? hasValue(connections.figma?.token)
                  : false,
          last_checked_at: updatedAt,
          ...(item.provider_key === "ai"
            ? secretMeta(connections.ai?.apiKey)
            : item.provider_key === "github"
              ? secretMeta(connections.github?.token)
              : item.provider_key === "figma"
                ? secretMeta(connections.figma?.token)
                : secretMeta("")),
          notes: [tokenNote("credentials", item.provider_key === "ai"
            ? connections.ai?.apiKey
            : item.provider_key === "github"
              ? connections.github?.token
              : item.provider_key === "figma"
                ? connections.figma?.token
                : "")],
        }));
        return sendJson(res, 200, rows);
      }

      if (urlPath === "/api/me/ai-settings") {
        const userId = req.user?.id || "";
        if (method === "GET") {
          try {
            return sendJson(res, 200, listPersonalAiSettings(db, userId));
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        if (method === "POST") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
          }
          try {
            return sendJson(res, 201, createPersonalAiSetting(db, userId, body));
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/me/ai-settings/default") {
        const userId = req.user?.id || "";
        if (method !== "GET") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        try {
          const item = getDefaultPersonalAiSetting(db, userId);
          return sendJson(res, 200, { item });
        } catch (error) {
          return jsonError(
            res,
            error.status || 400,
            error.code || "VALIDATION_ERROR",
            error.message || "入力が不正です",
            error.details || { failure_code: error.failure_code || "validation_error" }
          );
        }
      }

      const aiSettingMatch = urlPath.match(/^\/api\/me\/ai-settings\/([^/]+)$/);
      if (aiSettingMatch) {
        const userId = req.user?.id || "";
        const aiSettingId = aiSettingMatch[1];
        if (method === "GET") {
          try {
            const item = getPersonalAiSetting(db, userId, aiSettingId);
            if (!item) {
              return jsonError(res, 404, "NOT_FOUND", "ai setting not found", { failure_code: "not_found" });
            }
            return sendJson(res, 200, { item });
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        if (method === "PATCH") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
          }
          try {
            const item = patchPersonalAiSetting(db, userId, aiSettingId, body);
            if (!item) {
              return jsonError(res, 404, "NOT_FOUND", "ai setting not found", { failure_code: "not_found" });
            }
            return sendJson(res, 200, { item });
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/connections") {
        if (method === "GET") {
          const connections = readConnections();
          const updatedAt = getConnectionsUpdatedAt();
          return sendJson(res, 200, getConnectionsResponseBody(connections, updatedAt));
        }
        if (method !== "PUT" && method !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", {
            failure_code: "validation_error",
          });
        }
        req._logBody = sanitizeConnectionsPayloadForLog(body);
        try {
          const updated = updateConnections(body);
          return sendJson(res, 200, updated.body);
        } catch (error) {
          return jsonError(
            res,
            error.status || 400,
            error.code || "VALIDATION_ERROR",
            error.message || "入力が不正です",
            error.details || { failure_code: error.failure_code || "validation_error" }
          );
        }
      }

      // GET/HEAD /api/projects
      if ((method === "GET" || method === "HEAD") && urlPath === "/api/projects") {
        if (method === "HEAD") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          return res.end();
        }
        return sendJson(res, 200, listProjects(db));
      }

      // POST /api/projects
      if (method === "POST" && urlPath === "/api/projects") {
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
        }

        const nameErr = validateName(body.name);
        const urlErr = validateHttpsUrl(body.staging_url);
        const driveErr = body.drive_folder_id !== undefined ? validateDriveFolderId(body.drive_folder_id) : null;
        if (nameErr || urlErr || driveErr) {
          return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { nameErr, urlErr, driveErr });
        }

        const created = createProject(db, body.name.trim(), body.staging_url.trim(), req.user?.id, {
          description: body.description,
          drive_folder_id: body.drive_folder_id,
        });
        return sendJson(res, 201, toProjectView(created));
      }

      // GET/POST /api/runs
      if (urlPath === "/api/runs") {
        return handleRunsCollection(req, res, db, {
          onRunQueued: () => {
            if (inlineRunner) {
              inlineRunner.kick();
            }
          },
        });
      }
      if (method === "GET" && /^\/api\/runs\/[^/]+$/.test(urlPath)) {
        const runIdInput = urlPath.split("/").filter(Boolean)[2];
        const parsedRunId = parseRunIdInput(runIdInput);
        if (!parsedRunId.ok) {
          return jsonError(res, parsedRunId.status, parsedRunId.code, parsedRunId.message, parsedRunId.details);
        }
        const run = getRun(db, parsedRunId.internalId);
        if (!run) {
          return jsonError(res, 404, "NOT_FOUND", "run not found", {
            failure_code: "not_found",
          });
        }
        return sendJson(res, 200, run);
      }

      // /api/projects/:id
      const runMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/runs$/);
      if (runMatch) {
        const id = runMatch[1];
        const resolved = parseProjectIdInput(id);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const internalProjectId = resolved.internalId;
        const publicProjectId = resolved.publicId;
        if (method === "GET") {
          const projectRef = getProjectById(db, id);
          if (!projectRef.ok) {
            return jsonError(res, projectRef.status, projectRef.code, projectRef.message, projectRef.details);
          }
          if (!projectRef.item) return jsonError(res, 404, "NOT_FOUND", "project not found", { failure_code: "not_found" });
          return sendJson(res, 200, { project_id: publicProjectId, runs: mapRunsWithPublicProjectId(listRunsByProject(db, internalProjectId)) });
        }
        if (method === "POST") {
          return await handleProjectRunsPost(req, res, db, internalProjectId);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const projectThreadsMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/threads$/);
      if (projectThreadsMatch) {
        const id = projectThreadsMatch[1];
        const resolved = parseProjectIdInput(id);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const internalProjectId = resolved.internalId;
        if (method === "GET") {
          try {
            const payload = listThreadsByProject(db, internalProjectId);
            return sendJson(res, 200, mapThreadsWithPublicProjectId(payload));
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        if (method === "POST") {
          let body;
          try { body = await readJsonBody(req); } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
          }
          try {
            const created = createThread(db, internalProjectId, body.title);
            return sendJson(res, 201, withPublicProjectId(created));
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const threadChatMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/threads\/([^/]+)\/chat$/);
      if (threadChatMatch) {
        const resolved = parseProjectIdInput(threadChatMatch[1]);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        if (method !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        const projectId = resolved.internalId;
        const threadIdInput = threadChatMatch[2];
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
        }
        const content = typeof body.content === "string" ? body.content.trim() : typeof body.body === "string" ? body.body.trim() : "";
        if (!content) {
          return jsonError(res, 400, "VALIDATION_ERROR", "content is required", { failure_code: "validation_error" });
        }
        try {
          const parsedThread = parseThreadIdInput(threadIdInput);
          const ownerProjectId = getThreadProjectId(db, parsedThread.internalId);
          if (!ownerProjectId) {
            return jsonError(res, 404, "NOT_FOUND", "thread not found", { failure_code: "not_found" });
          }
          if (ownerProjectId !== projectId) {
            return jsonError(res, 400, "VALIDATION_ERROR", "thread does not belong to project", { failure_code: "validation_error" });
          }
          const posted = postMessage(
            db,
            parsedThread.publicId,
            { role: "user", content, run_id: body.run_id },
            req.user?.id || "user"
          );
          const sharedContext = loadProjectSharedContext(db, projectId);
          if (!sharedContext.ok) {
            return jsonError(
              res,
              sharedContext.status || 400,
              sharedContext.code || "VALIDATION_ERROR",
              sharedContext.message || "入力が不正です",
              sharedContext.details || { failure_code: "validation_error" }
            );
          }
          const userId = typeof req.user?.id === "string" ? req.user.id.trim() : "";
          const defaultAiSetting = userId ? getDefaultPersonalAiSetting(db, userId) : null;
          const selectedAiSettingId = defaultAiSetting && defaultAiSetting.ai_setting_id ? defaultAiSetting.ai_setting_id : null;
          const selectedProvider = defaultAiSetting && typeof defaultAiSetting.provider === "string" ? defaultAiSetting.provider : "local_stub";
          const selectedModel = defaultAiSetting && typeof defaultAiSetting.model === "string" ? defaultAiSetting.model : "local_stub";
          const runId = createRun(db, {
            project_id: projectId,
            thread_id: parsedThread.publicId,
            ai_setting_id: selectedAiSettingId,
            job_type: "integration_hub.workspace.chat_turn",
            run_mode: "mcp",
            inputs: {
              project_id: resolved.publicId,
              thread_id: parsedThread.publicId,
              ai_setting_id: selectedAiSettingId || undefined,
              ai_provider: selectedProvider,
              ai_model: selectedModel,
              content,
              shared_environment: sharedContext.shared_environment,
            },
            target_path: ".ai-runs/{{run_id}}/workspace_chat.json",
          });
          const chatResult = processChatTurnWithLocalStub(db, {
            runId,
            threadId: parsedThread.publicId,
            content,
            actorId: "assistant",
            aiSetting: { provider: selectedProvider, model: selectedModel },
          });
          return sendJson(res, 201, {
            project_id: resolved.publicId,
            thread_id: parsedThread.publicId,
            message_id: posted.message_id,
            run_id: toPublicRunId(runId),
            ai_setting_id: selectedAiSettingId || null,
            status: chatResult.status,
            failure_code: chatResult.failure_code,
            assistant_message_id: chatResult.assistant_message_id,
          });
        } catch (error) {
          return jsonError(
            res,
            error.status || 400,
            error.code || "VALIDATION_ERROR",
            error.message || "入力が不正です",
            error.details || { failure_code: error.failure_code || "validation_error" }
          );
        }
      }

      const workspaceMessageMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/workspace\/messages$/);
      if (workspaceMessageMatch) {
        const resolved = parseProjectIdInput(workspaceMessageMatch[1]);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const projectId = resolved.internalId;
        if (method !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Method not allowed");
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", { failure_code: "validation_error" });
        }
        const content = typeof body.content === "string" ? body.content.trim() : typeof body.body === "string" ? body.body.trim() : "";
        if (!content) {
          return jsonError(res, 400, "VALIDATION_ERROR", "content is required", { failure_code: "validation_error" });
        }
        let threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
        let createdThread = false;
        try {
          if (threadId) {
            const ownerProjectId = getThreadProjectId(db, threadId);
            if (!ownerProjectId) {
              return jsonError(res, 404, "NOT_FOUND", "thread not found", { failure_code: "not_found" });
            }
            if (ownerProjectId !== projectId) {
              return jsonError(res, 400, "VALIDATION_ERROR", "thread does not belong to project", { failure_code: "validation_error" });
            }
          } else {
            const titleFromBody = typeof body.title === "string" ? body.title.trim() : "";
            const autoTitle = titleFromBody || content.slice(0, 80);
            const created = createThread(db, projectId, autoTitle);
            threadId = created.thread_id;
            createdThread = true;
          }
          const posted = postMessage(
            db,
            threadId,
            { role: "user", content, run_id: body.run_id },
            req.user?.id || "user"
          );
          const sharedContext = loadProjectSharedContext(db, projectId);
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
            project_id: projectId,
            thread_id: threadId,
            ai_setting_id: typeof body.ai_setting_id === "string" ? body.ai_setting_id.trim() : null,
            job_type: "integration_hub.workspace.chat_turn",
            run_mode: "mcp",
            inputs: {
              project_id: resolved.publicId,
              thread_id: threadId,
              ai_setting_id: typeof body.ai_setting_id === "string" ? body.ai_setting_id.trim() : undefined,
              content,
              shared_environment: sharedContext.shared_environment,
            },
            target_path: ".ai-runs/{{run_id}}/workspace_chat.json",
          });
          return sendJson(res, 201, {
            project_id: resolved.publicId,
            thread_id: threadId,
            created_thread: createdThread,
            message_id: posted.message_id,
            run_id: toPublicRunId(runId),
          });
        } catch (error) {
          return jsonError(
            res,
            error.status || 400,
            error.code || "VALIDATION_ERROR",
            error.message || "入力が不正です",
            error.details || { failure_code: error.failure_code || "validation_error" }
          );
        }
      }

      const threadMessagesMatch = urlPath.match(/^\/api\/threads\/([^/]+)\/messages$/);
      if (threadMessagesMatch) {
        const threadId = threadMessagesMatch[1];
        if (method === "POST") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", {
              failure_code: "validation_error",
            });
          }
          try {
            const updated = postMessage(db, threadId, body, req.user?.id || "user");
            return sendJson(res, 201, updated);
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const threadMatch = urlPath.match(/^\/api\/threads\/([^/]+)$/);
      if (threadMatch) {
        const threadId = threadMatch[1];
        if (method === "GET") {
          let payload;
          try {
            payload = getThread(db, threadId);
          } catch (error) {
            return jsonError(
              res,
              error.status || 400,
              error.code || "VALIDATION_ERROR",
              error.message || "入力が不正です",
              error.details || { failure_code: error.failure_code || "validation_error" }
            );
          }
          if (!payload) {
            return jsonError(res, 404, "NOT_FOUND", "thread not found", {
              failure_code: "not_found",
            });
          }
          return sendJson(res, 200, payload);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/artifacts") {
        if (method === "POST") {
          return await handleArtifactsPost(req, res);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      if (urlPath === "/api/auth/login") {
        return await handleAuthLogin(req, res, db);
      }

      const artifactMatch = urlPath.match(/^\/api\/artifacts\/([^/]+)$/);
      if (artifactMatch) {
        const name = artifactMatch[1];
        if (method === "GET") {
          return handleArtifactsGet(req, res, name);
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const projectConnectionsMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/connections$/);
      if (projectConnectionsMatch) {
        const resolved = parseProjectIdInput(projectConnectionsMatch[1]);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const projectId = resolved.internalId;
        if (method === "GET") {
          const data = getProjectConnections(db, projectId);
          if (!data) return jsonError(res, 404, "NOT_FOUND", "Project not found", { failure_code: "not_found" });
          return sendJson(res, 200, withPublicProjectId(data));
        }
        if (method === "PUT" || method === "POST") {
          let body;
          try { body = await readJsonBody(req); } catch { return jsonError(res, 400, "VALIDATION_ERROR", "JSON不正", { failure_code: "validation_error" }); }
          try { return sendJson(res, 200, withPublicProjectId(putProjectConnections(db, projectId, body))); }
          catch (e) { return jsonError(res, e.status || 400, e.code || "VALIDATION_ERROR", e.message, { failure_code: e.failure_code || "validation_error" }); }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const projectDriveMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/drive$/);
      if (projectDriveMatch) {
        const resolved = parseProjectIdInput(projectDriveMatch[1]);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const projectId = resolved.internalId;
        if (method === "GET") {
          const data = getProjectDrive(db, projectId);
          if (!data) return jsonError(res, 404, "NOT_FOUND", "Project not found", { failure_code: "not_found" });
          return sendJson(res, 200, withPublicProjectId(data));
        }
        if (method === "PUT" || method === "POST") {
          let body;
          try { body = await readJsonBody(req); } catch { return jsonError(res, 400, "VALIDATION_ERROR", "JSON不正", { failure_code: "validation_error" }); }
          try { return sendJson(res, 200, withPublicProjectId(putProjectDrive(db, projectId, body))); }
          catch (e) { return jsonError(res, e.status || 400, e.code || "VALIDATION_ERROR", e.message, { failure_code: e.failure_code || "validation_error" }); }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const projectSettingsMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/settings$/);
      if (projectSettingsMatch) {
        const resolved = parseProjectIdInput(projectSettingsMatch[1]);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const projectId = resolved.internalId;
        if (method === "GET") {
          const data = getProjectSettings(db, projectId);
          if (!data) return jsonError(res, 404, "NOT_FOUND", "Project not found", { failure_code: "not_found" });
          return sendJson(res, 200, withPublicProjectId(data));
        }
        if (method === "PUT" || method === "POST") {
          let body;
          try { body = await readJsonBody(req); } catch { return jsonError(res, 400, "VALIDATION_ERROR", "JSON不正", { failure_code: "validation_error" }); }
          try { return sendJson(res, 200, withPublicProjectId(putProjectSettings(db, projectId, body))); }
          catch (e) { return jsonError(res, e.status || 400, e.code || "VALIDATION_ERROR", e.message, { failure_code: e.failure_code || "validation_error" }); }
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
      }

      const m = urlPath.match(/^\/api\/projects\/([^/]+)$/);
      if (m) {
        const id = m[1];
        const resolved = parseProjectIdInput(id);
        if (!resolved.ok) {
          return jsonError(res, resolved.status, resolved.code, resolved.message, resolved.details);
        }
        const internalProjectId = resolved.internalId;

        if (method === "GET") {
          const itemRef = getProjectById(db, id);
          if (!itemRef.ok) {
            return jsonError(res, itemRef.status, itemRef.code, itemRef.message, itemRef.details);
          }
          if (!itemRef.item) {
            return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません", {
              failure_code: "not_found",
            });
          }
          return sendJson(res, 200, itemRef.item);
        }

        if (method === "PATCH") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
          }

          if (body.name !== undefined) {
            const e = validateName(body.name);
            if (e) return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { nameErr: e });
          }
          if (body.staging_url !== undefined) {
            const e = validateHttpsUrl(body.staging_url);
            if (e) return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { urlErr: e });
          }
          if (body.drive_folder_id !== undefined) {
            const e = validateDriveFolderId(body.drive_folder_id);
            if (e) return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { driveErr: e });
          }

          const updated = patchProject(db, internalProjectId, body, req.user?.id);
          if (!updated) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          return sendJson(res, 200, toProjectView(updated));
        }

        if (method === "DELETE") {
          // 将来: runs(queued/running)があれば409で止める枠。現状は常に削除可。
          const ok = deleteProject(db, internalProjectId, req.user?.id);
          if (!ok) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          res.writeHead(204);
          return res.end();
        }
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (error) {
      if (res.headersSent) {
        return;
      }
      if (isServiceUnavailableError(error)) {
        return jsonError(res, 503, "SERVICE_UNAVAILABLE", "service unavailable", {
          failure_code: "service_unavailable",
        });
      }
      throw error;
    }
  });
  if (inlineRunner) {
    server.on("close", () => inlineRunner.stop());
  }
  return server;
}

module.exports = { createApiServer };
