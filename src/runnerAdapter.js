const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function writeHandshakeArtifact(targetPath, payload) {
  const absolute = path.join(process.cwd(), targetPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2));
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

async function run(job) {
  const mode = (job && job.run_mode ? String(job.run_mode).toLowerCase() : 'local_stub');
  if (mode === 'mcp') {
    const provider = (job.inputs && job.inputs.mcp_provider) || 'local_stub';
    if (provider === 'local_stub') {
      return runLocalStub(job);
    }
  }
  return runLocalStub(job);
}

module.exports = {
  run
};
