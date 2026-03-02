const fs = require("fs");
const path = require("path");

function readIngestArtifact(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized.startsWith("vault/tmp/") || normalized.includes("..")) {
    const error = new Error("ingest_artifact_path must be under vault/tmp/");
    error.status = 400;
    error.failure_code = "validation_error";
    throw error;
  }
  const absolute = path.resolve(process.cwd(), normalized);
  if (!fs.existsSync(absolute)) {
    const error = new Error("ingest artifact not found");
    error.status = 404;
    error.failure_code = "not_found";
    throw error;
  }
  const ext = path.extname(absolute).toLowerCase();
  let payload = {};
  if (ext === ".json") {
    try {
      payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
    } catch {
      payload = {};
    }
  }
  return { ext, payload, relativePath: normalized };
}

function buildPlan({ runId, ingestArtifactPath, payload }) {
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Figma Ingest Plan";
  return {
    run_id: runId,
    source: "figma",
    status: "ok",
    ingest_artifact_path: ingestArtifactPath,
    generated_at: new Date().toISOString(),
    summary: title,
    steps: [
      "Read ingest artifact",
      "Generate repo patch job",
      "Emit patch artifact"
    ],
  };
}

function buildJobFromPlan(plan) {
  return {
    job_type: "integration_hub.phase2.repo_patch",
    goal: "Apply generated patch from Figma ingest",
    inputs: {
      message: "figma ingest to patch",
      target_path: ".ai-runs/{{run_id}}/repo_patch_report.json",
      instruction: `Apply figma-derived change: ${plan.summary}`,
      allowed_paths: ["vault/tmp/", ".ai-runs/"],
      ingest_artifact_path: plan.ingest_artifact_path,
    },
    constraints: {
      allowed_paths: ["vault/tmp/", ".ai-runs/"],
      max_files_changed: 5,
      no_destructive_ops: true,
    },
    acceptance_criteria: ["patch artifact is generated", "plan artifact is generated"],
    provenance: {
      issue: "",
      operator: "operator",
    },
    run_mode: "mcp",
    output_language: "ja",
    expected_artifacts: [
      { name: "generated.patch", description: "generated unified patch" },
      { name: "plan.json", description: "plan output" },
    ],
  };
}

module.exports = {
  readIngestArtifact,
  buildPlan,
  buildJobFromPlan,
};
