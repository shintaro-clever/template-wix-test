const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { parsePublicIdFor, KINDS } = require("../../src/id/publicIds");
const { parseRunIdInput } = require("../../src/api/runs");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdRunIds = [];

  try {
    const server = createApiServer();
    const handler = server.listeners("request")[0];
    const jwtToken = jwt.sign(
      { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const authz = { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" };

    const createWithDrive = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({
        name: "man2-with-drive",
        description: "manual chapter2",
        staging_url: "https://example.com",
        drive_folder_id: "https://drive.google.com/drive/folders/1AbCdEfGhIJkLmNoPqRstu",
      }),
    });
    assert(createWithDrive.statusCode === 201, "project create with drive_folder_id should return 201");
    const projectWithDrive = JSON.parse(createWithDrive.body.toString("utf8"));
    const parsedWithDrive = parsePublicIdFor(KINDS.project, projectWithDrive.id);
    assert(parsedWithDrive.ok, "projectWithDrive.id should be public project ID");
    createdProjectIds.push(parsedWithDrive.internalId);
    assert(projectWithDrive.drive_folder_id === "1AbCdEfGhIJkLmNoPqRstu", "drive_folder_id should be normalized to ID");

    const readProject = await requestLocal(handler, {
      method: "GET",
      url: `/api/projects/${projectWithDrive.id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(readProject.statusCode === 200, "project detail should return 200");
    const readBody = JSON.parse(readProject.body.toString("utf8"));
    assert(readBody.drive_folder_id === "1AbCdEfGhIJkLmNoPqRstu", "drive_folder_id should persist");

    const createWithoutDrive = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({
        name: "man2-no-drive",
        staging_url: "https://example.com/no-drive",
      }),
    });
    assert(createWithoutDrive.statusCode === 201, "project create without drive should return 201");
    const projectWithoutDrive = JSON.parse(createWithoutDrive.body.toString("utf8"));
    const parsedWithoutDrive = parsePublicIdFor(KINDS.project, projectWithoutDrive.id);
    assert(parsedWithoutDrive.ok, "projectWithoutDrive.id should be public project ID");
    createdProjectIds.push(parsedWithoutDrive.internalId);

    const missingProjectRun = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        run_mode: "mcp",
        target_path: "vault/tmp",
        export_provider: "google_drive",
        google_native_type: "docs",
        thread_title: "manual-thread",
        inputs: {},
      }),
    });
    assert(missingProjectRun.statusCode === 400, "drive export should reject missing project_id");

    const noDriveProjectRun = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: parsedWithoutDrive.internalId,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        run_mode: "mcp",
        target_path: "vault/tmp",
        export_provider: "google_drive",
        google_native_type: "docs",
        thread_title: "manual-thread",
        inputs: {},
      }),
    });
    assert(noDriveProjectRun.statusCode === 400, "drive export should reject project without drive_folder_id");

    const runCreate = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        project_id: parsedWithDrive.internalId,
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        run_mode: "mcp",
        target_path: "vault/tmp",
        export_provider: "google_drive",
        google_native_type: "docs",
        thread_title: "manual-thread",
        inputs: { destination_folder_id: "SHOULD_NOT_BE_USED" },
      }),
    });
    assert(runCreate.statusCode === 201, "drive export should be accepted with configured project");
    const runPayload = JSON.parse(runCreate.body.toString("utf8"));
    const parsedRunId = parseRunIdInput(runPayload.run_id);
    assert(parsedRunId.ok, "run_id should be public run ID");
    createdRunIds.push(parsedRunId.internalId);

    const runDetail = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${runPayload.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetail.statusCode === 200, "run detail should return 200");
    const runRow = JSON.parse(runDetail.body.toString("utf8"));
    assert(runRow.inputs.export_provider === "google_drive", "export provider should be fixed to google_drive");
    assert(runRow.inputs.google_native_type === "docs", "google native type should be normalized");
    assert(runRow.inputs.drive_folder_id === "1AbCdEfGhIJkLmNoPqRstu", "destination should be project drive folder");
    assert(runRow.inputs.create_new_file === true, "drive export should always create new file");
    assert(
      /^manual-thread-\d{8}-\d{6}$/.test(runRow.inputs.output_name),
      "output name should be thread title + timestamp"
    );
  } finally {
    createdRunIds.forEach((id) => {
      db.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
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
