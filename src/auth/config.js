function parseAuthMode(raw = process.env.AUTH_MODE) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return "on";
  }
  const mode = String(raw).trim().toLowerCase();
  if (mode === "on") return "on";
  if (mode === "off") return "off";
  throw new Error('AUTH_MODE must be "on" or "off"');
}

function isValidJwtSecret(value) {
  return typeof value === "string" && value.length >= 32;
}

function isValidSecretKey(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function validateEnv(env = process.env) {
  const mode = parseAuthMode(env.AUTH_MODE);
  if (mode === "off") {
    const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
    if (nodeEnv === "production") {
      throw new Error('AUTH_MODE=off is not allowed when NODE_ENV=production');
    }
    return { authMode: mode };
  }
  if (!isValidJwtSecret(env.JWT_SECRET || "")) {
    throw new Error("JWT_SECRET is invalid: must be 32+ chars when AUTH_MODE=on");
  }
  if (!isValidSecretKey(env.SECRET_KEY || "")) {
    throw new Error("SECRET_KEY is invalid: must be 64-char hex when AUTH_MODE=on");
  }
  return { authMode: mode };
}

module.exports = {
  parseAuthMode,
  validateEnv,
};
