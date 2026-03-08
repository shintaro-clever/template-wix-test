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

    // Create a test project
    const createRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({
        name: "man2-bindings-test",
        staging_url: "https://example.com",
      }),
    });
    assert(createRes.statusCode === 201, `project create should return 201, got ${createRes.statusCode}`);
    const project = JSON.parse(createRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project.id should be public project ID");
    createdProjectIds.push(parsedProject.internalId);
    const pid = project.id;

    // 1. GET /api/projects/:id/connections → default (enabled:false x3)
    const connGet1 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/connections`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(connGet1.statusCode === 200, `GET connections should return 200, got ${connGet1.statusCode}`);
    const connData1 = JSON.parse(connGet1.body.toString("utf8"));
    assert(connData1.project_id === pid, "project_id should match");
    assert(Array.isArray(connData1.items), "items should be array");
    assert(connData1.items.length === 3, "default should have 3 items");
    assert(connData1.items.every((i) => i.enabled === false), "all default items should be disabled");

    // 2. PUT /api/projects/:id/connections 正常系 → 200 + 保存
    const connPut1 = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/connections`,
      headers: authz,
      body: JSON.stringify({
        items: [
          { key: "ai", enabled: true },
          { key: "github", enabled: false },
          { key: "figma", enabled: true },
        ],
      }),
    });
    assert(connPut1.statusCode === 200, `PUT connections should return 200, got ${connPut1.statusCode}`);
    const connPutData1 = JSON.parse(connPut1.body.toString("utf8"));
    assert(connPutData1.project_id === pid, "project_id should match after PUT");
    assert(connPutData1.items.find((i) => i.key === "ai").enabled === true, "ai should be enabled");
    assert(connPutData1.items.find((i) => i.key === "github").enabled === false, "github should be disabled");
    assert(connPutData1.items.find((i) => i.key === "figma").enabled === true, "figma should be enabled");

    // 3. PUT → GET round-trip
    const connGet2 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/connections`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(connGet2.statusCode === 200, `GET connections round-trip should return 200`);
    const connData2 = JSON.parse(connGet2.body.toString("utf8"));
    assert(connData2.items.find((i) => i.key === "ai").enabled === true, "round-trip: ai should be enabled");
    assert(connData2.items.find((i) => i.key === "figma").enabled === true, "round-trip: figma should be enabled");

    // 4. PUT unknown key → 400 validation_error
    const connPutBadKey = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/connections`,
      headers: authz,
      body: JSON.stringify({
        items: [{ key: "unknown_provider", enabled: true }],
      }),
    });
    assert(connPutBadKey.statusCode === 400, `PUT unknown key should return 400, got ${connPutBadKey.statusCode}`);

    // 5. PUT duplicate key → 400 validation_error
    const connPutDupKey = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/connections`,
      headers: authz,
      body: JSON.stringify({
        items: [
          { key: "ai", enabled: true },
          { key: "ai", enabled: false },
        ],
      }),
    });
    assert(connPutDupKey.statusCode === 400, `PUT duplicate key should return 400, got ${connPutDupKey.statusCode}`);

    // 6. GET /api/projects/:id/drive → default values
    const driveGet1 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/drive`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(driveGet1.statusCode === 200, `GET drive should return 200, got ${driveGet1.statusCode}`);
    const driveData1 = JSON.parse(driveGet1.body.toString("utf8"));
    assert(driveData1.project_id === pid, "drive project_id should match");
    assert(driveData1.folder_id === "", "default folder_id should be empty string");
    assert(driveData1.folder_url === "", "default folder_url should be empty string");
    assert(driveData1.enabled === false, "default enabled should be false");

    // 7. PUT /api/projects/:id/drive 正常系 → 200 + 保存
    const drivePut1 = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${pid}/drive`,
      headers: authz,
      body: JSON.stringify({
        folder_id: "test-folder-123",
        folder_url: "https://drive.google.com/drive/folders/test-folder-123",
        enabled: true,
      }),
    });
    assert(drivePut1.statusCode === 200, `PUT drive should return 200, got ${drivePut1.statusCode}`);
    const drivePutData1 = JSON.parse(drivePut1.body.toString("utf8"));
    assert(drivePutData1.folder_id === "test-folder-123", "folder_id should be saved");
    assert(drivePutData1.enabled === true, "enabled should be true");

    // 8. PUT → GET round-trip
    const driveGet2 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${pid}/drive`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(driveGet2.statusCode === 200, `GET drive round-trip should return 200`);
    const driveData2 = JSON.parse(driveGet2.body.toString("utf8"));
    assert(driveData2.folder_id === "test-folder-123", "round-trip: folder_id should match");
    assert(driveData2.enabled === true, "round-trip: enabled should be true");

    // 9. project not found → 404 (GET + PUT)
    const fakeId = `project_${crypto.randomUUID()}`;
    const connGet404 = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${fakeId}/connections`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(connGet404.statusCode === 404, `GET connections for missing project should return 404, got ${connGet404.statusCode}`);

    const drivePut404 = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${fakeId}/drive`,
      headers: authz,
      body: JSON.stringify({ folder_id: "x" }),
    });
    assert(drivePut404.statusCode === 404, `PUT drive for missing project should return 404, got ${drivePut404.statusCode}`);

    // 10. /api/connections (global) is not broken
    const globalConn = await requestLocal(handler, {
      method: "GET",
      url: "/api/connections",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(globalConn.statusCode === 200, `GET /api/connections should still return 200, got ${globalConn.statusCode}`);
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
