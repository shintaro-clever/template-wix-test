const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { applyCodexPrompt } = require('../codex/prompt');

const ROOT_DIR = path.join(__dirname, '..', '..');
const distDir = path.join(ROOT_DIR, 'apps', 'hub', 'dist');
const staticDir = path.join(ROOT_DIR, 'apps', 'hub', 'static');
const staticJobs = path.join(staticDir, 'jobs.html');
const staticConnections = path.join(staticDir, 'connections.html');
const staticConnectors = path.join(staticDir, 'connectors.html');
const staticConnectorDetail = path.join(staticDir, 'connector-detail.html');
const staticAccount = path.join(staticDir, 'account.html');
const staticChat = path.join(staticDir, 'chat.html');
const staticRunsList = path.join(staticDir, 'runs.html');
const staticRunDetail = path.join(staticDir, 'run.html');
const STATIC_ROUTE_PREFIX = '/static';
const RUNS_DIR = path.join(ROOT_DIR, '.ai-runs');
const scriptsDir = path.join(ROOT_DIR, 'scripts');
const runJobScript = path.join(scriptsDir, 'run-job.js');
const connectorSmokeScript = path.relative(process.cwd(), path.join(scriptsDir, 'connector-smoke.js'));
const connectionsDataDir = path.join(ROOT_DIR, 'apps', 'hub', 'data');
const connectionsDataPath = path.join(connectionsDataDir, 'connections.json');
const connectorsCatalogPath = path.join(ROOT_DIR, 'apps', 'hub', 'data', 'connectors.catalog.json');
// Quick smoke test: node server.js → curl -I http://127.0.0.1:3000/jobs

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function isSubPath(baseDir, target) {
  const relative = path.relative(baseDir, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function serveFile(res, filePath, method = 'GET') {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';
  const headers = { 'Content-Type': contentType };
  try {
    const stats = fs.statSync(filePath);
    headers['Content-Length'] = stats.size;
  } catch {
    // ignore stat errors; stream will handle read issues below
  }
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath)
    .on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read file');
    })
    .pipe(res);
}

function tryServeStatic(baseDir, requestPath, res, method) {
  const relative = requestPath.replace(/^\//, '') || 'index.html';
  const filePath = path.join(baseDir, relative);
  if (!isSubPath(baseDir, filePath) || !fileExists(filePath)) {
    return false;
  }
  serveFile(res, filePath, method);
  return true;
}

function tryServeStaticRoute(urlPath, res, method) {
  if (!urlPath.startsWith(STATIC_ROUTE_PREFIX)) {
    return false;
  }
  let relative = urlPath.slice(STATIC_ROUTE_PREFIX.length) || '/';
  if (!relative.startsWith('/')) {
    relative = `/${relative}`;
  }
  return tryServeStatic(staticDir, relative, res, method);
}

function resolveJobsPath() {
  if (fileExists(staticJobs)) {
    return staticJobs;
  }
  const distIndex = path.join(distDir, 'index.html');
  if (fileExists(distIndex)) {
    return distIndex;
  }
  return null;
}

function handleJobs(res, method) {
  const jobsPath = resolveJobsPath();
  if (jobsPath) {
    serveFile(res, jobsPath, method);
    return;
  }
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Missing Hub UI (fallback not found)');
}

function handleConnectionsPage(res, method) {
  if (fileExists(staticConnections)) {
    serveFile(res, staticConnections, method);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Connections UI not found');
}

function handleConnectorsPage(res, method) {
  if (fileExists(staticConnectors)) {
    serveFile(res, staticConnectors, method);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Connectors UI not found');
}

function handleConnectorDetailPage(res, method) {
  if (fileExists(staticConnectorDetail)) {
    serveFile(res, staticConnectorDetail, method);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Connector detail UI not found');
}

function createEmptyConnections() {
  return {
    ai: { provider: '', name: '', apiKey: '' },
    github: { repo: '', token: '' },
    figma: { fileUrl: '', token: '' }
  };
}

function coerceString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConnectionsPayload(payload = {}) {
  return {
    ai: {
      provider: coerceString(payload.ai?.provider),
      name: coerceString(payload.ai?.name),
      apiKey: coerceString(payload.ai?.apiKey)
    },
    github: {
      repo: coerceString(payload.github?.repo),
      token: coerceString(payload.github?.token)
    },
    figma: {
      fileUrl: coerceString(payload.figma?.fileUrl),
      token: coerceString(payload.figma?.token)
    }
  };
}

function readConnections() {
  if (!fileExists(connectionsDataPath)) {
    return createEmptyConnections();
  }
  try {
    const raw = fs.readFileSync(connectionsDataPath, 'utf8');
    return normalizeConnectionsPayload(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to read connections.json, returning defaults:', error.message);
    return createEmptyConnections();
  }
}

function writeConnections(data) {
  fs.mkdirSync(connectionsDataDir, { recursive: true });
  fs.writeFileSync(connectionsDataPath, JSON.stringify(data, null, 2), 'utf8');
}

function readConnectorsCatalog() {
  if (!fileExists(connectorsCatalogPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(connectorsCatalogPath, 'utf8');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to read connectors catalog:', error.message);
    return [];
  }
}

function getConnectionsUpdatedAt() {
  if (!fileExists(connectionsDataPath)) {
    return null;
  }
  try {
    const stats = fs.statSync(connectionsDataPath);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0;
}

function computeConnectorStatus(providerKey, connections, updatedAt) {
  let configured = false;
  switch (providerKey) {
    case 'ai':
      configured = hasValue(connections.ai?.apiKey);
      break;
    case 'github':
      configured = hasValue(connections.github?.token);
      break;
    case 'figma':
      configured = hasValue(connections.figma?.token);
      break;
    default:
      configured = false;
      break;
  }
  return {
    configured,
    last_updated_at: configured ? updatedAt : null
  };
}

function listRunDirectories() {
  if (!fs.existsSync(RUNS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(RUNS_DIR)
    .filter((entry) => {
      try {
        return fs.statSync(path.join(RUNS_DIR, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function detectNewRunId(previous = new Set()) {
  const dirs = listRunDirectories();
  const currentSet = new Set(dirs);
  const additions = dirs.filter((dir) => !previous.has(dir));
  if (additions.length === 1) {
    return additions[0];
  }
  if (additions.length > 1) {
    return additions.sort().pop();
  }
  let latestDir = null;
  let latestMtime = 0;
  dirs.forEach((dir) => {
    try {
      const stats = fs.statSync(path.join(RUNS_DIR, dir));
      if (stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
        latestDir = dir;
      }
    } catch {
      // ignore
    }
  });
  if (latestDir && !previous.has(latestDir)) {
    return latestDir;
  }
  return latestDir;
}

function getRecentRuns(limit = 10) {
  const dirs = listRunDirectories();
  const enriched = dirs
    .map((runId) => {
      const stats = getRunStats(runId);
      return {
        runId,
        mtime: stats ? stats.mtimeMs : 0
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return enriched.slice(0, limit).map((entry) => entry.runId);
}

function writeTempJobFile(jobPayload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-job-'));
  const jobPath = path.join(tempDir, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(jobPayload, null, 2));
  return { jobPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function mergeEnv(overrides = {}) {
  return { ...process.env, ...overrides };
}

function runJobCli(jobPayload, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const { jobPath, cleanup } = writeTempJobFile(jobPayload);
    const before = new Set(listRunDirectories());
    const child = spawn(process.execPath, [runJobScript, '--job', jobPath, '--role', 'operator'], {
      cwd: process.cwd(),
      env: mergeEnv(envOverrides)
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      const runId = detectNewRunId(before);
      let parsed = null;
      try {
        parsed = JSON.parse(stdout || '{}');
      } catch {
        parsed = null;
      }
      if (!runId) {
        reject(new Error('run_id を特定できませんでした'));
        return;
      }
      resolve({ code, result: parsed, runId, stderr: stderr.trim() });
    });
  });
}

function ensureConfigured(value, message) {
  if (!value || !String(value).trim()) {
    const error = new Error(message);
    error.code = 'CONFIG_MISSING';
    throw error;
  }
  return String(value).trim();
}

function ensureCodexPrompt(job) {
  applyCodexPrompt(job, { lang: job.output_language });
  return job;
}

function buildConnectorJob(providerKey) {
  const baseJob = {
    constraints: {
      allowed_paths: ['.ai-runs/'],
      max_files_changed: 0,
      no_destructive_ops: true
    },
    provenance: {
      issue: '',
      operator: 'operator'
    },
    run_mode: 'mcp',
    output_language: 'ja'
  };
  if (providerKey === 'github' || providerKey === 'figma') {
    const label = providerKey === 'github' ? 'GitHub' : 'Figma';
    const job = ensureCodexPrompt({
      ...baseJob,
      job_type: `integration_hub.phase2.mcp.spawn_smoke.${providerKey}`,
      goal: `${label} connector smoke`,
      inputs: {
        message: `${label} connector smoke`,
        target_path: `.ai-runs/{{run_id}}/connector_spawn_report.json`,
        mcp_provider: 'spawn',
        mcp_command: 'node',
        mcp_args: [connectorSmokeScript, '--provider', providerKey]
      },
      acceptance_criteria: [
        `${label} connector script exits 0`,
        'Artifacts land under .ai-runs/<run_id>/'
      ],
      expected_artifacts: [
        {
          name: 'connector_spawn_report.json',
          description: `${label} connector spawn result`
        }
      ]
    });
    return {
      job,
      env: {}
    };
  }
  if (providerKey === 'ai') {
    const job = ensureCodexPrompt({
      ...baseJob,
      job_type: 'integration_hub.phase2.mcp.openai_exec_smoke',
      goal: 'OpenAI Exec smoke via Codex CLI',
      inputs: {
        message: 'openai exec smoke',
        target_path: '.ai-runs/{{run_id}}/openai_exec_smoke_report.json',
        mcp_provider: 'spawn',
        mcp_command: 'npx',
        mcp_args: ['--yes', 'codex', 'exec', 'echo OK']
      },
      acceptance_criteria: ['spawn exit=0 with OK stdout'],
      expected_artifacts: [
        {
          name: 'openai_exec_smoke_report.json',
          description: 'OpenAI exec smoke summary'
        }
      ]
    });
    return {
      job,
      env: {}
    };
  }
  throw new Error(`Unsupported provider: ${providerKey}`);
}
function getRunArtifactPaths(result) {
  if (result && Array.isArray(result.artifacts)) {
    return result.artifacts
      .map((entry) => (entry && entry.path ? entry.path : null))
      .filter(Boolean);
  }
  return [];
}

async function createConnectorMetadata(providerKey, runId) {
  const baseDir = path.join(RUNS_DIR, runId);
  const stdoutPath = path.join(baseDir, 'spawn_stdout.txt');
  if (!fs.existsSync(stdoutPath)) {
    throw new Error('spawn stdout が見つかりません');
  }
  const raw = fs.readFileSync(stdoutPath, 'utf8').trim();
  if (!raw) {
    throw new Error('spawn stdout が空です');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('疎通テスト結果のJSON解析に失敗しました');
  }
  let targetFile = null;
  if (providerKey === 'github') {
    targetFile = path.join(baseDir, 'github_repo_meta.json');
  } else if (providerKey === 'figma') {
    targetFile = path.join(baseDir, 'figma_file_meta.json');
  } else {
    return null;
  }
  fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2));
  return path.relative(process.cwd(), targetFile);
}

function readRunJson(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  const runJsonPath = path.join(runDir, 'run.json');
  if (!fs.existsSync(runJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(runJsonPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to parse run.json for ${runId}:`, error.message);
    return null;
  }
}

function getRunStats(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  try {
    return fs.statSync(runDir);
  } catch {
    return null;
  }
}

function summarizeRun(runId) {
  const runJson = readRunJson(runId);
  const stats = getRunStats(runId);
  const metaCreated = runJson && runJson.meta && runJson.meta.created_at;
  const createdAt = metaCreated || (stats ? new Date(stats.mtimeMs).toISOString() : null);
  const status =
    (runJson && runJson.runnerResult && runJson.runnerResult.status) || (runJson ? 'unknown' : 'missing');
  const jobType = (runJson && runJson.job && runJson.job.job_type) || 'unknown';
  const artifacts =
    (runJson &&
      runJson.runnerResult &&
      Array.isArray(runJson.runnerResult.artifacts) &&
      runJson.runnerResult.artifacts.map((entry) => entry && entry.path).filter(Boolean)) ||
    [];
  return {
    run_id: runId,
    job_type: jobType,
    status,
    created_at: createdAt,
    artifacts
  };
}

function readAuditTail(runId) {
  const auditPath = path.join(RUNS_DIR, runId, 'audit.jsonl');
  if (!fs.existsSync(auditPath)) {
    return null;
  }
  try {
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const event = JSON.parse(lines[i]);
        if (event.event === 'RUN_END') {
          return event;
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch (error) {
    console.warn(`Failed to read audit for ${runId}:`, error.message);
  }
  return null;
}

function getRunDetail(runId) {
  const runJson = readRunJson(runId);
  if (!runJson) {
    return null;
  }
  const summary = summarizeRun(runId);
  const audit = readAuditTail(runId);
  return {
    ...summary,
    run_json: runJson,
    audit_tail: audit,
    figma_bootstrap_plan: readBootstrapPlan(runId),
    figma_bootstrap_nodes: readBootstrapNodes(runId)
  };
}

function handleRunArtifactRequest(runId, artifactPathParam, res, method) {
  if (!artifactPathParam) {
    sendJson(res, 400, { error: 'artifact path is required' });
    return;
  }
  const normalized = path.posix.normalize(String(artifactPathParam).replace(/\\/g, '/'));
  const prefix = `.ai-runs/${runId}/`;
  if (!normalized.startsWith(prefix)) {
    sendJson(res, 400, { error: 'artifact path must stay under run directory' });
    return;
  }
  const absolute = path.join(process.cwd(), normalized);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    sendJson(res, 404, { error: 'artifact not found' });
    return;
  }
  const ext = path.extname(absolute).toLowerCase();
  const contentType =
    {
      '.json': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.log': 'text/plain; charset=utf-8'
    }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(absolute)
    .on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read artifact');
    })
    .pipe(res);
}

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function readBootstrapPlan(runId) {
  const planPath = path.join(RUNS_DIR, runId, 'figma_bootstrap_plan.json');
  if (!fs.existsSync(planPath)) {
    return null;
  }
  return readJsonFileSafe(planPath);
}

function readBootstrapNodes(runId) {
  const nodesPath = path.join(RUNS_DIR, runId, 'figma_bootstrap_nodes.json');
  if (!fs.existsSync(nodesPath)) {
    return null;
  }
  return readJsonFileSafe(nodesPath);
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

const CORS_JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*'
};

const CORS_FULL_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function sendCorsJson(res, statusCode, body) {
  sendJson(res, statusCode, body, CORS_JSON_HEADERS);
}

function sendCorsNoContent(res) {
  res.writeHead(204, CORS_FULL_HEADERS);
  res.end();
}

function parseJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', (error) => reject(error));
  });
}

async function handleConnectionsApi(req, res, method) {
  if (method === 'GET') {
    const data = readConnections();
    sendJson(res, 200, data);
    return;
  }
  if (method === 'POST') {
    let payload = {};
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    try {
      const normalized = normalizeConnectionsPayload(payload);
      writeConnections(normalized);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error('Failed to save connections:', error);
      sendJson(res, 500, { error: 'Failed to save connections' });
    }
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleConnectorsApi(req, res, method) {
  if (method === 'GET') {
    const catalog = readConnectorsCatalog();
    const connections = readConnections();
    const updatedAt = getConnectionsUpdatedAt();
    const enriched = catalog.map((item) => ({
      ...item,
      status: computeConnectorStatus(item.provider_key, connections, updatedAt)
    }));
    sendJson(res, 200, enriched);
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleSmokeApi(req, res, method) {
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let payload = {};
  try {
    payload = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const providerKey = typeof payload.provider_key === 'string' ? payload.provider_key.trim() : '';
  if (!providerKey || !['github', 'figma', 'ai'].includes(providerKey)) {
    sendJson(res, 400, { error: 'Unsupported provider_key' });
    return;
  }
  const connections = readConnections();
  try {
    if (providerKey === 'github') {
      ensureConfigured(connections.github && connections.github.repo, 'GitHub リポジトリが未設定です');
    }
    if (providerKey === 'figma') {
      ensureConfigured(connections.figma && connections.figma.fileUrl, 'Figma URL が未設定です');
      ensureConfigured(connections.figma && connections.figma.token, 'Figma token が未設定です');
    }
    if (providerKey === 'ai') {
      ensureConfigured(connections.ai && connections.ai.apiKey, 'AI API Key が未設定です');
    }
    const { job, env } = buildConnectorJob(providerKey);
    if (providerKey === 'ai') {
      env.OPENAI_API_KEY = connections.ai.apiKey.trim();
    }
    const execResult = await runJobCli(job, env);
    let artifacts = getRunArtifactPaths(execResult.result);
    if (providerKey === 'github' || providerKey === 'figma') {
      const metaPath = await createConnectorMetadata(providerKey, execResult.runId);
      if (metaPath) {
        artifacts = artifacts.concat([metaPath]);
      }
    }
    sendJson(res, 200, {
      run_id: execResult.runId,
      status: (execResult.result && execResult.result.status) || (execResult.code === 0 ? 'ok' : 'error'),
      artifacts,
      diff_summary: execResult.result && execResult.result.diff_summary
    });
  } catch (error) {
    const status = error.code === 'CONFIG_MISSING' ? 400 : 500;
    sendJson(res, status, { error: error.message });
  }
}

function handleRunsApi(req, res, method, runId) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!runId) {
    const runs = getRecentRuns(10).map((id) => summarizeRun(id));
    sendJson(res, 200, { runs });
    return;
  }
  const detail = getRunDetail(runId);
  if (!detail) {
    sendJson(res, 404, { error: 'run not found' });
    return;
  }
  sendJson(res, 200, detail);
}

function handleBootstrapPlanApi(req, res, method, runId) {
  if (method === 'OPTIONS') {
    sendCorsNoContent(res);
    return;
  }
  if (method !== 'GET') {
    sendCorsJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const plan = readBootstrapPlan(runId);
  if (!plan) {
    sendCorsJson(res, 404, { error: 'plan not found' });
    return;
  }
  sendCorsJson(res, 200, plan);
}

async function handleBootstrapNodesApi(req, res, method, runId) {
  if (method === 'OPTIONS') {
    sendCorsNoContent(res);
    return;
  }
  if (method !== 'POST') {
    sendCorsJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let payload = {};
  try {
    payload = await parseJsonBody(req);
  } catch (error) {
    sendCorsJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  if (!Array.isArray(payload.nodes)) {
    sendCorsJson(res, 400, { error: 'nodes array is required' });
    return;
  }
  const nodesPath = path.join(RUNS_DIR, runId, 'figma_bootstrap_nodes.json');
  const record = {
    run_id: runId,
    submitted_at: new Date().toISOString(),
    figma_file_key: payload.figma_file_key || null,
    nodes: payload.nodes
  };
  try {
    fs.writeFileSync(nodesPath, JSON.stringify(record, null, 2));
    sendCorsJson(res, 200, { ok: true });
  } catch (error) {
    sendCorsJson(res, 500, { error: 'Failed to save nodes' });
  }
}

async function handleRequest(req, res) {
  const rawUrl = req.url || '/';
  const [pathOnly, queryString = ''] = rawUrl.split('?');
  const urlPath = pathOnly || '/';
  const queryParams = new URLSearchParams(queryString);
  const method = (req.method || 'GET').toUpperCase();
  const segments = urlPath.split('/').filter(Boolean);
  const start = process.hrtime.bigint();
  if (typeof res.on === 'function') {
    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${method} ${urlPath} -> ${res.statusCode} (${elapsedMs.toFixed(1)}ms)`);
    });
  }
  const isGetLikeMethod = method === 'GET' || method === 'HEAD';
  if (isGetLikeMethod && (urlPath === '/jobs' || urlPath === '/jobs/')) {
    handleJobs(res, method);
    return;
  }
  if (method === 'GET' && urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (isGetLikeMethod && (urlPath === '/connections' || urlPath === '/connections/')) {
    handleConnectionsPage(res, method);
    return;
  }
  if (isGetLikeMethod && (urlPath === '/connectors' || urlPath === '/connectors/')) {
    handleConnectorsPage(res, method);
    return;
  }
  if (
    isGetLikeMethod &&
    urlPath.startsWith('/connectors/') &&
    urlPath.split('/').filter(Boolean).length === 2
  ) {
    handleConnectorDetailPage(res, method);
    return;
  }
  if (isGetLikeMethod && (urlPath === '/runs' || urlPath === '/runs/')) {
    if (fileExists(staticRunsList)) {
      serveFile(res, staticRunsList, method);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Runs UI not found');
    }
    return;
  }
  if (segments[0] === 'runs') {
    if (segments.length === 2 && isGetLikeMethod) {
      if (fileExists(staticRunDetail)) {
        serveFile(res, staticRunDetail, method);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Run detail UI not found');
      }
      return;
    }
    if (segments.length === 3 && segments[2] === 'artifact' && isGetLikeMethod) {
      const runId = segments[1];
      const artifactPath = queryParams.get('path');
      handleRunArtifactRequest(runId, artifactPath, res, method);
      return;
    }
  }
  if (isGetLikeMethod && (urlPath === '/account' || urlPath === '/account/')) {
    if (fileExists(staticAccount)) {
      serveFile(res, staticAccount, method);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Account UI not found');
    }
    return;
  }
  if (isGetLikeMethod && (urlPath === '/chat' || urlPath === '/chat/')) {
    if (fileExists(staticChat)) {
      serveFile(res, staticChat, method);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Chat UI not found');
    }
    return;
  }
  if (urlPath === '/api/connections') {
    await handleConnectionsApi(req, res, method);
    return;
  }
  if (urlPath === '/api/connectors') {
    await handleConnectorsApi(req, res, method);
    return;
  }
  if (urlPath === '/api/smoke') {
    await handleSmokeApi(req, res, method);
    return;
  }
  if (segments[0] === 'api' && segments[1] === 'runs') {
    const runId = segments.length >= 3 ? segments[2] : null;
    if (segments.length >= 4 && segments[3] === 'figma-bootstrap-plan' && runId) {
      handleBootstrapPlanApi(req, res, method, runId);
      return;
    }
    if (segments.length >= 4 && segments[3] === 'figma-bootstrap-nodes' && runId) {
      await handleBootstrapNodesApi(req, res, method, runId);
      return;
    }
    handleRunsApi(req, res, method, runId);
    return;
  }
  if (isGetLikeMethod && urlPath === '/') {
    res.writeHead(302, { Location: '/jobs' });
    res.end();
    return;
  }
  if (
    isGetLikeMethod &&
    (urlPath === STATIC_ROUTE_PREFIX || urlPath.startsWith(`${STATIC_ROUTE_PREFIX}/`))
  ) {
    if (tryServeStaticRoute(urlPath, res, method)) {
      return;
    }
  }
  if (isGetLikeMethod) {
    const served =
      (fileExists(path.join(distDir, 'index.html')) &&
        tryServeStatic(distDir, urlPath, res, method)) ||
      tryServeStatic(staticDir, urlPath, res, method);
    if (served) {
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function createApp() {
  return (req, res) => {
    handleRequest(req, res);
  };
}

module.exports = {
  createApp
};
