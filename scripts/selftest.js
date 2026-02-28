#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const { PassThrough } = require('stream');
const http = require('http');
const { validateJob } = require('../src/jobSpec');
const { callFigmaApi, normalizeDepth, sanitizeQuery } = require('../src/figma/api');
const { buildCodexPrompt } = require('../src/codex/prompt');
const { resolveHostPort } = require('../src/server/config');
const { createApp } = require('../src/server/app');
const { extractSameOriginLinks, normalizePageUrl } = require('./run-job');
const { runJobClient } = require('../src/runner/runJobClient');
const {
  createRunRecord,
  getRunById,
  transitionToRunning,
  expireTimedOutRuns
} = require('../src/db/runs');
const { db: hubDb, DEFAULT_TENANT } = require('../src/db');

const RUNS_ROOT = path.join(process.cwd(), '.ai-runs');

function loadSelftestRunners() {
  const dir = path.join(__dirname, '..', 'tests', 'selftest');
  const order = [
    'ms2_targetPath.test.js',
    'ms2_runs.test.js',
    'ms2_api_runs.test.js',
    'ms2_artifacts.test.js',
    'ms2_events.test.js',
    'ms4_targetPath_cases.test.js',
    'ms4_figma_verify.test.js',
    'integration_ms0_ms4.test.js'
  ];
  const runners = [];
  for (const name of order) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      console.warn(`[selftest] SKIP missing ${name}`);
      continue;
    }
    const mod = require(filePath);
    if (typeof mod.run !== 'function') {
      throw new Error(`[selftest] invalid selftest module: ${name} (missing run)`);
    }
    runners.push({ name, run: mod.run });
  }
  return runners;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function listRuns() {
  try {
    return new Set(fs.readdirSync(RUNS_ROOT));
  } catch (error) {
    return new Set();
  }
}

function snapshotRuns() {
  const snapshot = {};
  let entries = [];
  try {
    entries = fs.readdirSync(RUNS_ROOT);
  } catch (error) {
    return snapshot;
  }
  entries.forEach((name) => {
    if (!name || name.startsWith('.')) return;
    const fullPath = path.join(RUNS_ROOT, name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return;
    }
    snapshot[name] = { mtimeMs: stat.mtimeMs, isDir: stat.isDirectory() };
  });
  return snapshot;
}

function diffRuns(before, after) {
  const added = [];
  after.forEach((entry) => {
    if (!before.has(entry)) {
      added.push(entry);
    }
  });
  return added;
}

function resolveRunIdFromResult(result, before, beforeSnapshot, after, afterSnapshot, errorMessage) {
  if (result && result.run_id) {
    return String(result.run_id);
  }
  let newRuns = diffRuns(before, after);
  if (newRuns.length === 0) {
    const candidates = Object.entries(afterSnapshot)
      .filter(([, info]) => info && info.isDir)
      .filter(([name, info]) => !beforeSnapshot[name] || info.mtimeMs > beforeSnapshot[name].mtimeMs)
      .sort((a, b) => (b[1].mtimeMs || 0) - (a[1].mtimeMs || 0));
    if (candidates.length > 0) {
      newRuns = [candidates[0][0]];
    }
  }
  assert(newRuns.length === 1, errorMessage);
  return newRuns[0];
}

function validateLatestOfflineSmoke(latestSmokePath) {
  if (!fs.existsSync(latestSmokePath)) {
    throw new Error('latest_offline_smoke.json missing');
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(latestSmokePath, 'utf8'));
  } catch (error) {
    throw new Error('latest_offline_smoke.json invalid JSON');
  }
  const requiredKeys = ['runId', 'job_type', 'startedAt', 'finishedAt', 'status', 'summary'];
  for (const key of requiredKeys) {
    if (!(key in payload)) {
      throw new Error(`latest_offline_smoke.json missing key: ${key}`);
    }
  }
  const startMs = Date.parse(payload.startedAt);
  const endMs = Date.parse(payload.finishedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('latest_offline_smoke.json invalid timestamp');
  }
  if (endMs < startMs) {
    throw new Error('latest_offline_smoke.json finishedAt before startedAt');
  }
  const allowed = new Set(['ok', 'error', 'invalid']);
  if (!allowed.has(payload.status)) {
    throw new Error(`latest_offline_smoke.json invalid status: ${payload.status}`);
  }
  return payload;
}

function requestLocal(app, options = {}) {
  const { method = 'GET', path: requestPath = '/', headers = {}, body = null } = options;
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = method;
    req.url = requestPath;
    req.headers = headers;
    req.setEncoding = () => {};
    req.on('error', reject);

    const res = new PassThrough();
    const resHeaders = {};
    let statusCode = 200;
    Object.defineProperty(res, 'statusCode', {
      get() {
        return statusCode;
      },
      set(value) {
        statusCode = value;
      }
    });
    res.setHeader = (key, value) => {
      resHeaders[String(key).toLowerCase()] = value;
    };
    res.writeHead = (code, hdrs = {}) => {
      res.statusCode = code;
      Object.entries(hdrs).forEach(([k, v]) => {
        resHeaders[String(k).toLowerCase()] = v;
      });
    };
    const chunks = [];
    res.write = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    };
    res.end = (chunk) => {
      if (chunk) {
        res.write(chunk);
      }
      res.emit('finish');
      resolve({
        statusCode,
        headers: resHeaders,
        body: Buffer.concat(chunks).toString('utf8')
      });
    };
    res.on('error', reject);

    app(req, res);
    process.nextTick(() => {
      if (body) {
        req.write(body);
      }
      req.end();
    });
  });
}

function runJob(jobPath, extraEnv = {}) {
  return runJobWithRunId(jobPath, extraEnv).result;
}

function runJobWithRunId(jobPath, extraEnv = {}) {
  const before = listRuns();
  const beforeSnapshot = snapshotRuns();
  const result = spawnSync(process.execPath, ['scripts/run-job.js', '--job', jobPath, '--role', 'operator'], {
    encoding: 'utf8',
    timeout: 30000, // 30秒
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) {
    const stderrText = (result.stderr || '').trim();
    const lines = stderrText.split(/\r?\n/).filter(Boolean);
    const lastLine = lines.length ? lines[lines.length - 1] : '';
    if (lastLine.startsWith('run_dir_create_failed:')) {
      const reason = lastLine.replace('run_dir_create_failed:', '').trim() || 'unknown';
      throw new Error(`run-job.js did not create run directory: ${reason}`);
    }
    throw new Error(`run-job.js exited with ${result.status}: ${stderrText}`);
  }
  const stdout = result.stdout.trim();
  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.length ? lines[lines.length - 1] : '';
      payload = lastLine ? JSON.parse(lastLine) : null;
    }
  }
  let runId = payload && payload.run_id ? String(payload.run_id) : '';
  const after = listRuns();
  const afterSnapshot = snapshotRuns();
  let newRuns = diffRuns(before, after);
  if (!runId) {
    if (newRuns.length === 0) {
      const candidates = Object.entries(afterSnapshot)
        .filter(([, info]) => info && info.isDir)
        .filter(([name, info]) => !beforeSnapshot[name] || info.mtimeMs > beforeSnapshot[name].mtimeMs)
        .sort((a, b) => (b[1].mtimeMs || 0) - (a[1].mtimeMs || 0));
      if (candidates.length > 0) {
        newRuns = [candidates[0][0]];
      }
    }
    assert(newRuns.length === 1, 'run-job.js missing run directory (unexpected)');
    runId = newRuns[0];
  }
  if (!payload) {
    const runJsonPath = path.join(RUNS_ROOT, runId, 'run.json');
    assert(fs.existsSync(runJsonPath), 'run.json missing for fallback JSON');
    const diskPayload = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
    payload = diskPayload.runnerResult || diskPayload;
  }
  return { result: payload, runId, stdout };
}

function validateSamples() {
  const offlineJob = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-job.mcp.offline.smoke.json'), 'utf8')
  );
  const docsJob = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-job.docs.update.json'), 'utf8')
  );
  const repoJob = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-job.repo_patch.hub-static.json'), 'utf8')
  );
  assert(validateJob(offlineJob).ok, 'offline smoke sample fails validation');
  assert(validateJob(docsJob).ok, 'docs update sample fails validation');
  assert(validateJob(repoJob).ok, 'repo patch sample fails validation');
  validateOfflineFixture(offlineJob);
}

function normalizeJobForFixture(job) {
  const clone = JSON.parse(JSON.stringify(job));
  if (clone.provenance) {
    clone.provenance.issue = '<issue>';
    clone.provenance.operator = '<operator>';
  }
  return clone;
}

function validateOfflineFixture(sampleOfflineJob) {
  const fixturePath = path.join(process.cwd(), 'apps', 'hub', 'static', 'offline-job.fixture.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const normalizedFixture = JSON.stringify(normalizeJobForFixture(fixture));
  const normalizedSample = JSON.stringify(normalizeJobForFixture(sampleOfflineJob));
  assert(normalizedFixture === normalizedSample, 'offline job fixture drift vs sample-job.mcp.offline.smoke.json');
}

function verifyOfflineSmoke() {
  if (process.env.SKIP_INTEGRATION_TESTS === '1') {
    console.log('[selftest] SKIP_INTEGRATION_TESTS=1: skipping offline smoke');
    return;
  }
  const jobPath = path.join(__dirname, 'sample-job.mcp.offline.smoke.json');
  const before = listRuns();
  const beforeSnapshot = snapshotRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'offline smoke should succeed');
  const after = listRuns();
  const afterSnapshot = snapshotRuns();
  const runId = resolveRunIdFromResult(
    result,
    before,
    beforeSnapshot,
    after,
    afterSnapshot,
    'offline smoke should create one run directory'
  );
  const runDir = path.join(RUNS_ROOT, runId);
  assert(fs.existsSync(path.join(runDir, 'run.json')), 'run.json missing for offline smoke');
  assert(fs.existsSync(path.join(runDir, 'audit.jsonl')), 'audit.jsonl missing for offline smoke');
  assert(fs.existsSync(path.join(runDir, 'claude_mcp_smoketest.json')), 'claude_mcp_smoketest missing');
  const latestSmokePath = path.join(RUNS_ROOT, 'latest_offline_smoke.json');
  const latestSmoke = validateLatestOfflineSmoke(latestSmokePath);
  assert(latestSmoke.status === 'ok', 'latest_offline_smoke.json status should be ok after success');
  assert(latestSmoke.runId === runId, 'latest_offline_smoke.json runId should match latest success');

  const failBefore = listRuns();
  const failBeforeSnapshot = snapshotRuns();
  const failResult = runJob(jobPath, { C2F_STUB_FAIL: '1' });
  assert(failResult.status === 'error', 'offline smoke failure should be error');
  assert(
    Array.isArray(failResult.checks) && failResult.checks.some((c) => c.id === 'mcp_exec' && c.ok === false),
    'offline smoke failure must include mcp_exec check'
  );
  const failAfter = listRuns();
  const failAfterSnapshot = snapshotRuns();
  const failRunId = resolveRunIdFromResult(
    failResult,
    failBefore,
    failBeforeSnapshot,
    failAfter,
    failAfterSnapshot,
    'offline smoke failure should create run directory'
  );
  const failDir = path.join(RUNS_ROOT, failRunId);
  assert(fs.existsSync(path.join(failDir, 'run.json')), 'offline failure missing run.json');
  assert(fs.existsSync(path.join(failDir, 'audit.jsonl')), 'offline failure missing audit');
  const failLatest = validateLatestOfflineSmoke(latestSmokePath);
  assert(failLatest.status === 'error', 'latest_offline_smoke.json status should be error after failure');
  assert(failLatest.runId === failRunId, 'latest_offline_smoke.json runId should match latest failure');
}

function verifyDocsUpdate() {
  const jobPath = path.join(__dirname, 'sample-job.docs.update.json');
  const docsPath = path.join(process.cwd(), 'docs', '.selftest-doc.md');
  const original = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '# Selftest Doc\n';
  fs.writeFileSync(docsPath, original, 'utf8');
  const before = listRuns();
  const beforeSnapshot = snapshotRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'docs update job should succeed');
  const after = listRuns();
  const afterSnapshot = snapshotRuns();
  resolveRunIdFromResult(
    result,
    before,
    beforeSnapshot,
    after,
    afterSnapshot,
    'docs update should create run directory'
  );
  const updatedDoc = fs.readFileSync(docsPath, 'utf8');
  assert(updatedDoc.includes('Add selftest note'), 'docs instruction not applied');
  fs.writeFileSync(docsPath, original, 'utf8');
}

function verifyRepoPatch() {
  const jobPath = path.join(__dirname, 'sample-job.repo_patch.hub-static.json');
  const targetPath = path.join(process.cwd(), 'apps/hub/static/jobs.html');
  const original = fs.readFileSync(targetPath, 'utf8');
  const before = listRuns();
  const beforeSnapshot = snapshotRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'repo patch job should succeed');
  assert(
    Array.isArray(result.checks) && result.checks.some((c) => c.id === 'repo_patch' && c.ok),
    'repo patch check missing'
  );
  const after = listRuns();
  const afterSnapshot = snapshotRuns();
  resolveRunIdFromResult(
    result,
    before,
    beforeSnapshot,
    after,
    afterSnapshot,
    'repo patch should create run directory'
  );
  const updated = fs.readFileSync(targetPath, 'utf8');
  assert(updated.includes('repo_patch'), 'repo patch note missing');
  fs.writeFileSync(targetPath, original, 'utf8');
}

function verifyCodeToFigmaSummaryGuarantee() {
  const tmpJobPath = path.join(os.tmpdir(), `sample-job.code_to_figma.${Date.now()}.json`);
  const payload = {
    job_type: 'integration_hub.phase1.code_to_figma_from_url',
    goal: 'code to figma selftest',
    inputs: {
      message: 'code to figma selftest',
      target_path: '.ai-runs/{{run_id}}/code_to_figma_report.json',
      page_url: 'https://example.com',
      figma_file_key: 'CutkQD2XudkCe8eJ1jDfkZ'
    },
    constraints: {
      allowed_paths: ['.ai-runs/'],
      max_files_changed: 1,
      no_destructive_ops: true
    },
    acceptance_criteria: ['summary.md is always written'],
    provenance: {
      issue: '',
      operator: 'operator'
    },
    run_mode: 'mcp',
    output_language: 'ja',
    expected_artifacts: [
      { name: 'code_to_figma_report.json', description: 'report' },
      { name: 'summary.md', description: 'summary' }
    ]
  };
  fs.writeFileSync(tmpJobPath, JSON.stringify(payload, null, 2), 'utf8');
  try {
    const { result, runId } = runJobWithRunId(tmpJobPath, { FIGMA_TOKEN: '' });
    assert(result.status === 'error', 'code_to_figma should fail when FIGMA_TOKEN is missing');
    const summaryPath = path.join(RUNS_ROOT, runId, 'summary.md');
    assert(fs.existsSync(summaryPath), 'summary.md must exist even when code_to_figma fails');
    const summary = fs.readFileSync(summaryPath, 'utf8');
    assert(summary.includes('reason:'), 'summary must include failure reason');
    assert(summary.includes('nextAction:'), 'summary must include nextAction');
  } finally {
    try {
      fs.unlinkSync(tmpJobPath);
    } catch {
      // ignore
    }
  }
}

function verifyCodeToFigmaPageCollection() {
  const startUrl = normalizePageUrl('https://example.com/start');
  const html = [
    '<html><head><title>Start</title></head><body>',
    '<a href="/page-a">A</a>',
    '<a href="/page-b?x=1">B-query</a>',
    '<a href="/page-c#section">C-hash</a>',
    '<a href="https://example.com/page-a">A-dup</a>',
    '<a href="https://other.example.com/out">OUT</a>',
    '</body></html>'
  ].join('');
  const pages = extractSameOriginLinks(startUrl, html, 20);
  assert(Array.isArray(pages), 'extractSameOriginLinks should return array');
  assert(pages.length >= 1, 'pages_total should be >= 1');
  assert(pages[0] === startUrl, 'pages should include start URL first');
  assert(!pages.some((url) => String(url).includes('?')), 'pages should exclude query URLs');
  assert(pages.includes('https://example.com/page-a'), 'same-origin link should be included');
  assert(pages.includes('https://example.com/page-c'), 'hash should be removed from collected URLs');
}

function verifyCodeToFigmaProgressLogs() {
  const tmpJobPath = path.join(os.tmpdir(), `sample-job.code_to_figma.progress.${Date.now()}.json`);
  const payload = {
    job_type: 'integration_hub.phase1.code_to_figma_from_url',
    goal: 'code to figma progress selftest',
    inputs: {
      message: 'code to figma progress',
      target_path: '.ai-runs/{{run_id}}/code_to_figma_report.json',
      page_url:
        'data:text/html,<html><title>Landing</title><body><h1>Hero</h1><p>Alpha</p><p>Beta</p></body></html>',
      pages: [
        'data:text/html,<html><title>Landing</title><body><h1>Hero</h1><p>Alpha</p><p>Beta</p></body></html>',
        'data:text/html,__force_fail__',
        'data:text/html,<html><title>p3</title><body><p>three</p></body></html>'
      ],
      figma_file_key: 'CutkQD2XudkCe8eJ1jDfkZ'
    },
    constraints: {
      allowed_paths: ['.ai-runs/'],
      max_files_changed: 1,
      no_destructive_ops: true
    },
    acceptance_criteria: ['progress logs must be ordered'],
    provenance: {
      issue: '',
      operator: 'operator'
    },
    run_mode: 'mcp',
    output_language: 'ja',
    expected_artifacts: [
      { name: 'code_to_figma_report.json', description: 'report' },
      { name: 'summary.md', description: 'summary' }
    ]
  };
  fs.writeFileSync(tmpJobPath, JSON.stringify(payload, null, 2), 'utf8');
  try {
    const { result, runId, stdout } = runJobWithRunId(tmpJobPath, {
      FIGMA_TOKEN: 'dummy_token_for_mock',
      FIGMA_API_MOCK: '1'
    });
    assert(result.status === 'ok', 'code_to_figma should continue and finish when one page fails');
    const logLines = Array.isArray(result.logs) ? result.logs : [];
    const streamLines = stdout.split(/\r?\n/).filter(Boolean);
    const combined = logLines.length > 0 ? logLines : streamLines;
    const discoveredLine = combined.find((line) => line.startsWith('PAGE_DISCOVERED total='));
    const discoveredMatch = discoveredLine ? discoveredLine.match(/total=(\d+)/) : null;
    assert(discoveredMatch, 'PAGE_DISCOVERED should be logged');
    const total = Number(discoveredMatch[1]);
    assert(total >= 3, 'PAGE_DISCOVERED total should be >= 3');
    const lines = combined;

    let cursor = 0;
    for (let i = 1; i <= total; i += 1) {
      const startPrefix = `PAGE_PROCESS_START ${i}/${total}`;
      const donePrefix = `PAGE_PROCESS_DONE ${i}/${total} status=`;
      const startAt = lines.findIndex((line, idx) => idx >= cursor && line.startsWith(startPrefix));
      assert(startAt >= 0, `missing progress log prefix: ${startPrefix}`);
      const doneAt = lines.findIndex((line, idx) => idx > startAt && line.startsWith(donePrefix));
      assert(doneAt >= 0, `missing progress log prefix: ${donePrefix}`);
      cursor = doneAt + 1;
    }
    const failedAt = lines.findIndex((line) => line.includes('PAGE_PROCESS_DONE') && line.includes('status=failed'));
    assert(failedAt >= 0, 'progress logs should include at least one failed page');
    const continuedAfterFailure = lines.findIndex(
      (line, idx) => idx > failedAt && line.startsWith('PAGE_PROCESS_START ')
    );
    assert(continuedAfterFailure >= 0, 'processing should continue after one failed page');

    const summaryPath = path.join(RUNS_ROOT, runId, 'summary.md');
    assert(fs.existsSync(summaryPath), 'summary.md must exist for progress run');
    const summary = fs.readFileSync(summaryPath, 'utf8');
    assert(summary.includes('naming_version: p1-04.v1'), 'summary should include naming_version');
    const successFrames = summary
      .split(/\r?\n/)
      .filter((line) => line.includes('- frames[]:') && line.includes('status: success')).length;
    const successLogs = lines.filter((line) => line.startsWith('PAGE_PROCESS_DONE') && line.includes('status=success')).length;
    assert(successFrames === successLogs, 'frames[] success entries should match successful page count');
    const summaryLines = summary.split(/\r?\n/).filter((line) => line.includes('- frames[]:'));
    assert(summaryLines.some((line) => line.includes('layoutApplied: true')), 'summary should record layoutApplied=true');
    assert(summaryLines.some((line) => line.includes('layoutApplied: false')), 'summary should record layoutApplied=false');
    assert(summaryLines.every((line) => line.includes('layoutReason:')), 'summary frames[] should include layoutReason');

    const payloadPath = path.join(RUNS_ROOT, runId, 'figma_nodes_payload.json');
    assert(fs.existsSync(payloadPath), 'figma_nodes_payload.json must exist');
    const payloadJson = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const frame = payloadJson && payloadJson.frame ? payloadJson.frame : {};
    assert(frame.layoutMode === 'VERTICAL', 'page frame should use vertical auto layout');
    const names = [frame.name]
      .concat(Array.isArray(frame.children) ? frame.children.map((node) => node && node.name).filter(Boolean) : [])
      .filter(Boolean);
    assert(!names.some((name) => /\b(h1|h2|h3|p|a)\b/i.test(String(name))), 'layer names must not be tag-derived');
    const sectionNames = names.filter((name) => /^Section \d{2}$/.test(String(name)));
    assert(sectionNames.length >= 2, 'section names should exist and be multiple');
    const sections = (Array.isArray(frame.children) ? frame.children : []).filter(
      (node) => node && /^Section \d{2}$/.test(String(node.name))
    );
    assert(sections.length >= 2, 'section nodes should exist');
    sections.forEach((section) => {
      assert(section.layoutMode === 'VERTICAL', 'section should use vertical auto layout');
      assert(section.layoutAlign === 'STRETCH', 'section should use fill container');
    });
    sectionNames.forEach((name, idx) => {
      const expected = `Section ${String(idx + 1).padStart(2, '0')}`;
      assert(name === expected, `section numbering should be stable (${expected})`);
    });
  } finally {
    try {
      fs.unlinkSync(tmpJobPath);
    } catch {
      // ignore
    }
  }
}

function verifyCodeToFigmaMcpLocalStubFrames() {
  const tmpJobPath = path.join(os.tmpdir(), `sample-job.code_to_figma.mcp_local_stub.${Date.now()}.json`);
  const payload = {
    job_type: 'integration_hub.phase1.code_to_figma_from_url',
    goal: 'code to figma mcp local_stub selftest',
    inputs: {
      message: 'code to figma mcp local_stub',
      target_path: '.ai-runs/{{run_id}}/code_to_figma_report.json',
      page_url: 'https://example.com/start',
      pages: ['https://example.com/start', 'https://example.com/about'],
      figma_file_key: 'CutkQD2XudkCe8eJ1jDfkZ',
      mcp_provider: 'local_stub'
    },
    constraints: {
      allowed_paths: ['.ai-runs/'],
      max_files_changed: 1,
      no_destructive_ops: true
    },
    acceptance_criteria: ['local_stub mcp returns frames/progress'],
    provenance: {
      issue: '',
      operator: 'operator'
    },
    run_mode: 'mcp',
    output_language: 'ja',
    expected_artifacts: [
      { name: 'code_to_figma_report.json', description: 'report' },
      { name: 'summary.md', description: 'summary' }
    ]
  };
  fs.writeFileSync(tmpJobPath, JSON.stringify(payload, null, 2), 'utf8');
  try {
    const { result, runId } = runJobWithRunId(tmpJobPath, {});
    assert(result.status === 'ok', 'code_to_figma should succeed via mcp local_stub');
    const summaryPath = path.join(RUNS_ROOT, runId, 'summary.md');
    assert(fs.existsSync(summaryPath), 'summary.md must exist for mcp local_stub run');
    const summary = fs.readFileSync(summaryPath, 'utf8');
    assert(summary.includes('mcp_attempt: { status: ok, reason: - }'), 'summary should record successful mcp attempt');
    const frameLines = summary
      .split(/\r?\n/)
      .filter((line) => line.includes('- frames[]:') && line.includes('status: success'));
    assert(frameLines.length >= 2, 'summary should include success frames from mcp local_stub');
  } finally {
    try {
      fs.unlinkSync(tmpJobPath);
    } catch {
      // ignore
    }
  }
}

function verifyCodeToFigmaMcpProviderSchemaInvariant() {
  function runProviderCase(provider) {
    const tmpJobPath = path.join(os.tmpdir(), `sample-job.code_to_figma.mcp_provider.${provider}.${Date.now()}.json`);
    const payload = {
      job_type: 'integration_hub.phase1.code_to_figma_from_url',
      goal: `code to figma mcp provider ${provider} selftest`,
      inputs: {
        message: `code to figma mcp provider ${provider}`,
        target_path: '.ai-runs/{{run_id}}/code_to_figma_report.json',
        page_url: 'https://example.com/start',
        pages: ['https://example.com/start', 'https://example.com/about'],
        figma_file_key: 'CutkQD2XudkCe8eJ1jDfkZ',
        mcp_provider: provider
      },
      constraints: {
        allowed_paths: ['.ai-runs/'],
        max_files_changed: 1,
        no_destructive_ops: true
      },
      acceptance_criteria: ['provider switch keeps summary schema'],
      provenance: {
        issue: '',
        operator: 'operator'
      },
      run_mode: 'mcp',
      output_language: 'ja',
      expected_artifacts: [
        { name: 'code_to_figma_report.json', description: 'report' },
        { name: 'summary.md', description: 'summary' }
      ]
    };
    fs.writeFileSync(tmpJobPath, JSON.stringify(payload, null, 2), 'utf8');
    try {
      const { result, runId } = runJobWithRunId(tmpJobPath, {});
      assert(result.status === 'ok', `${provider} run should succeed`);
      const summaryPath = path.join(RUNS_ROOT, runId, 'summary.md');
      assert(fs.existsSync(summaryPath), `${provider} summary.md must exist`);
      const summary = fs.readFileSync(summaryPath, 'utf8');
      const frameLine = summary
        .split(/\r?\n/)
        .find((line) => line.includes('- frames[]:') && line.includes('status: success'));
      assert(frameLine, `${provider} summary should include success frame line`);
      assert(frameLine.includes('index:'), `${provider} frame schema should include index`);
      assert(frameLine.includes('url:'), `${provider} frame schema should include url`);
      assert(frameLine.includes('status:'), `${provider} frame schema should include status`);
      assert(frameLine.includes('frameUrl:'), `${provider} frame schema should include frameUrl`);
      assert(frameLine.includes('layoutApplied:'), `${provider} frame schema should include layoutApplied`);
      assert(frameLine.includes('layoutReason:'), `${provider} frame schema should include layoutReason`);
      const progressLine = summary
        .split(/\r?\n/)
        .find((line) => line.includes('- progress[]:'));
      assert(progressLine, `${provider} summary should include progress line`);
      assert(progressLine.includes('index:'), `${provider} progress schema should include index`);
      assert(progressLine.includes('url:'), `${provider} progress schema should include url`);
      assert(progressLine.includes('status:'), `${provider} progress schema should include status`);
      assert(progressLine.includes('reason:'), `${provider} progress schema should include reason`);
      return { frameLine, progressLine };
    } finally {
      try {
        fs.unlinkSync(tmpJobPath);
      } catch {
        // ignore
      }
    }
  }

  const local = runProviderCase('local_stub');
  const codex = runProviderCase('codex-cli');
  const normalize = (line) =>
    String(line)
      .replace(/\{.*\}/, '{...}')
      .replace(/\s+/g, ' ')
      .trim();
  assert(normalize(local.frameLine) === normalize(codex.frameLine), 'provider switch should keep frames[] summary schema');
  assert(
    normalize(local.progressLine) === normalize(codex.progressLine),
    'provider switch should keep progress[] summary schema'
  );
}

async function verifyFigmaDepthNormalization() {
  assert(normalizeDepth(undefined) === undefined, 'undefined depth should remain undefined');
  assert(normalizeDepth(null) === undefined, 'null depth should remain undefined');
  assert(normalizeDepth(0) === 1, 'depth 0 should normalize to 1');
  assert(normalizeDepth('0') === 1, 'string depth "0" should normalize to 1');
  assert(normalizeDepth('2.8') === 2, 'non-integer depth should be floored');
  const sanitizedZero = sanitizeQuery({ depth: 0, foo: 'bar' });
  assert(sanitizedZero.depth === 1, 'sanitized depth 0 should become 1');
  const sanitizedString = sanitizeQuery({ depth: '0' });
  assert(sanitizedString.depth === 1, 'sanitized string depth "0" should become 1');
  const sanitizedEmpty = sanitizeQuery({});
  assert(!('depth' in sanitizedEmpty), 'unspecified depth should not appear in query');

  const prevMock = process.env.FIGMA_API_MOCK;
  const prevDebug = process.env.FIGMA_DEBUG;
  process.env.FIGMA_API_MOCK = '1';
  process.env.FIGMA_DEBUG = '1';
  try {
    const depthCall = await callFigmaApi({
      token: 'mock-token',
      endpoint: '/files/mock-depth',
      query: { depth: 0 }
    });
    assert(depthCall.debug && depthCall.debug.query.depth === 1, 'callFigmaApi should normalize depth to >=1');

    const undefinedCall = await callFigmaApi({
      token: 'mock-token',
      endpoint: '/files/mock-none',
      query: { depth: undefined }
    });
    assert(undefinedCall.debug && !('depth' in undefinedCall.debug.query), 'callFigmaApi should omit undefined depth');
  } finally {
    if (prevMock === undefined) {
      delete process.env.FIGMA_API_MOCK;
    } else {
      process.env.FIGMA_API_MOCK = prevMock;
    }
    if (prevDebug === undefined) {
      delete process.env.FIGMA_DEBUG;
    } else {
      process.env.FIGMA_DEBUG = prevDebug;
    }
  }
}

function verifyCodexPromptHeader() {
  const originalEnv = process.env.CODEX_OUTPUT_LANG;
  const truthy = (value) => /^(1|true|yes)$/i.test(String(value || ''));
  const ciMode = truthy(process.env.CI);
  const initialLang = (originalEnv || '').toLowerCase();
  const allowEn = truthy(process.env.ALLOW_CODEX_EN);
  if (ciMode && initialLang === 'en' && !allowEn) {
    throw new Error('CODEX_OUTPUT_LANG=en is blocked in CI unless ALLOW_CODEX_EN=1 (or true/yes).');
  }

  delete process.env.CODEX_OUTPUT_LANG;
  const defaultPrompt = buildCodexPrompt('デフォルト指示');
  assert(defaultPrompt.includes('出力言語は常に日本語です。'), 'Default codex prompt must mention Japanese language rule');
  assert(defaultPrompt.includes('更新内容') && defaultPrompt.includes('手順'), 'Default codex prompt must outline Japanese headings');

  process.env.CODEX_OUTPUT_LANG = 'ja';
  const prompt = buildCodexPrompt('テスト指示');
  assert(prompt.includes('出力言語は常に日本語です。'), 'Japanese policy must mention language rule');
  assert(prompt.includes('更新内容') && prompt.includes('手順') && prompt.includes('次のステップ'), 'Japanese policy must outline heading requirements');

  process.env.CODEX_OUTPUT_LANG = 'en';
  const englishPrompt = buildCodexPrompt('Test instructions');
  assert(englishPrompt.includes('Always respond in English.'), 'English codex prompt must switch when env override is set');
  assert(!englishPrompt.includes('出力言語は常に日本語です。'), 'English codex prompt must not include Japanese header');

  if (originalEnv === undefined) {
    delete process.env.CODEX_OUTPUT_LANG;
  } else {
    process.env.CODEX_OUTPUT_LANG = originalEnv;
  }
}

function verifyFigmaPlanGuarantee() {
  const samplePath = path.join(__dirname, 'sample-job.figma_bootstrap.json');
  if (!fs.existsSync(samplePath)) {
    console.warn('figma bootstrap sample missing; skipping plan guarantee test');
    return;
  }
  const baseJob = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const tempFiles = [];
  const createTempJob = (suffix, mutator) => {
    const clone = JSON.parse(JSON.stringify(baseJob));
    mutator(clone);
    const tempPath = path.join(__dirname, `sample-job.figma_bootstrap.${suffix}.json`);
    fs.writeFileSync(tempPath, JSON.stringify(clone, null, 2));
    tempFiles.push(tempPath);
    return tempPath;
  };
  const cleanup = () => {
    tempFiles.forEach((file) => {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    });
  };

  try {
    const invalidTargetJob = createTempJob('invalid_target', (job) => {
      job.inputs.target_path = 'vault/targets/DOES_NOT_EXIST/figma_plan.json';
    });
    const invalidRun = runJobWithRunId(invalidTargetJob);
    assert(invalidRun.result.status === 'error', 'invalid target path should produce error status');
    const invalidPlanPath = path.join(RUNS_ROOT, invalidRun.runId, 'figma_bootstrap_plan.json');
    assert(fs.existsSync(invalidPlanPath), 'plan file missing for invalid target path');
    const invalidPlan = JSON.parse(fs.readFileSync(invalidPlanPath, 'utf8'));
    assert(invalidPlan.status === 'error', 'plan status should be error when job fails before planning completes');
    assert(Array.isArray(invalidPlan.errors) && invalidPlan.errors.length > 0, 'plan errors missing for invalid target path');
    assert(invalidPlan.errors[0].where === 'constraints', 'plan error should record constraints failure');

    const missingRepoJob = createTempJob('missing_repo', (job) => {
      job.inputs.repo_local_path = 'vault/targets/does-not-exist';
    });
    const missingRun = runJobWithRunId(missingRepoJob);
    assert(missingRun.result.status === 'error', 'missing repo directory should produce error status');
    const missingPlanPath = path.join(RUNS_ROOT, missingRun.runId, 'figma_bootstrap_plan.json');
    assert(fs.existsSync(missingPlanPath), 'plan file missing for missing repo directory');
    const missingPlan = JSON.parse(fs.readFileSync(missingPlanPath, 'utf8'));
    assert(Array.isArray(missingPlan.errors) && missingPlan.errors.length > 0, 'plan errors missing for missing repo directory');
    assert(missingPlan.errors[0].where === 'resolveRepoRoot', 'plan error should capture resolveRepoRoot failure');
    assert(
      typeof missingPlan.errors[0].root === 'string' && missingPlan.errors[0].root.includes('vault/targets/does-not-exist'),
      'plan error root should include repo_local_path'
    );
  } finally {
    cleanup();
  }
}

async function verifyServerRoutes() {
  const app = createApp();
  const jobs = await requestLocal(app, { path: '/jobs' });
  assert(jobs.statusCode === 200, '/jobs should return 200');
  const jobsHead = await requestLocal(app, { method: 'HEAD', path: '/jobs' });
  assert(jobsHead.statusCode === 200, 'HEAD /jobs should return 200');
  const notFound = await requestLocal(app, { path: '/does-not-exist' });
  assert(notFound.statusCode === 404, 'Unknown path should return 404');
  const connections = await requestLocal(app, { path: '/connections' });
  assert(connections.statusCode === 200, '/connections UI should be available');
  const connectors = await requestLocal(app, { path: '/connectors' });
  assert(connectors.statusCode === 200, '/connectors UI should be available');
  const runs = await requestLocal(app, { path: '/runs' });
  assert(runs.statusCode === 200, '/runs UI should be available');
}

function verifyCleanupRunsScript() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-runs-'));
  const runsDir = path.join(tmpRoot, '.ai-runs');
  const dayMs = 24 * 60 * 60 * 1000;
  const names = ['ml000000-abcdef', 'ml000001-abcdee', 'ml000002-abcddd', 'ml000003-abcdcc'];
  const agesInDays = [0, 0.5, 2, 3];

  function seedRuns() {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.mkdirSync(runsDir, { recursive: true });
    names.forEach((name, idx) => {
      const dir = path.join(runsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), '{}');
      const mtime = new Date(Date.now() - agesInDays[idx] * dayMs);
      fs.utimesSync(dir, mtime, mtime);
    });
    fs.writeFileSync(path.join(runsDir, 'README.md'), 'leave me'); // ignored by pattern
  }

  const listRunsLocal = () =>
    fs
      .readdirSync(runsDir)
      .filter((name) => !name.startsWith('.'))
      .sort();

  seedRuns();
  const dryRun = spawnSync('node', ['scripts/cleanup-runs.js', '--dir', runsDir, '--keep', '2'], {
    encoding: 'utf8',
    timeout: 30000 // 30秒
  });
  assert(dryRun.status === 0, 'cleanup-runs dry-run should exit 0');
  const afterDry = listRunsLocal();
  assert(afterDry.length === names.length + 1, 'dry-run must not delete directories or files');
  assert(afterDry.includes('README.md'), 'non-run files should remain untouched');

  const applyKeep = spawnSync('node', ['scripts/cleanup-runs.js', '--dir', runsDir, '--keep', '2', '--apply'], {
    encoding: 'utf8',
    timeout: 30000 // 30秒
  });
  assert(applyKeep.status === 0, 'cleanup-runs apply should exit 0');
  const remainingKeep = listRunsLocal().filter((name) => name !== 'README.md');
  assert(remainingKeep.length === 2, 'cleanup-runs should leave 2 directories when keep=2');
  assert(remainingKeep[0] === names[0] && remainingKeep[1] === names[1], 'cleanup-runs should keep newest directories');

  seedRuns();
  const applyDays = spawnSync('node', ['scripts/cleanup-runs.js', '--dir', runsDir, '--days', '1', '--apply'], {
    encoding: 'utf8',
    timeout: 30000 // 30秒
  });
  assert(applyDays.status === 0, 'cleanup-runs days filter should exit 0');
  const remainingDays = listRunsLocal().filter((name) => name !== 'README.md');
  assert(remainingDays.length === 2 && remainingDays[0] === names[0] && remainingDays[1] === names[1], '--days should remove entries older than threshold');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function verifyServerHostPortResolver() {
  const fallback = resolveHostPort({});
  assert(fallback.host === '127.0.0.1', 'Default host should be 127.0.0.1');
  assert(fallback.port === 3100, 'Default port should be 3100');
  const custom = resolveHostPort({ HOST: '0.0.0.0', PORT: '3200' });
  assert(custom.host === '0.0.0.0', 'Custom host should be preserved');
  assert(custom.port === 3200, 'Custom port should parse integers');
  const hubPort = resolveHostPort({ HUB_PORT: '3150' });
  assert(hubPort.port === 3150, 'HUB_PORT fallback should apply');
  const invalid = resolveHostPort({ PORT: 'abc' });
  assert(invalid.port === 3100, 'Invalid port falls back to default');
}

function verifyNoEnglishTemplateLeak() {
  const tokens = ['Up' + 'dates', 'Tes' + 'ts', 'Natural next ' + 'step', 'Next ' + 'step'];
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`);
  const allowed = new Set(['src/codex/policies/en.md', 'AI_DEV_POLICY.md']);
  const skipDirs = new Set(['.git', '.ai-runs', 'node_modules', '.codex', '.github', 'vault']);
  const matches = [];
  const root = process.cwd();

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(root, absPath);

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) return;
        walk(absPath);
        return;
      }
      if (!entry.isFile()) return;
      if (allowed.has(relPath)) return;

      let content;
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        return;
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          matches.push(`${relPath}:${idx + 1}:${line.trim()}`);
        }
      });
    });
  };

  walk(root);
  if (matches.length > 0) {
    throw new Error(`English template tokens detected outside allowlist:\n${matches.slice(0, 5).join('\n')}`);
  }
}

function verifyPhase2SamplesExist() {
  // Keep this lightweight: existence only (no execution, no network).
  const paths = [
    'scripts/sample-job.mcp.offline.smoke.json',
    'scripts/sample-job.docs.update.json',
    'scripts/sample-job.repo_patch.hub-static.json',
    'scripts/sample-job.spawn_smoke.json',
    'scripts/sample-job.diagnostics.json',
    'scripts/sample-job.openai_exec_smoke.json',
    'docs/.selftest-doc.md',
    'apps/hub/static/offline-job.fixture.json'
  ];

  for (const fp of paths) {
    if (!fs.existsSync(fp)) {
      throw new Error(`missing: ${fp}`);
    }
  }

  console.log('[selftest] OK: phase2 samples/docs exist');
}

function verifyHubDoctor() {
  const outputPath = path.join(process.cwd(), 'doctor.json');
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  } catch {
    // ignore cleanup failures
  }

  const result = spawnSync(process.execPath, ['scripts/hub-doctor.js'], {
    encoding: 'utf8',
    timeout: 30000 // 30秒
  });
  assert(result.status === 0, `hub-doctor.js exited with ${result.status}: ${result.stderr}`);
  assert(fs.existsSync(outputPath), 'doctor.json missing after hub-doctor.js');
  const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert(payload && payload.network && payload.versions, 'doctor.json missing required fields');
  assert(
    ['CHECK_OK', 'CHECK_NET_NG', 'CHECK_DNS_NG', 'CHECK_BLOCKED'].includes(payload.network.status),
    'invalid network status'
  );
  assert(payload.versions.node && payload.versions.npm, 'doctor.json missing version entries');
  assert(payload.native && payload.native.better_sqlite3, 'doctor.json missing native.better_sqlite3');
  assert(
    'nodeModules' in payload.native.better_sqlite3,
    'doctor.json missing native.better_sqlite3.nodeModules'
  );
}

function verifyPrUpFlowLock() {
  const prUpPath = path.join(process.cwd(), 'scripts', 'pr-up.js');
  const text = fs.readFileSync(prUpPath, 'utf8');
  assert(text.includes('function shNodeTool('), 'pr-up.js must use shNodeTool wrapper');
  assert(
    text.includes('ネットワーク診断はNGですが、push/gh を継続して実行します。'),
    'pr-up.js must not abort only on NET_NG'
  );
  assert(text.includes('shNodeTool("npm", ["test"]'), 'pr-up.js must run npm test via shNodeTool');
  assert(
    text.includes('shNodeTool("node", ["scripts/gen-pr-body.js"]'),
    'pr-up.js must run gen-pr-body via shNodeTool'
  );
}

async function verifyRunJobClientDepth() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        payload = {};
      }
      received.push(payload);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const originalRequest = http.request;
  http.request = (options, callback) => {
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.destroy = (error) => {
      if (error) req.emit('error', error);
    };

    const res = new PassThrough();
    const resHeaders = {};
    res.headers = resHeaders;
    res.setHeader = (key, value) => {
      resHeaders[String(key).toLowerCase()] = value;
    };
    res.writeHead = (code, hdrs = {}) => {
      res.statusCode = code;
      Object.entries(hdrs).forEach(([k, v]) => {
        resHeaders[String(k).toLowerCase()] = v;
      });
    };
    res.statusCode = 200;

    if (callback) callback(res);
    process.nextTick(() => {
      server.emit('request', req, res);
    });
    return req;
  };

  try {
    const url = 'http://localhost/run-job';
    await runJobClient({ url, inputs: { depth: 3, foo: 'bar' }, job_type: 'test' });
    await runJobClient({ url, inputs: { depth: null, foo: 'bar' }, job_type: 'test' });
    await runJobClient({ url, inputs: { foo: 'bar' }, job_type: 'test' });

    assert(received.length === 3, 'runJobClient should send three requests');
    assert(received[0].inputs.depth === 3, 'depth should be included when number');
    assert(!('depth' in received[1].inputs), 'depth should be omitted when null');
    assert(!('depth' in received[2].inputs), 'depth should be omitted when absent');
  } finally {
    http.request = originalRequest;
  }
}

async function verifyRunTimeout() {
  const projectId = `selftest-${Date.now()}`;
  const runId = createRunRecord({
    tenantId: DEFAULT_TENANT,
    projectId,
    inputsJson: { message: 'timeout test' }
  });
  const moved = transitionToRunning({ tenantId: DEFAULT_TENANT, runId });
  assert(moved, 'transition to running should succeed');

  const past = new Date(Date.now() - 500).toISOString();
  hubDb.prepare("UPDATE runs SET updated_at=? WHERE tenant_id=? AND id=?").run(past, DEFAULT_TENANT, runId);

  const prevTimeout = process.env.RUN_TIMEOUT_MS;
  process.env.RUN_TIMEOUT_MS = '100';
  try {
    const expired = expireTimedOutRuns({ tenantId: DEFAULT_TENANT });
    assert(expired >= 1, 'expireTimedOutRuns should mark at least one run');
    const run = getRunById({ tenantId: DEFAULT_TENANT, runId });
    assert(run.status === 'failed', 'timed out run should be failed');
    assert(run.failure_code === 'service_unavailable', 'timed out run should set failure_code');
  } finally {
    if (prevTimeout === undefined) {
      delete process.env.RUN_TIMEOUT_MS;
    } else {
      process.env.RUN_TIMEOUT_MS = prevTimeout;
    }
    hubDb.prepare("DELETE FROM runs WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, runId);
  }
}

async function main() {
  validateSamples();
  verifyOfflineSmoke();
  verifyDocsUpdate();
  verifyRepoPatch();
  verifyCodeToFigmaSummaryGuarantee();
  verifyCodeToFigmaPageCollection();
  verifyCodeToFigmaProgressLogs();
  verifyCodeToFigmaMcpLocalStubFrames();
  verifyCodeToFigmaMcpProviderSchemaInvariant();
  verifyCodexPromptHeader();
  verifyNoEnglishTemplateLeak();
  verifyCleanupRunsScript();
  verifyServerHostPortResolver();
  await verifyServerRoutes();
  await verifyFigmaDepthNormalization();
  verifyFigmaPlanGuarantee();
  verifyPhase2SamplesExist();
  verifyHubDoctor();
  verifyPrUpFlowLock();
  await verifyRunJobClientDepth();
  await verifyRunTimeout();
  const runners = loadSelftestRunners();
  for (const runner of runners) {
    await runner.run();
  }
  console.log('Selftest ok');
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
