#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const distDir = path.join(__dirname, 'apps', 'hub', 'dist');
const staticDir = path.join(__dirname, 'apps', 'hub', 'static');
const fallbackJobs = path.join(staticDir, 'jobs.html');

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function isSubPath(baseDir, target) {
  const relative = path.relative(baseDir, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath)
    .on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read file');
    })
    .pipe(res);
}

function tryServeStatic(baseDir, requestPath, res) {
  const relative = requestPath.replace(/^\//, '') || 'index.html';
  const filePath = path.join(baseDir, relative);
  if (!isSubPath(baseDir, filePath) || !fileExists(filePath)) {
    return false;
  }
  serveFile(res, filePath);
  return true;
}

function handleJobs(res) {
  const distIndex = path.join(distDir, 'index.html');
  if (fileExists(distIndex)) {
    serveFile(res, distIndex);
    return;
  }
  if (fileExists(fallbackJobs)) {
    serveFile(res, fallbackJobs);
    return;
  }
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Missing Hub UI (fallback not found)');
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '').split('?')[0] || '/';
  if (req.method === 'GET' && (urlPath === '/jobs' || urlPath === '/jobs/')) {
    handleJobs(res);
    return;
  }
  if (req.method === 'GET' && urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method === 'GET') {
    const served =
      (fileExists(path.join(distDir, 'index.html')) && tryServeStatic(distDir, urlPath, res)) ||
      tryServeStatic(staticDir, urlPath, res);
    if (served) {
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Hub fallback server listening on http://localhost:${PORT}`);
});
