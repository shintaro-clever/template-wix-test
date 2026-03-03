const { createApiServer } = require("../../src/server/apiApp");
const { assert, requestLocal } = require("./_helpers");

function restoreEnv(snapshot) {
  if (snapshot.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = snapshot.AUTH_MODE;
  if (snapshot.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = snapshot.JWT_SECRET;
  if (snapshot.SECRET_KEY === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = snapshot.SECRET_KEY;
}

async function run() {
  const snapshot = {
    AUTH_MODE: process.env.AUTH_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    SECRET_KEY: process.env.SECRET_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };

  try {
    process.env.AUTH_MODE = "on";
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.SECRET_KEY = "1".repeat(64);
    const serverOn = createApiServer();
    const onHandler = serverOn.listeners("request")[0];

    const healthzRes = await requestLocal(onHandler, { method: "GET", url: "/healthz" });
    assert(healthzRes.statusCode === 200, "/healthz should be public");

    const projects401 = await requestLocal(onHandler, { method: "GET", url: "/api/projects" });
    assert(projects401.statusCode === 401, "/api/projects should require auth when AUTH_MODE=on");

    process.env.AUTH_MODE = "off";
    delete process.env.JWT_SECRET;
    delete process.env.SECRET_KEY;
    const serverOff = createApiServer();
    const offHandler = serverOff.listeners("request")[0];
    const projects200 = await requestLocal(offHandler, { method: "GET", url: "/api/projects" });
    assert(projects200.statusCode === 200, "/api/projects should be accessible when AUTH_MODE=off");

    process.env.AUTH_MODE = "on";
    delete process.env.JWT_SECRET;
    process.env.SECRET_KEY = "1".repeat(64);
    let jwtRejected = false;
    try {
      createApiServer();
    } catch (error) {
      jwtRejected = /JWT_SECRET/.test(String(error && error.message));
    }
    assert(jwtRejected, "createApiServer should reject invalid JWT_SECRET when AUTH_MODE=on");

    process.env.JWT_SECRET = "x".repeat(32);
    process.env.SECRET_KEY = "short";
    let secretRejected = false;
    try {
      createApiServer();
    } catch (error) {
      secretRejected = /SECRET_KEY/.test(String(error && error.message));
    }
    assert(secretRejected, "createApiServer should reject invalid SECRET_KEY when AUTH_MODE=on");

    process.env.AUTH_MODE = "off";
    process.env.NODE_ENV = "production";
    let prodOffRejected = false;
    try {
      createApiServer();
    } catch (error) {
      prodOffRejected = /AUTH_MODE=off/.test(String(error && error.message));
    }
    assert(prodOffRejected, "createApiServer should reject AUTH_MODE=off in production");
  } finally {
    restoreEnv(snapshot);
    if (snapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = snapshot.NODE_ENV;
  }
}

module.exports = { run };
