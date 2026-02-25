#!/usr/bin/env node
/**
 * pr-up.js
 *
 * 1. main/master ブランチガード
 * 2. npm test
 * 3. gen-pr-body.js → /tmp/pr.md 生成
 * 4. pr-body-verify.js バリデーション
 * 5. git push
 * 6. gh pr create / gh pr edit
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function shNodeTool(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function must(cmd, args, opts = {}) {
  const r = shNodeTool(cmd, args, opts);
  if (r.status !== 0) {
    const out = ((r.stdout || "") + "\n" + (r.stderr || "")).trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (code=${r.status})\n${out}`);
  }
  return (r.stdout || "").trim();
}

function info(msg) { process.stdout.write(msg + "\n"); }
function warn(msg) { process.stderr.write(msg + "\n"); }

function tailText(text, lines = 12) {
  if (!text) return "";
  const arr = String(text).split("\n");
  return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

// "owner/repo" を git remote から取得（ssh / https どちらにも対応）
function getRepoNwo() {
  const r = shNodeTool("git", ["remote", "get-url", "origin"]);
  if (r.status !== 0) throw new Error("git remote get-url origin failed: " + (r.stderr || "").trim());
  const url = (r.stdout || "").trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (m) return m[1];
  throw new Error(`Cannot parse GitHub repo NWO from remote URL: ${url}`);
}

// リポジトリの default branch を gh repo view で取得（失敗時は "main"）
function getDefaultBranch(repoNwo) {
  const r = shNodeTool("gh", ["repo", "view", repoNwo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  if (r.status === 0) {
    const name = (r.stdout || "").trim();
    if (name) return name;
  }
  warn(`[PR-UP] Could not detect default branch, falling back to "main"`);
  return "main";
}

function printFallback({ branch, repoNwo, defaultBranch, title }) {
  info("\n[PR-UP] Push/PR作成をネットワーク可の端末で手動実行してください:");
  info(`  git push -u origin ${branch}`);
  info(`  gh pr create --repo ${repoNwo} --base ${defaultBranch} --head ${branch} --title "${title}" --body-file /tmp/pr.md`);
}

function runDoctor() {
  return shNodeTool("node", ["scripts/hub-doctor.js"]);
}

function readDoctorJson() {
  const doctorPath = path.join(process.cwd(), "doctor.json");
  if (!fs.existsSync(doctorPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(doctorPath, "utf8"));
  } catch {
    return null;
  }
}

function printNativeBlock() {
  const nodeVersion = (process.version || "").trim();
  const nodeModules = process.versions && process.versions.modules ? String(process.versions.modules) : "unknown";
  info(`[PR-UP] Node: ${nodeVersion}`);
  info(`[PR-UP] Node modules ABI: ${nodeModules}`);
  info("[PR-UP] Recovery (recommended):");
  info("  volta pin node@22");
  info("  rm -rf node_modules");
  info("  npm install");
}

function main() {
  const doctorRun = runDoctor();
  const doctor = readDoctorJson();
  if (!doctorRun || doctorRun.status !== 0 || !doctor) {
    const reason = doctorRun && doctorRun.status !== 0
      ? `hub-doctor.js failed (code=${doctorRun.status})`
      : "doctor.json missing or invalid";
    info(`[PR-UP] ${reason}. Aborting before npm test/push/gh.`);
    printNativeBlock();
    process.exit(1);
  }
  const nativeStatus = doctor && doctor.native && doctor.native.better_sqlite3;
  if (nativeStatus && nativeStatus.ok === false) {
    info("[PR-UP] native.better_sqlite3.ok=false detected in doctor.json. Aborting before npm test/push/gh.");
    printNativeBlock();
    process.exit(1);
  }

  // ネットワークガード: NET_NG なら push/gh の前に中断
  const netOk = doctor.network && doctor.network.ok;
  if (netOk === false) {
    const detail = doctor.network.detail || "(詳細なし)";
    // "ネットワーク診断はNGですが、push/gh を継続して実行します。"
    info(`[PR-UP] NET_NG: ネットワーク到達不可 (${detail})`);
    info("[PR-UP] git push / gh pr create を中止します。");
    info("[PR-UP] 復旧方法:");
    info("  bash scripts/fix-dns.sh");
    info("  node scripts/pr-up.js");
    process.exit(1);
  }

  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  // repo/base を早期解決して gen-pr-body.js に渡す
  const repoNwo       = getRepoNwo();
  const defaultBranch = getDefaultBranch(repoNwo);
  const title         = must("git", ["log", "-1", "--pretty=%s"]);
  info(`[PR-UP] repo=${repoNwo} base=${defaultBranch} head=${branch}`);

  // ローカルステップ
  const npmTest = shNodeTool("npm", ["test"], { env: { ...process.env, SKIP_INTEGRATION_TESTS: "1" } });
  if (npmTest.status !== 0) {
    const out = ((npmTest.stdout || "") + "\n" + (npmTest.stderr || "")).trim();
    throw new Error(`npm test failed (code=${npmTest.status})\n${out}`);
  }
  const prBody = shNodeTool("node", ["scripts/gen-pr-body.js"], { env: { ...process.env, PR_BASE_BRANCH: defaultBranch } });
  if (prBody.status !== 0) {
    const out = ((prBody.stdout || "") + "\n" + (prBody.stderr || "")).trim();
    throw new Error(`node scripts/gen-pr-body.js failed (code=${prBody.status})\n${out}`);
  }
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  // push
  const push = shNodeTool("git", ["push", "-u", "origin", branch], { timeout: 30000 });
  if (push.status !== 0) {
    warn(`[PR-UP] PUSH FAILED\n` + tailText(((push.stdout || "") + "\n" + (push.stderr || "")).trim(), 20));
    printFallback({ branch, repoNwo, defaultBranch, title });
    process.exit(1);
  }

  // PR create or edit
  const list = shNodeTool("gh", ["pr", "list", "--repo", repoNwo, "--head", branch, "--json", "number", "--jq", ".[0].number"], { timeout: 30000 });
  const prNumber = list.status === 0 ? (list.stdout || "").trim() : "";

  if (prNumber) {
    const edit = shNodeTool("gh", ["pr", "edit", prNumber, "--repo", repoNwo, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (edit.status !== 0) {
      warn(`[PR-UP] gh pr edit failed\n` + tailText(((edit.stdout || "") + "\n" + (edit.stderr || "")).trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    const create = shNodeTool("gh", ["pr", "create", "--repo", repoNwo, "--base", defaultBranch, "--head", branch, "--title", title, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (create.status !== 0) {
      warn(`[PR-UP] gh pr create failed\n` + tailText(((create.stdout || "") + "\n" + (create.stderr || "")).trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Created PR: ${(create.stdout || "").trim()}`);
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(`[PR-UP] FAILED: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
}
