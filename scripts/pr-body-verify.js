#!/usr/bin/env node

const fs = require("fs");

function fail(message) {
  console.error(`[pr-body-verify] FAIL: ${message}`);
  process.exit(1);
}

const file = process.argv[2] || "/tmp/pr.md";
if (!fs.existsSync(file)) fail(`missing file: ${file}`);

const body = fs.readFileSync(file, "utf8");
const requiredHeadings = [
  "## 概要",
  "## 変更内容（AIが埋める）",
  "## 関連Issue（どちらか1つチェック）",
  "## 完了条件（最低1つチェック）",
  "## 補足（任意）",
];

for (const heading of requiredHeadings) {
  if (!body.includes(heading)) {
    fail(`missing heading: ${heading}`);
  }
}

const issueSection = (body.match(/## 関連Issue（どちらか1つチェック）[\s\S]*?(?:\n## |\s*$)/) || [body])[0];
const checkedIssueCount = (issueSection.match(/- \[x\]/g) || []).length;
if (checkedIssueCount !== 1) {
  fail(`関連Issue section must have exactly 1 checked item, got=${checkedIssueCount}`);
}

const acSection = (body.match(/## 完了条件（最低1つチェック）[\s\S]*?(?:\n## |\s*$)/) || [body])[0];
const checkedAcCount = (acSection.match(/- \[x\]/g) || []).length;
if (checkedAcCount < 1) {
  fail(`完了条件 section must have >=1 checked item, got=${checkedAcCount}`);
}

console.log("[pr-body-verify] OK");
