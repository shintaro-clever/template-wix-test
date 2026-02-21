#!/usr/bin/env node
const http = require('http');
const path = require('path');
const fs = require('fs');
const { createApp } = require('./src/server/app');
const { resolveHostPort } = require('./src/server/config');

const app = createApp();
const server = http.createServer((req, res) => app(req, res));
const { host, port } = resolveHostPort();

server.listen(port, host, () => {
  const root = process.cwd();
  const jobsPath = fs.existsSync(path.join(root, 'apps', 'hub', 'static', 'jobs.html'))
    ? path.join(root, 'apps', 'hub', 'static', 'jobs.html')
    : 'missing';
  console.log(`Hub fallback server listening on http://${host}:${port}`);
  console.log(`startup host=${host} port=${port} /jobs serves: ${jobsPath}`);
});
