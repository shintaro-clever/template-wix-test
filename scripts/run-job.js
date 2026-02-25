#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { URLSearchParams } = require('url');
const { validateJob } = require('../src/jobSpec');
const { run: runAdapter } = require('../src/runnerAdapter');
const { callFigmaApi } = require('../src/figma/api');
const { applyCodexPrompt } = require('../src/codex/prompt');

const SCHEMA_VERSION = 'phase2/v1';
const ALLOWED_SPAWN_COMMANDS = new Set(['node', 'npx', 'git', 'php', 'codex']);
const SPAWN_ENV_ALLOWLIST = ['PATH', 'HOME', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const MAX_SPAWN_CAPTURE = 4000;
const CODEX_SHELL_WARNING = 'Shell snapshot validation failed';
const FIGMA_DEBUG_ENABLED = /^(1|true|yes)$/i.test(String(process.env.FIGMA_DEBUG || ''));
function formatFigmaRequestLog(label, debugInfo) {
  if (!FIGMA_DEBUG_ENABLED || !debugInfo) {
    return null;
  }
  const hasQuery = debugInfo.query && Object.keys(debugInfo.query).length > 0;
  const queryString = hasQuery ? `?${new URLSearchParams(debugInfo.query).toString()}` : '';
  return `figma_req[${label}]=${debugInfo.endpoint}${queryString}`;
}
const SCREEN_IGNORES = new Set([
  'node_modules',
  '.git',
  '.next',
  'out',
  'build',
  'dist',
  'coverage',
  '.ai-runs',
  '.turbo',
  'tmp'
]);
const SCREEN_PATTERNS_DESCRIPTION = [
  'next-app-router',
  'next-pages',
  'template',
  'react-route',
  'php-public'
].join(',');
const SCREEN_PATTERN_LIST = SCREEN_PATTERNS_DESCRIPTION.split(',');

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
  if (!runId || typeof runId !== 'string') {
    const error = new Error('invalid runId');
    error.code = 'INVALID_RUN_ID';
    throw error;
  }
  const baseDir = path.join(process.cwd(), '.ai-runs', runId);
  fs.mkdirSync(baseDir, { recursive: true });
  return {
    baseDir,
    runId,
    runJson: path.join(baseDir, 'run.json'),
    audit: path.join(baseDir, 'audit.jsonl')
  };
}

function createRunPathsOrExit(runId) {
  try {
    return ensureRunDirectory(runId);
  } catch (error) {
    const reason = error && (error.code || error.message) ? (error.code || error.message) : String(error);
    console.error(`run_dir_create_failed: ${reason}`);
    process.exit(1);
  }
}

function generateRunId() {
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  if (!/^[a-z0-9]+-[a-f0-9]+$/.test(id)) {
    const error = new Error('invalid runId');
    error.code = 'INVALID_RUN_ID';
    throw error;
  }
  return id;
}

function createRunIdOrExit() {
  try {
    return generateRunId();
  } catch (error) {
    const reason = error && (error.code || error.message) ? (error.code || error.message) : String(error);
    console.error(`run_dir_create_failed: ${reason}`);
    process.exit(1);
  }
}

function appendAudit(runPaths, event) {
  fs.appendFileSync(runPaths.audit, `${JSON.stringify(event)}\n`);
}

function writeJsonAtomic(targetPath, payload) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, targetPath);
}

function updateLatestOfflineSmoke({ runId, jobType, startedAt, finishedAt, status, summary }) {
  const runsRoot = path.join(process.cwd(), '.ai-runs');
  fs.mkdirSync(runsRoot, { recursive: true });
  const payload = {
    runId,
    job_type: jobType,
    startedAt,
    finishedAt,
    status,
    summary
  };
  const tmpPath = path.join(runsRoot, `.latest_offline_smoke.${process.pid}.${Date.now()}.tmp`);
  const targetPath = path.join(runsRoot, 'latest_offline_smoke.json');
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, targetPath);
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
  writeJsonAtomic(runPaths.runJson, payload);
  appendAudit(runPaths, {
    event: 'RUN_END',
    ts: new Date().toISOString(),
    run_id: runPaths.runId,
    schema_version: SCHEMA_VERSION,
    status: runnerResult.status,
    checks_summary: summary
  });
  return { ...runnerResult, run_id: runPaths.runId };
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

function extractFigmaFileKey(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('figma_design_url / figma_file_key が指定されていません');
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((segment) => segment === 'file' || segment === 'design');
    if (idx >= 0 && segments[idx + 1]) {
      return segments[idx + 1];
    }
    if (segments.length >= 1) {
      return segments[0];
    }
  } catch {
    // ignore
  }
  throw new Error('Figma ファイルキーを抽出できませんでした');
}

function normalizeRepoReference(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`;
      }
      return segments[0] || raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

function stripRouteGroup(segment) {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    return '';
  }
  return segment;
}

function convertDynamicSegment(segment) {
  const match = segment.match(/^\[(\.\.\.)?([^\]]+)\]$/);
  if (!match) {
    return segment;
  }
  const isCatchAll = Boolean(match[1]);
  const name = match[2];
  return isCatchAll ? `*${name}` : `:${name}`;
}

function deriveRouteFromPath(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  if (/^app\//.test(unixPath)) {
    const inner = unixPath.replace(/^app\//, '').replace(/\/page\.[^/]+$/i, '');
    const segments = inner
      .split('/')
      .map(stripRouteGroup)
      .filter(Boolean)
      .map(convertDynamicSegment);
    return `/${segments.join('/')}`.replace(/\/+/g, '/');
  }
  if (/^pages\//.test(unixPath)) {
    const inner = unixPath.replace(/^pages\//, '').replace(/\.[^/.]+$/, '');
    const segments = inner.split('/').map(convertDynamicSegment);
    return `/${segments.join('/')}`.replace(/\/+/g, '/');
  }
  if (/^(templates|resources\/views)\//.test(unixPath)) {
    return `/${unixPath.replace(/^(templates|resources\/views)\//, '').replace(/\.[^/.]+$/, '')}`;
  }
  if (/^src\/routes\//.test(unixPath)) {
    return `/${unixPath.replace(/^src\/routes\//, '').replace(/\.[^/.]+$/, '')}`;
  }
  return `/${unixPath.replace(/\.[^/.]+$/, '')}`;
}

function detectScreenPattern(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  if (/^app\/.+\/page\.(js|jsx|ts|tsx|mdx)$/i.test(unixPath)) {
    return 'next-app-router';
  }
  if (/^pages\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath)) {
    return 'next-pages';
  }
  if (/^(templates|resources\/views)\/.+\.(php|blade\.php|twig)$/i.test(unixPath)) {
    return 'template';
  }
  if (/^src\/routes\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath)) {
    return 'react-route';
  }
  if (/\/public\/.+\.php$/i.test(unixPath)) {
    return 'php-public';
  }
  return 'generic';
}

function isScreenCandidate(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  return (
    /^app\/.+\/page\.(js|jsx|ts|tsx|mdx)$/i.test(unixPath) ||
    /^pages\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath) ||
    /^(templates|resources\/views)\/.+\.(php|blade\.php|twig)$/i.test(unixPath) ||
    /^src\/routes\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath) ||
    /\/public\/.+\.php$/i.test(unixPath)
  );
}

function assignFramePositions(frames) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(frames.length)));
  const gapX = 480;
  const gapY = 360;
  return frames.map((frame, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...frame,
      position: { x: column * gapX, y: row * gapY }
    };
  });
}

function collectScreenCandidates(limit = 24, strategy = 'routes_first', rootDir = process.cwd()) {
  const results = [];
  function walk(currentDir, relative = '') {
    if (results.length >= limit) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SCREEN_IGNORES.has(entry.name)) {
          continue;
        }
        walk(
          path.join(currentDir, entry.name),
          relative ? `${relative}/${entry.name}` : entry.name
        );
      } else if (entry.isFile()) {
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (isScreenCandidate(relativePath)) {
          const route = deriveRouteFromPath(relativePath);
          const frameName = route === '/' ? 'home' : route.replace(/^\//, '');
          results.push({
            frame_name: frameName || relativePath,
            route,
            source_path: relativePath,
            pattern: detectScreenPattern(relativePath)
          });
          if (results.length >= limit) {
            return;
          }
        }
      }
    }
  }
  walk(rootDir, '');
  return assignFramePositions(results);
}

function buildFigmaCommentMessage({ pageName, frames, runId, repoRef }) {
  const header = `Hub Bootstrap "${pageName}" (run: ${runId}${repoRef ? ` / ${repoRef}` : ''})`;
  const lines = frames.slice(0, 10).map(
    (frame) => `• ${frame.route} (${frame.source_path}) [${frame.pattern}]`
  );
  if (frames.length > 10) {
    lines.push(`… and ${frames.length - 10} more`);
  }
  return `${header}\nFrames:\n${lines.join('\n')}`;
}

function resolveRepoRoot(repoLocalPath) {
  const resolved = repoLocalPath ? path.resolve(repoLocalPath) : process.cwd();
  if (!repoLocalPath) {
    return resolved;
  }
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    throw new Error(
      `repo_local_path "${repoLocalPath}" のディレクトリが見つかりません (root=${resolved}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `repo_local_path "${repoLocalPath}" はディレクトリではありません (root=${resolved}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`
    );
  }
  return resolved;
}

function normalizeManualFrames(manualFrames = []) {
  return manualFrames
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const name = entry.name || entry.frame_name || entry.route || `Frame ${index + 1}`;
      return {
        ...entry,
        frame_name: entry.frame_name || name,
        name,
        route: entry.route || `manual-${index + 1}`,
        source_path: entry.source_path || '(manual)',
        pattern: entry.pattern || 'manual'
      };
    })
    .filter(Boolean);
}

function ensureFramePositions(frames = []) {
  const fallback = assignFramePositions(frames);
  return frames.map((frame, index) => {
    const hasPosition =
      frame &&
      frame.position &&
      typeof frame.position.x === 'number' &&
      typeof frame.position.y === 'number';
    if (hasPosition) {
      return frame;
    }
    return {
      ...frame,
      position: fallback[index] ? fallback[index].position : { x: index * 40, y: index * 40 }
    };
  });
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
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    const result = buildValidationFailure(validation.errors);
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: result.status,
        summary: summarizeChecks(result.checks || [])
      });
    }
    return finalizeRun(runPaths, job, result, createdAt);
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
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
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

async function executeFigmaBootstrapJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const planRelativePath = `.ai-runs/${runId}/figma_bootstrap_plan.json`;
  const planAbsolutePath = path.join(process.cwd(), planRelativePath);
  const nodesRelativePath = `.ai-runs/${runId}/figma_bootstrap_nodes.json`;
  const planState = {
    schema_version: SCHEMA_VERSION,
    job_type: job.job_type,
    run_id: runId,
    started_at: createdAt,
    status: 'pending',
    page_name: job.inputs.page_name || 'Hub Bootstrap',
    repo_reference: null,
    repo_root: job.inputs.repo_local_path ? path.resolve(job.inputs.repo_local_path) : process.cwd(),
    figma_file_key: null,
    screen_patterns: SCREEN_PATTERN_LIST.slice(),
    frames: [],
    frame_source: null,
    errors: []
  };
  const writePlan = () => {
    planState.updated_at = new Date().toISOString();
    try {
      fs.writeFileSync(planAbsolutePath, JSON.stringify(planState, null, 2));
    } catch (error) {
      console.error(`[figma-plan] write failed: ${error.message}`);
    }
  };
  writePlan();

  const annotateError = (error, where, meta = {}) => {
    const baseError = error instanceof Error ? error : new Error(String(error));
    if (!baseError.planWhere) {
      baseError.planWhere = where;
    }
    if (!baseError.planCode) {
      baseError.planCode = baseError.code || 'ERR';
    }
    baseError.planMeta = { ...(baseError.planMeta || {}), ...meta };
    return baseError;
  };

  const baseLogs = [`plan_path=${planRelativePath}`, `screen patterns=${SCREEN_PATTERNS_DESCRIPTION}`];
  let requestedPlanTarget = null;
  let frameSource = 'scan';

  try {
    const validation = validateJob(job);
    if (!validation.ok) {
      throw annotateError(
        new Error(validation.errors[0] || 'job validation failed'),
        'preflight',
        { errors: validation.errors }
      );
    }
    planState.status = 'running';

    const targetTemplate = job.inputs.target_path || '.ai-runs/{{run_id}}/figma_bootstrap_plan.json';
    try {
      requestedPlanTarget = resolveTargetPath(targetTemplate, runId);
      planState.requested_target = requestedPlanTarget;
    } catch (error) {
      throw annotateError(error, 'constraints', { target_template: targetTemplate });
    }
    try {
      ensureAllowedPath(
        requestedPlanTarget,
        job.constraints && job.constraints.allowed_paths ? job.constraints.allowed_paths : []
      );
    } catch (error) {
      throw annotateError(error, 'constraints', {
        allowed_paths: job.constraints ? job.constraints.allowed_paths : null
      });
    }

    const repoRef =
      normalizeRepoReference(job.inputs.repo_url || job.inputs.repo || job.inputs.owner_repo) ||
      normalizeRepoReference(job.inputs.repository);
    if (!repoRef) {
      throw annotateError(
        new Error('repo_url (owner/repo) を inputs に指定してください'),
        'preflight'
      );
    }
    planState.repo_reference = repoRef;

    const figmaInput = job.inputs.figma_design_url || job.inputs.figma_file_key;
    const fileKey = extractFigmaFileKey(figmaInput);
    planState.figma_file_key = fileKey;

    const figmaToken = (job.inputs.figma_token || process.env.FIGMA_TOKEN || '').trim();
    const hasFigmaToken = Boolean(figmaToken);

    try {
      const resolvedRoot = resolveRepoRoot(job.inputs.repo_local_path);
      planState.repo_root = resolvedRoot;
    } catch (error) {
      throw annotateError(error, 'resolveRepoRoot', { repo_local_path: job.inputs.repo_local_path });
    }

    const strategy = job.inputs.strategy || 'routes_first';
    baseLogs.push(`screen root=${planState.repo_root}`);
    baseLogs.push(`figma file_key=${fileKey}`);
    baseLogs.push(`repo=${repoRef}`);
    baseLogs.push(`screen strategy=${strategy}`);
    baseLogs.push(`figma_api=${hasFigmaToken ? 'enabled' : 'skipped'}`);

    let frames = [];
    if (Array.isArray(job.inputs.frames)) {
      const manualFrames = ensureFramePositions(normalizeManualFrames(job.inputs.frames));
      if (manualFrames.length) {
        frames = manualFrames;
        frameSource = 'manual-input';
      } else {
        frames = ensureFramePositions(
          normalizeManualFrames([
            { name: 'Bootstrap', source_path: '(manual)', route: '/', pattern: 'manual' }
          ])
        );
        frameSource = 'manual-default';
      }
    } else {
      frames = collectScreenCandidates(24, strategy, planState.repo_root);
      if (!frames.length) {
        frames = ensureFramePositions(
          normalizeManualFrames([
            { name: 'Bootstrap', source_path: '(manual)', route: '/', pattern: 'manual' }
          ])
        );
        frameSource = 'manual-default';
      }
    }
    planState.frames = frames;
    planState.frame_source = frameSource;

    writeJsonArtifact(nodesRelativePath, {
      run_id: runId,
      repo_reference: repoRef,
      repo_root: planState.repo_root,
      figma_file_key: fileKey,
      nodes: [],
      recorded_at: null
    });
    let commentId = 'skipped-no-token';
    if (hasFigmaToken) {
      try {
        const fileMetaResponse = await callFigmaApi({
          token: figmaToken,
          method: 'GET',
          endpoint: `/files/${fileKey}`
        });
        const fileLog = formatFigmaRequestLog('file_meta', fileMetaResponse.debug);
        if (fileLog) {
          baseLogs.push(fileLog);
        }
      } catch (infoError) {
        if (infoError.debug) {
          const debugLog = formatFigmaRequestLog('file_meta', infoError.debug);
          if (debugLog) {
            baseLogs.push(debugLog);
          }
        }
        baseLogs.push(`figma_info_error[file_meta]=${infoError.message}`);
      }
      const commentMessage = buildFigmaCommentMessage({
        pageName: planState.page_name,
        frames,
        runId,
        repoRef
      });
      let commentData;
      try {
        const commentResponse = await callFigmaApi({
          token: figmaToken,
          method: 'POST',
          endpoint: `/files/${fileKey}/comments`,
          body: {
            message: commentMessage,
            client_meta: { x: 0, y: 0 }
          }
        });
        const commentLog = formatFigmaRequestLog('comment', commentResponse.debug);
        if (commentLog) {
          baseLogs.push(commentLog);
        }
        commentData = commentResponse.data;
      } catch (commentError) {
        if (commentError.debug) {
          const debugLog = formatFigmaRequestLog('comment', commentError.debug);
          if (debugLog) {
            baseLogs.push(debugLog);
          }
        }
        baseLogs.push(`figma_info_error[comment]=${commentError.message}`);
        throw commentError;
      }
      commentId =
        (commentData && (commentData.id || (commentData.comment && commentData.comment.id))) ||
        'unknown';
    }
    planState.comment_id = commentId;
    planState.status = 'ok';
    planState.completed_at = new Date().toISOString();
    writePlan();

    if (
      requestedPlanTarget &&
      requestedPlanTarget !== planRelativePath &&
      requestedPlanTarget.startsWith('.ai-runs/')
    ) {
      try {
        const absoluteTarget = path.join(process.cwd(), requestedPlanTarget);
        fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
        fs.writeFileSync(absoluteTarget, JSON.stringify(planState, null, 2));
      } catch (copyError) {
        baseLogs.push(`plan_copy_error=${copyError.message}`);
      }
    }

    const result = {
      status: 'ok',
      artifacts: [
        { path: planRelativePath, kind: 'json' },
        { path: nodesRelativePath, kind: 'json' }
      ],
      diff_summary: `Figma bootstrap planned (${frames.length} frames)`,
      checks: [
        { id: 'figma_comment', ok: true, reason: `comment_id=${commentId}` },
        { id: 'repo_routes', ok: true, reason: `${frames.length} screen candidates` }
      ],
      logs: [
        ...baseLogs,
        `frames_source=${frameSource}`,
        `frames_count=${frames.length}`,
        `comment_id=${commentId}`
      ]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const where = error.planWhere || 'unknown';
    const failureMessage = error.message || 'figma bootstrap failed';
    const failureReason = `${failureMessage} (where=${where}, root=${planState.repo_root}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`;
    planState.status = 'error';
    planState.failed_at = new Date().toISOString();
    planState.errors.push({
      code: error.planCode || error.code || 'ERR',
      where,
      message: failureMessage,
      root: planState.repo_root,
      patterns: planState.screen_patterns,
      meta: error.planMeta || {},
      stack: error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : undefined
    });
    writePlan();
    const result = {
      status: 'error',
      errors: [failureReason],
      checks: [{ id: 'figma_bootstrap', ok: false, reason: failureReason }],
      logs: baseLogs.length
        ? [...baseLogs, `failure_reason=${failureReason}`, 'figma bootstrap failed']
        : ['figma bootstrap failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } finally {
    writePlan();
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

function exitWithJobError(checkId, reason, logMessages) {
  const logsArray = Array.isArray(logMessages) ? logMessages : logMessages ? [logMessages] : [];
  const result = {
    status: 'error',
    checks: [{ id: checkId, ok: false, reason }],
    logs: logsArray
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}

function buildSpawnEnv() {
  const env = {};
  SPAWN_ENV_ALLOWLIST.forEach((key) => {
    if (typeof process.env[key] === 'string') {
      env[key] = process.env[key];
    }
  });
  return env;
}

function writeTextArtifact(relativePath, content = '') {
  const absolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return relativePath;
}

function captureWithLimit(buffer, chunk) {
  const next = buffer + chunk;
  if (next.length <= MAX_SPAWN_CAPTURE) {
    return next;
  }
  return next.slice(0, MAX_SPAWN_CAPTURE);
}

function runSpawnCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });
    child.stdout.on('data', (chunk) => {
      stdout = captureWithLimit(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = captureWithLimit(stderr, chunk.toString());
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function executeDiagnosticsJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
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

async function executeSpawnJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    if (!job.inputs || job.inputs.mcp_provider !== 'spawn') {
      throw new Error('spawn provider requires inputs.mcp_provider="spawn"');
    }
    const command = job.inputs.mcp_command;
    if (typeof command !== 'string' || !ALLOWED_SPAWN_COMMANDS.has(command)) {
      throw new Error('spawn command not allowed');
    }
    const rawArgs = job.inputs.mcp_args || [];
    if (!Array.isArray(rawArgs)) {
      throw new Error('spawn args must be an array');
    }
    const args = rawArgs.map((value) => {
      if (typeof value !== 'string') {
        throw new Error('spawn args entries must be strings');
      }
      return value;
    });
    if (!job.constraints || job.constraints.no_destructive_ops !== true) {
      throw new Error('spawn jobs require constraints.no_destructive_ops=true');
    }
    const allowedPaths = job.constraints.allowed_paths;
    if (!Array.isArray(allowedPaths) || !allowedPaths.length) {
      throw new Error('spawn jobs require constraints.allowed_paths');
    }
    const resolvedTarget = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(resolvedTarget, allowedPaths);
    const env = buildSpawnEnv();
    const { code, stdout, stderr } = await runSpawnCommand(command, args, env);
    const stdoutPath = `.ai-runs/${runId}/spawn_stdout.txt`;
    const stderrPath = `.ai-runs/${runId}/spawn_stderr.txt`;
    writeTextArtifact(stdoutPath, stdout);
    writeTextArtifact(stderrPath, stderr);
    writeJsonArtifact(resolvedTarget, {
      command,
      args,
      exit_code: code,
      stdout_path: stdoutPath,
      stderr_path: stderrPath
    });
    const preview = (text) => {
      if (!text) {
        return '(empty)';
      }
      return text.split('\n').slice(0, 3).join(' | ');
    };
    const knownWarnings = [];
    let stderrPreview = preview(stderr);
    const stdoutPreview = preview(stdout);
    if (stderr.includes(CODEX_SHELL_WARNING)) {
      const warningMessage = 'Shell snapshot validation failed (exec may still succeed)';
      knownWarnings.push({
        id: 'codex_shell_snapshot_validation_failed',
        message: warningMessage
      });
      stderrPreview = `[KNOWN WARNING] ${warningMessage}`;
    }
    const logs = [
      `spawn command=${command}`,
      `spawn args=${JSON.stringify(args)}`,
      `stdout preview: ${stdoutPreview}`,
      `stderr preview: ${stderrPreview}`
    ];
    knownWarnings.forEach((warning) => {
      logs.push(`known_warning=${warning.id}`);
    });
    const checks = [{ id: 'spawn_exec', ok: code === 0, reason: `exit=${code}` }];
    const result = {
      status: code === 0 ? 'ok' : 'error',
      artifacts: [
        { path: resolvedTarget, kind: 'json' },
        { path: stdoutPath, kind: 'text' },
        { path: stderrPath, kind: 'text' }
      ],
      diff_summary: `spawn exit=${code}`,
      checks,
      logs,
      known_warnings: knownWarnings
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'spawn_exec', ok: false, reason: error.message }],
      logs: ['spawn execution failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeMcpJob(jobPayload, role) {
  if (jobPayload && jobPayload.inputs && jobPayload.inputs.mcp_provider === 'spawn') {
    return executeSpawnJob(jobPayload);
  }
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();
  const startedAt = createdAt;
  const isOfflineSmoke = job && job.job_type === 'integration_hub.phase2.mcp.offline_smoke';

  if (isOfflineSmoke) {
    const initialRunJson = {
      job,
      runnerResult: {
        status: 'running',
        checks: [],
        logs: ['offline_smoke started']
      },
      meta: {
        schema_version: SCHEMA_VERSION,
        created_at: createdAt
      }
    };
    writeJsonAtomic(runPaths.runJson, initialRunJson);
  }

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
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: runnerResult.status,
        summary: summarizeChecks(runnerResult.checks || [])
      });
    }
    return finalizeRun(runPaths, job, runnerResult, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'mcp_exec', ok: false, reason: error.message }],
      logs: ['runner_adapter=mcp']
    };
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: result.status,
        summary: summarizeChecks(result.checks || [])
      });
    }
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
  let raw;
  try {
    raw = fs.readFileSync(jobPath, 'utf8');
  } catch (error) {
    exitWithJobError('job_json_parse', 'run.json のJSON形式が正しくありません。', [
      `job file read failed: ${error.message}`
    ]);
    return;
  }
  let jobPayload;
  try {
    jobPayload = JSON.parse(raw);
  } catch (error) {
    exitWithJobError('job_json_parse', 'run.json のJSON形式が正しくありません。', [
      `job JSON parse failed: ${error.message}`
    ]);
    return;
  }
  applyCodexPrompt(jobPayload, { lang: jobPayload && jobPayload.output_language });
  const validation = validateJob(jobPayload);
  if (!validation.ok) {
    const reason = `ジョブ定義エラー: ${validation.errors[0] || '不明なエラー'}`;
    exitWithJobError('job_validation', reason, validation.errors);
    return;
  }
  const jobType = jobPayload.job_type;
  let result;
  if (jobType === 'integration_hub.phase2.docs_update') {
    result = await executeDocsUpdateJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.repo_patch') {
    result = await executeRepoPatchJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.diagnostics') {
    result = await executeDiagnosticsJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.figma_bootstrap_from_repo') {
    result = await executeFigmaBootstrapJob(jobPayload);
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
