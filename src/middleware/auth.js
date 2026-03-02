// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const { buildErrorBody } = require("../server/errors");

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
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : "";

  if (!token) {
    unauthorized(res);
    return false;
  }

  try {
    const secret = process.env.JWT_SECRET;
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    req.user = payload;
    return true;
  } catch {
    unauthorized(res);
    return false;
  }
}

module.exports = { requireAuth };
