const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { createPullRequestMinimal } = require("../../github/pr");
const { updateRunTrace } = require("../../db/runTrace");
const { parseRunIdInput } = require("../../api/runs");

async function handleGithubPrCreate(req, res) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, "VALIDATION_ERROR", "JSONが不正です", {
      failure_code: "validation_error",
    });
  }

  try {
    let internalRunId = "";
    const runIdInput = typeof body.run_id === "string" && body.run_id.trim() ? body.run_id.trim() : "";
    if (runIdInput) {
      const parsed = parseRunIdInput(runIdInput);
      if (!parsed.ok) {
        return jsonError(res, parsed.status || 400, parsed.code || "VALIDATION_ERROR", parsed.message || "run_id format is invalid", parsed.details || { failure_code: "validation_error" });
      }
      internalRunId = parsed.internalId;
    }
    const result = await createPullRequestMinimal(body || {});
    if (internalRunId && result && !result.dry_run) {
      updateRunTrace({
        runId: internalRunId,
        githubPrUrl: result.pr_url || null,
        githubPrNumber: result.pr_number || null,
      });
    }
    return sendJson(res, 201, result);
  } catch (error) {
    return jsonError(res, error.status || 500, "VALIDATION_ERROR", error.message || "github pr failed", {
      failure_code: error.failure_code || "service_unavailable",
      reason: error.reason || null,
    });
  }
}

module.exports = {
  handleGithubPrCreate,
};
