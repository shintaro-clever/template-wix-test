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
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
} = require("../api/projects");
const { listRuns, createRun, claimNextQueuedRun, markRunFinished, getRun } = require("../api/runs");
const { handleProjectRunsPost } = require("../routes/runs");
const { handleRunsCollection } = require("./routes/runs");
const { handleAuthLogin } = require("../routes/auth");
const { handleArtifactsPost, handleArtifactsGet } = require("../routes/artifacts");
const { handleConnectorConnections } = require("./routes/connectors");
const { handleFigmaIngest } = require("./routes/ingest");
const { handleJobsFromFigma } = require("./routes/jobs");
const { handleGithubPrCreate } = require("./routes/github");
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
        if (localResult.status === "completed") {
          markRunFinished(db, row.id, { status: "completed", failureCode: null });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "completed", reason: "-" });
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
          markRunFinished(db, row.id, { status: "completed", failureCode: null });
          emitRunnerLog("RUNNER_DONE", row.id, { status: "completed", reason: "-" });
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
        return sendJson(res, 201, created);
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
        const runId = urlPath.split("/").filter(Boolean)[2];
        const run = getRun(db, runId);
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
        if (method === "POST") {
          return await handleProjectRunsPost(req, res, db, id);
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

      const m = urlPath.match(/^\/api\/projects\/([^/]+)$/);
      if (m) {
        const id = m[1];

        if (method === "GET") {
          const item = getProject(db, id);
          if (!item) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          return sendJson(res, 200, item);
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

          const updated = patchProject(db, id, body, req.user?.id);
          if (!updated) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
          return sendJson(res, 200, updated);
        }

        if (method === "DELETE") {
          // 将来: runs(queued/running)があれば409で止める枠。現状は常に削除可。
          const ok = deleteProject(db, id, req.user?.id);
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
