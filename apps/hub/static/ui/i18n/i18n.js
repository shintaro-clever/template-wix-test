(function () {
  const STORAGE_KEY = "ui_lang";
  const SUPPORTED = new Set(["ja", "en"]);

  function detectLang() {
    try {
      const fromStorage = (localStorage.getItem(STORAGE_KEY) || "").trim().toLowerCase();
      if (SUPPORTED.has(fromStorage)) return fromStorage;
    } catch (_) {}
    const nav = (navigator.language || "").toLowerCase();
    return nav.startsWith("ja") ? "ja" : "en";
  }

  function getPath(lang) {
    return `/ui/i18n/${lang}.json`;
  }

  async function fetchDict(lang) {
    const res = await fetch(getPath(lang), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`i18n fetch failed: ${lang}`);
    return res.json();
  }

  function applyI18n(dict, fallback) {
    const getText = (key) => {
      if (dict && typeof dict[key] === "string") return dict[key];
      if (fallback && typeof fallback[key] === "string") return fallback[key];
      return key;
    };

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = (el.getAttribute("data-i18n") || "").trim();
      if (!key) return;
      el.textContent = getText(key);
    });

    const titleFromAttr = document.querySelector("[data-i18n-title]");
    if (titleFromAttr) {
      const key = (titleFromAttr.getAttribute("data-i18n-title") || "").trim();
      if (key) {
        document.title = getText(key);
        return;
      }
    }

    const titleEl = document.querySelector("title[data-i18n]");
    if (titleEl) {
      const key = (titleEl.getAttribute("data-i18n") || titleEl.textContent || "").trim();
      if (key) {
        const text = getText(key);
        document.title = text;
        titleEl.textContent = text;
      }
    }
  }

  async function main() {
    const lang = detectLang();
    let current = null;
    let ja = null;

    try {
      current = await fetchDict(lang);
    } catch (_) {
      current = null;
    }

    if (lang !== "ja") {
      try {
        ja = await fetchDict("ja");
      } catch (_) {
        ja = null;
      }
    } else {
      ja = current;
    }

    applyI18n(current || {}, ja || {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
