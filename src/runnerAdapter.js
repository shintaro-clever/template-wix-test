const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeRelativePath(rawPath, fallback = '.ai-runs/handshake.json') {
  const candidate = String(rawPath || fallback).trim() || fallback;
  const normalized = path.posix.normalize(toPosixPath(candidate)).replace(/^\.\//, '');
  if (path.posix.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error('codex_cli_target_path_blocked');
  }
  return normalized;
}

function resolveTargetPath(job) {
  const raw = (job.inputs && (job.inputs.target_path_resolved || job.inputs.target_path)) || '.ai-runs/handshake.json';
  return normalizeRelativePath(raw);
}

function writeHandshakeArtifact(targetPath, payload, options = {}) {
  const absolute = path.join(process.cwd(), targetPath);
  if (options.allowedRoot) {
    const allowedRoot = path.join(process.cwd(), options.allowedRoot);
    const relative = path.relative(allowedRoot, absolute);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('codex_cli_target_path_blocked');
    }
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2));
}

function isPhase1CodeToFigmaJob(job) {
  return job && job.job_type === 'integration_hub.phase1.code_to_figma_from_url';
}

function normalizeStubPages(job = {}) {
  const inputs = job.inputs || {};
  const pageUrl = typeof inputs.page_url === 'string' && inputs.page_url.trim() ? inputs.page_url.trim() : '';
  const pages = Array.isArray(inputs.pages)
    ? inputs.pages
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim())
    : [];
  const merged = [];
  const seen = new Set();
  [pageUrl, ...pages].forEach((entry) => {
    if (!entry || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    merged.push(entry);
  });
  return merged.slice(0, 20);
}

function pageFrameName(index, url = '') {
  const number = String(index).padStart(2, '0');
  const short = String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    .slice(0, 24);
  return short ? `Page ${number} - ${short}` : `Page ${number}`;
}

const PAGE_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 24,
  paddingRight: 32,
  paddingBottom: 24,
  paddingLeft: 32,
  itemSpacing: 12,
};

const SECTION_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  itemSpacing: 8,
};

function shouldForceLayoutFailure() {
  return process.env.C2F_LAYOUT_FAIL === '1';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeReason(error, fallback = 'codex_cli_failed') {
  const text = error && error.message ? String(error.message) : String(error || '');
  if (!text) {
    return fallback;
  }
  if (/codex_cli_target_path_blocked/.test(text)) {
    return 'codex_cli_target_path_blocked';
  }
  if (/codex_cli_network_policy_blocked/.test(text)) {
    return 'codex_cli_network_policy_blocked';
  }
  if (/codex_cli_timeout/.test(text)) {
    return 'codex_cli_timeout';
  }
  return fallback;
}

function collectSecretLens(job = {}) {
  const inputs = job && job.inputs ? job.inputs : {};
  const source = {
    FIGMA_TOKEN: inputs.figma_token || process.env.FIGMA_TOKEN || '',
    OPENAI_API_KEY: inputs.openai_api_key || process.env.OPENAI_API_KEY || '',
    ANTHROPIC_API_KEY: inputs.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
    JWT_SECRET: inputs.jwt_secret || process.env.JWT_SECRET || ''
  };
  const lenses = {};
  Object.entries(source).forEach(([key, value]) => {
    const text = String(value || '');
    lenses[key] = text.length;
  });
  return lenses;
}

function isBlockedNetworkHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  if (!host) {
    return true;
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split('.').map((part) => Number(part));
    if (octets[0] === 127 || octets[0] === 10) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }
  }
  return false;
}

function enforceCodexCliNetworkPolicy(job = {}) {
  const inputs = job && job.inputs ? job.inputs : {};
  const urls = [];
  if (typeof inputs.page_url === 'string' && inputs.page_url.trim()) {
    urls.push(inputs.page_url.trim());
  }
  if (Array.isArray(inputs.pages)) {
    inputs.pages
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .forEach((entry) => urls.push(entry.trim()));
  }
  for (const raw of urls) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('codex_cli_network_policy_blocked');
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error('codex_cli_network_policy_blocked');
    }
    if (isBlockedNetworkHost(parsed.hostname)) {
      throw new Error('codex_cli_network_policy_blocked');
    }
  }
}

function buildMinimalLayoutPayloadForPage(index, url, layoutMinimal, layoutApplied) {
  const sections = ['Section 01', 'Section 02'];
  const sectionChildren = sections.map((name) => ({
    type: 'FRAME',
    name,
    ...(layoutMinimal && layoutApplied ? SECTION_LAYOUT_MINIMAL : {}),
    children: [],
  }));
  return {
    index,
    url,
    payload: {
      frame: {
        type: 'FRAME',
        name: pageFrameName(index, url),
        ...(layoutMinimal && layoutApplied ? PAGE_LAYOUT_MINIMAL : {}),
        children: sectionChildren,
      },
    },
  };
}

function buildCodeToFigmaPayloadFromInputs(job = {}, provider = 'local_stub') {
  const pages = normalizeStubPages(job);
  const namingVersion = (job.inputs && job.inputs.naming_version) || '';
  const layoutMinimal = Boolean(job.inputs && job.inputs.layout_minimal);
  const layoutApplied = layoutMinimal && !shouldForceLayoutFailure();
  const layoutReason = layoutMinimal ? (layoutApplied ? '-' : 'layout_apply_failed') : 'layout_minimal_disabled';
  const frames = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    frameName: pageFrameName(index + 1, url),
    frameUrl: `https://www.figma.com/file/stub?node-id=${encodeURIComponent(`${provider}:${index + 1}`)}`,
    layoutApplied,
    layoutReason
  }));
  const progress = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    reason: '-'
  }));
  const framePayloads = pages.map((url, index) =>
    buildMinimalLayoutPayloadForPage(index + 1, url, layoutMinimal, layoutApplied)
  );
  return {
    pages,
    frames,
    progress,
    frame_payloads: framePayloads,
    reason: '-',
    naming_version: namingVersion,
    layout_minimal: layoutMinimal
  };
}

function buildCodeToFigmaMcpSuccess({
  job,
  handshake,
  targetPath,
  provider
}) {
  const codeToFigma = buildCodeToFigmaPayloadFromInputs(job, provider);
  const report = {
    ...handshake,
    provider,
    code_to_figma: codeToFigma
  };
  writeHandshakeArtifact(targetPath, report);
  return {
    status: 'ok',
    artifacts: [{ path: targetPath, kind: 'json' }],
    diff_summary: `${provider} code_to_figma report written to ${targetPath}`,
    checks: [
      { id: 'mcp_exec', ok: true, reason: `${provider} adapter completed` },
      { id: 'code_to_figma', ok: true, reason: `${provider} frames generated` }
    ],
    logs: ['runner_adapter=mcp', `provider=${provider}`, 'code_to_figma_mcp=ok', `handshake=${JSON.stringify(handshake)}`],
    evidence_paths: [targetPath],
    code_to_figma: codeToFigma
  };
}

function runLocalStub(job) {
  return new Promise((resolve) => {
    const stubPath = path.join(__dirname, '..', 'scripts', 'mcp-stub-runner.js');
    const child = spawn(process.execPath, [stubPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          status: 'error',
          errors: [stderr.trim() || 'local stub failed'],
          checks: [{ id: 'mcp_exec', ok: false, reason: stderr.trim() || 'local stub failed' }],
          logs: ['runner_adapter=mcp', stderr.trim()].filter(Boolean)
        });
        return;
      }
      try {
        const handshake = JSON.parse(stdout || '{}');
        const targetPath = (job.inputs && (job.inputs.target_path_resolved || job.inputs.target_path)) || '.ai-runs/handshake.json';
        if (isPhase1CodeToFigmaJob(job)) {
          resolve(
            buildCodeToFigmaMcpSuccess({
              job,
              handshake,
              targetPath,
              provider: 'local_stub'
            })
          );
          return;
        }
        writeHandshakeArtifact(targetPath, handshake);
        resolve({
          status: 'ok',
          artifacts: [{ path: targetPath, kind: 'json' }],
          diff_summary: `Local stub handshake written to ${targetPath}`,
          checks: [{ id: 'mcp_exec', ok: true, reason: 'local stub completed' }],
          logs: ['runner_adapter=mcp', `handshake=${JSON.stringify(handshake)}`],
          evidence_paths: [targetPath]
        });
      } catch (error) {
        resolve({
          status: 'error',
          errors: [error.message],
          checks: [{ id: 'mcp_exec', ok: false, reason: error.message }],
          logs: ['runner_adapter=mcp']
        });
      }
    });
    try {
      child.stdin.write(JSON.stringify(job));
    } catch (error) {
      // ignore
    }
    child.stdin.end();
  });
}

function runCodexCli(job) {
  const timeoutMs = parsePositiveInt(process.env.CODEX_CLI_TIMEOUT_MS, 45000);
  const delayMs = parsePositiveInt(process.env.CODEX_CLI_SIMULATE_MS, 0);
  const secretLens = collectSecretLens(job);
  const execute = async () => {
    const targetPath = resolveTargetPath(job);
    if (!targetPath.startsWith('.ai-runs/')) {
      throw new Error('codex_cli_target_path_blocked');
    }
    enforceCodexCliNetworkPolicy(job);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const handshake = {
      provider: 'codex-cli',
      job_type: job.job_type || 'unknown',
      delegated: true,
      ts: new Date().toISOString(),
      safety: {
        network_policy: 'enforced',
        path_scope: path.posix.dirname(targetPath),
        secret_lens: secretLens
      }
    };
    if (isPhase1CodeToFigmaJob(job)) {
      return buildCodeToFigmaMcpSuccess({
        job,
        handshake,
        targetPath,
        provider: 'codex-cli'
      });
    }
    writeHandshakeArtifact(targetPath, handshake, { allowedRoot: path.posix.dirname(targetPath) });
    return {
      status: 'ok',
      artifacts: [{ path: targetPath, kind: 'json' }],
      diff_summary: `codex-cli handshake written to ${targetPath}`,
      checks: [{ id: 'mcp_exec', ok: true, reason: 'codex-cli adapter completed' }],
      logs: [
        'runner_adapter=mcp',
        'provider=codex-cli',
        'network_policy=enforced',
        `target_scope=${path.posix.dirname(targetPath)}`,
        `secret_lens=${JSON.stringify(secretLens)}`,
        `handshake=${JSON.stringify(handshake)}`
      ],
      evidence_paths: [targetPath]
    };
  };

  const withTimeout = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('codex_cli_timeout')), ms);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });

  return withTimeout(execute(), timeoutMs).catch((error) => ({
    status: 'error',
    errors: [toSafeReason(error)],
    checks: [{ id: 'mcp_exec', ok: false, reason: toSafeReason(error) }],
    logs: [
      'runner_adapter=mcp',
      'provider=codex-cli',
      'network_policy=enforced',
      `secret_lens=${JSON.stringify(secretLens)}`
    ]
  }));
}

async function run(job) {
  const mode = (job && job.run_mode ? String(job.run_mode).toLowerCase() : 'local_stub');
  if (mode === 'mcp') {
    const provider = (job.inputs && job.inputs.mcp_provider) || 'local_stub';
    if (provider === 'local_stub') {
      return runLocalStub(job);
    }
    if (provider === 'codex-cli') {
      return runCodexCli(job);
    }
  }
  return runLocalStub(job);
}

module.exports = {
  run
};
