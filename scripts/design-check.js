#!/usr/bin/env node
/**
 * design-check.js
 * CSS tokenの数値をデザインチェックシートの基準と照合する自動検証スクリプト
 * 参照: agents/rules/60-design-quality.md
 */

const fs = require('fs');
const path = require('path');

// ── 基準値 ───────────────────────────────────────────────────
const STANDARDS = {
  breakpoints: {
    desktop:    { min: 1500 },
    laptop:     { min: 1000, max: 1499 },
    tablet:     { min: 700,  max: 999 },
    smartphone: { min: 320,  max: 699 },
  },
  fontSizes: {
    // デスクトップ基準（px）
    h1: { min: 30, max: 40 },
    h2: { min: 26, max: 30 },
    h3: { min: 24, max: 26 },
    h4: { min: 22, max: 24 },
    h5: { min: 20, max: 22 },
    h6: { min: 18, max: 20 },
    p1: { min: 14, max: 16 },
    p2: { min: 12, max: 14 },
    p3: { min: 10, max: 12 },
  },
  sectionPadding: {
    desktop:    { min: 50,  max: 100 },
    tablet:     { min: 40,  max: 70  },
    smartphone: { min: 30,  max: 50  },
  },
};

// ── CSS 読み込み ─────────────────────────────────────────────
const cssPath = path.join(__dirname, '../src/styles/global.css');
if (!fs.existsSync(cssPath)) {
  console.error('❌ src/styles/global.css が見つかりません');
  process.exit(1);
}
const css = fs.readFileSync(cssPath, 'utf-8');

// ── トークン抽出ヘルパー ──────────────────────────────────────
function extractVarValue(css, varName) {
  const match = css.match(new RegExp(`${varName}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

function parsePx(value) {
  if (!value) return null;
  const m = value.match(/([\d.]+)px/);
  return m ? parseFloat(m[1]) : null;
}

// ── チェック関数 ─────────────────────────────────────────────
const results = [];

function check(label, value, { min, max }, unit = 'px') {
  if (value === null) {
    results.push({ status: '確認不可', label, detail: 'トークン未定義' });
    return;
  }
  const ok = (min === undefined || value >= min) && (max === undefined || value <= max);
  const range = max ? `${min}〜${max}${unit}` : `${min}${unit}〜`;
  results.push({
    status: ok ? '✅' : '❌',
    label,
    detail: `${value}${unit}（基準: ${range}）`,
  });
}

// フォントサイズ検証
const fontChecks = [
  ['--font-size-h1', 'h1'],
  ['--font-size-h2', 'h2'],
  ['--font-size-h3', 'h3'],
  ['--font-size-h4', 'h4'],
  ['--font-size-h5', 'h5'],
  ['--font-size-h6', 'h6'],
  ['--font-size-p1', 'p1'],
  ['--font-size-p2', 'p2'],
  ['--font-size-p3', 'p3'],
];

for (const [token, key] of fontChecks) {
  const raw = extractVarValue(css, token);
  const px = parsePx(raw);
  if (px !== null) {
    check(`フォントサイズ ${key.toUpperCase()} (${token})`, px, STANDARDS.fontSizes[key]);
  } else {
    results.push({ status: '確認不可', label: `フォントサイズ ${key.toUpperCase()}`, detail: `${token} 未定義` });
  }
}

// セクションパディング検証
const sectionPaddingDesktop = parsePx(extractVarValue(css, '--section-padding') || extractVarValue(css, '--spacing-section'));
if (sectionPaddingDesktop !== null) {
  check('セクション上下パディング（デスクトップ）', sectionPaddingDesktop, STANDARDS.sectionPadding.desktop);
} else {
  results.push({ status: '確認不可', label: 'セクション上下パディング', detail: '--section-padding / --spacing-section 未定義' });
}

// カラートークン数（メインカラー・キーカラー）
const colorTokenMatches = css.match(/--color-(?!white|bg|text|border)[a-z-]+\s*:/g) || [];
const colorCount = colorTokenMatches.length;
results.push({
  status: colorCount <= 3 ? '✅' : '⚠️',
  label: `メイン・キーカラー数`,
  detail: `${colorCount} 種類（基準: 3種類以下）`,
});

// ブレイクポイント検証（@media）
const mediaMatches = css.match(/@media[^{]+\{/g) || [];
const bpValues = mediaMatches.map(m => {
  const nums = m.match(/\d+px/g) || [];
  return nums.map(n => parseInt(n));
}).flat().filter(Boolean);

if (bpValues.length > 0) {
  results.push({ status: '✅', label: 'メディアクエリ定義', detail: `ブレイクポイント検出: ${[...new Set(bpValues)].sort((a, b) => a - b).join(', ')}px` });
} else {
  results.push({ status: '⚠️', label: 'メディアクエリ定義', detail: 'global.css にブレイクポイントが定義されていない（Wix Editor側で管理の可能性）' });
}

// ── レポート出力 ──────────────────────────────────────────────
const pass  = results.filter(r => r.status === '✅').length;
const warn  = results.filter(r => r.status === '⚠️').length;
const fail  = results.filter(r => r.status === '❌').length;
const nocheck = results.filter(r => r.status === '確認不可').length;

console.log('\n## design-check.js — CSS Token 自動検証レポート');
console.log(`対象: ${cssPath}`);
console.log(`\n### サマリー`);
console.log(`  ✅ 合格:    ${pass} 項目`);
console.log(`  ⚠️  要改善:  ${warn} 項目`);
console.log(`  ❌ 不合格:  ${fail} 項目`);
console.log(`  確認不可: ${nocheck} 項目`);

console.log('\n### 詳細');
for (const r of results) {
  console.log(`  ${r.status} ${r.label} — ${r.detail}`);
}

if (fail > 0) {
  console.log('\n⚠️  不合格項目があります。agents/rules/60-design-quality.md を確認してください。');
  process.exit(1);
} else {
  console.log('\n✅ 自動検証できる全項目が基準を満たしています。');
  process.exit(0);
}
