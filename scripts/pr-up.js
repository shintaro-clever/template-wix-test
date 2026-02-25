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

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function must(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
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
  const r = sh("git", ["remote", "get-url", "origin"]);
  if (r.status !== 0) throw new Error("git remote get-url origin failed: " + (r.stderr || "").trim());
  const url = (r.stdout || "").trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (m) return m[1];
  throw new Error(`Cannot parse GitHub repo NWO from remote URL: ${url}`);
}

// リポジトリの default branch を gh repo view で取得（失敗時は "main"）
function getDefaultBranch(repoNwo) {
  const r = sh("gh", ["repo", "view", repoNwo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
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

function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  // ローカルステップ
  must("npm", ["test"], { env: { ...process.env, SKIP_INTEGRATION_TESTS: "1" } });
  must("node", ["scripts/gen-pr-body.js"]);
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  // repo / branch / title
  const repoNwo      = getRepoNwo();
  const defaultBranch = getDefaultBranch(repoNwo);
  const title        = must("git", ["log", "-1", "--pretty=%s"]);
  info(`[PR-UP] repo=${repoNwo} base=${defaultBranch} head=${branch}`);

  // push
  const push = sh("git", ["push", "-u", "origin", branch], { timeout: 30000 });
  if (push.status !== 0) {
    warn(`[PR-UP] PUSH FAILED\n` + tailText(((push.stdout || "") + "\n" + (push.stderr || "")).trim(), 20));
    printFallback({ branch, repoNwo, defaultBranch, title });
    process.exit(1);
  }

  // PR create or edit
  const title_ = must("git", ["log", "-1", "--pretty=%s"]);
  const list = sh("gh", ["pr", "list", "--repo", repoNwo, "--head", branch, "--json", "number", "--jq", ".[0].number"], { timeout: 30000 });
  const prNumber = list.status === 0 ? (list.stdout || "").trim() : "";

  if (prNumber) {
    const edit = sh("gh", ["pr", "edit", prNumber, "--repo", repoNwo, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (edit.status !== 0) {
      warn(`[PR-UP] gh pr edit failed\n` + tailText(((edit.stdout || "") + "\n" + (edit.stderr || "")).trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title: title_ });
      process.exit(1);
    }
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    const create = sh("gh", ["pr", "create", "--repo", repoNwo, "--base", defaultBranch, "--head", branch, "--title", title_, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (create.status !== 0) {
      warn(`[PR-UP] gh pr create failed\n` + tailText(((create.stdout || "") + "\n" + (create.stderr || "")).trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title: title_ });
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
