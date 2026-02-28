const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeRelativePath(rawPath, fallback = '.ai-runs/handshake.json') {
  const candidate = String(rawPath || fallback).trim() || fallback;
  const normalized = path.posix.normalize(toPosixPath(candidate)).replace(/^\.\//, '');
  if (path.posix.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error('codex_cli_target_path_blocked');
  }
  return normalized;
}

function resolveTargetPath(job) {
  const raw = (job.inputs && (job.inputs.target_path_resolved || job.inputs.target_path)) || '.ai-runs/handshake.json';
  return normalizeRelativePath(raw);
}

function writeHandshakeArtifact(targetPath, payload, options = {}) {
  const absolute = path.join(process.cwd(), targetPath);
  if (options.allowedRoot) {
    const allowedRoot = path.join(process.cwd(), options.allowedRoot);
    const relative = path.relative(allowedRoot, absolute);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('codex_cli_target_path_blocked');
    }
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2));
}

function isPhase1CodeToFigmaJob(job) {
  return job && job.job_type === 'integration_hub.phase1.code_to_figma_from_url';
}

function normalizeStubPages(job = {}) {
  const inputs = job.inputs || {};
  const pageUrl = typeof inputs.page_url === 'string' && inputs.page_url.trim() ? inputs.page_url.trim() : '';
  const pages = Array.isArray(inputs.pages)
    ? inputs.pages
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim())
    : [];
  const merged = [];
  const seen = new Set();
  [pageUrl, ...pages].forEach((entry) => {
    if (!entry || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    merged.push(entry);
  });
  return merged.slice(0, 20);
}

function normalizePageUrlForMatch(rawUrl = '') {
  const text = String(rawUrl || '').trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = new URL(text);
    if (parsed.search) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
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

function truncateImageLabel(value = '', maxLen = 32) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.slice(0, maxLen);
}

function extractImagePlaceholders(job = {}) {
  const html = job && job.inputs && typeof job.inputs.page_html === 'string' ? job.inputs.page_html : '';
  if (!html) {
    return { images: [], image_stats: { images_total: 0, images_labeled: 0 } };
  }
  const images = [];
  const pattern = /<img\b([^>]*)\/?>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = String(match[1] || '');
    const alt = truncateImageLabel(extractAttrValue(attrs, 'alt'));
    const ariaLabel = truncateImageLabel(extractAttrValue(attrs, 'aria-label'));
    const label = alt || ariaLabel || '';
    images.push({
      name: label ? `Image - ${label}` : 'Image',
      labeled: Boolean(label)
    });
  }
  return {
    images,
    image_stats: {
      images_total: images.length,
      images_labeled: images.filter((img) => img.labeled).length
    }
  };
}

function computeInternalLinkMappings(job = {}, pages = []) {
  const inputs = job && job.inputs ? job.inputs : {};
  const html = typeof inputs.page_html === 'string' ? inputs.page_html : '';
  const pageUrl = typeof inputs.page_url === 'string' ? inputs.page_url.trim() : '';
  if (!html || !pageUrl) {
    return {
      link_stats: { links_total: 0, links_internal: 0, links_mapped: 0 },
      links: []
    };
  }
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return {
      link_stats: { links_total: 0, links_internal: 0, links_mapped: 0 },
      links: []
    };
  }
  const pageIndexByUrl = new Map();
  pages.forEach((url, index) => {
    const normalized = normalizePageUrlForMatch(url);
    if (normalized) {
      pageIndexByUrl.set(normalized, index + 1);
    }
  });
  const links = [];
  let linksTotal = 0;
  let linksInternal = 0;
  const pattern = /<a\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = String(match[1] || '');
    const href = extractAttrValue(attrs, 'href');
    if (!href) {
      continue;
    }
    linksTotal += 1;
    let parsed;
    try {
      parsed = new URL(href, base.toString());
    } catch {
      continue;
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      continue;
    }
    if (parsed.origin !== base.origin) {
      continue;
    }
    linksInternal += 1;
    if (parsed.search) {
      continue;
    }
    parsed.hash = '';
    const normalized = parsed.toString();
    const targetIndex = pageIndexByUrl.get(normalized);
    if (!targetIndex) {
      continue;
    }
    links.push({
      source_page_index: 1,
      href: normalized,
      target_page_index: targetIndex
    });
  }
  return {
    link_stats: {
      links_total: linksTotal,
      links_internal: linksInternal,
      links_mapped: links.length
    },
    links
  };
}

function pageFrameName(index, url = '') {
  const number = String(index).padStart(2, '0');
  const short = String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    .slice(0, 24);
  return short ? `Page ${number} - ${short}` : `Page ${number}`;
}

const PAGE_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 24,
  paddingRight: 24,
  paddingBottom: 24,
  paddingLeft: 24,
  itemSpacing: 24,
};

const SECTION_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  itemSpacing: 16,
};

const HEADER_FOOTER_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  itemSpacing: 12,
};

const HERO_LAYOUT_MINIMAL = {
  layoutMode: 'VERTICAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  paddingTop: 24,
  paddingRight: 24,
  paddingBottom: 24,
  paddingLeft: 24,
  itemSpacing: 16,
};

const NAV_LAYOUT_MINIMAL = {
  layoutMode: 'HORIZONTAL',
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'AUTO',
  itemSpacing: 12,
};

const OUTER_CONTAINER_NAMES = ['Header', 'Hero', 'Footer'];
const PROTECTED_FRAME_NAMES = new Set([
  'Header',
  'Hero',
  'Footer',
  'Nav',
  'Page',
  'Section'
]);

function shouldForceLayoutFailure() {
  return process.env.C2F_LAYOUT_FAIL === '1';
}

function buildSpacingProfile() {
  return {
    Page: { padding: 24, itemSpacing: 24, layoutMode: 'VERTICAL' },
    Section: { padding: 16, itemSpacing: 16, layoutMode: 'VERTICAL' },
    Header: { padding: 16, itemSpacing: 12, layoutMode: 'VERTICAL' },
    Footer: { padding: 16, itemSpacing: 12, layoutMode: 'VERTICAL' },
    Hero: { padding: 24, itemSpacing: 16, layoutMode: 'VERTICAL' },
    Nav: { itemSpacing: 12, layoutMode: 'HORIZONTAL' }
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeReason(error, fallback = 'codex_cli_failed') {
  const text = error && error.message ? String(error.message) : String(error || '');
  if (!text) {
    return fallback;
  }
  if (/codex_cli_target_path_blocked/.test(text)) {
    return 'codex_cli_target_path_blocked';
  }
  if (/codex_cli_network_policy_blocked/.test(text)) {
    return 'codex_cli_network_policy_blocked';
  }
  if (/codex_cli_timeout/.test(text)) {
    return 'codex_cli_timeout';
  }
  return fallback;
}

function collectSecretLens(job = {}) {
  const inputs = job && job.inputs ? job.inputs : {};
  const source = {
    FIGMA_TOKEN: inputs.figma_token || process.env.FIGMA_TOKEN || '',
    OPENAI_API_KEY: inputs.openai_api_key || process.env.OPENAI_API_KEY || '',
    ANTHROPIC_API_KEY: inputs.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
    JWT_SECRET: inputs.jwt_secret || process.env.JWT_SECRET || ''
  };
  const lenses = {};
  Object.entries(source).forEach(([key, value]) => {
    const text = String(value || '');
    lenses[key] = text.length;
  });
  return lenses;
}

function isBlockedNetworkHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  if (!host) {
    return true;
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split('.').map((part) => Number(part));
    if (octets[0] === 127 || octets[0] === 10) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }
  }
  return false;
}

function enforceCodexCliNetworkPolicy(job = {}) {
  const inputs = job && job.inputs ? job.inputs : {};
  const urls = [];
  if (typeof inputs.page_url === 'string' && inputs.page_url.trim()) {
    urls.push(inputs.page_url.trim());
  }
  if (Array.isArray(inputs.pages)) {
    inputs.pages
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .forEach((entry) => urls.push(entry.trim()));
  }
  for (const raw of urls) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('codex_cli_network_policy_blocked');
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error('codex_cli_network_policy_blocked');
    }
    if (isBlockedNetworkHost(parsed.hostname)) {
      throw new Error('codex_cli_network_policy_blocked');
    }
  }
}

function isVoidHtmlTag(tag = '') {
  return new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']).has(String(tag || '').toLowerCase());
}

function extractMainDirectStructuralTags(html = '') {
  const text = String(html || '');
  const mainMatch = text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!mainMatch || !mainMatch[1]) {
    return [];
  }
  const content = mainMatch[1];
  const recognized = new Set(['header', 'nav', 'section', 'footer']);
  const tags = [];
  const stack = [];
  const pattern = /<\/?([a-zA-Z0-9:-]+)\b[^>]*>/g;
  let match;
  while ((match = pattern.exec(content))) {
    const token = String(match[0] || '');
    const tag = String(match[1] || '').toLowerCase();
    const isClosing = token.startsWith('</');
    if (isClosing) {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    if (stack.length === 0 && recognized.has(tag)) {
      tags.push(tag);
    }
    const selfClosing = /\/>$/.test(token) || isVoidHtmlTag(tag);
    if (!selfClosing) {
      stack.push(tag);
    }
  }
  return tags;
}

function deriveSectionRoles(job = {}) {
  const html = job && job.inputs && typeof job.inputs.page_html === 'string' ? job.inputs.page_html : '';
  const tags = extractMainDirectStructuralTags(html);
  if (tags.length === 0) {
    return ['section', 'section'];
  }
  return tags.slice(0, 6);
}

function buildMinimalLayoutPayloadForPage(index, url, layoutMinimal, layoutApplied, jobContext = {}) {
  const sectionRoles = deriveSectionRoles(jobContext);
  const imageMeta = extractImagePlaceholders(jobContext);
  const heroImageRects = imageMeta.images.slice(0, 6).map((img, idx) => ({
    type: 'RECTANGLE',
    name: img.name,
    width: 220,
    height: 120,
    x: idx * 16,
    y: idx * 16
  }));
  const shellContainers = OUTER_CONTAINER_NAMES.map((name) => {
    if (name === 'Header') {
      return {
        type: 'FRAME',
        name: 'Header',
        ...(layoutMinimal && layoutApplied ? HEADER_FOOTER_LAYOUT_MINIMAL : {}),
        children: [
          {
            type: 'FRAME',
            name: 'Nav',
            ...(layoutMinimal && layoutApplied ? NAV_LAYOUT_MINIMAL : {}),
            children: [
              { type: 'TEXT', name: 'Link', characters: 'Home' },
              { type: 'TEXT', name: 'Label', characters: 'Products' },
              { type: 'TEXT', name: 'Body', characters: 'Docs' }
            ]
          }
        ]
      };
    }
    return {
      type: 'FRAME',
      name,
      ...(layoutMinimal && layoutApplied ? (name === 'Hero' ? HERO_LAYOUT_MINIMAL : HEADER_FOOTER_LAYOUT_MINIMAL) : {}),
      children: [
        ...(name === 'Hero'
          ? [
              { type: 'TEXT', name: 'Body', characters: 'Hero description' },
              ...heroImageRects,
              {
                type: 'FRAME',
                name: 'Hero CTA Group',
                children: [
                  { type: 'TEXT', name: 'Link', characters: 'Get started' },
                  { type: 'TEXT', name: 'Label', characters: 'Contact sales' },
                  { type: 'TEXT', name: 'Body', characters: 'Learn more' }
                ]
              }
            ]
          : [
              // Decorative wrapper candidate for prune pass.
              {
                type: 'FRAME',
                name: `${name} Wrapper`,
                children: [{ type: 'TEXT', name: `${name} Text`, characters: name }]
              }
            ])
      ]
    };
  });
  const sectionChildren = sectionRoles.map((role, idx) => ({
    type: 'FRAME',
    name: `Section ${String(idx + 1).padStart(2, '0')}`,
    ...(layoutMinimal && layoutApplied ? SECTION_LAYOUT_MINIMAL : {}),
    children: [
      {
        type: 'TEXT',
        name: role === 'section' ? 'Body' : 'Label',
        characters: role === 'section' ? `Section ${idx + 1}` : `${role} group`
      }
    ],
  }));
  return {
    index,
    url,
    payload: {
      frame: {
        type: 'FRAME',
        name: pageFrameName(index, url),
        ...(layoutMinimal && layoutApplied ? PAGE_LAYOUT_MINIMAL : {}),
        children: [...shellContainers, ...sectionChildren],
      },
    },
  };
}

function countLinkOrLabelDirectChildren(group = {}) {
  const children = Array.isArray(group.children) ? group.children : [];
  return children.filter((node) => {
    if (!node || String(node.type || '').toUpperCase() !== 'TEXT') {
      return false;
    }
    const name = String(node.name || '');
    return name === 'Link' || name === 'Label';
  }).length;
}

function applyHeroCtaRowLayout(frame = {}) {
  if (!frame || typeof frame !== 'object') {
    return frame;
  }
  const children = Array.isArray(frame.children) ? frame.children : [];
  const updatedChildren = children.map((node) => {
    if (!node || node.type !== 'FRAME' || node.name !== 'Hero') {
      return node;
    }
    const heroChildren = Array.isArray(node.children) ? node.children : [];
    const nextHeroChildren = heroChildren.map((group) => {
      if (!group || group.type !== 'FRAME') {
        return group;
      }
      const ctaCount = countLinkOrLabelDirectChildren(group);
      if (ctaCount >= 2) {
        return {
          ...group,
          layoutMode: 'HORIZONTAL',
          itemSpacing: 12
        };
      }
      return group;
    });
    return {
      ...node,
      children: nextHeroChildren
    };
  });
  return {
    ...frame,
    children: updatedChildren
  };
}

function isProtectedFrame(node = {}) {
  const name = String(node.name || '');
  if (PROTECTED_FRAME_NAMES.has(name)) {
    return true;
  }
  if (/^Page \d{2}\b/.test(name)) {
    return true;
  }
  if (/^Section \d{2}$/.test(name)) {
    return true;
  }
  return false;
}

function hasMeaningfulLayout(node = {}) {
  return [
    'layoutMode',
    'itemSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft'
  ].some((key) => Object.prototype.hasOwnProperty.call(node, key));
}

function hasBackgroundContainerRole(node = {}) {
  const children = Array.isArray(node.children) ? node.children : [];
  const hasRect = children.some((child) => child && child.type === 'RECTANGLE');
  return hasRect && children.length >= 2;
}

function isLinkLikeContainer(node = {}) {
  const name = String(node.name || '').toLowerCase();
  return node.isLink === true || name.includes('link');
}

function pruneDecorativeFrames(node = {}, stats) {
  if (!node || typeof node !== 'object') {
    return node;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  const prunedChildren = children
    .map((child) => pruneDecorativeFrames(child, stats))
    .filter(Boolean);
  const next = { ...node, children: prunedChildren };
  if (next.type !== 'FRAME') {
    return next;
  }
  if (isProtectedFrame(next)) {
    stats.frames_kept += 1;
    return next;
  }
  if (isLinkLikeContainer(next) || hasBackgroundContainerRole(next) || hasMeaningfulLayout(next)) {
    stats.frames_kept += 1;
    return next;
  }
  if (prunedChildren.length === 0) {
    stats.frames_pruned += 1;
    return null;
  }
  if (prunedChildren.length === 1) {
    stats.frames_pruned += 1;
    return prunedChildren[0];
  }
  stats.frames_kept += 1;
  return next;
}

function collectQualityMetrics(framePayloads = []) {
  const textCounts = { Heading: 0, Body: 0, Link: 0, Label: 0 };
  const nodeCounts = { FRAME: 0, RECT: 0, TEXT: 0 };
  const layoutCounts = { auto_layout_nodes: 0, horizontal_nodes: 0, vertical_nodes: 0, hero_cta_rows: 0 };

  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const type = String(node.type || '').toUpperCase();
    if (type === 'FRAME' || type === 'RECT' || type === 'TEXT') {
      nodeCounts[type] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'layoutMode')) {
      layoutCounts.auto_layout_nodes += 1;
      const mode = String(node.layoutMode || '').toUpperCase();
      if (mode === 'HORIZONTAL') {
        layoutCounts.horizontal_nodes += 1;
      }
      if (mode === 'VERTICAL') {
        layoutCounts.vertical_nodes += 1;
      }
    }
    if (type === 'TEXT') {
      const name = String(node.name || '');
      if (Object.prototype.hasOwnProperty.call(textCounts, name)) {
        textCounts[name] += 1;
      }
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };

  framePayloads.forEach((entry) => {
    const root = entry && entry.payload ? entry.payload.frame : null;
    visit(root);
    const rootChildren = root && Array.isArray(root.children) ? root.children : [];
    const hero = rootChildren.find((node) => node && node.type === 'FRAME' && node.name === 'Hero');
    const heroChildren = hero && Array.isArray(hero.children) ? hero.children : [];
    heroChildren.forEach((group) => {
      if (!group || group.type !== 'FRAME') {
        return;
      }
      const mode = String(group.layoutMode || '').toUpperCase();
      if (mode !== 'HORIZONTAL') {
        return;
      }
      if (countLinkOrLabelDirectChildren(group) >= 2) {
        layoutCounts.hero_cta_rows += 1;
      }
    });
  });
  return {
    text_counts: textCounts,
    node_counts: nodeCounts,
    layout_counts: layoutCounts
  };
}

function buildCodeToFigmaPayloadFromInputs(job = {}, provider = 'local_stub') {
  const pages = normalizeStubPages(job);
  const namingVersion = (job.inputs && job.inputs.naming_version) || '';
  const layoutMinimal = Boolean(job.inputs && job.inputs.layout_minimal);
  const layoutApplied = layoutMinimal && !shouldForceLayoutFailure();
  const layoutReason = layoutMinimal ? (layoutApplied ? '-' : 'layout_apply_failed') : 'layout_minimal_disabled';
  const frames = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    frameName: pageFrameName(index + 1, url),
    frameUrl: `https://www.figma.com/file/stub?node-id=${encodeURIComponent(`${provider}:${index + 1}`)}`,
    layoutApplied,
    layoutReason
  }));
  const progress = pages.map((url, index) => ({
    index: index + 1,
    url,
    status: 'success',
    reason: '-'
  }));
  const transformStats = { frames_pruned: 0, frames_kept: 0 };
  const linkMapping = computeInternalLinkMappings(job, pages);
  const imageMeta = extractImagePlaceholders(job);
  const framePayloads = pages.map((url, index) => {
    const pagePayload = buildMinimalLayoutPayloadForPage(index + 1, url, layoutMinimal, layoutApplied, job);
    const root = pagePayload && pagePayload.payload ? pagePayload.payload.frame : null;
    const optimized = pruneDecorativeFrames(root, transformStats);
    const heroAdjusted = layoutMinimal && layoutApplied ? applyHeroCtaRowLayout(optimized || root) : (optimized || root);
    const linksForPage = linkMapping.links.filter((entry) => Number(entry.source_page_index) === index + 1);
    return {
      ...pagePayload,
      payload: {
        frame: heroAdjusted,
        prototype_links: linksForPage.map((entry) => ({
          href: entry.href,
          target_page_index: entry.target_page_index
        }))
      }
    };
  });
  const qualityMetrics = collectQualityMetrics(framePayloads);
  const spacingProfile = buildSpacingProfile();
  return {
    pages,
    frames,
    progress,
    frame_payloads: framePayloads,
    transform_stats: transformStats,
    link_stats: linkMapping.link_stats,
    image_stats: imageMeta.image_stats,
    text_counts: qualityMetrics.text_counts,
    node_counts: qualityMetrics.node_counts,
    layout_counts: qualityMetrics.layout_counts,
    spacing_profile: spacingProfile,
    links: linkMapping.links,
    reason: '-',
    naming_version: namingVersion,
    layout_minimal: layoutMinimal
  };
}

function buildCodeToFigmaMcpSuccess({
  job,
  handshake,
  targetPath,
  provider
}) {
  const codeToFigma = buildCodeToFigmaPayloadFromInputs(job, provider);
  const report = {
    ...handshake,
    provider,
    code_to_figma: codeToFigma
  };
  writeHandshakeArtifact(targetPath, report);
  return {
    status: 'ok',
    artifacts: [{ path: targetPath, kind: 'json' }],
    diff_summary: `${provider} code_to_figma report written to ${targetPath}`,
    checks: [
      { id: 'mcp_exec', ok: true, reason: `${provider} adapter completed` },
      { id: 'code_to_figma', ok: true, reason: `${provider} frames generated` }
    ],
    logs: ['runner_adapter=mcp', `provider=${provider}`, 'code_to_figma_mcp=ok', `handshake=${JSON.stringify(handshake)}`],
    evidence_paths: [targetPath],
    code_to_figma: codeToFigma
  };
}

function runLocalStub(job) {
  return new Promise((resolve) => {
    const stubPath = path.join(__dirname, '..', 'scripts', 'mcp-stub-runner.js');
    const child = spawn(process.execPath, [stubPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          status: 'error',
          errors: [stderr.trim() || 'local stub failed'],
          checks: [{ id: 'mcp_exec', ok: false, reason: stderr.trim() || 'local stub failed' }],
          logs: ['runner_adapter=mcp', stderr.trim()].filter(Boolean)
        });
        return;
      }
      try {
        const handshake = JSON.parse(stdout || '{}');
        const targetPath = (job.inputs && (job.inputs.target_path_resolved || job.inputs.target_path)) || '.ai-runs/handshake.json';
        if (isPhase1CodeToFigmaJob(job)) {
          resolve(
            buildCodeToFigmaMcpSuccess({
              job,
              handshake,
              targetPath,
              provider: 'local_stub'
            })
          );
          return;
        }
        writeHandshakeArtifact(targetPath, handshake);
        resolve({
          status: 'ok',
          artifacts: [{ path: targetPath, kind: 'json' }],
          diff_summary: `Local stub handshake written to ${targetPath}`,
          checks: [{ id: 'mcp_exec', ok: true, reason: 'local stub completed' }],
          logs: ['runner_adapter=mcp', `handshake=${JSON.stringify(handshake)}`],
          evidence_paths: [targetPath]
        });
      } catch (error) {
        resolve({
          status: 'error',
          errors: [error.message],
          checks: [{ id: 'mcp_exec', ok: false, reason: error.message }],
          logs: ['runner_adapter=mcp']
        });
      }
    });
    try {
      child.stdin.write(JSON.stringify(job));
    } catch (error) {
      // ignore
    }
    child.stdin.end();
  });
}

function runCodexCli(job) {
  const timeoutMs = parsePositiveInt(process.env.CODEX_CLI_TIMEOUT_MS, 45000);
  const delayMs = parsePositiveInt(process.env.CODEX_CLI_SIMULATE_MS, 0);
  const secretLens = collectSecretLens(job);
  const execute = async () => {
    const targetPath = resolveTargetPath(job);
    if (!targetPath.startsWith('.ai-runs/')) {
      throw new Error('codex_cli_target_path_blocked');
    }
    enforceCodexCliNetworkPolicy(job);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const handshake = {
      provider: 'codex-cli',
      job_type: job.job_type || 'unknown',
      delegated: true,
      ts: new Date().toISOString(),
      safety: {
        network_policy: 'enforced',
        path_scope: path.posix.dirname(targetPath),
        secret_lens: secretLens
      }
    };
    if (isPhase1CodeToFigmaJob(job)) {
      return buildCodeToFigmaMcpSuccess({
        job,
        handshake,
        targetPath,
        provider: 'codex-cli'
      });
    }
    writeHandshakeArtifact(targetPath, handshake, { allowedRoot: path.posix.dirname(targetPath) });
    return {
      status: 'ok',
      artifacts: [{ path: targetPath, kind: 'json' }],
      diff_summary: `codex-cli handshake written to ${targetPath}`,
      checks: [{ id: 'mcp_exec', ok: true, reason: 'codex-cli adapter completed' }],
      logs: [
        'runner_adapter=mcp',
        'provider=codex-cli',
        'network_policy=enforced',
        `target_scope=${path.posix.dirname(targetPath)}`,
        `secret_lens=${JSON.stringify(secretLens)}`,
        `handshake=${JSON.stringify(handshake)}`
      ],
      evidence_paths: [targetPath]
    };
  };

  const withTimeout = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('codex_cli_timeout')), ms);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });

  return withTimeout(execute(), timeoutMs).catch((error) => ({
    status: 'error',
    errors: [toSafeReason(error)],
    checks: [{ id: 'mcp_exec', ok: false, reason: toSafeReason(error) }],
    logs: [
      'runner_adapter=mcp',
      'provider=codex-cli',
      'network_policy=enforced',
      `secret_lens=${JSON.stringify(secretLens)}`
    ]
  }));
}

async function run(job) {
  const mode = (job && job.run_mode ? String(job.run_mode).toLowerCase() : 'local_stub');
  if (mode === 'mcp') {
    const provider = (job.inputs && job.inputs.mcp_provider) || 'local_stub';
    if (provider === 'local_stub') {
      return runLocalStub(job);
    }
    if (provider === 'codex-cli') {
      return runCodexCli(job);
    }
  }
  return runLocalStub(job);
}

module.exports = {
  run
};
