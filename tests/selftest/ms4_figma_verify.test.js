const nock = require("nock");
const { assert } = require("./_helpers");
const { mapFigmaVerifyError, verifyFigmaConnection } = require("../../src/routes/connections");

async function run() {
  nock("https://api.figma.com")
    .get("/v1/files/rate-limited")
    .reply(429, { err: "Too many requests" });
  try {
    await verifyFigmaConnection({ token: "t", file_key: "rate-limited" });
    assert(false, "429 should throw");
  } catch (error) {
    const mapped = mapFigmaVerifyError(error);
    assert(mapped.failure_code === "rate_limit", "429 should map to rate_limit");
  }
  nock.cleanAll();

  nock("https://api.figma.com")
    .get("/v1/files/plan-limited")
    .reply(403, { message: "Starter plan monthly limit reached (6 per month)" });
  try {
    await verifyFigmaConnection({ token: "t", file_key: "plan-limited" });
    assert(false, "403 plan limit should throw");
  } catch (error) {
    const mapped = mapFigmaVerifyError(error);
    assert(
      mapped.failure_code === "plan_limit_exceeded",
      "403 + plan message should map to plan_limit_exceeded"
    );
  }
  nock.cleanAll();

  nock("https://api.figma.com")
    .get("/v1/files/missing-file")
    .reply(404, { err: "Not found" });
  try {
    await verifyFigmaConnection({ token: "t", file_key: "missing-file" });
    assert(false, "404 should throw");
  } catch (error) {
    const mapped = mapFigmaVerifyError(error);
    assert(mapped.failure_code === "not_found", "404 should map to not_found");
  }
  nock.cleanAll();
}

module.exports = { run };
