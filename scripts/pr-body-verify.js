#!/usr/bin/env node
const fs = require("fs");

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  console.error("[pr-body-verify] FAIL");
  list.forEach((msg) => {
    console.error(`- ${msg}`);
  });
  process.exit(1);
}

const file = process.argv[2] || "/tmp/pr.md";
if (!fs.existsSync(file)) fail(`missing file: ${file}`);
const body = fs.readFileSync(file, "utf8");

const errors = [];

const requiredHeadings = [
  "## 概要",
  "## 変更内容（AIが埋める）",
  "## 関連Issue（どちらか1つチェック）",
  "## 完了条件（最低1つチェック）",
  "## 補足（任意）"
];
for (const h of requiredHeadings) {
  if (!body.includes(h)) errors.push(`必須見出しが不足: ${h}`);
}

if (body.split("\n").some((line) => line.includes("（AI）"))) {
  errors.push("プレースホルダー（（AI））が残っています");
}

function extractSection(text, heading) {
  const re = new RegExp(`^${heading}\\s*$`, "m");
  const match = text.match(re);
  if (!match || typeof match.index !== "number") return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.match(/\n##\s+/m);
  return next ? rest.slice(0, next.index) : rest;
}

const diffFilesSection = extractSection(body, "### 差分ファイル一覧");
if (!diffFilesSection) {
  errors.push("差分ファイル一覧が見つかりません");
}

const diffStatSection = extractSection(body, "### diff統計");
if (!diffStatSection || !diffStatSection.includes("```")) {
  errors.push("diff統計のコードブロックが不足しています");
}

const verifySection = extractSection(body, "### 検証結果");
if (!verifySection) {
  errors.push("検証結果が見つかりません");
} else {
  const npmLine = verifySection.split("\n").find((line) => /npm\s*test/i.test(line));
  if (!npmLine) {
    errors.push("検証結果に npm test がありません");
  } else if (!/pass|ok|成功|fail|失敗/i.test(npmLine)) {
    errors.push("検証結果の npm test に結果が記載されていません");
  }
}

// --- 追加チェック: 概要が空でない ---
const overview = extractSection(body, "## 概要");
const overviewBullets = overview
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("- "));
if (overviewBullets.length === 0) {
  errors.push("概要が空です（## 概要 に - から始まる1行以上が必要）");
}

// --- 追加チェック: 関連Issueはどちらか1つチェック ---
const issueSection = extractSection(body, "## 関連Issue（どちらか1つチェック）");
const hasIssueChecked = /-\s*\[x\]\s*関連Issueあり:/i.test(issueSection);
const noIssueChecked = /-\s*\[x\]\s*No Issue/i.test(issueSection);
if (!hasIssueChecked && !noIssueChecked) {
  errors.push("関連Issue が未選択です（関連Issueあり か No Issue のどちらかを [x] にしてください）");
}
if (noIssueChecked && /<[^>]+>/.test(issueSection)) {
  errors.push("No Issue の理由がプレースホルダーのままです（<...> を残さないでください）");
}

// --- 追加チェック: 完了条件（AC）は最低1つチェック ---
const acSection = extractSection(body, "## 完了条件（最低1つチェック）");
if (!/-\s*\[x\]/i.test(acSection)) {
  errors.push("完了条件（AC）が未チェックです（最低1つは [x] にしてください）");
}

// --- 追加チェック: Review Pack に外部前提が残っていない ---
if (/ネットNG|手動で行う|別端末|ネットワーク可端末/i.test(body)) {
  errors.push("Review Pack に外部前提（ネットNG/手動/別端末 等）の文言が残っています（この端末実働方針に反します）");
}

if (!body.includes("## Review Pack")) {
  errors.push("Review Pack が見つかりません");
}

if (errors.length) fail(errors);

console.log("[pr-body-verify] OK");
