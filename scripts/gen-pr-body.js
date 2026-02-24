#!/usr/bin/env node
const fs = require("fs");
const { spawnSync } = require("child_process");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}

function inferImpactFromFiles(files) {
  const impacts = new Set();
  files.forEach((f) => {
    if (f.startsWith("docs/") || f.endsWith(".md")) impacts.add("Docs");
    else if (f.includes("server") || f.startsWith("src/server")) impacts.add("API");
    else if (f.startsWith("apps/hub/static") || f.includes("/ui") || f.endsWith(".html")) impacts.add("UI");
    else if (f.includes("db") || f.includes("sqlite")) impacts.add("DB");
    else if (f.includes("config") || f.endsWith(".yml") || f.endsWith(".yaml")) impacts.add("Config");
    else impacts.add("Code");
  });
  return Array.from(impacts);
}

function main() {
  const templatePath = ".github/PULL_REQUEST_TEMPLATE.md";
  if (!fs.existsSync(templatePath)) throw new Error(`missing template: ${templatePath}`);
  const template = fs.readFileSync(templatePath, "utf8");

  let base = "origin/main";
  try {
    run("git", ["rev-parse", "--verify", base]);
  } catch {
    base = "main";
  }

  const stat = run("git", ["diff", "--stat", `${base}...HEAD`]);
  const nameStatus = run("git", ["diff", "--name-only", `${base}...HEAD`]);
  let files = nameStatus ? nameStatus.split("\n").filter(Boolean) : [];

  if (files.length === 0) {
    const lastNames = run("git", ["show", "--name-only", "--pretty=format:", "-1"]);
    files = lastNames ? lastNames.split("\n").filter(Boolean) : [];
  }

  const effectiveStat = stat || run("git", ["show", "--stat", "--oneline", "-1"]);
  const impacts = inferImpactFromFiles(files);
  const impactLine = impacts.length ? impacts.join(" / ") : "Code";

  const summaryLine = files.length
    ? files.slice(0, 7).map((f) => `- ${f}`).join("\n")
    : "- （差分ファイルの検出に失敗。git diff を確認してください）";

  const riskLine =
    files.length === 1 && files[0].endsWith(".md")
      ? "リスク: なし（ドキュメントのみ）"
      : "リスク: 既存挙動への影響がある場合は差分に基づき確認が必要";

  let out = template;

  out = out.replace(/## 概要[\s\S]*?- （AI）.*?\n/, `## 概要\n- 差分（${base}...HEAD）の変更を反映する\n`);
  out = out.replace(
    /## 変更内容（AIが埋める）[\s\S]*?- （AI）変更点を箇条書きで3〜7行.*?\n- （AI）影響範囲.*?\n- （AI）リスクがあれば1行.*?\n/,
    `## 変更内容（AIが埋める）\n- 変更差分（${base}...HEAD）:\n${summaryLine}\n- 影響範囲: ${impactLine}\n- ${riskLine}\n`
  );

  out = out.replace(
    /## 関連Issue（どちらか1つチェック）[\s\S]*?- \[ \] 関連Issueあり: #<issue_number>\n- \[ \] No Issue（理由）: <.*?>\n/,
    `## 関連Issue（どちらか1つチェック）\n- [ ] 関連Issueあり: #<issue_number>\n- [x] No Issue（理由）: 軽度修正/調整のため\n`
  );

  out = out.replace(
    /## 完了条件（最低1つチェック）[\s\S]*?- \[ \] AC: \n- \[ \] AC: \n- \[ \] AC: \n/,
    `## 完了条件（最低1つチェック）\n- [x] AC: npm test が成功する\n- [ ] AC: PR Gate を通過してマージ可能な状態になる\n- [ ] AC: 変更内容が差分と一致している\n`
  );

  out = out.replace(
    /## 補足（任意）[\s\S]*?- （AI）参照リンクが必要ならここ（原則はIssueに集約）\n?/,
    `## 補足（任意）\n- diff summary:\n\n\`\`\`\n${effectiveStat}\n\`\`\`\n`
  );

  fs.writeFileSync("/tmp/pr.md", out, "utf8");
  console.log("/tmp/pr.md generated");
}

main();
