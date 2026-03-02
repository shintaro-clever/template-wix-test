const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readJsonBody, sendJson, jsonError } = require("../../api/projects");
const { validateJob } = require("../../jobSpec");
const { createPlanWriter } = require("../../plans/writer");
const { readIngestArtifact, buildPlan, buildJobFromPlan } = require("../../plans/figmaToJob");
const { generatePatchFromJob } = require("../../ai/generatePatch");
const { writePatchArtifact } = require("../../patch/format");
let updateRunTrace = null;
try {
  ({ updateRunTrace } = require("../../db/runTrace"));
} catch {
  updateRunTrace = null;
}

function writeJobArtifact(runId, job) {
  const relativePath = `.ai-runs/${runId}/job.json`;
  const absolutePath = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(job, null, 2), "utf8");
  return relativePath;
}

async function handleJobsFromFigma(req, res) {
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

  const runId = typeof body.run_id === "string" && body.run_id.trim() ? body.run_id.trim() : crypto.randomUUID();
  const ingestPath = typeof body.ingest_artifact_path === "string" ? body.ingest_artifact_path.trim() : "";
  const writer = createPlanWriter(runId);

  const basePlan = {
    run_id: runId,
    source: "figma",
    status: "running",
    ingest_artifact_path: ingestPath || null,
    generated_at: new Date().toISOString(),
  };
  writer.writePlan(basePlan);
  writer.appendLog("plan generation started");

  try {
    if (!ingestPath) {
      throw new Error("ingest_artifact_path is required");
    }
    const ingest = readIngestArtifact(ingestPath);
    const plan = buildPlan({
      runId,
      ingestArtifactPath: ingest.relativePath,
      payload: ingest.payload,
    });
    const figmaFileKey =
      typeof ingest.payload?.figma_file_key === "string" && ingest.payload.figma_file_key.trim()
        ? ingest.payload.figma_file_key.trim()
        : null;
    if (typeof updateRunTrace === "function") {
      updateRunTrace({
        runId,
        ingestArtifactPath: ingest.relativePath,
        figmaFileKey,
      });
    }
    writer.writePlan(plan);
    writer.appendLog("plan generated");

    const job = buildJobFromPlan(plan);
    const validation = validateJob(job);
    if (!validation.ok) {
      const error = new Error(`job validation failed: ${validation.errors.join("; ")}`);
      error.status = 400;
      error.failure_code = "validation_error";
      throw error;
    }
    const jobPath = writeJobArtifact(runId, job);
    writer.appendLog("job generated");

    const generated = generatePatchFromJob({ runId, job, plan });
    const patchArtifact = writePatchArtifact(runId, generated.patch);
    writer.appendLog("patch artifact generated");

    return sendJson(res, 201, {
      run_id: runId,
      plan_path: `.ai-runs/${runId}/plan.json`,
      plan_log_path: `.ai-runs/${runId}/plan.log`,
      job_path: jobPath,
      patch_path: patchArtifact.relative_path,
      patch_target_path: generated.target_path,
    });
  } catch (error) {
    const failedPlan = {
      ...basePlan,
      status: "error",
      error: error.message,
      failed_at: new Date().toISOString(),
    };
    writer.writePlan(failedPlan);
    writer.appendLog(`plan generation failed: ${error.message}`);
    return jsonError(res, error.status || 500, "VALIDATION_ERROR", error.message || "job generation failed", {
      failure_code: error.failure_code || "service_unavailable",
      plan_path: `.ai-runs/${runId}/plan.json`,
      plan_log_path: `.ai-runs/${runId}/plan.log`,
    });
  }
}

module.exports = {
  handleJobsFromFigma,
};
