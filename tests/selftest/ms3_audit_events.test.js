const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const AUDIT_ACTIONS = require("../../src/audit/actions");
const { handleAuthLogin } = require("../../src/routes/auth");
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

    const before = db
      .prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE tenant_id=? AND action=?")
      .get(DEFAULT_TENANT, AUDIT_ACTIONS.AUTH_LOGIN).cnt;

    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const loginRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin" }),
    });
    assert(loginRes.statusCode === 200, "login should succeed");

    const after = db
      .prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE tenant_id=? AND action=?")
      .get(DEFAULT_TENANT, AUDIT_ACTIONS.AUTH_LOGIN).cnt;
    assert(after >= before + 1, "audit log should be recorded for auth.login");

    const failingAuditDb = {
      constructor: { name: "Database" },
      prepare(sql) {
        if (String(sql).includes("INSERT INTO audit_logs")) {
          throw new Error("forced audit insert failure");
        }
        return {
          run() {
            return { changes: 1 };
          },
        };
      },
    };
    const loginWithAuditFailure = await requestLocal(
      (req, res) => handleAuthLogin(req, res, failingAuditDb),
      {
        method: "POST",
        url: "/api/auth/login",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "admin", password: "admin" }),
      }
    );
    assert(loginWithAuditFailure.statusCode === 200, "audit insert failure should not break login");
  } finally {
    restoreEnv(snapshot);
  }
}

module.exports = { run };
