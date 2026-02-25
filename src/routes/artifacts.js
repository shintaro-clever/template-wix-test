const fs = require("fs");
const path = require("path");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { createArtifact, getArtifactByName } = require("../db/artifacts");
const { sendJson, jsonError, readJsonBody } = require("../api/projects");

const REPO_ROOT = path.join(__dirname, "..", "..");

function validateRelativePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false };
  }
  if (path.isAbsolute(value)) {
    return { valid: false };
  }
  const normalized = path.normalize(value);
  if (normalized.includes("..")) {
    return { valid: false };
  }
  return { valid: true, normalized };
}

function resolvePath(relPath) {
  return path.resolve(REPO_ROOT, relPath);
}

async function handleArtifactsPost(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です");
  }

  const name = body && typeof body.name === "string" ? body.name.trim() : "";
  const rawPath = body && typeof body.path === "string" ? body.path.trim() : "";
  const pathResult = validateRelativePath(rawPath);
  if (!name || !pathResult.valid) {
    return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: "validation_error",
    });
  }

  const result = createArtifact({
    tenantId: DEFAULT_TENANT,
    name,
    path: pathResult.normalized,
  });
  if (!result.ok) {
    return jsonError(res, result.status || 500, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: result.failure_code,
    });
  }

  return sendJson(res, 201, { name, path: pathResult.normalized });
}

function handleArtifactsGet(req, res, name) {
  if (!name) {
    return jsonError(res, 400, "VALIDATION_ERROR", "入力が不正です", {
      failure_code: "validation_error",
    });
  }
  const artifact = getArtifactByName({ tenantId: DEFAULT_TENANT, name });
  if (!artifact) {
    return jsonError(res, 404, "NOT_FOUND", "not found", {
      failure_code: "not_found",
    });
  }
  const absolute = resolvePath(artifact.path);
  if (!fs.existsSync(absolute)) {
    return jsonError(res, 404, "NOT_FOUND", "not found", {
      failure_code: "not_found",
    });
  }
  res.writeHead(200, { "Content-Type": "application/octet-stream" });
  const stream = fs.createReadStream(absolute);
  stream.on("error", () => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Failed to read artifact");
  });
  stream.pipe(res);
}

module.exports = {
  handleArtifactsPost,
  handleArtifactsGet,
  resolvePath,
};
