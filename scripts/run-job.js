#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateJob } = require('../src/jobSpec');
const { run: runAdapter } = require('../src/runnerAdapter');

const SCHEMA_VERSION = 'phase2/v1';

function parseArgs(argv) {
  const args = { role: 'operator' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--job' && argv[i + 1]) {
      args.job = argv[i + 1];
      i += 1;
    } else if (arg === '--role' && argv[i + 1]) {
      args.role = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function cloneJob(job) {
  return JSON.parse(JSON.stringify(job || {}));
}

function normalizeRelativePath(rawPath) {
  const normalized = path.posix.normalize(String(rawPath || '').replace(/\\/g, '/'));
  if (normalized.startsWith('..')) {
    throw new Error('path must stay under workspace');
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error('path must be relative');
  }
  return normalized.replace(/^\.\//, '');
}

function ensureAllowedPath(target, allowed) {
  const ok = Array.isArray(allowed) && allowed.some((prefix) => target.startsWith(prefix));
  if (!ok) {
    throw new Error(`target_path ${target} outside allowed_paths`);
  }
}

function ensureRunDirectory(runId) {
  const baseDir = path.join(process.cwd(), '.ai-runs', runId);
  fs.mkdirSync(baseDir, { recursive: true });
  return {
    baseDir,
    runId,
    runJson: path.join(baseDir, 'run.json'),
    audit: path.join(baseDir, 'audit.jsonl')
  };
}

function appendAudit(runPaths, event) {
  fs.appendFileSync(runPaths.audit, `${JSON.stringify(event)}\n`);
}

function summarizeChecks(checks = []) {
  const failing = checks.filter((c) => c && c.ok === false).map((c) => c.id || 'unknown');
  return {
    total: checks.length,
    passed: checks.length - failing.length,
    failing
  };
}

function finalizeRun(runPaths, job, runnerResult, createdAt) {
  const summary = summarizeChecks(runnerResult.checks || []);
  const payload = {
    job,
    runnerResult: {
      ...runnerResult,
      checks_summary: summary
    },
    meta: {
      schema_version: SCHEMA_VERSION,
      created_at: createdAt
    }
  };
  fs.writeFileSync(runPaths.runJson, JSON.stringify(payload, null, 2));
  appendAudit(runPaths, {
    event: 'RUN_END',
    ts: new Date().toISOString(),
    run_id: runPaths.runId,
    schema_version: SCHEMA_VERSION,
    status: runnerResult.status,
    checks_summary: summary
  });
  return runnerResult;
}

function recordRunStart(runPaths, job) {
  appendAudit(runPaths, {
    event: 'RUN_START',
    ts: new Date().toISOString(),
    run_id: runPaths.runId,
    schema_version: SCHEMA_VERSION,
    job_type: job.job_type,
    allowed_paths: (job.constraints && job.constraints.allowed_paths) || []
  });
}

function buildValidationFailure(errors) {
  return {
    status: 'error',
    errors,
    checks: errors.map((reason, idx) => ({ id: `job_spec_${idx + 1}`, ok: false, reason })),
    logs: ['job validation failed']
  };
}

function resolveTargetPath(template, runId) {
  const replaced = String(template).replace(/{{\s*run_id\s*}}/gi, runId);
  const normalized = normalizeRelativePath(replaced);
  if (!normalized.startsWith('.ai-runs/')) {
    throw new Error('target_path must resolve under .ai-runs/');
  }
  return normalized;
}

function writeJsonArtifact(relativePath, payload) {
  const absolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2));
  return relativePath;
}

function applyDocsInstruction(docPath, instruction) {
  const absolute = path.join(process.cwd(), docPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`doc_path not found: ${docPath}`);
  }
  const original = fs.readFileSync(absolute, 'utf8');
  const note = `> NOTE (${new Date().toISOString()}): ${instruction}`;
  const updated = original.endsWith('\n') ? `${original}${note}\n` : `${original}\n${note}\n`;
  fs.writeFileSync(absolute, updated, 'utf8');
  return note;
}

function applyRepoPatch(targetPath, instruction) {
  const absolute = path.join(process.cwd(), targetPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`target_path not found: ${targetPath}`);
  }
  const original = fs.readFileSync(absolute, 'utf8');
  const note = `<!-- repo_patch (${new Date().toISOString()}) ${instruction} -->`;
  const updated = original.endsWith('\n') ? `${original}${note}\n` : `${original}\n${note}\n`;
  fs.writeFileSync(absolute, updated, 'utf8');
  return { note, original };
}

async function executeDocsUpdateJob(jobPayload) {
  const job = cloneJob(jobPayload);
  job.constraints.max_files_changed = 1;
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const runPaths = ensureRunDirectory(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const docPath = normalizeRelativePath(job.inputs.doc_path);
    if (!docPath.startsWith('docs/')) {
      throw new Error('doc_path must stay under docs/');
    }
    ensureAllowedPath(docPath, job.constraints.allowed_paths);
    const note = applyDocsInstruction(docPath, job.inputs.instruction);
    const artifactPath = `.ai-runs/${runId}/docs_update_report.json`;
    writeJsonArtifact(artifactPath, {
      doc_path: docPath,
      instruction: job.inputs.instruction,
      note,
      updated_at: new Date().toISOString()
    });
    const result = {
      status: 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: `Docs updated at ${docPath}`,
      checks: [{ id: 'docs_update', ok: true, reason: 'instruction applied' }],
      logs: [`doc_path=${docPath}`]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'docs_update', ok: false, reason: error.message }],
      logs: ['docs_update failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeRepoPatchJob(jobPayload) {
  const job = cloneJob(jobPayload);
  job.constraints.max_files_changed = 1;
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const runPaths = ensureRunDirectory(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const targetPath = normalizeRelativePath(job.inputs.target_path);
    ensureAllowedPath(targetPath, job.inputs.allowed_paths || job.constraints.allowed_paths);
    const { note } = applyRepoPatch(targetPath, job.inputs.instruction);
    const artifactPath = `.ai-runs/${runId}/repo_patch_report.json`;
    writeJsonArtifact(artifactPath, {
      target_path: targetPath,
      instruction: job.inputs.instruction,
      note,
      updated_at: new Date().toISOString()
    });
    const result = {
      status: 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: `Repo patch applied to ${targetPath}`,
      checks: [{ id: 'repo_patch', ok: true, reason: 'instruction applied' }],
      logs: [`target_path=${targetPath}`]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'repo_patch', ok: false, reason: error.message }],
      logs: ['repo_patch failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeMcpJob(jobPayload, role) {
  const job = cloneJob(jobPayload);
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const runPaths = ensureRunDirectory(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const resolvedTarget = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(resolvedTarget, job.constraints.allowed_paths);
    const runnerJob = cloneJob(job);
    runnerJob.inputs = runnerJob.inputs || {};
    runnerJob.inputs.target_path_resolved = resolvedTarget;
    const runnerResult = await runAdapter(runnerJob, { role });
    return finalizeRun(runPaths, job, runnerResult, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'mcp_exec', ok: false, reason: error.message }],
      logs: ['runner_adapter=mcp']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function main() {
  const { job, role } = parseArgs(process.argv);
  if (!job) {
    console.error('Usage: node scripts/run-job.js --job <path> [--role operator]');
    process.exit(1);
    return;
  }

  const jobPath = path.resolve(job);
  const jobPayload = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const jobType = jobPayload.job_type;
  let result;
  if (jobType === 'integration_hub.phase2.docs_update') {
    result = await executeDocsUpdateJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.repo_patch') {
    result = await executeRepoPatchJob(jobPayload);
  } else {
    result = await executeMcpJob(jobPayload, role);
  }
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
