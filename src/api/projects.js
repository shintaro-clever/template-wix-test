const { DEFAULT_TENANT } = require("../db/sqlite");
const crypto = require("crypto");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(res, status, code, message, details) {
  const body = { code, message };
  if (details) body.details = details;
  sendJson(res, status, body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function validateHttpsUrl(url) {
  if (typeof url !== "string" || url.trim().length === 0) return "staging_url is required";
  if (url.length > 2048) return "staging_url too long";
  if (!/^https:\/\//i.test(url)) return "staging_url must start with https://";
  return null;
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length === 0) return "name is required";
  if (name.length > 200) return "name too long";
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function listProjects(db) {
  return db
    .prepare(
      "SELECT id,name,staging_url,created_at,updated_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC"
    )
    .all(DEFAULT_TENANT);
}

function getProject(db, id) {
  return db
    .prepare("SELECT id,name,staging_url,created_at,updated_at FROM projects WHERE tenant_id=? AND id=?")
    .get(DEFAULT_TENANT, id);
}

function createProject(db, name, stagingUrl) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    "INSERT INTO projects(tenant_id,id,name,staging_url,created_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).run(DEFAULT_TENANT, id, name, stagingUrl, ts, ts);
  return getProject(db, id);
}

function patchProject(db, id, patch) {
  const existing = getProject(db, id);
  if (!existing) return null;

  const nextName = typeof patch.name === "string" ? patch.name : existing.name;
  const nextUrl = typeof patch.staging_url === "string" ? patch.staging_url : existing.staging_url;

  db.prepare("UPDATE projects SET name=?, staging_url=?, updated_at=? WHERE tenant_id=? AND id=?").run(
    nextName,
    nextUrl,
    nowIso(),
    DEFAULT_TENANT,
    id
  );
  return getProject(db, id);
}

function deleteProject(db, id) {
  const info = db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
  return info.changes > 0;
}

module.exports = {
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
};
