/* eslint-disable no-undef */
(function initCodexPrompt(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexPrompt = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const hasRequire = typeof require === 'function';
  const fs = hasRequire ? require('fs') : null;
  const path = hasRequire ? require('path') : null;

  const DEFAULT_LANG = 'ja';
  const SUPPORTED_LANGS = new Set(['ja', 'en']);

  const policyCache = {};
  const POLICY_DIR = hasRequire && path ? path.join(__dirname, 'policies') : null;

  function sanitizeLang(value) {
    if (!value) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    return SUPPORTED_LANGS.has(normalized) ? normalized : null;
  }

  function envLanguage() {
    if (typeof process === 'undefined' || !process || !process.env) {
      return null;
    }
    return sanitizeLang(process.env.CODEX_OUTPUT_LANG);
  }

  function resolveLanguage(preferred) {
    return envLanguage() || sanitizeLang(preferred) || DEFAULT_LANG;
  }

  function readPolicyFromFile(lang) {
    if (!fs || !POLICY_DIR) {
      return null;
    }
    const filePath = path.join(POLICY_DIR, `${lang}.md`);
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      return null;
    }
  }

  function loadPolicy(lang) {
    const target = SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
    if (policyCache[target]) {
      return policyCache[target];
    }
    let text = readPolicyFromFile(target);
    if (!text && target !== DEFAULT_LANG) {
      text = loadPolicy(DEFAULT_LANG);
    }
    if (!text) {
      text = 'Output language policy missing.';
    }
    policyCache[target] = text;
    return text;
  }

  function buildCodexPrompt(message, options = {}) {
    const lang = resolveLanguage(options.lang);
    const policy = loadPolicy(lang);
    const body = typeof message === 'string' ? message : '';
    const trimmed = body.trimStart();
    if (policy && trimmed.startsWith(policy)) {
      return body;
    }
    return body ? `${policy}\n\n${body}` : policy;
  }

  function applyCodexPrompt(job, options = {}) {
    if (!job || typeof job !== 'object' || !job.inputs || typeof job.inputs !== 'object') {
      return job;
    }
    if (typeof job.inputs.message !== 'string' || !job.inputs.message.trim()) {
      return job;
    }
    const lang = options.lang || job.output_language;
    job.inputs.message = buildCodexPrompt(job.inputs.message, { lang });
    return job;
  }

  return {
    buildCodexPrompt,
    applyCodexPrompt
  };
});
