#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { URLSearchParams } = require('url');
const { validateJob } = require('../src/jobSpec');
const { run: runAdapter } = require('../src/runnerAdapter');
const { callFigmaApi } = require('../src/figma/api');
const { applyCodexPrompt } = require('../src/codex/prompt');

const SCHEMA_VERSION = 'phase2/v1';
const ALLOWED_SPAWN_COMMANDS = new Set(['node', 'npx', 'git', 'php', 'codex']);
const SPAWN_ENV_ALLOWLIST = ['PATH', 'HOME', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const MAX_SPAWN_CAPTURE = 4000;
const CODEX_SHELL_WARNING = 'Shell snapshot validation failed';
const PHASE1_NAMING_VERSION = 'p1-04.v1';
const FIGMA_DEBUG_ENABLED = /^(1|true|yes)$/i.test(String(process.env.FIGMA_DEBUG || ''));
function formatFigmaRequestLog(label, debugInfo) {
  if (!FIGMA_DEBUG_ENABLED || !debugInfo) {
    return null;
  }
  const hasQuery = debugInfo.query && Object.keys(debugInfo.query).length > 0;
  const queryString = hasQuery ? `?${new URLSearchParams(debugInfo.query).toString()}` : '';
  return `figma_req[${label}]=${debugInfo.endpoint}${queryString}`;
}
const SCREEN_IGNORES = new Set([
  'node_modules',
  '.git',
  '.next',
  'out',
  'build',
  'dist',
  'coverage',
  '.ai-runs',
  '.turbo',
  'tmp'
]);
const SCREEN_PATTERNS_DESCRIPTION = [
  'next-app-router',
  'next-pages',
  'template',
  'react-route',
  'php-public'
].join(',');
const SCREEN_PATTERN_LIST = SCREEN_PATTERNS_DESCRIPTION.split(',');

function parseArgs(argv) {
  const args = { role: 'operator' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--job' && argv[i + 1]) {
      args.job = argv[i + 1];
      i += 1;
    } else if (arg === '--role' && argv[i + 1]) {
      args.role = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function cloneJob(job) {
  return JSON.parse(JSON.stringify(job || {}));
}

function normalizeRelativePath(rawPath) {
  const normalized = path.posix.normalize(String(rawPath || '').replace(/\\/g, '/'));
  if (normalized.startsWith('..')) {
    throw new Error('path must stay under workspace');
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error('path must be relative');
  }
  return normalized.replace(/^\.\//, '');
}

function ensureAllowedPath(target, allowed) {
  const ok = Array.isArray(allowed) && allowed.some((prefix) => target.startsWith(prefix));
  if (!ok) {
    throw new Error(`target_path ${target} outside allowed_paths`);
  }
}

function ensureRunDirectory(runId) {
  if (!runId || typeof runId !== 'string') {
    const error = new Error('invalid runId');
    error.code = 'INVALID_RUN_ID';
    throw error;
  }
  const baseDir = path.join(process.cwd(), '.ai-runs', runId);
  fs.mkdirSync(baseDir, { recursive: true });
  return {
    baseDir,
    runId,
    runJson: path.join(baseDir, 'run.json'),
    audit: path.join(baseDir, 'audit.jsonl')
  };
}

function createRunPathsOrExit(runId) {
  try {
    return ensureRunDirectory(runId);
  } catch (error) {
    const reason = error && (error.code || error.message) ? (error.code || error.message) : String(error);
    console.error(`run_dir_create_failed: ${reason}`);
    process.exit(1);
  }
}

function generateRunId() {
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  if (!/^[a-z0-9]+-[a-f0-9]+$/.test(id)) {
    const error = new Error('invalid runId');
    error.code = 'INVALID_RUN_ID';
    throw error;
  }
  return id;
}

function createRunIdOrExit() {
  try {
    return generateRunId();
  } catch (error) {
    const reason = error && (error.code || error.message) ? (error.code || error.message) : String(error);
    console.error(`run_dir_create_failed: ${reason}`);
    process.exit(1);
  }
}

function appendAudit(runPaths, event) {
  fs.appendFileSync(runPaths.audit, `${JSON.stringify(event)}\n`);
}

function writeJsonAtomic(targetPath, payload) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, targetPath);
}

function updateLatestOfflineSmoke({ runId, jobType, startedAt, finishedAt, status, summary }) {
  const runsRoot = path.join(process.cwd(), '.ai-runs');
  fs.mkdirSync(runsRoot, { recursive: true });
  const payload = {
    runId,
    job_type: jobType,
    startedAt,
    finishedAt,
    status,
    summary
  };
  const tmpPath = path.join(runsRoot, `.latest_offline_smoke.${process.pid}.${Date.now()}.tmp`);
  const targetPath = path.join(runsRoot, 'latest_offline_smoke.json');
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, targetPath);
}

function summarizeChecks(checks = []) {
  const failing = checks.filter((c) => c && c.ok === false).map((c) => c.id || 'unknown');
  return {
    total: checks.length,
    passed: checks.length - failing.length,
    failing
  };
}

function finalizeRun(runPaths, job, runnerResult, createdAt) {
  const summary = summarizeChecks(runnerResult.checks || []);
  const payload = {
    job,
    runnerResult: {
      ...runnerResult,
      checks_summary: summary
    },
    meta: {
      schema_version: SCHEMA_VERSION,
      created_at: createdAt
    }
  };
  writeJsonAtomic(runPaths.runJson, payload);
  appendAudit(runPaths, {
    event: 'RUN_END',
    ts: new Date().toISOString(),
    run_id: runPaths.runId,
    schema_version: SCHEMA_VERSION,
    status: runnerResult.status,
    checks_summary: summary
  });
  return { ...runnerResult, run_id: runPaths.runId };
}

function recordRunStart(runPaths, job) {
  appendAudit(runPaths, {
    event: 'RUN_START',
    ts: new Date().toISOString(),
    run_id: runPaths.runId,
    schema_version: SCHEMA_VERSION,
    job_type: job.job_type,
    allowed_paths: (job.constraints && job.constraints.allowed_paths) || []
  });
}

function buildValidationFailure(errors) {
  return {
    status: 'error',
    errors,
    checks: errors.map((reason, idx) => ({ id: `job_spec_${idx + 1}`, ok: false, reason })),
    logs: ['job validation failed']
  };
}

function resolveTargetPath(template, runId) {
  const replaced = String(template).replace(/{{\s*run_id\s*}}/gi, runId);
  const normalized = normalizeRelativePath(replaced);
  if (!normalized.startsWith('.ai-runs/')) {
    throw new Error('target_path must resolve under .ai-runs/');
  }
  return normalized;
}

function writeJsonArtifact(relativePath, payload) {
  const absolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2));
  return relativePath;
}

function extractFigmaFileKey(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('figma_design_url / figma_file_key が指定されていません');
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((segment) => segment === 'file' || segment === 'design');
    if (idx >= 0 && segments[idx + 1]) {
      return segments[idx + 1];
    }
    if (segments.length >= 1) {
      return segments[0];
    }
  } catch {
    // ignore
  }
  throw new Error('Figma ファイルキーを抽出できませんでした');
}

function normalizeRepoReference(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`;
      }
      return segments[0] || raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

function stripRouteGroup(segment) {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    return '';
  }
  return segment;
}

function convertDynamicSegment(segment) {
  const match = segment.match(/^\[(\.\.\.)?([^\]]+)\]$/);
  if (!match) {
    return segment;
  }
  const isCatchAll = Boolean(match[1]);
  const name = match[2];
  return isCatchAll ? `*${name}` : `:${name}`;
}

function deriveRouteFromPath(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  if (/^app\//.test(unixPath)) {
    const inner = unixPath.replace(/^app\//, '').replace(/\/page\.[^/]+$/i, '');
    const segments = inner
      .split('/')
      .map(stripRouteGroup)
      .filter(Boolean)
      .map(convertDynamicSegment);
    return `/${segments.join('/')}`.replace(/\/+/g, '/');
  }
  if (/^pages\//.test(unixPath)) {
    const inner = unixPath.replace(/^pages\//, '').replace(/\.[^/.]+$/, '');
    const segments = inner.split('/').map(convertDynamicSegment);
    return `/${segments.join('/')}`.replace(/\/+/g, '/');
  }
  if (/^(templates|resources\/views)\//.test(unixPath)) {
    return `/${unixPath.replace(/^(templates|resources\/views)\//, '').replace(/\.[^/.]+$/, '')}`;
  }
  if (/^src\/routes\//.test(unixPath)) {
    return `/${unixPath.replace(/^src\/routes\//, '').replace(/\.[^/.]+$/, '')}`;
  }
  return `/${unixPath.replace(/\.[^/.]+$/, '')}`;
}

function detectScreenPattern(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  if (/^app\/.+\/page\.(js|jsx|ts|tsx|mdx)$/i.test(unixPath)) {
    return 'next-app-router';
  }
  if (/^pages\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath)) {
    return 'next-pages';
  }
  if (/^(templates|resources\/views)\/.+\.(php|blade\.php|twig)$/i.test(unixPath)) {
    return 'template';
  }
  if (/^src\/routes\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath)) {
    return 'react-route';
  }
  if (/\/public\/.+\.php$/i.test(unixPath)) {
    return 'php-public';
  }
  return 'generic';
}

function isScreenCandidate(relativePath) {
  const unixPath = relativePath.replace(/\\/g, '/');
  return (
    /^app\/.+\/page\.(js|jsx|ts|tsx|mdx)$/i.test(unixPath) ||
    /^pages\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath) ||
    /^(templates|resources\/views)\/.+\.(php|blade\.php|twig)$/i.test(unixPath) ||
    /^src\/routes\/.+\.(js|jsx|ts|tsx)$/i.test(unixPath) ||
    /\/public\/.+\.php$/i.test(unixPath)
  );
}

function assignFramePositions(frames) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(frames.length)));
  const gapX = 480;
  const gapY = 360;
  return frames.map((frame, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...frame,
      position: { x: column * gapX, y: row * gapY }
    };
  });
}

function collectScreenCandidates(limit = 24, strategy = 'routes_first', rootDir = process.cwd()) {
  const results = [];
  function walk(currentDir, relative = '') {
    if (results.length >= limit) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SCREEN_IGNORES.has(entry.name)) {
          continue;
        }
        walk(
          path.join(currentDir, entry.name),
          relative ? `${relative}/${entry.name}` : entry.name
        );
      } else if (entry.isFile()) {
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (isScreenCandidate(relativePath)) {
          const route = deriveRouteFromPath(relativePath);
          const frameName = route === '/' ? 'home' : route.replace(/^\//, '');
          results.push({
            frame_name: frameName || relativePath,
            route,
            source_path: relativePath,
            pattern: detectScreenPattern(relativePath)
          });
          if (results.length >= limit) {
            return;
          }
        }
      }
    }
  }
  walk(rootDir, '');
  return assignFramePositions(results);
}

function buildFigmaCommentMessage({ pageName, frames, runId, repoRef }) {
  const header = `Hub Bootstrap "${pageName}" (run: ${runId}${repoRef ? ` / ${repoRef}` : ''})`;
  const lines = frames.slice(0, 10).map(
    (frame) => `• ${frame.route} (${frame.source_path}) [${frame.pattern}]`
  );
  if (frames.length > 10) {
    lines.push(`… and ${frames.length - 10} more`);
  }
  return `${header}\nFrames:\n${lines.join('\n')}`;
}

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAttrValue(attrText = '', attrName = '') {
  if (!attrText || !attrName) {
    return '';
  }
  const escaped = String(attrName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoted = new RegExp(`${escaped}\\s*=\\s*\"([^\"]*)\"`, 'i');
  const singleQuoted = new RegExp(`${escaped}\\s*=\\s*'([^']*)'`, 'i');
  const bare = new RegExp(`${escaped}\\s*=\\s*([^\\s\"'>]+)`, 'i');
  const q = String(attrText).match(quoted);
  if (q && q[1]) return q[1];
  const s = String(attrText).match(singleQuoted);
  if (s && s[1]) return s[1];
  const b = String(attrText).match(bare);
  if (b && b[1]) return b[1];
  return '';
}

function classifyTextRole({ tag = '', ariaLabel = '' } = {}) {
  const normalizedTag = String(tag || '').toLowerCase();
  if (normalizedTag === 'a') {
    return 'Link';
  }
  if (/^h[1-6]$/.test(normalizedTag)) {
    return 'Heading';
  }
  if (normalizedTag === 'button' || normalizedTag === 'label' || normalizedTag === 'input' || String(ariaLabel || '').trim()) {
    return 'Label';
  }
  return 'Body';
}

function extractTextFromHtml(html = '', limit = 10) {
  const cleaned = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const picked = [];
  const blockPattern = /<(h[1-6]|p|a|button|label)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const inputPattern = /<input\b([^>]*)\/?>/gi;
  let match;
  while ((match = blockPattern.exec(cleaned)) && picked.length < limit) {
    const tag = String(match[1] || '').toLowerCase();
    const attrs = String(match[2] || '');
    const ariaLabel = decodeHtmlEntities(extractAttrValue(attrs, 'aria-label')).trim();
    const text = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const content = text || ariaLabel;
    if (!content) {
      continue;
    }
    picked.push({
      tag,
      role: classifyTextRole({ tag, ariaLabel }),
      text: content.slice(0, 180)
    });
  }
  while ((match = inputPattern.exec(cleaned)) && picked.length < limit) {
    const attrs = String(match[1] || '');
    const ariaLabel = decodeHtmlEntities(extractAttrValue(attrs, 'aria-label')).trim();
    const value = decodeHtmlEntities(extractAttrValue(attrs, 'value')).trim();
    const placeholder = decodeHtmlEntities(extractAttrValue(attrs, 'placeholder')).trim();
    const content = ariaLabel || value || placeholder;
    if (!content) {
      continue;
    }
    picked.push({
      tag: 'input',
      role: classifyTextRole({ tag: 'input', ariaLabel }),
      text: content.slice(0, 180)
    });
  }
  if (picked.length > 0) {
    return picked;
  }
  const fallback = decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (!fallback) {
    return [];
  }
  return [{ tag: 'body', role: 'Body', text: fallback.slice(0, 180) }];
}

function extractTitleFromHtml(html = '') {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return 'Untitled Page';
  }
  const title = decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim());
  return title || 'Untitled Page';
}

function buildDomSnapshot(pageUrl, html, responseMeta = {}) {
  const blocks = extractTextFromHtml(html, 12);
  return {
    page_url: pageUrl,
    fetched_at: new Date().toISOString(),
    html_length: String(html || '').length,
    title: extractTitleFromHtml(html),
    text_blocks: blocks,
    response: {
      status: responseMeta.status || null,
      content_type: responseMeta.contentType || ''
    }
  };
}

function shortTitleForFrame(title = '') {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.slice(0, 24);
}

function pageFrameName(pageIndex = 1, title = '') {
  const number = String(pageIndex).padStart(2, '0');
  const short = shortTitleForFrame(title);
  return short ? `Page ${number} - ${short}` : `Page ${number}`;
}

const PAGE_AUTO_LAYOUT = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 24,
  paddingRight: 32,
  paddingBottom: 24,
  paddingLeft: 32,
  itemSpacing: 12
};

const SECTION_AUTO_LAYOUT = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  itemSpacing: 8
};

function buildFigmaFramePayload(snapshot, options = {}) {
  const pageIndex = Number.isFinite(Number(options.pageIndex)) ? Number(options.pageIndex) : 1;
  const width = 1200;
  const baseY = 340;
  const blocks = Array.isArray(snapshot.text_blocks) ? snapshot.text_blocks : [];
  const sections = blocks.slice(0, 8);
  const children = [
    {
      type: 'RECTANGLE',
      name: 'Hero',
      x: 0,
      y: 0,
      width: width - 64,
      height: 220,
      layoutAlign: 'STRETCH',
      fills: [{ type: 'SOLID', color: { r: 0.97, g: 0.98, b: 1 } }]
    },
    {
      type: 'TEXT',
      name: 'Heading',
      x: 32,
      y: 24,
      characters: snapshot.title || 'Untitled Page'
    },
    {
      type: 'RECTANGLE',
      name: 'Header',
      x: 0,
      y: 220,
      width: width - 64,
      height: 50,
      layoutAlign: 'STRETCH',
      fills: [{ type: 'SOLID', color: { r: 0.94, g: 0.96, b: 0.99 } }]
    },
    {
      type: 'TEXT',
      name: 'Label',
      x: 32,
      y: 235,
      characters: 'Header'
    },
    {
      type: 'RECTANGLE',
      name: 'Nav',
      x: 0,
      y: 270,
      width: width - 64,
      height: 50,
      layoutAlign: 'STRETCH',
      fills: [{ type: 'SOLID', color: { r: 0.93, g: 0.95, b: 0.99 } }]
    },
    {
      type: 'TEXT',
      name: 'Link',
      x: 32,
      y: 285,
      characters: 'Navigation'
    }
  ];
  sections.forEach((block, index) => {
    const sectionY = baseY + index * 90;
    children.push({
      type: 'FRAME',
      name: `Section ${String(index + 1).padStart(2, '0')}`,
      x: 24,
      y: sectionY,
      width: width - 64,
      minHeight: 76,
      ...SECTION_AUTO_LAYOUT,
      layoutAlign: 'STRETCH',
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      children: [
        {
          type: 'TEXT',
          name: block && typeof block.role === 'string' ? block.role : classifyTextRole({ tag: block && block.tag }),
          layoutAlign: 'STRETCH',
          characters: block.text
        }
      ]
    });
  });
  const footerY = baseY + sections.length * 90 + 20;
  children.push({
    type: 'RECTANGLE',
    name: 'Footer',
    x: 0,
    y: footerY,
    width: width - 64,
    height: 60,
    layoutAlign: 'STRETCH',
    fills: [{ type: 'SOLID', color: { r: 0.94, g: 0.96, b: 0.99 } }]
  });
  children.push({
    type: 'TEXT',
    name: 'Label',
    x: 32,
    y: footerY + 20,
    characters: snapshot.page_url || ''
  });
  return {
    frame: {
      type: 'FRAME',
      name: pageFrameName(pageIndex, snapshot.title),
      x: 0,
      y: 0,
      width,
      height: footerY + 100,
      ...PAGE_AUTO_LAYOUT,
      children
    }
  };
}

function sanitizeReasonText(value, fallback = 'unknown') {
  const text = value && value.message ? value.message : value;
  if (!text) {
    return fallback;
  }
  return String(text).replace(/\s+/g, '_');
}

function collectSectionFrameNames(figmaPayload = {}) {
  const frame = figmaPayload && figmaPayload.frame ? figmaPayload.frame : {};
  const children = Array.isArray(frame.children) ? frame.children : [];
  return children
    .filter((node) => node && typeof node.name === 'string' && /^Section \d{2}$/.test(node.name))
    .map((node) => node.name);
}

async function applyMinimalAutoLayout({ token, fileKey, frameId, figmaPayload }) {
  if (!frameId) {
    return { layoutApplied: false, layoutReason: 'layout_frame_id_missing' };
  }
  const sectionNames = collectSectionFrameNames(figmaPayload);
  try {
    await callFigmaApi({
      token,
      method: 'POST',
      endpoint: `/files/${fileKey}/nodes`,
      body: {
        action: 'apply_auto_layout_minimal',
        payload: {
          frame_id: frameId,
          page: PAGE_AUTO_LAYOUT,
          sections: sectionNames.map((name) => ({
            name,
            ...SECTION_AUTO_LAYOUT
          }))
        }
      }
    });
    return { layoutApplied: true, layoutReason: '-' };
  } catch (error) {
    return { layoutApplied: false, layoutReason: sanitizeReasonText(error, 'layout_apply_failed') };
  }
}

function collectNodeNamesFromPayload(payload = {}) {
  const names = [];
  const frame = payload && payload.frame ? payload.frame : null;
  if (frame && frame.name) {
    names.push(frame.name);
  }
  const children = frame && Array.isArray(frame.children) ? frame.children : [];
  children.forEach((node) => {
    if (node && typeof node.name === 'string') {
      names.push(node.name);
    }
  });
  return names;
}

function hasTagLikeLayerName(names = []) {
  return names.some((name) => /\b(h1|h2|h3|p|a)\b/i.test(String(name)));
}

function sectionNumbersStable(names = []) {
  const sectionNames = names.filter((name) => /^Section \d{2}$/.test(String(name)));
  for (let i = 0; i < sectionNames.length; i += 1) {
    const expected = `Section ${String(i + 1).padStart(2, '0')}`;
    if (sectionNames[i] !== expected) {
      return false;
    }
  }
  return sectionNames.length > 0;
}

function buildNamingChecks(payload = {}) {
  const names = collectNodeNamesFromPayload(payload);
  return {
    naming_version: PHASE1_NAMING_VERSION,
    tag_derived_name: hasTagLikeLayerName(names),
    section_sequence_stable: sectionNumbersStable(names)
  };
}

function toFigmaNodeUrl(fileKey, nodeId) {
  if (!nodeId) {
    return null;
  }
  return `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(String(nodeId))}`;
}

function extractCreatedNodeInfo(data = {}) {
  const pageId =
    data.page_id ||
    data.pageNodeId ||
    data.page?.id ||
    data.parent?.id ||
    null;
  const frameId =
    data.frame_id ||
    data.frameNodeId ||
    data.node_id ||
    data.node?.id ||
    data.createdNode?.id ||
    (Array.isArray(data.nodes) && data.nodes[0] && data.nodes[0].id) ||
    null;
  return { pageId, frameId };
}

function inferNextAction(reason = '') {
  const text = String(reason || '').toLowerCase();
  if (text.includes('token')) return 'FIGMA_TOKEN の有無/LENを確認し、Hub接続設定を見直してください。';
  if (text.includes('page_fetch_failed') || text.includes('network')) return 'page_url へ到達可能かを確認し、ネットワークを再試行してください。';
  if (text.includes('figma api 401') || text.includes('figma api 403')) return 'Figma権限/トークンの有効性を確認してください。';
  return 'inputs.page_url / figma_file_key を確認し、再実行してください。';
}

function buildCodeToFigmaSummary({
  status,
  runId,
  pageUrl,
  pages,
  frames,
  progress,
  transformStats,
  linkStats,
  imageStats,
  textCounts,
  nodeCounts,
  layoutCounts,
  spacingProfile,
  figmaFileUrl,
  figmaPageUrl,
  figmaFrameUrl,
  mcpAttempt,
  reason,
  nextAction
}) {
  const lines = [
    '# Code to Figma Summary',
    '',
    `- run_id: ${runId}`,
    `- status: ${status}`,
    `- naming_version: ${PHASE1_NAMING_VERSION}`,
    `- page_url: ${pageUrl || '-'}`,
    `- figma_file: ${figmaFileUrl || '-'}`,
    `- figma_page: ${figmaPageUrl || '-'}`,
    `- figma_frame: ${figmaFrameUrl || '-'}`,
    `- mcp_attempt: ${mcpAttempt ? `{ status: ${mcpAttempt.status || '-'}, reason: ${mcpAttempt.reason || '-'} }` : '-'}`,
    ''
  ];
  const normalizedPages = Array.isArray(pages) && pages.length > 0 ? pages : pageUrl ? [pageUrl] : [];
  lines.push('## Pages', `- pages_total: ${normalizedPages.length}`);
  normalizedPages.forEach((url, index) => {
    lines.push(`- pages[]: { index: ${index + 1}, url: ${url} }`);
  });
  lines.push('');
  if (Array.isArray(frames) && frames.length > 0) {
    lines.push('## Frames');
    frames.forEach((entry) => {
      if (entry.status === 'success') {
        lines.push(
          `- frames[]: { index: ${entry.index}, url: ${entry.url}, status: success, frameUrl: ${entry.frameUrl || '-'}, layoutApplied: ${entry.layoutApplied === true ? 'true' : 'false'}, layoutReason: ${entry.layoutReason || '-'} }`
        );
      } else {
        lines.push(
          `- frames[]: { index: ${entry.index}, url: ${entry.url}, status: failed, reason: ${entry.reason || '-'}, layoutApplied: ${entry.layoutApplied === true ? 'true' : 'false'}, layoutReason: ${entry.layoutReason || '-'} }`
        );
      }
    });
    lines.push('');
  }
  if (Array.isArray(progress) && progress.length > 0) {
    lines.push('## Progress');
    progress.forEach((entry) => {
      lines.push(
        `- progress[]: { index: ${entry.index}, url: ${entry.url}, status: ${entry.status}, reason: ${entry.reason || '-'} }`
      );
    });
    lines.push('');
  }
  if (transformStats && typeof transformStats === 'object') {
    lines.push('## Transform Stats');
    lines.push(`- transform_stats: { frames_pruned: ${Number(transformStats.frames_pruned || 0)}, frames_kept: ${Number(transformStats.frames_kept || 0)} }`);
    lines.push('');
  }
  if (linkStats && typeof linkStats === 'object') {
    lines.push('## Link Stats');
    lines.push(`- link_stats: { links_total: ${Number(linkStats.links_total || 0)}, links_internal: ${Number(linkStats.links_internal || 0)}, links_mapped: ${Number(linkStats.links_mapped || 0)} }`);
    lines.push('');
  }
  if (imageStats && typeof imageStats === 'object') {
    lines.push('## Image Stats');
    lines.push(`- image_stats: { images_total: ${Number(imageStats.images_total || 0)}, images_labeled: ${Number(imageStats.images_labeled || 0)} }`);
    lines.push('');
  }
  if (textCounts && typeof textCounts === 'object') {
    lines.push('## Text Counts');
    lines.push(`- text_counts: { Heading: ${Number(textCounts.Heading || 0)}, Body: ${Number(textCounts.Body || 0)}, Link: ${Number(textCounts.Link || 0)}, Label: ${Number(textCounts.Label || 0)} }`);
    lines.push('');
  }
  if (nodeCounts && typeof nodeCounts === 'object') {
    lines.push('## Node Counts');
    lines.push(`- node_counts: { FRAME: ${Number(nodeCounts.FRAME || 0)}, RECT: ${Number(nodeCounts.RECT || 0)}, TEXT: ${Number(nodeCounts.TEXT || 0)} }`);
    lines.push('');
  }
  if (layoutCounts && typeof layoutCounts === 'object') {
    lines.push('## Layout Counts');
    lines.push(`- layout_counts: { auto_layout_nodes: ${Number(layoutCounts.auto_layout_nodes || 0)}, horizontal_nodes: ${Number(layoutCounts.horizontal_nodes || 0)}, vertical_nodes: ${Number(layoutCounts.vertical_nodes || 0)}, hero_cta_rows: ${Number(layoutCounts.hero_cta_rows || 0)} }`);
    lines.push('');
  }
  if (spacingProfile && typeof spacingProfile === 'object') {
    const page = spacingProfile.Page || {};
    const section = spacingProfile.Section || {};
    const header = spacingProfile.Header || {};
    const hero = spacingProfile.Hero || {};
    const footer = spacingProfile.Footer || {};
    const nav = spacingProfile.Nav || {};
    lines.push('## Spacing Profile');
    lines.push(`- spacing_profile: { Page:${page.padding || '-'} / ${page.itemSpacing || '-'}, Section:${section.padding || '-'} / ${section.itemSpacing || '-'}, Header:${header.padding || '-'} / ${header.itemSpacing || '-'}, Hero:${hero.padding || '-'} / ${hero.itemSpacing || '-'}, Footer:${footer.padding || '-'} / ${footer.itemSpacing || '-'}, Nav(H):${nav.itemSpacing || '-'} }`);
    lines.push('');
  }
  if (status === 'ok') {
    lines.push('## Result', '- Code→Figma completed for one page.');
  } else {
    lines.push('## Failure', `- reason: ${reason || 'unknown'}`, `- nextAction: ${nextAction || inferNextAction(reason)}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function fetchPageSnapshot(pageUrl) {
  if (typeof fetch !== 'function') {
    throw new Error('network_unreachable: global fetch unavailable');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(pageUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'integration-hub-code-to-figma' }
    });
    if (!response.ok) {
      throw new Error(`page_fetch_failed status=${response.status}`);
    }
    const html = await response.text();
    return {
      html,
      meta: {
        status: response.status,
        contentType: response.headers.get('content-type') || ''
      }
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('page_fetch_failed timeout');
    }
    if (error && error.message) {
      throw error;
    }
    throw new Error('page_fetch_failed unknown');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePageUrl(raw) {
  const parsed = new URL(String(raw || '').trim());
  parsed.hash = '';
  return parsed.toString();
}

const NON_HTML_PATH_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
  '.pdf',
  '.mp4',
  '.mp3',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf'
]);

function hasNonHtmlExtension(pathname = '') {
  const lower = String(pathname || '').toLowerCase();
  for (const ext of NON_HTML_PATH_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function extractSameOriginLinks(startUrl, html, maxPages = 20) {
  const base = new URL(startUrl);
  const pages = [startUrl];
  const seen = new Set(pages);
  const hrefPattern = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefPattern.exec(String(html || '')))) {
    if (pages.length >= maxPages) {
      break;
    }
    const href = String(match[1] || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(href, base);
    } catch {
      continue;
    }
    if (parsed.origin !== base.origin) {
      continue;
    }
    if (hasNonHtmlExtension(parsed.pathname)) {
      continue;
    }
    if (parsed.search) {
      continue;
    }
    parsed.hash = '';
    const normalized = parsed.toString();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    pages.push(normalized);
  }
  return pages.slice(0, maxPages);
}

async function collectPagesFromOrigin(pageUrl, { maxPages = 20 } = {}) {
  const normalizedStart = normalizePageUrl(pageUrl);
  const fetched = await fetchPageSnapshot(normalizedStart);
  const pages = extractSameOriginLinks(normalizedStart, fetched.html, maxPages);
  return {
    pages,
    html: fetched.html,
    meta: fetched.meta
  };
}

function shouldTryMcpFirst(job = {}) {
  const mode = job && typeof job.run_mode === 'string' ? job.run_mode.trim().toLowerCase() : 'mcp';
  return mode === '' || mode === 'mcp';
}

function resolveMcpProvider(job = {}) {
  const provider = job && job.inputs && typeof job.inputs.mcp_provider === 'string' ? job.inputs.mcp_provider.trim() : '';
  return provider;
}

function safeNormalizePageUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }
  try {
    return normalizePageUrl(text);
  } catch {
    return text;
  }
}

function collectRequestedPagesForMcp(job = {}) {
  const inputs = job && job.inputs ? job.inputs : {};
  const primary = safeNormalizePageUrl(inputs.page_url);
  const extras = Array.isArray(inputs.pages)
    ? inputs.pages
        .map((entry) => safeNormalizePageUrl(entry))
        .filter(Boolean)
    : [];
  const combined = [];
  const seen = new Set();
  [primary, ...extras].forEach((entry) => {
    if (!entry || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    combined.push(entry);
  });
  return combined.slice(0, 20);
}

function buildCodeToFigmaMcpJob(job = {}, runId = '') {
  const mcpJob = cloneJob(job);
  const resolvedMcpTarget = `.ai-runs/${runId}/code_to_figma_mcp_report.json`;
  const pages = collectRequestedPagesForMcp(job);
  const provider = resolveMcpProvider(job) || 'local_stub';
  mcpJob.inputs = {
    ...(mcpJob.inputs || {}),
    mcp_provider: provider,
    pages,
    naming_version: PHASE1_NAMING_VERSION,
    layout_minimal: true,
    target_path: resolvedMcpTarget,
    target_path_resolved: resolvedMcpTarget
  };
  return mcpJob;
}

function parseMcpFailureReason(result = {}) {
  if (Array.isArray(result.checks)) {
    const failed = result.checks.find((entry) => entry && entry.ok === false);
    if (failed) {
      return failed.id ? `mcp_${sanitizeReasonText(failed.id, 'failed')}` : 'mcp_exec_failed';
    }
  }
  if (Array.isArray(result.errors) && result.errors[0]) {
    return 'mcp_exec_failed';
  }
  return 'mcp_failed';
}

function hasCodeToFigmaMcpSuccessSignal(result = {}) {
  const logs = Array.isArray(result.logs) ? result.logs : [];
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const hasSpecificCheck = checks.some((entry) => entry && entry.id === 'code_to_figma' && entry.ok === true);
  const hasSpecificLog = logs.some((entry) => typeof entry === 'string' && entry.startsWith('code_to_figma_mcp=ok'));
  return hasSpecificCheck || hasSpecificLog;
}

function normalizeMcpFrames(frames = [], fallbackPages = []) {
  return (Array.isArray(frames) ? frames : []).map((entry, index) => {
    const row = entry && typeof entry === 'object' ? entry : {};
    const status = row.status === 'failed' ? 'failed' : 'success';
    const frameUrl = row.frameUrl || row.frame_url || '-';
    const reason = row.reason || '-';
    return {
      index: Number.isFinite(Number(row.index)) ? Number(row.index) : index + 1,
      url: row.url || fallbackPages[index] || '-',
      status,
      frameUrl,
      reason,
      layoutApplied: row.layoutApplied === true,
      layoutReason: row.layoutReason || (row.layoutApplied === true ? '-' : status === 'failed' ? 'mcp_frame_failed' : '-')
    };
  });
}

function normalizeMcpProgress(progress = [], fallbackPages = []) {
  return (Array.isArray(progress) ? progress : []).map((entry, index) => {
    const row = entry && typeof entry === 'object' ? entry : {};
    return {
      index: Number.isFinite(Number(row.index)) ? Number(row.index) : index + 1,
      url: row.url || fallbackPages[index] || '-',
      status: row.status === 'failed' ? 'failed' : 'success',
      reason: row.reason || '-'
    };
  });
}

function extractMcpCodeToFigmaPayload(result = {}) {
  const payload = result && typeof result.code_to_figma === 'object' ? result.code_to_figma : {};
  const pages = Array.isArray(payload.pages) ? payload.pages : Array.isArray(result.pages) ? result.pages : [];
  const frames = Array.isArray(payload.frames) ? payload.frames : Array.isArray(result.frames) ? result.frames : [];
  const progress = Array.isArray(payload.progress) ? payload.progress : Array.isArray(result.progress) ? result.progress : [];
  const figmaLinks = payload.figma_links && typeof payload.figma_links === 'object' ? payload.figma_links : {};
  const textCounts =
    payload.text_counts && typeof payload.text_counts === 'object'
      ? payload.text_counts
      : result.text_counts && typeof result.text_counts === 'object'
        ? result.text_counts
        : null;
  const nodeCounts =
    payload.node_counts && typeof payload.node_counts === 'object'
      ? payload.node_counts
      : result.node_counts && typeof result.node_counts === 'object'
        ? result.node_counts
        : null;
  const layoutCounts =
    payload.layout_counts && typeof payload.layout_counts === 'object'
      ? payload.layout_counts
      : result.layout_counts && typeof result.layout_counts === 'object'
        ? result.layout_counts
        : null;
  const spacingProfile =
    payload.spacing_profile && typeof payload.spacing_profile === 'object'
      ? payload.spacing_profile
      : result.spacing_profile && typeof result.spacing_profile === 'object'
        ? result.spacing_profile
        : null;
  const linkStats =
    payload.link_stats && typeof payload.link_stats === 'object'
      ? payload.link_stats
      : result.link_stats && typeof result.link_stats === 'object'
        ? result.link_stats
        : null;
  const imageStats =
    payload.image_stats && typeof payload.image_stats === 'object'
      ? payload.image_stats
      : result.image_stats && typeof result.image_stats === 'object'
        ? result.image_stats
        : null;
  const transformStats =
    payload.transform_stats && typeof payload.transform_stats === 'object'
      ? payload.transform_stats
      : result.transform_stats && typeof result.transform_stats === 'object'
        ? result.transform_stats
        : null;
  return {
    pages,
    frames,
    progress,
    transformStats,
    linkStats,
    imageStats,
    textCounts,
    nodeCounts,
    layoutCounts,
    spacingProfile,
    figmaLinks,
    reason: payload.reason || '-'
  };
}

function progressLog(message) {
  process.stdout.write(`${message}\n`);
}

function resolveRepoRoot(repoLocalPath) {
  const resolved = repoLocalPath ? path.resolve(repoLocalPath) : process.cwd();
  if (!repoLocalPath) {
    return resolved;
  }
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    throw new Error(
      `repo_local_path "${repoLocalPath}" のディレクトリが見つかりません (root=${resolved}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `repo_local_path "${repoLocalPath}" はディレクトリではありません (root=${resolved}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`
    );
  }
  return resolved;
}

function normalizeManualFrames(manualFrames = []) {
  return manualFrames
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const name = entry.name || entry.frame_name || entry.route || `Frame ${index + 1}`;
      return {
        ...entry,
        frame_name: entry.frame_name || name,
        name,
        route: entry.route || `manual-${index + 1}`,
        source_path: entry.source_path || '(manual)',
        pattern: entry.pattern || 'manual'
      };
    })
    .filter(Boolean);
}

function ensureFramePositions(frames = []) {
  const fallback = assignFramePositions(frames);
  return frames.map((frame, index) => {
    const hasPosition =
      frame &&
      frame.position &&
      typeof frame.position.x === 'number' &&
      typeof frame.position.y === 'number';
    if (hasPosition) {
      return frame;
    }
    return {
      ...frame,
      position: fallback[index] ? fallback[index].position : { x: index * 40, y: index * 40 }
    };
  });
}

function applyDocsInstruction(docPath, instruction) {
  const absolute = path.join(process.cwd(), docPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`doc_path not found: ${docPath}`);
  }
  const original = fs.readFileSync(absolute, 'utf8');
  const note = `> NOTE (${new Date().toISOString()}): ${instruction}`;
  const updated = original.endsWith('\n') ? `${original}${note}\n` : `${original}\n${note}\n`;
  fs.writeFileSync(absolute, updated, 'utf8');
  return note;
}

function applyRepoPatch(targetPath, instruction, allowHtmlComment = false) {
  const absolute = path.join(process.cwd(), targetPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`target_path not found: ${targetPath}`);
  }
  const original = fs.readFileSync(absolute, 'utf8');
  if (allowHtmlComment) {
    const note = `<!-- repo_patch (${new Date().toISOString()}) ${instruction} -->`;
    const updated = original.endsWith('\n') ? `${original}${note}\n` : `${original}\n${note}\n`;
    fs.writeFileSync(absolute, updated, 'utf8');
    return { note, original };
  }
  const note = `repo_patch noop: would append comment "${instruction}" to ${targetPath}`;
  return { note, original };
}

async function executeDocsUpdateJob(jobPayload) {
  const job = cloneJob(jobPayload);
  job.constraints.max_files_changed = 1;
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    const result = buildValidationFailure(validation.errors);
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: result.status,
        summary: summarizeChecks(result.checks || [])
      });
    }
    return finalizeRun(runPaths, job, result, createdAt);
  }

  try {
    const docPath = normalizeRelativePath(job.inputs.doc_path);
    if (!docPath.startsWith('docs/')) {
      throw new Error('doc_path must stay under docs/');
    }
    ensureAllowedPath(docPath, job.constraints.allowed_paths);
    const note = applyDocsInstruction(docPath, job.inputs.instruction);
    const artifactPath = `.ai-runs/${runId}/docs_update_report.json`;
    writeJsonArtifact(artifactPath, {
      doc_path: docPath,
      instruction: job.inputs.instruction,
      note,
      updated_at: new Date().toISOString()
    });
    const result = {
      status: 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: `Docs updated at ${docPath}`,
      checks: [{ id: 'docs_update', ok: true, reason: 'instruction applied' }],
      logs: [`doc_path=${docPath}`]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'docs_update', ok: false, reason: error.message }],
      logs: ['docs_update failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeRepoPatchJob(jobPayload) {
  const job = cloneJob(jobPayload);
  job.constraints.max_files_changed = 1;
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const targetPath = normalizeRelativePath(job.inputs.target_path);
    ensureAllowedPath(targetPath, job.inputs.allowed_paths || job.constraints.allowed_paths);
    const allowComment = job.inputs && job.inputs.allow_html_comment === true;
    const { note } = applyRepoPatch(targetPath, job.inputs.instruction, allowComment);
    const noop = typeof note === 'string' && note.startsWith('repo_patch noop:');
    const summary = noop ? note : `Repo patch applied to ${targetPath}`;
    const checkReason = noop ? note : 'instruction applied';
    const artifactPath = `.ai-runs/${runId}/repo_patch_report.json`;
    writeJsonArtifact(artifactPath, {
      target_path: targetPath,
      instruction: job.inputs.instruction,
      note,
      updated_at: new Date().toISOString()
    });
    const result = {
      status: 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: summary,
      checks: [{ id: 'repo_patch', ok: true, reason: checkReason }],
      logs: [`target_path=${targetPath}`]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'repo_patch', ok: false, reason: error.message }],
      logs: ['repo_patch failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeFigmaBootstrapJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const planRelativePath = `.ai-runs/${runId}/figma_bootstrap_plan.json`;
  const planAbsolutePath = path.join(process.cwd(), planRelativePath);
  const nodesRelativePath = `.ai-runs/${runId}/figma_bootstrap_nodes.json`;
  const planState = {
    schema_version: SCHEMA_VERSION,
    job_type: job.job_type,
    run_id: runId,
    started_at: createdAt,
    status: 'pending',
    page_name: job.inputs.page_name || 'Hub Bootstrap',
    repo_reference: null,
    repo_root: job.inputs.repo_local_path ? path.resolve(job.inputs.repo_local_path) : process.cwd(),
    figma_file_key: null,
    screen_patterns: SCREEN_PATTERN_LIST.slice(),
    frames: [],
    frame_source: null,
    errors: []
  };
  const writePlan = () => {
    planState.updated_at = new Date().toISOString();
    try {
      fs.writeFileSync(planAbsolutePath, JSON.stringify(planState, null, 2));
    } catch (error) {
      console.error(`[figma-plan] write failed: ${error.message}`);
    }
  };
  writePlan();

  const annotateError = (error, where, meta = {}) => {
    const baseError = error instanceof Error ? error : new Error(String(error));
    if (!baseError.planWhere) {
      baseError.planWhere = where;
    }
    if (!baseError.planCode) {
      baseError.planCode = baseError.code || 'ERR';
    }
    baseError.planMeta = { ...(baseError.planMeta || {}), ...meta };
    return baseError;
  };

  const baseLogs = [`plan_path=${planRelativePath}`, `screen patterns=${SCREEN_PATTERNS_DESCRIPTION}`];
  let requestedPlanTarget = null;
  let frameSource = 'scan';

  try {
    const validation = validateJob(job);
    if (!validation.ok) {
      throw annotateError(
        new Error(validation.errors[0] || 'job validation failed'),
        'preflight',
        { errors: validation.errors }
      );
    }
    planState.status = 'running';

    const targetTemplate = job.inputs.target_path || '.ai-runs/{{run_id}}/figma_bootstrap_plan.json';
    try {
      requestedPlanTarget = resolveTargetPath(targetTemplate, runId);
      planState.requested_target = requestedPlanTarget;
    } catch (error) {
      throw annotateError(error, 'constraints', { target_template: targetTemplate });
    }
    try {
      ensureAllowedPath(
        requestedPlanTarget,
        job.constraints && job.constraints.allowed_paths ? job.constraints.allowed_paths : []
      );
    } catch (error) {
      throw annotateError(error, 'constraints', {
        allowed_paths: job.constraints ? job.constraints.allowed_paths : null
      });
    }

    const repoRef =
      normalizeRepoReference(job.inputs.repo_url || job.inputs.repo || job.inputs.owner_repo) ||
      normalizeRepoReference(job.inputs.repository);
    if (!repoRef) {
      throw annotateError(
        new Error('repo_url (owner/repo) を inputs に指定してください'),
        'preflight'
      );
    }
    planState.repo_reference = repoRef;

    const figmaInput = job.inputs.figma_design_url || job.inputs.figma_file_key;
    const fileKey = extractFigmaFileKey(figmaInput);
    planState.figma_file_key = fileKey;

    const figmaToken = (job.inputs.figma_token || process.env.FIGMA_TOKEN || '').trim();
    const hasFigmaToken = Boolean(figmaToken);

    try {
      const resolvedRoot = resolveRepoRoot(job.inputs.repo_local_path);
      planState.repo_root = resolvedRoot;
    } catch (error) {
      throw annotateError(error, 'resolveRepoRoot', { repo_local_path: job.inputs.repo_local_path });
    }

    const strategy = job.inputs.strategy || 'routes_first';
    baseLogs.push(`screen root=${planState.repo_root}`);
    baseLogs.push(`figma file_key=${fileKey}`);
    baseLogs.push(`repo=${repoRef}`);
    baseLogs.push(`screen strategy=${strategy}`);
    baseLogs.push(`figma_api=${hasFigmaToken ? 'enabled' : 'skipped'}`);

    let frames = [];
    if (Array.isArray(job.inputs.frames)) {
      const manualFrames = ensureFramePositions(normalizeManualFrames(job.inputs.frames));
      if (manualFrames.length) {
        frames = manualFrames;
        frameSource = 'manual-input';
      } else {
        frames = ensureFramePositions(
          normalizeManualFrames([
            { name: 'Bootstrap', source_path: '(manual)', route: '/', pattern: 'manual' }
          ])
        );
        frameSource = 'manual-default';
      }
    } else {
      frames = collectScreenCandidates(24, strategy, planState.repo_root);
      if (!frames.length) {
        frames = ensureFramePositions(
          normalizeManualFrames([
            { name: 'Bootstrap', source_path: '(manual)', route: '/', pattern: 'manual' }
          ])
        );
        frameSource = 'manual-default';
      }
    }
    planState.frames = frames;
    planState.frame_source = frameSource;

    writeJsonArtifact(nodesRelativePath, {
      run_id: runId,
      repo_reference: repoRef,
      repo_root: planState.repo_root,
      figma_file_key: fileKey,
      nodes: [],
      recorded_at: null
    });
    let commentId = 'skipped-no-token';
    if (hasFigmaToken) {
      try {
        const fileMetaResponse = await callFigmaApi({
          token: figmaToken,
          method: 'GET',
          endpoint: `/files/${fileKey}`
        });
        const fileLog = formatFigmaRequestLog('file_meta', fileMetaResponse.debug);
        if (fileLog) {
          baseLogs.push(fileLog);
        }
      } catch (infoError) {
        if (infoError.debug) {
          const debugLog = formatFigmaRequestLog('file_meta', infoError.debug);
          if (debugLog) {
            baseLogs.push(debugLog);
          }
        }
        baseLogs.push(`figma_info_error[file_meta]=${infoError.message}`);
      }
      const commentMessage = buildFigmaCommentMessage({
        pageName: planState.page_name,
        frames,
        runId,
        repoRef
      });
      let commentData;
      try {
        const commentResponse = await callFigmaApi({
          token: figmaToken,
          method: 'POST',
          endpoint: `/files/${fileKey}/comments`,
          body: {
            message: commentMessage,
            client_meta: { x: 0, y: 0 }
          }
        });
        const commentLog = formatFigmaRequestLog('comment', commentResponse.debug);
        if (commentLog) {
          baseLogs.push(commentLog);
        }
        commentData = commentResponse.data;
      } catch (commentError) {
        if (commentError.debug) {
          const debugLog = formatFigmaRequestLog('comment', commentError.debug);
          if (debugLog) {
            baseLogs.push(debugLog);
          }
        }
        baseLogs.push(`figma_info_error[comment]=${commentError.message}`);
        throw commentError;
      }
      commentId =
        (commentData && (commentData.id || (commentData.comment && commentData.comment.id))) ||
        'unknown';
    }
    planState.comment_id = commentId;
    planState.status = 'ok';
    planState.completed_at = new Date().toISOString();
    writePlan();

    if (
      requestedPlanTarget &&
      requestedPlanTarget !== planRelativePath &&
      requestedPlanTarget.startsWith('.ai-runs/')
    ) {
      try {
        const absoluteTarget = path.join(process.cwd(), requestedPlanTarget);
        fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
        fs.writeFileSync(absoluteTarget, JSON.stringify(planState, null, 2));
      } catch (copyError) {
        baseLogs.push(`plan_copy_error=${copyError.message}`);
      }
    }

    const result = {
      status: 'ok',
      artifacts: [
        { path: planRelativePath, kind: 'json' },
        { path: nodesRelativePath, kind: 'json' }
      ],
      diff_summary: `Figma bootstrap planned (${frames.length} frames)`,
      checks: [
        { id: 'figma_comment', ok: true, reason: `comment_id=${commentId}` },
        { id: 'repo_routes', ok: true, reason: `${frames.length} screen candidates` }
      ],
      logs: [
        ...baseLogs,
        `frames_source=${frameSource}`,
        `frames_count=${frames.length}`,
        `comment_id=${commentId}`
      ]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const where = error.planWhere || 'unknown';
    const failureMessage = error.message || 'figma bootstrap failed';
    const failureReason = `${failureMessage} (where=${where}, root=${planState.repo_root}, patterns=${SCREEN_PATTERNS_DESCRIPTION})`;
    planState.status = 'error';
    planState.failed_at = new Date().toISOString();
    planState.errors.push({
      code: error.planCode || error.code || 'ERR',
      where,
      message: failureMessage,
      root: planState.repo_root,
      patterns: planState.screen_patterns,
      meta: error.planMeta || {},
      stack: error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : undefined
    });
    writePlan();
    const result = {
      status: 'error',
      errors: [failureReason],
      checks: [{ id: 'figma_bootstrap', ok: false, reason: failureReason }],
      logs: baseLogs.length
        ? [...baseLogs, `failure_reason=${failureReason}`, 'figma bootstrap failed']
        : ['figma bootstrap failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } finally {
    writePlan();
  }
}

async function executeCodeToFigmaFromUrlJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();
  const summaryPath = `.ai-runs/${runId}/summary.md`;
  const domSnapshotPath = `.ai-runs/${runId}/dom_snapshot.json`;
  const figmaPayloadPath = `.ai-runs/${runId}/figma_nodes_payload.json`;
  const artifactPath = `.ai-runs/${runId}/code_to_figma_report.json`;
  let collectedPages = [];
  const progressRows = [];
  const frameRows = [];
  const progressMessages = [];
  let mcpAttempt = null;
  const emitProgress = (message) => {
    progressMessages.push(message);
    progressLog(message);
  };

  const writeFailureSummary = (reason) => {
    const pageUrl = job?.inputs?.page_url || '';
    const summary = buildCodeToFigmaSummary({
      status: 'failed',
      runId,
      pageUrl,
      pages: collectedPages.length > 0 ? collectedPages : pageUrl ? [pageUrl] : [],
      frames: frameRows,
      progress: progressRows,
      mcpAttempt,
      reason,
      nextAction: inferNextAction(reason)
    });
    writeTextArtifact(summaryPath, summary);
  };

  const validation = validateJob(job);
  if (!validation.ok) {
    const reason = validation.errors[0] || 'job validation failed';
    writeFailureSummary(reason);
    const result = buildValidationFailure(validation.errors);
    result.artifacts = [{ path: summaryPath, kind: 'markdown' }];
    return finalizeRun(runPaths, job, result, createdAt);
  }

  try {
    if (shouldTryMcpFirst(job)) {
      const mcpProvider = resolveMcpProvider(job);
      if (!mcpProvider) {
        mcpAttempt = { status: 'skipped', reason: 'mcp_provider_not_configured' };
        emitProgress('C2F_MCP_FIRST status=skipped reason=mcp_provider_not_configured');
      } else {
        emitProgress(`C2F_MCP_FIRST status=started provider=${mcpProvider}`);
        try {
          const mcpJob = buildCodeToFigmaMcpJob(job, runId);
          const mcpResult = await runAdapter(mcpJob, { role: 'operator' });
          if (mcpResult && mcpResult.status === 'ok' && hasCodeToFigmaMcpSuccessSignal(mcpResult)) {
            const mcpPayload = extractMcpCodeToFigmaPayload(mcpResult);
            const mcpPages = Array.isArray(mcpPayload.pages) && mcpPayload.pages.length > 0
              ? mcpPayload.pages
              : collectRequestedPagesForMcp(job);
            const mcpFrames = normalizeMcpFrames(mcpPayload.frames, mcpPages);
            const mcpProgress = normalizeMcpProgress(mcpPayload.progress, mcpPages);
            if (mcpFrames.length === 0) {
              const reason = 'mcp_frames_missing';
              mcpAttempt = { status: 'failed', reason };
              emitProgress(`C2F_MCP_FIRST status=failed reason=${reason}`);
            } else {
              mcpAttempt = { status: 'ok', reason: '-' };
              emitProgress('C2F_MCP_FIRST status=ok reason=-');
              const targetPath = resolveTargetPath(job.inputs.target_path, runId);
              ensureAllowedPath(targetPath, job.constraints.allowed_paths);
              const pageUrl = safeNormalizePageUrl((job.inputs && job.inputs.page_url) || '');
              const resolvedPages = mcpPages.length > 0 ? mcpPages : pageUrl ? [pageUrl] : [];
              resolvedPages.forEach((entry) => {
                if (!collectedPages.includes(entry)) {
                  collectedPages.push(entry);
                }
              });
              mcpFrames.forEach((entry) => frameRows.push(entry));
              mcpProgress.forEach((entry) => progressRows.push(entry));
              const summary = buildCodeToFigmaSummary({
                status: 'ok',
                runId,
                pageUrl: resolvedPages[0] || pageUrl,
                pages: resolvedPages,
                frames: frameRows,
                progress: progressRows,
                transformStats: mcpPayload.transformStats,
                linkStats: mcpPayload.linkStats,
                imageStats: mcpPayload.imageStats,
                textCounts: mcpPayload.textCounts,
                nodeCounts: mcpPayload.nodeCounts,
                layoutCounts: mcpPayload.layoutCounts,
                spacingProfile: mcpPayload.spacingProfile,
                mcpAttempt,
                figmaFileUrl: mcpPayload.figmaLinks.file || '-',
                figmaPageUrl: mcpPayload.figmaLinks.page || '-',
                figmaFrameUrl: mcpPayload.figmaLinks.frame || '-'
              });
              writeTextArtifact(summaryPath, summary);
              writeJsonArtifact(targetPath, {
                run_id: runId,
                page_url: resolvedPages[0] || pageUrl || '',
                pages_total: resolvedPages.length,
                pages: resolvedPages.map((url, index) => ({ index: index + 1, url })),
                frames: frameRows,
                progress: progressRows,
                transform_stats: mcpPayload.transformStats || undefined,
                link_stats: mcpPayload.linkStats || undefined,
                image_stats: mcpPayload.imageStats || undefined,
                text_counts: mcpPayload.textCounts || undefined,
                node_counts: mcpPayload.nodeCounts || undefined,
                layout_counts: mcpPayload.layoutCounts || undefined,
                spacing_profile: mcpPayload.spacingProfile || undefined,
                naming: { naming_version: PHASE1_NAMING_VERSION },
                mcp_attempt: mcpAttempt
              });
              const result = {
                status: 'ok',
                artifacts: [
                  { path: targetPath, kind: 'json' },
                  { path: summaryPath, kind: 'markdown' }
                ],
                diff_summary: 'Code→Figma completed via MCP',
                checks: [{ id: 'code_to_figma_mcp', ok: true, reason: 'mcp_first_success' }],
                logs: [...progressMessages, 'code_to_figma_mcp=ok']
              };
              return finalizeRun(runPaths, job, result, createdAt);
            }
          }
          const reason = parseMcpFailureReason(mcpResult);
          mcpAttempt = { status: 'failed', reason };
          emitProgress(`C2F_MCP_FIRST status=failed reason=${reason}`);
        } catch (mcpError) {
          const reason = sanitizeReasonText(mcpError, 'mcp_failed');
          mcpAttempt = { status: 'failed', reason };
          emitProgress(`C2F_MCP_FIRST status=failed reason=${reason}`);
        }
      }
    } else {
      mcpAttempt = { status: 'skipped', reason: 'run_mode_not_mcp' };
    }

    const targetPath = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(targetPath, job.constraints.allowed_paths);

    const pageUrl = typeof job.inputs.page_url === 'string' ? job.inputs.page_url.trim() : '';
    if (!pageUrl) {
      throw new Error('page_url is required');
    }
    collectedPages = [normalizePageUrl(pageUrl)];
    const inputPages = Array.isArray(job.inputs.pages)
      ? job.inputs.pages
          .filter((entry) => typeof entry === 'string' && entry.trim())
          .map((entry) => normalizePageUrl(entry.trim()))
      : [];
    let firstHtml = '';
    let firstMeta = {};
    if (inputPages.length > 0) {
      const unique = [];
      const seen = new Set();
      [normalizePageUrl(pageUrl), ...inputPages].forEach((entry) => {
        if (!seen.has(entry)) {
          seen.add(entry);
          unique.push(entry);
        }
      });
      collectedPages = unique.slice(0, 20);
    } else {
      const collected = await collectPagesFromOrigin(pageUrl, { maxPages: 20 });
      collectedPages = collected.pages.length > 0 ? collected.pages : [normalizePageUrl(pageUrl)];
      firstHtml = collected.html;
      firstMeta = collected.meta;
    }
    emitProgress(`PAGE_DISCOVERED total=${collectedPages.length}`);

    const figmaInput = job.inputs.figma_design_url || job.inputs.figma_file_key;
    const fileKey = extractFigmaFileKey(figmaInput);
    const figmaToken = (job.inputs.figma_token || process.env.FIGMA_TOKEN || '').trim();
    const tokenPresent = figmaToken.length > 0;
    const tokenLen = figmaToken.length;
    if (!tokenPresent) {
      throw new Error('FIGMA_TOKEN missing (presence=false len=0)');
    }

    let firstSuccess = null;
    let firstSnapshot = null;
    let firstPayload = null;
    for (let i = 0; i < collectedPages.length; i += 1) {
      const url = collectedPages[i];
      const seq = `${i + 1}/${collectedPages.length}`;
      emitProgress(`PAGE_PROCESS_START ${seq} url=${url}`);
      try {
        if (url.includes('__force_fail__')) {
          throw new Error('forced_page_failure');
        }
        let html;
        let meta;
        if (i === 0 && firstHtml) {
          html = firstHtml;
          meta = firstMeta;
        } else {
          const fetched = await fetchPageSnapshot(url);
          html = fetched.html;
          meta = fetched.meta;
        }
        const snapshot = buildDomSnapshot(url, html, meta);
        const figmaPayload = buildFigmaFramePayload(snapshot, { pageIndex: i + 1 });
        figmaPayload.pages = collectedPages.map((entry, index) => ({ index: index + 1, url: entry }));
        const writeResponse = await callFigmaApi({
          token: figmaToken,
          method: 'POST',
          endpoint: `/files/${fileKey}/nodes`,
          body: {
            action: 'create_frame_from_snapshot',
            payload: figmaPayload
          }
        });
        const created = extractCreatedNodeInfo(writeResponse.data || {});
        if (!created.frameId && process.env.FIGMA_API_MOCK === '1') {
          created.pageId = created.pageId || '0:1';
          created.frameId = `1:${i + 1}`;
        }
        if (!created.frameId) {
          throw new Error('figma write response missing frame id');
        }
        if (!firstSuccess) {
          firstSuccess = created;
          firstSnapshot = snapshot;
          firstPayload = figmaPayload;
        }
        const frameUrl = toFigmaNodeUrl(fileKey, created.frameId);
        const layoutResult = await applyMinimalAutoLayout({
          token: figmaToken,
          fileKey,
          frameId: created.frameId,
          figmaPayload
        });
        frameRows.push({
          index: i + 1,
          url,
          status: 'success',
          frameUrl,
          layoutApplied: layoutResult.layoutApplied,
          layoutReason: layoutResult.layoutReason
        });
        progressRows.push({
          index: i + 1,
          url,
          status: 'success',
          reason: '-'
        });
        emitProgress(`PAGE_PROCESS_DONE ${seq} status=success reason=-`);
      } catch (pageError) {
        const reasonText = sanitizeReasonText(pageError, 'unknown');
        progressRows.push({
          index: i + 1,
          url,
          status: 'failed',
          reason: reasonText
        });
        frameRows.push({
          index: i + 1,
          url,
          status: 'failed',
          reason: reasonText,
          layoutApplied: false,
          layoutReason: 'page_create_failed'
        });
        emitProgress(`PAGE_PROCESS_DONE ${seq} status=failed reason=${reasonText}`);
      }
    }
    if (!firstSuccess || !firstSnapshot || !firstPayload) {
      throw new Error('all pages failed');
    }
    const namingSummary = buildNamingChecks(firstPayload);
    writeJsonArtifact(domSnapshotPath, firstSnapshot);
    writeJsonArtifact(figmaPayloadPath, firstPayload);

    const figmaFileUrl = `https://www.figma.com/file/${fileKey}`;
    const figmaPageUrl = toFigmaNodeUrl(fileKey, firstSuccess.pageId);
    const figmaFrameUrl = toFigmaNodeUrl(fileKey, firstSuccess.frameId);
    const summary = buildCodeToFigmaSummary({
      status: 'ok',
      runId,
      pageUrl: collectedPages[0],
      pages: collectedPages,
      frames: frameRows,
      progress: progressRows,
      mcpAttempt,
      figmaFileUrl,
      figmaPageUrl,
      figmaFrameUrl
    });
    writeTextArtifact(summaryPath, summary);

    writeJsonArtifact(targetPath, {
      run_id: runId,
      page_url: collectedPages[0],
      pages_total: collectedPages.length,
      pages: collectedPages.map((url, index) => ({ index: index + 1, url })),
      frames: frameRows,
      progress: progressRows,
      figma_file_key: fileKey,
      figma_links: {
        file: figmaFileUrl,
        page: figmaPageUrl,
        frame: figmaFrameUrl
      },
      figma_token: { present: tokenPresent, len: tokenLen },
      snapshot: {
        title: firstSnapshot.title,
        text_blocks: firstSnapshot.text_blocks.length
      },
      naming: namingSummary,
      created_at: new Date().toISOString()
    });

    if (targetPath !== artifactPath) {
      writeJsonArtifact(artifactPath, {
        run_id: runId,
        page_url: collectedPages[0],
        pages_total: collectedPages.length,
        pages: collectedPages.map((url, index) => ({ index: index + 1, url })),
        frames: frameRows,
        progress: progressRows,
        figma_links: {
          file: figmaFileUrl,
          page: figmaPageUrl,
          frame: figmaFrameUrl
        },
        naming: namingSummary,
        figma_token: { present: tokenPresent, len: tokenLen }
      });
    }

    const result = {
      status: 'ok',
      artifacts: [
        { path: targetPath, kind: 'json' },
        { path: domSnapshotPath, kind: 'json' },
        { path: figmaPayloadPath, kind: 'json' },
        { path: summaryPath, kind: 'markdown' }
      ],
      diff_summary: 'Code→Figma completed for single page URL',
      checks: [
        { id: 'page_fetch', ok: true, reason: `url=${collectedPages[0]}` },
        { id: 'page_collect', ok: collectedPages.length >= 1, reason: `pages_total=${collectedPages.length}` },
        {
          id: 'page_process',
          ok: progressRows.some((row) => row.status === 'success'),
          reason: `success=${progressRows.filter((row) => row.status === 'success').length}/${progressRows.length}`
        },
        { id: 'naming_tag_guard', ok: !namingSummary.tag_derived_name, reason: `tag_derived_name=${namingSummary.tag_derived_name}` },
        {
          id: 'naming_section_order',
          ok: namingSummary.section_sequence_stable,
          reason: `section_sequence_stable=${namingSummary.section_sequence_stable}`
        },
        { id: 'figma_write', ok: true, reason: `file_key=${fileKey}` }
      ],
      logs: [
        ...progressMessages,
        `page_url=${collectedPages[0]}`,
        `pages_total=${collectedPages.length}`,
        `naming_version=${namingSummary.naming_version}`,
        `figma_file_key=${fileKey}`,
        `figma_token_present=${tokenPresent}`,
        `figma_token_len=${tokenLen}`
      ]
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const reason = error && error.message ? error.message : 'code_to_figma_failed';
    writeFailureSummary(reason);
    const result = {
      status: 'error',
      errors: [reason],
      artifacts: [{ path: summaryPath, kind: 'markdown' }],
      checks: [{ id: 'code_to_figma', ok: false, reason }],
      logs: [...progressMessages, 'code_to_figma failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

function checkCommandAvailability(command) {
  try {
    const result = execSync(`command -v ${command}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (error) {
    return null;
  }
}

function maskEnvValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'NOT_SET';
  }
  return 'SET';
}

function exitWithJobError(checkId, reason, logMessages) {
  const logsArray = Array.isArray(logMessages) ? logMessages : logMessages ? [logMessages] : [];
  const result = {
    status: 'error',
    checks: [{ id: checkId, ok: false, reason }],
    logs: logsArray
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}

function buildSpawnEnv() {
  const env = {};
  SPAWN_ENV_ALLOWLIST.forEach((key) => {
    if (typeof process.env[key] === 'string') {
      env[key] = process.env[key];
    }
  });
  return env;
}

function writeTextArtifact(relativePath, content = '') {
  const absolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return relativePath;
}

function captureWithLimit(buffer, chunk) {
  const next = buffer + chunk;
  if (next.length <= MAX_SPAWN_CAPTURE) {
    return next;
  }
  return next.slice(0, MAX_SPAWN_CAPTURE);
}

function runSpawnCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });
    child.stdout.on('data', (chunk) => {
      stdout = captureWithLimit(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = captureWithLimit(stderr, chunk.toString());
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function executeDiagnosticsJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const logs = [];
    const checks = [];
    let hasBlockingFailure = false;

    function pushCheck(id, ok, reason, importance = 'optional') {
      checks.push({ id, ok, reason });
      if (!ok && importance === 'required') {
        hasBlockingFailure = true;
      }
    }

    const nodeVersion = process.version || 'unknown';
    logs.push(`Node.js バージョン: ${nodeVersion}`);
    pushCheck('node_version', nodeVersion !== 'unknown', `process.version=${nodeVersion}`, 'required');

    const commandTargets = [
      { name: 'node', importance: 'required' },
      { name: 'npx', importance: 'required' },
      { name: 'git', importance: 'required' },
      { name: 'php', importance: 'optional' },
      { name: 'claude', importance: 'optional' },
      { name: 'codex', importance: 'optional' }
    ];

    const commandReport = {};
    commandTargets.forEach((entry) => {
      const pathResult = checkCommandAvailability(entry.name);
      const found = Boolean(pathResult);
      commandReport[entry.name] = pathResult || 'NOT_FOUND';
      if (found) {
        logs.push(`${entry.name} コマンド: ${pathResult}`);
        pushCheck(`cmd_${entry.name}`, true, `${entry.name} コマンド検出: ${pathResult}`, entry.importance);
      } else {
        logs.push(`${entry.name} コマンド未検出`);
        const message =
          entry.importance === 'required'
            ? `${entry.name} コマンドが見つかりません`
            : `${entry.name} コマンドは任意ですが見つかりませんでした`;
        pushCheck(`cmd_${entry.name}`, false, message, entry.importance);
      }
    });

    const envTargets = [
      { name: 'OPENAI_API_KEY', importance: 'required' },
      { name: 'ANTHROPIC_API_KEY', importance: 'optional' }
    ];
    const envReport = {};
    envTargets.forEach((entry) => {
      const key = entry.name;
      const masked = maskEnvValue(process.env[key]);
      envReport[key] = masked;
      logs.push(`環境変数 ${key}: ${masked}`);
      const ok = masked === 'SET';
      pushCheck(`env_${key.toLowerCase()}`, ok, `環境変数 ${key}: ${masked}`, entry.importance);
    });

    const artifactPath = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(artifactPath, job.constraints.allowed_paths);
    writeJsonArtifact(artifactPath, {
      generated_at: new Date().toISOString(),
      node_version: nodeVersion,
      commands: commandReport,
      env: envReport
    });

    const result = {
      status: hasBlockingFailure ? 'error' : 'ok',
      artifacts: [{ path: artifactPath, kind: 'json' }],
      diff_summary: 'Diagnostics completed',
      checks,
      logs
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'diagnostics', ok: false, reason: error.message }],
      logs: ['diagnostics failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeSpawnJob(jobPayload) {
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    if (!job.inputs || job.inputs.mcp_provider !== 'spawn') {
      throw new Error('spawn provider requires inputs.mcp_provider="spawn"');
    }
    const command = job.inputs.mcp_command;
    if (typeof command !== 'string' || !ALLOWED_SPAWN_COMMANDS.has(command)) {
      throw new Error('spawn command not allowed');
    }
    const rawArgs = job.inputs.mcp_args || [];
    if (!Array.isArray(rawArgs)) {
      throw new Error('spawn args must be an array');
    }
    const args = rawArgs.map((value) => {
      if (typeof value !== 'string') {
        throw new Error('spawn args entries must be strings');
      }
      return value;
    });
    if (!job.constraints || job.constraints.no_destructive_ops !== true) {
      throw new Error('spawn jobs require constraints.no_destructive_ops=true');
    }
    const allowedPaths = job.constraints.allowed_paths;
    if (!Array.isArray(allowedPaths) || !allowedPaths.length) {
      throw new Error('spawn jobs require constraints.allowed_paths');
    }
    const resolvedTarget = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(resolvedTarget, allowedPaths);
    const env = buildSpawnEnv();
    const { code, stdout, stderr } = await runSpawnCommand(command, args, env);
    const stdoutPath = `.ai-runs/${runId}/spawn_stdout.txt`;
    const stderrPath = `.ai-runs/${runId}/spawn_stderr.txt`;
    writeTextArtifact(stdoutPath, stdout);
    writeTextArtifact(stderrPath, stderr);
    writeJsonArtifact(resolvedTarget, {
      command,
      args,
      exit_code: code,
      stdout_path: stdoutPath,
      stderr_path: stderrPath
    });
    const preview = (text) => {
      if (!text) {
        return '(empty)';
      }
      return text.split('\n').slice(0, 3).join(' | ');
    };
    const knownWarnings = [];
    let stderrPreview = preview(stderr);
    const stdoutPreview = preview(stdout);
    if (stderr.includes(CODEX_SHELL_WARNING)) {
      const warningMessage = 'Shell snapshot validation failed (exec may still succeed)';
      knownWarnings.push({
        id: 'codex_shell_snapshot_validation_failed',
        message: warningMessage
      });
      stderrPreview = `[KNOWN WARNING] ${warningMessage}`;
    }
    const logs = [
      `spawn command=${command}`,
      `spawn args=${JSON.stringify(args)}`,
      `stdout preview: ${stdoutPreview}`,
      `stderr preview: ${stderrPreview}`
    ];
    knownWarnings.forEach((warning) => {
      logs.push(`known_warning=${warning.id}`);
    });
    const checks = [{ id: 'spawn_exec', ok: code === 0, reason: `exit=${code}` }];
    const result = {
      status: code === 0 ? 'ok' : 'error',
      artifacts: [
        { path: resolvedTarget, kind: 'json' },
        { path: stdoutPath, kind: 'text' },
        { path: stderrPath, kind: 'text' }
      ],
      diff_summary: `spawn exit=${code}`,
      checks,
      logs,
      known_warnings: knownWarnings
    };
    return finalizeRun(runPaths, job, result, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'spawn_exec', ok: false, reason: error.message }],
      logs: ['spawn execution failed']
    };
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function executeMcpJob(jobPayload, role) {
  if (jobPayload && jobPayload.inputs && jobPayload.inputs.mcp_provider === 'spawn') {
    return executeSpawnJob(jobPayload);
  }
  const job = cloneJob(jobPayload);
  const runId = createRunIdOrExit();
  const runPaths = createRunPathsOrExit(runId);
  recordRunStart(runPaths, job);
  const createdAt = new Date().toISOString();
  const startedAt = createdAt;
  const isOfflineSmoke = job && job.job_type === 'integration_hub.phase2.mcp.offline_smoke';

  if (isOfflineSmoke) {
    const initialRunJson = {
      job,
      runnerResult: {
        status: 'running',
        checks: [],
        logs: ['offline_smoke started']
      },
      meta: {
        schema_version: SCHEMA_VERSION,
        created_at: createdAt
      }
    };
    writeJsonAtomic(runPaths.runJson, initialRunJson);
  }

  const validation = validateJob(job);
  if (!validation.ok) {
    return finalizeRun(runPaths, job, buildValidationFailure(validation.errors), createdAt);
  }

  try {
    const resolvedTarget = resolveTargetPath(job.inputs.target_path, runId);
    ensureAllowedPath(resolvedTarget, job.constraints.allowed_paths);
    const runnerJob = cloneJob(job);
    runnerJob.inputs = runnerJob.inputs || {};
    runnerJob.inputs.target_path_resolved = resolvedTarget;
    const runnerResult = await runAdapter(runnerJob, { role });
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: runnerResult.status,
        summary: summarizeChecks(runnerResult.checks || [])
      });
    }
    return finalizeRun(runPaths, job, runnerResult, createdAt);
  } catch (error) {
    const result = {
      status: 'error',
      errors: [error.message],
      checks: [{ id: 'mcp_exec', ok: false, reason: error.message }],
      logs: ['runner_adapter=mcp']
    };
    if (isOfflineSmoke) {
      const finishedAt = new Date().toISOString();
      updateLatestOfflineSmoke({
        runId,
        jobType: job.job_type,
        startedAt,
        finishedAt,
        status: result.status,
        summary: summarizeChecks(result.checks || [])
      });
    }
    return finalizeRun(runPaths, job, result, createdAt);
  }
}

async function main() {
  const { job, role } = parseArgs(process.argv);
  if (!job) {
    console.error('Usage: node scripts/run-job.js --job <path> [--role operator]');
    process.exit(1);
    return;
  }

  const jobPath = path.resolve(job);
  let raw;
  try {
    raw = fs.readFileSync(jobPath, 'utf8');
  } catch (error) {
    exitWithJobError('job_json_parse', 'run.json のJSON形式が正しくありません。', [
      `job file read failed: ${error.message}`
    ]);
    return;
  }
  let jobPayload;
  try {
    jobPayload = JSON.parse(raw);
  } catch (error) {
    exitWithJobError('job_json_parse', 'run.json のJSON形式が正しくありません。', [
      `job JSON parse failed: ${error.message}`
    ]);
    return;
  }
  applyCodexPrompt(jobPayload, { lang: jobPayload && jobPayload.output_language });
  const validation = validateJob(jobPayload);
  if (!validation.ok) {
    const reason = `ジョブ定義エラー: ${validation.errors[0] || '不明なエラー'}`;
    exitWithJobError('job_validation', reason, validation.errors);
    return;
  }
  const jobType = jobPayload.job_type;
  let result;
  if (jobType === 'integration_hub.phase2.docs_update') {
    result = await executeDocsUpdateJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.repo_patch') {
    result = await executeRepoPatchJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.diagnostics') {
    result = await executeDiagnosticsJob(jobPayload);
  } else if (jobType === 'integration_hub.phase1.code_to_figma_from_url') {
    result = await executeCodeToFigmaFromUrlJob(jobPayload);
  } else if (jobType === 'integration_hub.phase2.figma_bootstrap_from_repo') {
    result = await executeFigmaBootstrapJob(jobPayload);
  } else {
    result = await executeMcpJob(jobPayload, role);
  }
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  extractSameOriginLinks,
  buildCodeToFigmaSummary,
  normalizePageUrl,
  extractTextFromHtml,
  buildFigmaFramePayload
};
