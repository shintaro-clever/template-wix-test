#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readConnections() {
  const filePath = path.join(__dirname, '..', 'apps', 'hub', 'data', 'connections.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('connections.json を読み込めませんでした');
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--provider' || arg === '-p') && argv[i + 1]) {
      args.provider = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function normalizeRepo(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('GitHub リポジトリが未設定です');
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('GitHub リポジトリが未設定です');
  }
  if (trimmed.startsWith('http')) {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error('GitHub リポジトリ URL が不正です');
    }
    return `${segments[0]}/${segments[1]}`;
  }
  if (!trimmed.includes('/')) {
    throw new Error('GitHub リポジトリは owner/repo 形式で入力してください');
  }
  return trimmed;
}

async function githubSmoke(connections) {
  const repo = normalizeRepo(connections.github && connections.github.repo);
  const token = (connections.github && connections.github.token) || '';
  const headers = {
    'User-Agent': 'integration-hub-connector-smoke',
    Accept: 'application/vnd.github+json'
  };
  if (token.trim()) {
    headers.Authorization = `token ${token.trim()}`;
  }
  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    method: 'GET',
    headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub API エラー (${response.status}): ${body.message || 'unknown'}`);
  }
  return {
    provider: 'github',
    repo,
    private: body.private,
    visibility: body.visibility,
    default_branch: body.default_branch,
    pushed_at: body.pushed_at,
    stargazers: body.stargazers_count,
    http_status: response.status,
    fetched_at: new Date().toISOString()
  };
}

function extractFigmaKey(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Figma ファイルURLが未設定です');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Figma ファイルURLが未設定です');
  }
  if (!trimmed.includes('figma.com')) {
    return trimmed;
  }
  const match = trimmed.match(/figma\\.com\\/(?:file|design)\\/([a-zA-Z0-9]+)(?:\\/|$)/);
  if (match && match[1]) {
    return match[1];
  }
  throw new Error('Figma ファイルURLから key を抽出できませんでした');
}

async function figmaSmoke(connections) {
  const token = (connections.figma && connections.figma.token) || '';
  if (!token.trim()) {
    throw new Error('Figma token が未設定です');
  }
  const fileKey = extractFigmaKey(connections.figma && connections.figma.fileUrl);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    method: 'GET',
    headers: {
      'X-Figma-Token': token.trim()
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Figma API エラー (${response.status}): ${body.message || 'unknown'}`);
  }
  return {
    provider: 'figma',
    file_key: fileKey,
    name: body.name,
    last_modified: body.lastModified,
    role: body.role,
    editor_type: body.editorType,
    http_status: response.status,
    fetched_at: new Date().toISOString()
  };
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('fetch API がサポートされていません（Node.js 18+ が必要）');
  }
  const args = parseArgs(process.argv);
  if (!args.provider) {
    throw new Error('--provider を指定してください');
  }
  const provider = args.provider;
  const connections = readConnections();
  let result;
  if (provider === 'github') {
    result = await githubSmoke(connections);
  } else if (provider === 'figma') {
    result = await figmaSmoke(connections);
  } else {
    throw new Error(`未対応の provider: ${provider}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\\n`);
}

main().catch((error) => {
  console.error(error.message || 'connector-smoke error');
  process.exit(1);
});
