const { URL, URLSearchParams } = require('url');

const API_BASE_URL = 'https://api.figma.com/v1';

function isDebugEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.FIGMA_DEBUG || ''));
}

function isMockEnabled() {
  return process.env.FIGMA_API_MOCK === '1';
}

function ensureFetchAvailable() {
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('global fetch is not available (Node.js 18+ required)');
}

function normalizeDepth(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const floored = Math.floor(numeric);
  if (floored < 1) {
    return 1;
  }
  return floored;
}

function sanitizeQuery(raw = {}) {
  const sanitized = {};
  Object.entries(raw || {}).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') {
      return;
    }
    if (key === 'depth') {
      const normalized = normalizeDepth(val);
      if (normalized !== undefined) {
        sanitized.depth = normalized;
      }
    } else {
      sanitized[key] = val;
    }
  });
  if (Object.prototype.hasOwnProperty.call(sanitized, 'depth')) {
    const depthValue = sanitized.depth;
    if (typeof depthValue !== 'number' || depthValue < 1) {
      throw new Error(`Invalid depth after normalization: ${depthValue}`);
    }
  }
  return sanitized;
}

function buildUrl(endpoint, query = {}) {
  const base = endpoint.startsWith('http')
    ? new URL(endpoint)
    : new URL(endpoint.replace(/^\//, ''), `${API_BASE_URL}/`);
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, val]) => {
    params.set(key, String(val));
  });
  const queryString = params.toString();
  if (queryString) {
    base.search = queryString;
  }
  return base.toString();
}

async function callFigmaApi({ token, endpoint, method = 'GET', query = {}, body }) {
  const fetchImpl = ensureFetchAvailable();
  const headers = { 'X-Figma-Token': token };
  const options = { method, headers };
  if (body && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const sanitizedQuery = sanitizeQuery(query);
  const url = buildUrl(endpoint, sanitizedQuery);
  const debugInfo = isDebugEnabled()
    ? {
        endpoint,
        method,
        query: sanitizedQuery,
        url
      }
    : undefined;
  if (isMockEnabled()) {
    return { data: { mocked: true }, debug: debugInfo };
  }
  try {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message =
        (data && (data.error || data.err || data.message)) || text || response.statusText;
      const apiError = new Error(`Figma API ${response.status}: ${message}`);
      if (debugInfo) {
        apiError.debug = debugInfo;
      }
      throw apiError;
    }
    return { data, debug: debugInfo };
  } catch (error) {
    if (debugInfo && !error.debug) {
      error.debug = debugInfo;
    }
    throw error;
  }
}

module.exports = {
  callFigmaApi,
  normalizeDepth,
  sanitizeQuery
};
