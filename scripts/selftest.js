#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function mustExist(p) {
  const abs = path.resolve(__dirname, '..', p);
  if (!fs.existsSync(abs)) {
    console.error(`[selftest] MISSING: ${p}`);
    process.exit(1);
  }
  console.log(`[selftest] OK: ${p}`);
}

function mustRequire(p) {
  try {
    const abs = path.resolve(__dirname, '..', p);
    require(abs);
    console.log(`[selftest] REQUIRE OK: ${p}`);
  } catch (e) {
    console.error(`[selftest] REQUIRE FAIL: ${p}`);
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  }
}

mustExist('package.json');
mustExist('server.js');
mustExist('src/jobSpec.js');
mustExist('src/runnerAdapter.js');
mustExist('scripts/run-job.js');
mustExist('scripts/mcp-stub-runner.js');

mustRequire('src/jobSpec.js');
mustRequire('src/runnerAdapter.js');

console.log('[selftest] OK');
process.exit(0);
