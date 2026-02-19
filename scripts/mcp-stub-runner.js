#!/usr/bin/env node
const fs = require('fs');

function readJob() {
  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => {
      if (!buffer.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(buffer));
      } catch (error) {
        resolve({});
      }
    });
  });
}

async function main() {
  if (process.env.C2F_STUB_FAIL === '1') {
    console.error('mcp-stub-runner forced failure via C2F_STUB_FAIL');
    process.exit(2);
    return;
  }
  const job = await readJob();
  const language = (job && job.output_language) || process.env.OUTPUT_LANGUAGE || 'ja';
  const payload = {
    provider: 'local_stub',
    job_type: job.job_type || 'unknown',
    handshake_ok: true,
    ts: new Date().toISOString(),
    notes: 'offline smoke stub (no network, no claude cli)',
    output_language: language,
    system_prompt: `Output language must be: ${language}`
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  console.error(error.message || 'mcp-stub-runner error');
  process.exit(1);
});
