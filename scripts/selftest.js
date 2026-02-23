#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateJob } = require('../src/jobSpec');

const RUNS_ROOT = path.join(process.cwd(), '.ai-runs');

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

function diffRuns(before, after) {
  const added = [];
  after.forEach((entry) => {
    if (!before.has(entry)) {
      added.push(entry);
    }
  });
  return added;
}

function runJob(jobPath, extraEnv = {}) {
  const before = listRuns();
  const result = spawnSync('node', ['scripts/run-job.js', '--job', jobPath, '--role', 'operator'], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  assert(result.status === 0, `run-job.js exited with ${result.status}: ${result.stderr}`);
  const stdout = result.stdout.trim();
  if (stdout) {
    return JSON.parse(stdout);
  }
  const after = listRuns();
  const newRuns = diffRuns(before, after);
  assert(newRuns.length === 1, 'run-job.js did not create run directory for fallback JSON');
  const runJsonPath = path.join(RUNS_ROOT, newRuns[0], 'run.json');
  assert(fs.existsSync(runJsonPath), 'run.json missing for fallback JSON');
  const payload = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
  assert(payload.runnerResult, 'run.json missing runnerResult');
  return payload.runnerResult;
}

function validateSamples() {
  const offlineJob = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-job.mcp.offline.smoke.json'), 'utf8'));
  const docsJob = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-job.docs.update.json'), 'utf8'));
  const repoJob = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-job.repo_patch.hub-static.json'), 'utf8'));
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
  const jobPath = path.join(__dirname, 'sample-job.mcp.offline.smoke.json');
  const before = listRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'offline smoke should succeed');
  const after = listRuns();
  const newRuns = diffRuns(before, after);
  assert(newRuns.length === 1, 'offline smoke should create one run directory');
  const runId = newRuns[0];
  const runDir = path.join(RUNS_ROOT, runId);
  assert(fs.existsSync(path.join(runDir, 'run.json')), 'run.json missing for offline smoke');
  assert(fs.existsSync(path.join(runDir, 'audit.jsonl')), 'audit.jsonl missing for offline smoke');
  assert(fs.existsSync(path.join(runDir, 'claude_mcp_smoketest.json')), 'claude_mcp_smoketest missing');

  const failBefore = listRuns();
  const failResult = runJob(jobPath, { C2F_STUB_FAIL: '1' });
  assert(failResult.status === 'error', 'offline smoke failure should be error');
  assert(
    Array.isArray(failResult.checks) && failResult.checks.some((c) => c.id === 'mcp_exec' && c.ok === false),
    'offline smoke failure must include mcp_exec check'
  );
  const failAfter = listRuns();
  const failRuns = diffRuns(failBefore, failAfter);
  assert(failRuns.length === 1, 'offline smoke failure should create run directory');
  const failDir = path.join(RUNS_ROOT, failRuns[0]);
  assert(fs.existsSync(path.join(failDir, 'run.json')), 'offline failure missing run.json');
  assert(fs.existsSync(path.join(failDir, 'audit.jsonl')), 'offline failure missing audit');
}

function verifyDocsUpdate() {
  const jobPath = path.join(__dirname, 'sample-job.docs.update.json');
  const docsPath = path.join(process.cwd(), 'docs', '.selftest-doc.md');
  const original = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '# Selftest Doc\n';
  fs.writeFileSync(docsPath, original, 'utf8');
  const before = listRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'docs update job should succeed');
  const after = listRuns();
  const runs = diffRuns(before, after);
  assert(runs.length === 1, 'docs update should create run directory');
  const updatedDoc = fs.readFileSync(docsPath, 'utf8');
  assert(updatedDoc.includes('Add selftest note'), 'docs instruction not applied');
  fs.writeFileSync(docsPath, original, 'utf8');
}

function verifyRepoPatch() {
  const jobPath = path.join(__dirname, 'sample-job.repo_patch.hub-static.json');
  const targetPath = path.join(process.cwd(), 'apps/hub/static/jobs.html');
  const original = fs.readFileSync(targetPath, 'utf8');
  const before = listRuns();
  const result = runJob(jobPath);
  assert(result.status === 'ok', 'repo patch job should succeed');
  assert(
    Array.isArray(result.checks) && result.checks.some((c) => c.id === 'repo_patch' && c.ok),
    'repo patch check missing'
  );
  const after = listRuns();
  const runs = diffRuns(before, after);
  assert(runs.length === 1, 'repo patch should create run directory');
  const updated = fs.readFileSync(targetPath, 'utf8');
  assert(updated.includes('repo_patch'), 'repo patch note missing');
  fs.writeFileSync(targetPath, original, 'utf8');
}

function main() {
  validateSamples();
  verifyOfflineSmoke();
  verifyDocsUpdate();
  verifyRepoPatch();
  console.log('Selftest ok');
}

main();

// --- MS0 API reachability check (HTTPS) ---
try {
  const https = require("https");

  const url = "https://hub.test-plan.help/api/projects";

  function fetch(urlStr) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        urlStr,
        {
          timeout: 10_000,
          headers: { "User-Agent": "integration-hub-selftest" },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers || {},
              body: data,
            });
          });
        }
      );
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", reject);
    });
  }

  (async () => {
    const r = await fetch(url);
    const ct = String(r.headers["content-type"] || "");

    if (r.status !== 200) {
      throw new Error(`status=${r.status} bodyHead=${JSON.stringify(r.body.slice(0, 200))}`);
    }
    if (!ct.includes("application/json")) {
      throw new Error(`content-type=${ct} bodyHead=${JSON.stringify(r.body.slice(0, 200))}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(r.body);
    } catch (e) {
      throw new Error(`json_parse_failed bodyHead=${JSON.stringify(r.body.slice(0, 200))}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`expected_array got=${typeof parsed}`);
    }

    // 現状MS0は [] が期待値（将来CRUDで増えるので “配列であること”を主条件に）
    if (parsed.length !== 0) {
      console.log("[selftest] WARN: /api/projects is not empty (ok after MS1). len=" + parsed.length);
    }

    console.log("[selftest] OK: ms0 api /api/projects reachable");
  })().catch((e) => {
    console.error("[selftest] MS0_API_CHECK FAILED:", e?.message || e);
    process.exitCode = 1;
  });
} catch (e) {
  console.error("[selftest] MS0_API_CHECK INIT FAILED:", e?.message || e);
  process.exitCode = 1;
}

// --- MS1 Projects CRUD check (HTTPS) ---
try {
  const https = require("https");
  const base = "https://hub.test-plan.help";

  function requestJson(method, path, bodyObj) {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = {
      method,
      timeout: 10_000,
      headers: {
        "User-Agent": "integration-hub-selftest",
      },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(body);
    }
    return new Promise((resolve, reject) => {
      const req = https.request(base + path, opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: data }));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  (async () => {
    // POST
    const create = await requestJson("POST", "/api/projects", {
      name: "Selftest CRUD Project",
      staging_url: "https://example.com",
    });
    if (create.status !== 201) throw new Error(`POST status=${create.status} bodyHead=${create.body.slice(0,200)}`);
    const created = JSON.parse(create.body);
    if (!created.id) throw new Error("POST missing id");
    const id = created.id;

    // GET by id
    const get1 = await requestJson("GET", `/api/projects/${id}`);
    if (get1.status !== 200) throw new Error(`GET status=${get1.status} bodyHead=${get1.body.slice(0,200)}`);

    // PATCH
    const patch = await requestJson("PATCH", `/api/projects/${id}`, { name: "Selftest CRUD Project v2" });
    if (patch.status !== 200) throw new Error(`PATCH status=${patch.status} bodyHead=${patch.body.slice(0,200)}`);
    const patched = JSON.parse(patch.body);
    if (patched.name !== "Selftest CRUD Project v2") throw new Error("PATCH name not applied");

    // DELETE
    const del = await requestJson("DELETE", `/api/projects/${id}`);
    if (del.status !== 204) throw new Error(`DELETE status=${del.status} bodyHead=${del.body.slice(0,200)}`);

    // GET should 404
    const get2 = await requestJson("GET", `/api/projects/${id}`);
    if (get2.status !== 404) throw new Error(`GET-after-delete expected 404 got=${get2.status}`);

    console.log("[selftest] OK: ms1 projects crud");
  })().catch((e) => {
    console.error("[selftest] MS1_PROJECTS_CRUD FAILED:", e?.message || e);
    process.exitCode = 1;
  });
} catch (e) {
  console.error("[selftest] MS1_PROJECTS_CRUD INIT FAILED:", e?.message || e);
  process.exitCode = 1;
}

// --- Phase2 samples & docs (PR-C) existence checks ---
try {
  // Keep this lightweight: existence only (no execution, no network).
  const fs = require("fs");
  const paths = [
    "scripts/sample-job.mcp.offline.smoke.json",
    "scripts/sample-job.docs.update.json",
    "scripts/sample-job.repo_patch.hub-static.json",
    "scripts/sample-job.spawn_smoke.json",
    "scripts/sample-job.diagnostics.json",
    "scripts/sample-job.openai_exec_smoke.json",
    "docs/.selftest-doc.md",
    "apps/hub/static/offline-job.fixture.json",
  ];
  for (const fp of paths) {
    if (!fs.existsSync(fp)) {
      throw new Error("missing: " + fp);
    }
  }
  console.log("[selftest] OK: phase2 samples/docs exist");
} catch (e) {
  console.error("[selftest] PHASE2_SAMPLES_CHECK FAILED:", e?.message || e);
  process.exitCode = 1;
}
