const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "pset-model-test", staging_url: "https://example.com" }),
    });
    assert(createRes.statusCode === 201, `project create should return 201, got ${createRes.statusCode}`);
    const project = JSON.parse(createRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public project id");
    createdProjectIds.push(parsedProject.internalId);

    const detail1 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detail1.statusCode === 200, `project detail should return 200, got ${detail1.statusCode}`);
    const detail1Body = JSON.parse(detail1.body.toString("utf8"));
    assert(detail1Body.shared_environment, "project detail should include shared_environment");
    assert(detail1Body.shared_environment.github.repository === "", "default github repository should be empty");
    assert(detail1Body.shared_environment.figma.file === "", "default figma file should be empty");
    assert(detail1Body.shared_environment.drive.url === "", "default drive url should be empty");

    const putSettings = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        figma_file: "https://www.figma.com/file/abc123/Design",
        drive_url: "https://drive.google.com/drive/folders/folder123",
      }),
    });
    assert(putSettings.statusCode === 200, `settings put should return 200, got ${putSettings.statusCode}`);

    const detail2 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(detail2.statusCode === 200, `project detail after settings should return 200, got ${detail2.statusCode}`);
    const detail2Body = JSON.parse(detail2.body.toString("utf8"));
    assert(
      detail2Body.shared_environment.github.repository === "octocat/hello-world",
      "shared_environment.github.repository should be saved"
    );
    assert(
      detail2Body.shared_environment.figma.file === "https://www.figma.com/file/abc123/Design",
      "shared_environment.figma.file should be saved"
    );
    assert(
      detail2Body.shared_environment.drive.url === "https://drive.google.com/drive/folders/folder123",
      "shared_environment.drive.url should be saved"
    );
  } finally {
    createdProjectIds.forEach((id) => {
      db.prepare("DELETE FROM projects WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
    if (prevAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevAuthMode;
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
