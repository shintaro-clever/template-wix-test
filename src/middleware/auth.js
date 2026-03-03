// src/middleware/auth.js
const { buildErrorBody } = require("../server/errors");
const { parseAuthMode } = require("../auth/config");
const { verifyJwtToken } = require("../auth/jwt");

function unauthorized(res) {
  if (res && typeof res.writeHead === "function") {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify(
        buildErrorBody({
          code: "UNAUTHORIZED",
          message: "認証が必要です",
          message_en: "authentication required",
          details: { failure_code: "permission" },
        })
      )
    );
  }
}

function requireAuth(req, res) {
  if (parseAuthMode(process.env.AUTH_MODE) === "off") {
    req.user = { id: "dev-auth-bypass", role: "admin", tenant_id: "default" };
    return true;
  }

  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : "";

  if (!token) {
    unauthorized(res);
    return false;
  }

  try {
    const payload = verifyJwtToken(token, process.env);
    req.user = payload;
    return true;
  } catch {
    unauthorized(res);
    return false;
  }
}

module.exports = { requireAuth };
