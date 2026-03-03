const { createApiServer } = require("../../src/server/apiApp");
const { assert, requestLocal } = require("./_helpers");

function restoreEnv(snapshot) {
  if (snapshot.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = snapshot.AUTH_MODE;
  if (snapshot.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = snapshot.JWT_SECRET;
  if (snapshot.SECRET_KEY === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = snapshot.SECRET_KEY;
  if (snapshot.AUTH_LOGIN_ID === undefined) delete process.env.AUTH_LOGIN_ID;
  else process.env.AUTH_LOGIN_ID = snapshot.AUTH_LOGIN_ID;
  if (snapshot.AUTH_LOGIN_PASSWORD === undefined) delete process.env.AUTH_LOGIN_PASSWORD;
  else process.env.AUTH_LOGIN_PASSWORD = snapshot.AUTH_LOGIN_PASSWORD;
}

async function run() {
  const snapshot = {
    AUTH_MODE: process.env.AUTH_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    SECRET_KEY: process.env.SECRET_KEY,
    AUTH_LOGIN_ID: process.env.AUTH_LOGIN_ID,
    AUTH_LOGIN_PASSWORD: process.env.AUTH_LOGIN_PASSWORD,
  };

  try {
    process.env.AUTH_MODE = "on";
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.SECRET_KEY = "1".repeat(64);
    process.env.AUTH_LOGIN_ID = "admin";
    process.env.AUTH_LOGIN_PASSWORD = "admin";

    const server = createApiServer();
    const handler = server.listeners("request")[0];

    const unauth = await requestLocal(handler, { method: "GET", url: "/api/projects" });
    assert(unauth.statusCode === 401, "GET /api/projects should be 401 without bearer token");

    const login = await requestLocal(handler, {
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin" }),
    });
    assert(login.statusCode === 200, "POST /api/auth/login should return 200 with correct credentials");
    const loginPayload = JSON.parse(login.body.toString("utf8"));
    assert(typeof loginPayload.token === "string" && loginPayload.token.length > 0, "login should return token");

    const authed = await requestLocal(handler, {
      method: "GET",
      url: "/api/projects",
      headers: { Authorization: `Bearer ${loginPayload.token}` },
    });
    assert(authed.statusCode === 200, "GET /api/projects should return 200 with bearer token");
  } finally {
    restoreEnv(snapshot);
  }
}

module.exports = { run };
