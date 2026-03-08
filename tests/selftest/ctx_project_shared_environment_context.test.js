const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createApiServer } = require("../../src/server/apiApp");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { KINDS, parsePublicIdFor } = require("../../src/id/publicIds");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const prevAuthMode = process.env.AUTH_MODE;
  const prevJwt = process.env.JWT_SECRET;
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.AUTH_MODE = "on";
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const createdProjectIds = [];
  const createdThreadIds = [];
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

    const createProjectRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/projects",
      headers: authz,
      body: JSON.stringify({ name: "ctx-shared-env-test", staging_url: "https://example.com" }),
    });
    assert(createProjectRes.statusCode === 201, "project create should return 201");
    const project = JSON.parse(createProjectRes.body.toString("utf8"));
    const parsedProject = parsePublicIdFor(KINDS.project, project.id);
    assert(parsedProject.ok, "project id should be public project id");
    createdProjectIds.push(parsedProject.internalId);

    const putSettingsRes = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "octocat/hello-world",
        figma_file: "https://www.figma.com/file/abc123/Design",
        drive_url: "https://drive.google.com/drive/folders/folder123",
      }),
    });
    assert(putSettingsRes.statusCode === 200, "project settings put should return 200");

    const createRunRes = await requestLocal(handler, {
      method: "POST",
      url: "/api/runs",
      headers: authz,
      body: JSON.stringify({
        job_type: "integration_hub.phase1.code_to_figma_from_url",
        target_path: ".ai-runs/{{run_id}}/ctx-check.json",
        project_id: project.id,
        inputs: { page_url: "https://example.com" },
      }),
    });
    assert(createRunRes.statusCode === 201, "runs create should return 201");
    const createdRun = JSON.parse(createRunRes.body.toString("utf8"));
    const parsedRun = parsePublicIdFor(KINDS.run, createdRun.run_id);
    assert(parsedRun.ok, "run id should be public run id");
    createdRunIds.push(parsedRun.internalId);

    const runDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailRes.statusCode === 200, "run detail should return 200");
    const runDetail = JSON.parse(runDetailRes.body.toString("utf8"));
    assert(runDetail.inputs && runDetail.inputs.shared_environment, "run inputs should include shared_environment");
    assert(runDetail.context_used && runDetail.context_used.shared_environment, "run detail should include context_used.shared_environment");
    assert(runDetail.inputs.shared_environment.github_repository === "octocat/hello-world", "run should include github_repository");
    assert(runDetail.inputs.shared_environment.figma_file.includes("figma.com"), "run should include figma_file");
    assert(runDetail.inputs.shared_environment.drive_url.includes("drive.google.com"), "run should include drive_url");
    assert(runDetail.context_used.shared_environment.github_repository === "octocat/hello-world", "context_used should include github_repository");

    const putSettingsRes2 = await requestLocal(handler, {
      method: "PUT",
      url: `/api/projects/${project.id}/settings`,
      headers: authz,
      body: JSON.stringify({
        github_repository: "acme/new-repo",
        figma_file: "https://www.figma.com/file/new123/NextDesign",
        drive_url: "https://drive.google.com/drive/folders/new-folder",
      }),
    });
    assert(putSettingsRes2.statusCode === 200, "project settings second put should return 200");

    const runDetailAfterUpdateRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${createdRun.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(runDetailAfterUpdateRes.statusCode === 200, "run detail after settings update should return 200");
    const runDetailAfterUpdate = JSON.parse(runDetailAfterUpdateRes.body.toString("utf8"));
    assert(
      runDetailAfterUpdate.context_used.shared_environment.github_repository === "octocat/hello-world",
      "existing run context should remain as execution-time snapshot"
    );

    const workspaceRes = await requestLocal(handler, {
      method: "POST",
      url: `/api/projects/${project.id}/workspace/messages`,
      headers: authz,
      body: JSON.stringify({ content: "ctx test message" }),
    });
    assert(workspaceRes.statusCode === 201, "workspace message should return 201");
    const workspaceBody = JSON.parse(workspaceRes.body.toString("utf8"));
    const parsedWorkspaceRun = parsePublicIdFor(KINDS.run, workspaceBody.run_id);
    const parsedThread = parsePublicIdFor(KINDS.thread, workspaceBody.thread_id);
    assert(parsedWorkspaceRun.ok, "workspace run id should be public run id");
    assert(parsedThread.ok, "workspace thread id should be public thread id");
    createdRunIds.push(parsedWorkspaceRun.internalId);
    createdThreadIds.push(parsedThread.internalId);

    const workspaceRunDetailRes = await requestLocal(handler, {
      method: "GET",
      url: `/api/runs/${workspaceBody.run_id}`,
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    assert(workspaceRunDetailRes.statusCode === 200, "workspace run detail should return 200");
    const workspaceRunDetail = JSON.parse(workspaceRunDetailRes.body.toString("utf8"));
    assert(
      workspaceRunDetail.inputs && workspaceRunDetail.inputs.shared_environment,
      "workspace run inputs should include shared_environment"
    );
    assert(
      workspaceRunDetail.context_used && workspaceRunDetail.context_used.shared_environment,
      "workspace run should include context_used.shared_environment"
    );
    assert(
      workspaceRunDetail.inputs.shared_environment.github_repository === "acme/new-repo",
      "workspace run should include latest github_repository"
    );
    assert(
      workspaceRunDetail.inputs.shared_environment.figma_file.includes("new123"),
      "workspace run should include latest figma_file"
    );
    assert(
      workspaceRunDetail.inputs.shared_environment.drive_url.includes("new-folder"),
      "workspace run should include latest drive_url"
    );
    assert(
      workspaceRunDetail.context_used.shared_environment.github_repository === "acme/new-repo",
      "workspace run context_used should include latest github_repository"
    );
  } finally {
    createdThreadIds.forEach((id) => {
      db.prepare("DELETE FROM thread_messages WHERE tenant_id=? AND thread_id=?").run(DEFAULT_TENANT, id);
      db.prepare("DELETE FROM project_threads WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, id);
    });
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
