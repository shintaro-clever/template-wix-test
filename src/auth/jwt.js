const jwt = require("jsonwebtoken");

function getJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET || "";
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("JWT_SECRET is invalid");
  }
  return secret;
}

function issueJwtToken(payload, env = process.env) {
  const secret = getJwtSecret(env);
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "1h" });
}

function verifyJwtToken(token, env = process.env) {
  const secret = getJwtSecret(env);
  return jwt.verify(token, secret, { algorithms: ["HS256"] });
}

module.exports = {
  issueJwtToken,
  verifyJwtToken,
};
