#!/usr/bin/env node
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

function info(msg) {
  process.stdout.write(msg + "\n");
}

function warn(msg) {
  process.stderr.write(msg + "\n");
}

function main() {
  // 0) Branch guard
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  // 1) テスト（ローカルのみ）
  must("npm", ["test"]);

  // 2) PR本文生成（ローカルのみ）
  must("node", ["scripts/gen-pr-body.js"]);
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  // 3) Push（ネットワーク必須）
  const push = sh("git", ["push", "-u", "origin", branch]);
  if (push.status !== 0) {
    const err = ((push.stdout || "") + "\n" + (push.stderr || "")).trim();
    warn(`[PR-UP] PUSH FAILED`);
    warn(err.split("\n").slice(-8).join("\n"));

    info("\n[PR-UP] Fallback (network-required steps):");
    info(`- Retry push in a network-reachable environment:\n  git push -u origin ${branch}`);
    info(`- PR body is already generated at /tmp/pr.md:\n  cat /tmp/pr.md`);
    info("- If you can access GitHub Web UI, paste /tmp/pr.md into the PR description.");
    process.exit(1);
  }

  // 4) GitHub API到達性
  const curl = sh("curl", ["-I", "https://api.github.com"]);
  if (curl.status !== 0) {
    warn(`[PR-UP] GitHub API unreachable. Falling back to manual Web UI paste.`);
    info(`\n[PR-UP] PR body:\n`);
    const body = must("cat", ["/tmp/pr.md"]);
    info(body);
    process.exit(0);
  }

  // 5) ghによるPR作成/更新
  const list = sh("gh", ["pr", "list", "--head", branch, "--json", "number", "--jq", ".[0].number"]);
  const prNumber = list.status === 0 ? (list.stdout || "").trim() : "";

  if (prNumber) {
    must("gh", ["pr", "edit", prNumber, "--body-file", "/tmp/pr.md"]);
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    // baseはmain固定（レポジトリ前提）
    const created = must("gh", ["pr", "create", "--base", "main", "--head", branch, "--body-file", "/tmp/pr.md"]);
    info(`[PR-UP] Created PR: ${created}`);
  }
}

try {
  main();
} catch (e) {
  warn(`[PR-UP] FAILED: ${e && e.message ? e.message : String(e)}`);
  warn(`[PR-UP] If /tmp/pr.md exists, you can paste it into GitHub Web UI.`);
  process.exit(1);
}
