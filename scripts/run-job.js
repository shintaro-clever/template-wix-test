#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
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

function applyRepoPatch(targetPath, instruction, allowHtmlComment = false) {
  const absolute = path.join(process.cwd(), targetPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`target_path not found: ${targetPath}`);
  }
  const original = fs.readFileSync(absolute, 'utf8');
  if (allowHtmlComment) {
    const note = `<!-- repo_patch (${new Date().toISOString()}) ${instruction} -->`;
    const updated = original.endsWith('\n') ? `${original}${note}\n` : `${original}\n${note}\n`;
    fs.writeFileSync(absolute, updated, 'utf8');
    return { note, original };
  }
  const note = `repo_patch noop: would append comment "${instruction}" to ${targetPath}`;
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
    const allowComment = job.inputs && job.inputs.allow_html_comment === true;
    const { note } = applyRepoPatch(targetPath, job.inputs.instruction, allowComment);
    const noop = typeof note === 'string' && note.startsWith('repo_patch noop:');
    const summary = noop ? note : `Repo patch applied to ${targetPath}`;
    const checkReason = noop ? note : 'instruction applied';
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
      diff_summary: summary,
      checks: [{ id: 'repo_patch', ok: true, reason: checkReason }],
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

function checkCommandAvailability(command) {
  try {
    const result = execSync(`command -v ${command}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (error) {
    return null;
  }
}

function maskEnvValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'NOT_SET';
  }
  return 'SET';
}

async function executeDiagnosticsJob(jobPayload) {
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
    const logs = [];
    const checks = [];
    let hasBlockingFailure = false;

    function pushCheck(id, ok, reason, importance = 'optional') {
      checks.push({ id, ok, reason });
      if (!ok && importance === 'required') {
        hasBlockingFailure = true;
      }
    }

    const nodeVersion = process.version || 'unknown';
    logs.push(`Node.js バージョン: ${nodeVersion}`);
    pushCheck('node_version', nodeVersion !== 'unknown', `process.version=${nodeVersion}`, 'required');

    const commandTargets = [
      { name: 'node', importance: 'required' },
      { name: 'npx', importance: 'required' },
      { name: 'git', importance: 'required' },
      { name: 'php', importance: 'optional' },
      { name: 'claude', importance: 'optional' },
      { name: 'codex', importance: 'optional' }
    ];

    const commandReport = {};
    commandTargets.forEach((entry) => {
      const pathResult = checkCommandAvailability(entry.name);
      const found = Boolean(pathResult);
      commandReport[entry.name] = pathResult || 'NOT_FOUND';
      if (found) {
        logs.push(`${entry.name} コマンド: ${pathResult}`);
        pushCheck(`cmd_${entry.name}`, true, `${entry.name} コマンド検出: ${pathResult}`, entry.importance);
      } else {
        logs.push(`${entry.name} コマンド未検出`);
        const message =
          entry.importance === 'required'
            ? `${entry.name} コマンドが見つかりません`
            : `${entry.name} コマンドは任意ですが見つかりませんでした`;
        pushCheck(`cmd_${entry.name}`, false, message, entry.importance);
      }
    });

    const envTargets = [
      { name: 'OPENAI_API_KEY', importance: 'required' },
      { name: 'ANTHROPIC_API_KEY', importance: 'optional' }
    ];
    const envReport = {};
    envTargets.forEach((entry) => {
      const key = entry.name;
      const masked = maskEnvValue(process.env[key]);
      envReport[key] = masked;
      logs.push(`環境変数 ${key}: ${masked}`);
      const ok = masked === 'SET';
      pushCheck(`env_${key.toLowerCase()}`, ok, `環境変数 ${key}: ${masked}`, entry.importance);
    });

    const artifactPath = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(artifactPath, job.constraints.allowed_paths);
    writeJsonArtifact(artifactPath, {
      generated_at: new Date().toISOString(),
      node_version: nodeVersion,
      commands: commandReport,
      env: envReport
    });

    const result = {
      status: hasBlockingFailure ? 'error' : 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: 'Diagnostics completed',
      checks,
      logs
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'diagnostics', ok: false, reason: error.message }],
      logs: ['diagnostics failed']
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
  } else if (jobType === 'integration_hub.phase2.diagnostics') {
    result = await executeDiagnosticsJob(jobPayload);
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
