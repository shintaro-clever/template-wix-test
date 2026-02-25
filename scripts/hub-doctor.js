#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function checkNetwork() {
  const res = runCommand('curl', ['-fsSI', '-o', '/dev/null', 'https://github.com']);
  const status = res.ok ? 'NET_OK' : 'NET_NG';
  return {
    status,
    ok: res.ok,
    detail: res.ok ? null : res.error || res.stderr || `curl exit ${res.status}`
  };
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

function main() {
  const cwd = process.cwd();
  const network = checkNetwork();
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
    lines.push('NET_NG: git/gh operations are prohibited.');
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

main();
