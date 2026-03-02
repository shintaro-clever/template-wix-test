const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { withRetry } = require("../db/retry");
const { buildErrorBody } = require("../server/errors");

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

function getJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET || "";
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("JWT_SECRET is invalid");
  }
  return secret;
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
  const row = withRetry(() =>
    db
      .prepare("SELECT id, role, tenant_id, password_hash FROM users WHERE id = ?")
      .get(userId)
  );
  if (!row || !row.password_hash) {
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
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
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
  const secret = getJwtSecret();
  const token = jwt.sign(
    { id: row.id, role: row.role, tenant_id: row.tenant_id },
    secret,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  sendJson(res, 200, { token });
}

module.exports = {
  handleAuthLogin,
};
