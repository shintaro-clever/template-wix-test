const { buildErrorBody } = require("../server/errors");
const { issueJwtToken } = require("../auth/jwt");
const { DEFAULT_TENANT } = require("../db/sqlite");
const { recordAudit, AUDIT_ACTIONS } = require("../middleware/audit");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj || {});
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(data);
        req._logBody = parsed;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleAuthLogin(req, res, db) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }
  const userId = typeof payload.id === "string" ? payload.id.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!userId || !password) {
    sendJson(
      res,
      401,
      buildErrorBody({
        code: "UNAUTHORIZED",
        message: "認証が必要です",
        message_en: "authentication required",
        details: { failure_code: "permission" },
      })
    );
    return;
  }
  const loginId = String(process.env.AUTH_LOGIN_ID || "admin");
  const loginPassword = String(process.env.AUTH_LOGIN_PASSWORD || "admin");
  if (userId !== loginId || password !== loginPassword) {
    sendJson(
      res,
      401,
      buildErrorBody({
        code: "UNAUTHORIZED",
        message: "認証が必要です",
        message_en: "authentication required",
        details: { failure_code: "permission" },
      })
    );
    return;
  }
  const token = issueJwtToken({ id: loginId, role: "admin", tenant_id: DEFAULT_TENANT });
  recordAudit({
    db,
    action: AUDIT_ACTIONS.AUTH_LOGIN,
    tenantId: DEFAULT_TENANT,
    actorId: loginId,
    meta: { route: "/api/auth/login" },
  });
  sendJson(res, 200, { token });
}

module.exports = {
  handleAuthLogin,
};
