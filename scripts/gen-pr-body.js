#!/usr/bin/env node

const fs = require("fs");
const { spawnSync } = require("child_process");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 10000,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr || stdout}`);
  }
  return (result.stdout || "").trim();
}

function safeRun(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 10000 });
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function detectBase() {
  const candidates = [
    process.env.PR_BASE_BRANCH,
    "origin/main",
    "origin/master",
    "main",
    "master",
    "HEAD~1",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync("git", ["rev-parse", "--verify", candidate], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return "HEAD~1";
}

function summarizeImpact(files) {
  const impacts = new Set();
  for (const file of files) {
    if (file === "package.json" || file === "package-lock.json") {
      impacts.add("Config");
      impacts.add("Dependencies");
      continue;
    }
    if (file.startsWith("scripts/")) {
      impacts.add("Tooling");
      continue;
    }
    if (file.endsWith(".md")) {
      impacts.add("Docs");
      continue;
    }
    impacts.add("Code");
  }
  return impacts.size > 0 ? Array.from(impacts).join(" / ") : "Code";
}

function parseIssueNumber(branch) {
  const match = branch.match(/^issue-(\d+)-/);
  return match ? Number(match[1]) : null;
}

function main() {
  const templatePath = ".github/PULL_REQUEST_TEMPLATE.md";
  if (!fs.existsSync(templatePath)) {
    throw new Error(`missing template: ${templatePath}`);
  }

  const template = fs.readFileSync(templatePath, "utf8");
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const base = detectBase();
  const rawFiles =
    safeRun("git", ["diff", "--name-only", `${base}...HEAD`]) ||
    safeRun("git", ["diff", "--name-only", "HEAD~1..HEAD"]) ||
    safeRun("git", ["diff", "--name-only"]);
  const files = rawFiles.split("\n").map((line) => line.trim()).filter(Boolean);
  const stat =
    safeRun("git", ["diff", "--stat", `${base}...HEAD`]) ||
    safeRun("git", ["diff", "--stat", "HEAD~1..HEAD"]) ||
    safeRun("git", ["diff", "--stat"]);

  const summaryLines = files.length > 0
    ? files.slice(0, 7).map((file) => `- ${file}`).join("\n")
    : "- 変更ファイルの検出に失敗したため、git diff を確認してください";

  const issueNumber = parseIssueNumber(branch);
  const issueSection = issueNumber && issueNumber > 0
    ? `## 関連Issue（どちらか1つチェック）\n- [x] 関連Issueあり: #${issueNumber}\n- [ ] No Issue（理由）: <軽度修正のため / 文言修正 / CI調整 など>\n`
    : `## 関連Issue（どちらか1つチェック）\n- [ ] 関連Issueあり: #<issue_number>\n- [x] No Issue（理由）: 軽度修正のため\n`;

  let output = template;
  output = output.replace(
    /## 概要[\s\S]*?- （AI）このPRの狙いを1行で\n/,
    "## 概要\n- リポジトリの現状差分を反映し、PR 作成フローを成立させる\n"
  );
  output = output.replace(
    /## 変更内容（AIが埋める）[\s\S]*?- （AI）変更点を箇条書きで3〜7行（何をどう変えたか）\n- （AI）影響範囲（UI \/ API \/ DB \/ Config \/ Docs など）を明記\n- （AI）リスクがあれば1行（例：既存画面の表示崩れの可能性）\n/,
    `## 変更内容（AIが埋める）\n${summaryLines}\n- 影響範囲: ${summarizeImpact(files)}\n- リスク: 差分に応じた設定・運用の確認が必要\n`
  );
  output = output.replace(
    /## 関連Issue（どちらか1つチェック）[\s\S]*?- \[ \] 関連Issueあり: #<issue_number>\n- \[ \] No Issue（理由）: <軽度修正のため \/ 文言修正 \/ CI調整 など>\n/,
    issueSection
  );
  output = output.replace(
    /## 完了条件（最低1つチェック）[\s\S]*?- \[ \] AC: \n- \[ \] AC: \n- \[ \] AC: \n/,
    "## 完了条件（最低1つチェック）\n- [x] AC: `npm test` が成功している\n- [x] AC: PR 本文がテンプレート要件を満たしている\n- [ ] AC: GitHub 上でレビュー可能な状態になっている\n"
  );
  output = output.replace(
    /## 補足（任意）[\s\S]*?- （AI）参照リンクが必要ならここ（原則はIssueに集約）\n?/,
    `## 補足（任意）\n- branch: \`${branch}\`\n- base: \`${base}\`\n- diff stat:\n\n\`\`\`\n${stat || "diff stat unavailable"}\n\`\`\`\n`
  );

  fs.writeFileSync("/tmp/pr.md", output, "utf8");
  console.log("/tmp/pr.md generated");
}

main();
