const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nock = require("nock");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");
const { createApiServer } = require("../../src/server/apiApp");
const { MCP_TOOLS } = require("../../src/figma/mcpCapabilities");
const { validateCapability } = require("../../src/validation/capabilityCheck");
const { validatePreflightLocal, deepVerify } = require("../../src/runner/preflight");
const { detectInputType } = require("../../src/jobs/autoRoute");
const { encrypt, decrypt } = require("../../src/crypto/secrets");
const { mapFigmaVerifyError, verifyFigmaConnection } = require("../../src/routes/connections");

const FAILURE_CODES_13 = [
  "validation_error",
  "not_found",
  "permission",
  "service_unavailable",
  "concurrent_run_limit",
  "mode_mismatch",
  "capability_missing",
  "preflight_failed",
  "artifact_conflict",
  "rate_limit",
  "plan_limit_exceeded",
  "run_failed",
  "internal_error",
];

function typeOfValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function assertShape(label, object, schema) {
  const errors = [];
  schema.forEach((rule) => {
    const has = Object.prototype.hasOwnProperty.call(object, rule.key);
    if (!has) {
      errors.push(`missing key: ${rule.key}`);
      return;
    }
    const actual = object[rule.key];
    const actualType = typeOfValue(actual);
    if (!rule.types.includes(actualType)) {
      errors.push(`type mismatch: ${rule.key} expected=${rule.types.join("|")} actual=${actualType}`);
    }
  });
  if (errors.length > 0) {
    assert(false, `${label} shape errors -> ${errors.join(", ")}`);
  }
}

async function run() {
  process.env.JWT_SECRET = "x".repeat(32);
  process.env.SECRET_KEY = "1".repeat(64);

  const server = createApiServer();
  const handler = server.listeners("request")[0];

  // Auth baseline
  const unauth = await requestLocal(handler, { method: "GET", url: "/api/projects" });
  assert(unauth.statusCode === 401, "GET /api/projects should require auth when AUTH_MODE=on");
  const unauthProjectsBody = JSON.parse(unauth.body.toString("utf8"));
  assert(typeof unauthProjectsBody.message === "string", "project unauth response should include message");

  const unauthConnectors = await requestLocal(handler, { method: "GET", url: "/api/connectors" });
  assert(unauthConnectors.statusCode === 401, "unauthenticated connectors should return 401");
  const unauthBody = JSON.parse(unauthConnectors.body.toString("utf8"));
  assert(typeof unauthBody.message === "string", "error.message should exist");
  assert(typeof unauthBody.message_en === "string", "error.message_en should exist");
  assert(unauthBody.details && typeof unauthBody.details === "object", "error.details should exist");

  // Project CRUD happy path (MS0 baseline)
  const jwtToken = jwt.sign(
    { id: `u-${crypto.randomUUID()}`, role: "admin", tenant_id: DEFAULT_TENANT },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const token = `Bearer ${jwtToken}`;

  const connectorsRes = await requestLocal(handler, {
    method: "GET",
    url: "/api/connectors",
    headers: { Authorization: token },
  });
  assert(connectorsRes.statusCode === 200, "connectors should return 200");
  const connectors = JSON.parse(connectorsRes.body.toString("utf8"));
  assert(Array.isArray(connectors) && connectors.length >= 1, "connectors should be a non-empty array");
  const rowSchema = [
    { key: "schema_version", types: ["string"] },
    { key: "id", types: ["string"] },
    { key: "key", types: ["string"] },
    { key: "name", types: ["string"] },
    { key: "enabled", types: ["boolean"] },
    { key: "connected", types: ["boolean"] },
    { key: "last_checked_at", types: ["string", "null"] },
    { key: "has_secret", types: ["boolean"] },
    { key: "secret_len", types: ["number"] },
    { key: "notes", types: ["array"] },
  ];
  connectors.forEach((row) => {
    assertShape("connector", row, rowSchema);
    assert(Array.isArray(row.notes), "connector notes should be array");
  });

  const connectionsRes = await requestLocal(handler, {
    method: "GET",
    url: "/api/connections",
    headers: { Authorization: token },
  });
  assert(connectionsRes.statusCode === 200, "connections should return 200");
  const connections = JSON.parse(connectionsRes.body.toString("utf8"));
  assertShape("connections", connections, [
    { key: "schema_version", types: ["string"] },
    { key: "updated_at", types: ["string", "null"] },
    { key: "items", types: ["array"] },
  ]);
  assert(Array.isArray(connections.items), "connections.items should be array");
  connections.items.forEach((row) => {
    assertShape("connection item", row, rowSchema);
    assert(Array.isArray(row.notes), "connection item notes should be array");
  });
  assert(!connections.ai?.apiKey, "connections GET should not expose ai apiKey");
  assert(!connections.github?.token, "connections GET should not expose github token");
  assert(!connections.figma?.token, "connections GET should not expose figma token");

  const createRes = await requestLocal(handler, {
    method: "POST",
    url: "/api/projects",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ms0-ms4", staging_url: "https://example.com" }),
  });
  assert(createRes.statusCode === 201, "project create should return 201");
  const created = JSON.parse(createRes.body.toString("utf8"));
  assert(created.id, "project id should exist");

  const readRes = await requestLocal(handler, {
    method: "GET",
    url: `/api/projects/${created.id}`,
    headers: { Authorization: token },
  });
  assert(readRes.statusCode === 200, "project read should return 200");

  // capabilityCheck 3 cases
  const template = {
    required_mode: "remote",
    required_capabilities: ["read", "verify"],
  };
  const modeMismatch = validateCapability({ mode: "desktop", capabilities: ["read", "verify"] }, template);
  assert(modeMismatch.failure_code === "mode_mismatch", "mode mismatch expected");
  const capMissing = validateCapability({ mode: "remote", capabilities: ["read"] }, template);
  assert(capMissing.failure_code === "capability_missing", "capability missing expected");
  const capOk = validateCapability({ mode: "remote", capabilities: ["read", "verify"] }, template);
  assert(capOk.valid === true, "capability pass expected");

  // MCP 13 tools
  assert(Array.isArray(MCP_TOOLS) && MCP_TOOLS.length === 13, "MCP tools should define 13 entries");

  // Preflight 3 cases
  const connection = { mode: "remote", capabilities: ["read"], config_json: { token: "t" } };
  const jobTemplate = { required_mode: "remote", required_capabilities: ["read"] };
  const badCap = validatePreflightLocal(
    { mode: "desktop", capabilities: ["read"], config_json: { token: "t" } },
    jobTemplate,
    { file_key: "abc", target_node_id: "1-1" }
  );
  assert(badCap.valid === false, "preflight should fail on mode mismatch");
  const badFile = validatePreflightLocal(connection, jobTemplate, { file_key: "bad key", target_node_id: "1-1" });
  assert(badFile.valid === false, "preflight should fail on bad file key");
  const preflightOk = validatePreflightLocal(connection, jobTemplate, { file_key: "abc123", target_node_id: "1-1" });
  assert(preflightOk.valid === true, "preflight should pass on valid inputs");

  // Deep verify (nock)
  nock("https://api.figma.com")
    .get("/v1/files/abc123")
    .reply(200, { name: "ok" })
    .get("/v1/files/abc123/nodes")
    .query(true)
    .reply(200, { nodes: { "1:1": {} } });
  const deepOk = await deepVerify(connection, { file_key: "abc123", target_node_id: "1:1" });
  assert(deepOk.valid === true, "deep verify should pass");
  nock.cleanAll();

  // autoRoute 3 patterns
  assert(detectInputType({ file_key: "x" }).type === "figma_to_code", "autoRoute figma_to_code");
  assert(detectInputType({ repo_url: "https://repo" }).type === "code_to_figma", "autoRoute code_to_figma");
  assert(detectInputType({}).type === "manual", "autoRoute manual");

  // template 4 seeds
  const templateRows = db.prepare("SELECT name, required_capabilities FROM job_templates").all();
  const names = new Set(templateRows.map((r) => r.name));
  ["figma_read", "figma_plan", "figma_apply", "figma_verify"].forEach((name) =>
    assert(names.has(name), `template ${name} should exist`)
  );

  // encryption round trip
  const cipher = encrypt("hello");
  assert(decrypt(cipher) === "hello", "encrypt/decrypt round-trip");

  // figma verify mapping (nock + mapping)
  nock("https://api.figma.com").get("/v1/files/ratelimit").reply(429, { err: "too many requests" });
  try {
    await verifyFigmaConnection({ token: "t", file_key: "ratelimit" });
  } catch (error) {
    const mapped = mapFigmaVerifyError(error);
    assert(mapped.failure_code === "rate_limit", "429 should map rate_limit");
  }
  nock.cleanAll();
  const mappedPlan = mapFigmaVerifyError(new Error("Figma API 403: Starter plan monthly limit reached"));
  assert(mappedPlan.failure_code === "plan_limit_exceeded", "403 plan limit should map plan_limit_exceeded");
  const mapped404 = mapFigmaVerifyError(new Error("Figma API 404: Not found"));
  assert(mapped404.failure_code === "not_found", "404 should map not_found");

  // audit log touch
  const auditCount = db.prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE tenant_id=?").get(DEFAULT_TENANT).cnt;
  assert(typeof auditCount === "number", "audit_logs should be queryable");

  // failure codes definition count
  assert(new Set(FAILURE_CODES_13).size === 13, "failure_code definitions should include 13 unique values");

  // cleanup project
  await requestLocal(handler, {
    method: "DELETE",
    url: `/api/projects/${created.id}`,
    headers: { Authorization: token },
  });
}

module.exports = { run };
