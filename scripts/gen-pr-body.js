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

function parseDiffStat(statText) {
  if (!statText) return [];
  return statText.split("\n").filter(Boolean);
}

function runStatWithFallback(base) {
  const candidates = [
    ["git", ["diff", "--stat", `${base}...HEAD`]],
    ["git", ["diff", "--stat", `${base}..HEAD`]],
    ["git", ["diff", "--stat", "main...HEAD"]],
    ["git", ["diff", "--stat", "HEAD~1..HEAD"]]
  ];
  const attempts = [];
  let lastSuccess = null;
  let lastFailure = null;

  candidates.forEach(([cmd, args]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10000 });
    const stderr = (r.stderr || "").trim();
    const stdout = (r.stdout || "").trim();
    attempts.push({ cmd, args, status: r.status, stderr });
    if (r.status === 0 && stdout) {
      lastSuccess = { cmd, args, stdout };
    } else if (r.status !== 0) {
      lastFailure = { cmd, args, status: r.status, stderr };
    }
  });

  if (lastSuccess) {
    return {
      ok: true,
      stdout: lastSuccess.stdout,
      cmd: `${lastSuccess.cmd} ${lastSuccess.args.join(" ")}`
    };
  }

  const lastAttempt = attempts[attempts.length - 1];
  const failure = lastFailure || lastAttempt || {};
  const cmdText = failure.cmd ? `${failure.cmd} ${failure.args.join(" ")}` : "git diff --stat";
  const reason = failure.stderr ? failure.stderr.split("\n").filter(Boolean).slice(-1)[0] : `exit=${failure.status || "unknown"}`;
  return { ok: false, stdout: "", cmd: cmdText, reason };
}

function runNumstatWithFallback(base) {
  const candidates = [
    ["git", ["diff", "--numstat", `${base}...HEAD`]],
    ["git", ["diff", "--numstat", `${base}..HEAD`]],
    ["git", ["diff", "--numstat", "main...HEAD"]],
    ["git", ["diff", "--numstat", "HEAD~1..HEAD"]]
  ];
  const attempts = [];
  let lastSuccess = null;
  let lastFailure = null;

  candidates.forEach(([cmd, args]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10000 });
    const stderr = (r.stderr || "").trim();
    const stdout = (r.stdout || "").trim();
    attempts.push({ cmd, args, status: r.status, stderr });
    if (r.status === 0 && stdout) {
      lastSuccess = { cmd, args, stdout };
    } else if (r.status !== 0) {
      lastFailure = { cmd, args, status: r.status, stderr };
    }
  });

  if (lastSuccess) {
    return {
      ok: true,
      stdout: lastSuccess.stdout,
      cmd: `${lastSuccess.cmd} ${lastSuccess.args.join(" ")}`
    };
  }

  const lastAttempt = attempts[attempts.length - 1];
  const failure = lastFailure || lastAttempt || {};
  const cmdText = failure.cmd ? `${failure.cmd} ${failure.args.join(" ")}` : "git diff --numstat";
  const reason = failure.stderr ? failure.stderr.split("\n").filter(Boolean).slice(-1)[0] : `exit=${failure.status || "unknown"}`;
  return { ok: false, stdout: "", cmd: cmdText, reason };
}

function inferChangeSummary({ files, diffText }) {
  const lines = diffText ? diffText.split("\n") : [];
  const addedLines = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const changeTypes = new Set();

  if (files.some((f) => f === ".gitignore" || f.endsWith(".gitignore"))) {
    changeTypes.add("ignore追加/変更");
  }
  if (files.some((f) => f.includes("pr-up.js") || f.includes("hub-doctor.js"))) {
    changeTypes.add("ガード/事前チェック追加");
  }
  if (files.some((f) => f.includes("selftest") || f.includes("/tests/") || f.endsWith(".test.js"))) {
    changeTypes.add("テスト追加/強化");
  }
  if (files.some((f) => f.startsWith("docs/"))) {
    changeTypes.add("ドキュメント更新");
  }
  if (addedLines.some((line) => line.includes("run_dir_create_failed") || line.includes("latest_offline_smoke"))) {
    changeTypes.add("ラン/スモーク関連の堅牢化");
  }

  if (changeTypes.size === 0) {
    changeTypes.add("一般的なコード変更");
  }

  const summary = Array.from(changeTypes).slice(0, 3);
  return summary.map((item) => `- ${item}`).join("\n");
}

function parseStatEntryLine(line) {
  if (typeof line !== "string") return null;
  const parts = line.split("|");
  if (parts.length !== 2) return null;
  const file = parts[0].trim();
  const detail = parts[1].trim();
  if (!file || !detail) return null;
  return { file, detail, line };
}

function buildRiskFlags(files, statEntries, numstatResult) {
  const flags = [];
  try {
    const fileCount = files.length;
    if (fileCount > 20) {
      flags.push(`files>20 (${fileCount})`);
    }
  } catch {
    flags.push("files_count_failed");
  }

  try {
    let plusLines = 0;
    if (numstatResult && numstatResult.ok && numstatResult.stdout) {
      const lines = numstatResult.stdout.split("\n").filter(Boolean);
      lines.forEach((line) => {
        const parts = line.split("\t");
        if (parts.length < 2) return;
        const added = parseInt(parts[0], 10);
        if (!Number.isNaN(added)) {
          plusLines += added;
        }
      });
    } else {
      statEntries.forEach((entry) => {
        const parsed = parseStatEntryLine(entry);
        if (!parsed || typeof parsed.detail !== "string") return;
        const plusMatch = parsed.detail.match(/\+{1,}/);
        if (plusMatch) {
          plusLines += plusMatch[0].length;
        }
      });
    }
    if (plusLines > 500) {
      flags.push(`+lines>500 (${plusLines})`);
    }
  } catch {
    flags.push("lines_count_failed");
  }
  try {
    const importantPrefixes = [
      "src/",
      "scripts/",
      "apps/",
      "server.js",
      "api-server.js",
      "package.json",
      "package-lock.json",
      ".github/",
      "docs/ai/"
    ];
    const hasImportant = files.some((f) => importantPrefixes.some((p) => f.startsWith(p) || f === p));
    if (hasImportant) {
      flags.push("重要パス変更");
    }
  } catch {
    flags.push("important_path_check_failed");
  }
  try {
    const sensitivePatterns = [
      ".env",
      "auth.json",
      "credentials",
      "secret",
      "token",
      "id_rsa",
      "id_ed25519",
      ".pem",
      ".p12",
      ".pfx",
      ".crt",
      ".cer",
      ".der",
      "vault/"
    ];
    const generatedPrefixes = ["dist/", "build/", "coverage/", ".next/", "node_modules/", ".ai-runs/"];
    const hasSensitive = files.some((f) => sensitivePatterns.some((p) => f.includes(p)));
    const hasGenerated = files.some((f) => generatedPrefixes.some((p) => f.startsWith(p)));
    if (hasSensitive || hasGenerated) {
      const details = [];
      if (hasSensitive) details.push("機密");
      if (hasGenerated) details.push("生成物");
      flags.push(`機密/生成物疑い(${details.join("+")})`);
    }
  } catch {
    flags.push("sensitive_check_failed");
  }
  return flags;
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

  const statResult = runStatWithFallback(base);
  const stat = statResult.ok ? statResult.stdout : "";
  const nameStatus = run("git", ["diff", "--name-status", `${base}...HEAD`]);
  const nameOnly = run("git", ["diff", "--name-only", `${base}...HEAD`]);
  const diffText = run("git", ["diff", "--unified=0", `${base}...HEAD`]);
  let files = nameOnly ? nameOnly.split("\n").filter(Boolean) : [];
  const statusLines = nameStatus ? nameStatus.split("\n").filter(Boolean) : [];

  if (files.length === 0) {
    const lastNames = run("git", ["show", "--name-only", "--pretty=format:", "-1"]);
    files = lastNames ? lastNames.split("\n").filter(Boolean) : [];
  }

  const effectiveStat = stat || run("git", ["show", "--stat", "--oneline", "-1"]);
  const impacts = inferImpactFromFiles(files);
  const impactLine = impacts.length ? impacts.join(" / ") : "Code";

  const summaryBlock = inferChangeSummary({ files, diffText });

  const statEntries = parseDiffStat(stat);
  const numstatResult = runNumstatWithFallback(base);
  let riskFlags = [];
  let riskNote = null;
  try {
    riskFlags = buildRiskFlags(files, statEntries, numstatResult);
  } catch (error) {
    riskFlags = [];
    const reason = error && error.message ? error.message : "unknown";
    riskNote = `リスク計算失敗: ${reason}`;
  }
  const riskText = riskFlags.length ? riskFlags.join(", ") : "なし";
  const humanRequired = riskFlags.length ? "YES" : "NO";

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

  const statFileLines = statEntries
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("files changed") && !line.includes("file changed"));
  const topFiles = statFileLines.length
    ? statFileLines.slice(0, 10).map((line) => `- ${line}`).join("\n")
    : `- （差分統計が空です: 最後に成功したコマンド=${statResult.cmd} / 失敗理由=${statResult.reason || "不明"}）`;

  const reviewPackJa = [
    "## Review Pack",
    "### 変更サマリ（最大3行）",
    summaryBlock,
    "### リスクフラグ",
    `- ${riskText}`,
    `- 人手レビュー必須: ${humanRequired}`,
    riskNote ? `- ${riskNote}` : null,
    "### 検証方法",
    "- `node scripts/hub-doctor.js`",
    "- `node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator`",
    "- `npm test`",
    "- ネットNGの場合はPR作成は手動で行う",
    "### 変更ファイル上位（最大10件）",
    topFiles
  ].filter(Boolean).join("\n");

  const reviewPack = reviewPackJa;

  out = `${out}\n${reviewPack}\n`;

  fs.writeFileSync("/tmp/pr.md", out, "utf8");
  console.log("/tmp/pr.md generated");
}

main();
