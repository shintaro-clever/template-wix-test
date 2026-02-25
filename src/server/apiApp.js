const http = require("http");
const { openDb } = require("../db/sqlite");
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
const { handleProjectRunsPost } = require("../routes/runs");
const { handleArtifactsPost, handleArtifactsGet } = require("../routes/artifacts");

function createApiServer() {
  const db = openDb();

  return http.createServer(async (req, res) => {
    const urlPath = (req.url || "").split("?")[0] || "/";
    const method = (req.method || "GET").toUpperCase();

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

      const created = createProject(db, body.name.trim(), body.staging_url.trim());
      return sendJson(res, 201, created);
    }

    // /api/projects/:id
    const runMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/runs$/);
    if (runMatch) {
      const id = runMatch[1];
      if (method === "POST") {
        return handleProjectRunsPost(req, res, db, id);
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method not allowed");
    }

    if (urlPath === "/api/artifacts") {
      if (method === "POST") {
        return handleArtifactsPost(req, res);
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method not allowed");
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

        const updated = patchProject(db, id, body);
        if (!updated) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
        return sendJson(res, 200, updated);
      }

      if (method === "DELETE") {
        // 将来: runs(queued/running)があれば409で止める枠。現状は常に削除可。
        const ok = deleteProject(db, id);
        if (!ok) return jsonError(res, 404, "NOT_FOUND", "Projectが見つかりません");
        res.writeHead(204);
        return res.end();
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}

module.exports = { createApiServer };
