const http = require("http");
const { initDB } = require("../db");
const {
  sendJson,
  jsonError,
  readJsonBody,
  validateName,
  validateHttpsUrl,
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
} = require("../api/projects");
const { listRuns, createRun } = require("../api/runs");
const { handleProjectRunsPost } = require("../routes/runs");
const { handleAuthLogin } = require("../routes/auth");
const { handleArtifactsPost, handleArtifactsGet } = require("../routes/artifacts");
const { requireAuth } = require("../middleware/auth");
const { logRequest } = require("../middleware/requestLog");

function isServiceUnavailableError(error) {
  return Boolean(error && error.status === 503 && error.failure_code === "service_unavailable");
}

function createApiServer(dbConn) {
  const db =
    dbConn && dbConn.constructor && dbConn.constructor.name === "Database"
      ? dbConn
      : initDB();

  return http.createServer(async (req, res) => {
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
        if (nameErr || urlErr) {
          return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", { nameErr, urlErr });
        }

        const created = createProject(db, body.name.trim(), body.staging_url.trim(), req.user?.id);
        return sendJson(res, 201, created);
      }

      // GET/POST /api/runs
      if (urlPath === "/api/runs") {
        if (method === "GET") {
          return sendJson(res, 200, listRuns(db));
        }
        if (method === "POST") {
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
          const inputs =
            body && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {};
          const runId = createRun(db, { job_type: jobType, inputs, target_path: targetPath });
          return sendJson(res, 201, { run_id: runId, status: "queued" });
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed");
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
}

module.exports = { createApiServer };
