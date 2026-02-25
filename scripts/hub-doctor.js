#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const https = require('https');

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 10000,
    ...options
  });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const ok = result.status === 0 && !result.error;
  return {
    ok,
    status: result.status,
    stdout,
    stderr,
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function classifyNetworkError(error) {
  const code = error && error.code ? String(error.code) : '';
  if (['EPERM', 'EACCES', 'ENOENT'].includes(code)) {
    return { status: 'CHECK_BLOCKED', detail: code };
  }
  if (['EAI_AGAIN', 'ENOTFOUND', 'EAI_FAIL'].includes(code)) {
    return { status: 'CHECK_DNS_NG', detail: code };
  }
  return {
    status: 'CHECK_NET_NG',
    detail: code || (error && error.message ? error.message : String(error))
  };
}

function checkNetwork() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'HEAD',
        hostname: 'github.com',
        path: '/',
        timeout: 5000
      },
      (res) => {
        res.resume();
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        resolve({
          status: ok ? 'CHECK_OK' : 'CHECK_NET_NG',
          ok,
          detail: ok ? null : `HTTP ${res.statusCode}`
        });
      }
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (error) => {
      const classified = classifyNetworkError(error);
      resolve({
        status: classified.status,
        ok: false,
        detail: classified.detail
      });
    });
    req.end();
  });
}

function checkVersion(cmd, args) {
  const res = runCommand(cmd, args);
  return {
    ok: res.ok,
    version: res.ok ? res.stdout : null,
    detail: res.ok ? null : res.error || res.stderr || `${cmd} exit ${res.status}`
  };
}

function checkRepoWriteable(root) {
  const filename = `.hub-doctor-${process.pid}-${Date.now()}.tmp`;
  const target = path.join(root, filename);
  try {
    fs.writeFileSync(target, 'ok', 'utf8');
    fs.unlinkSync(target);
    return { ok: true, detail: null };
  } catch (error) {
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    } catch {
      // ignore cleanup errors
    }
    return { ok: false, detail: String(error && error.message ? error.message : error) };
  }
}

function parseNodeModuleVersions(message) {
  if (!message) return { required: null, found: null };
  const matches = [...message.matchAll(/NODE_MODULE_VERSION\s+(\d+)/g)].map((m) => m[1]);
  if (matches.length >= 2) {
    return { found: matches[0], required: matches[1] };
  }
  return { required: null, found: null };
}

async function main() {
  const cwd = process.cwd();
  const network = await checkNetwork();
  const nodeVersion = checkVersion('node', ['-v']);
  const npmVersion = checkVersion('npm', ['-v']);
  const nodeModules = checkVersion('node', ['-p', 'process.versions.modules']);
  const repoWritable = checkRepoWriteable(cwd);
  const envPath = path.join(cwd, '.env');
  const envPresent = fs.existsSync(envPath);

  let betterSqlite3 = null;
  try {
    require('better-sqlite3');
    betterSqlite3 = {
      ok: true,
      nodeModules: nodeModules.ok ? nodeModules.version : null,
      required: null,
      found: null
    };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    const versions = parseNodeModuleVersions(message);
    betterSqlite3 = {
      ok: false,
      nodeModules: nodeModules.ok ? nodeModules.version : null,
      required: versions.required,
      found: versions.found
    };
  }

  const payload = {
    timestamp: new Date().toISOString(),
    network,
    versions: {
      node: nodeVersion,
      npm: npmVersion
    },
    native: {
      better_sqlite3: betterSqlite3
    },
    repo: {
      writable: repoWritable
    },
    env: {
      present: envPresent
    }
  };

  const outputPath = path.join(cwd, 'doctor.json');
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [];
  lines.push(`NET: ${network.status}`);
  if (!network.ok && network.detail) {
    lines.push(`NET detail: ${network.detail}`);
    if (network.status === 'CHECK_DNS_NG') {
      lines.push('CHECK_DNS_NG: DNS failure. git/gh operations are prohibited.');
      lines.push('Recovery: bash scripts/fix-dns.sh');
    } else if (network.status === 'CHECK_BLOCKED') {
      lines.push('CHECK_BLOCKED: Network check blocked. git/gh operations are prohibited.');
      lines.push('Recovery: check container permissions / network policy.');
    } else {
      lines.push('CHECK_NET_NG: git/gh operations are prohibited.');
    }
  }
  lines.push(`node: ${nodeVersion.ok ? nodeVersion.version : 'NG'}`);
  if (!nodeVersion.ok && nodeVersion.detail) {
    lines.push(`node detail: ${nodeVersion.detail}`);
  }
  lines.push(`npm: ${npmVersion.ok ? npmVersion.version : 'NG'}`);
  if (!npmVersion.ok && npmVersion.detail) {
    lines.push(`npm detail: ${npmVersion.detail}`);
  }
  lines.push(`repo writable: ${repoWritable.ok ? 'OK' : 'NG'}`);
  if (!repoWritable.ok && repoWritable.detail) {
    lines.push(`repo detail: ${repoWritable.detail}`);
  }
  lines.push(`.env present: ${envPresent ? 'YES' : 'NO'}`);
  lines.push(`doctor.json: ${outputPath}`);

  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`[hub-doctor] FAILED: ${message}\n`);
  process.exit(1);
});
