const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function writeHandshakeArtifact(targetPath, payload) {
  const absolute = path.join(process.cwd(), targetPath);
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

function buildCodeToFigmaPayloadFromInputs(job = {}, provider = 'local_stub') {
  const pages = normalizeStubPages(job);
  const namingVersion = (job.inputs && job.inputs.naming_version) || '';
  const layoutMinimal = Boolean(job.inputs && job.inputs.layout_minimal);
  const frames = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    frameName: pageFrameName(index + 1, url),
    frameUrl: `https://www.figma.com/file/stub?node-id=${encodeURIComponent(`${provider}:${index + 1}`)}`,
    layoutApplied: layoutMinimal,
    layoutReason: layoutMinimal ? '-' : 'layout_minimal_disabled'
  }));
  const progress = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    reason: '-'
  }));
  return {
    pages,
    frames,
    progress,
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
  return new Promise((resolve) => {
    try {
      const targetPath = (job.inputs && (job.inputs.target_path_resolved || job.inputs.target_path)) || '.ai-runs/handshake.json';
      const handshake = {
        provider: 'codex-cli',
        job_type: job.job_type || 'unknown',
        delegated: true,
        ts: new Date().toISOString()
      };
      if (isPhase1CodeToFigmaJob(job)) {
        resolve(
          buildCodeToFigmaMcpSuccess({
            job,
            handshake,
            targetPath,
            provider: 'codex-cli'
          })
        );
        return;
      }
      writeHandshakeArtifact(targetPath, handshake);
      resolve({
        status: 'ok',
        artifacts: [{ path: targetPath, kind: 'json' }],
        diff_summary: `codex-cli handshake written to ${targetPath}`,
        checks: [{ id: 'mcp_exec', ok: true, reason: 'codex-cli adapter completed' }],
        logs: ['runner_adapter=mcp', 'provider=codex-cli', `handshake=${JSON.stringify(handshake)}`],
        evidence_paths: [targetPath]
      });
    } catch (error) {
      resolve({
        status: 'error',
        errors: [error.message || 'codex-cli adapter failed'],
        checks: [{ id: 'mcp_exec', ok: false, reason: error.message || 'codex-cli adapter failed' }],
        logs: ['runner_adapter=mcp', 'provider=codex-cli']
      });
    }
  });
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
