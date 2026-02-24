#!/usr/bin/env node
const { spawnSync } = require("child_process");

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 10000, ...opts });
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

function tailText(text, lines = 12) {
  if (!text) return "";
  const arr = String(text).split("\n");
  return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

function bash(script) {
  return sh("bash", ["-lc", script]);
}

function dumpDiag(label) {
  const r = bash(`
    echo "=== ${label} ==="
    echo "-- id/host/time --"
    id || true
    hostname || true
    date || true
    echo "-- resolv.conf --"
    cat /etc/resolv.conf || true
    echo "-- env (proxy/git/codespaces) --"
    env | grep -E '^(HTTP|HTTPS|ALL)_PROXY=|^NO_PROXY=|^GIT_|^CODESPACES' || true
    echo "-- curl github (exit only) --"
    curl -fsSI -o /dev/null https://github.com
    echo "curl_exit=$?"
    echo "-- git remote --"
    git remote -v || true
  `);

  info((r.stdout || "").trim());
  if (r.stderr) {
    warn(tailText(r.stderr, 20));
  }
}

function sleepMs(ms) {
  bash(`sleep ${Math.ceil(ms / 1000)}`);
}

function githubReachableOnce() {
  const r = sh("curl", ["-fsSI", "-o", "/dev/null", "https://github.com"]);
  return { ok: r.status === 0, status: r.status, stderr: (r.stderr || "").trim() };
}

function githubReachableWithRetry() {
  let r = githubReachableOnce();
  if (r.ok) return r;

  const delays = [1000, 2000, 4000];
  for (const d of delays) {
    warn(`[PR-UP] GitHub reachability failed (curl exit=${r.status}). Retrying in ${d}ms...`);
    sleepMs(d);
    r = githubReachableOnce();
    if (r.ok) return r;
  }
  return r;
}

// リポジトリの default branch を gh repo view で取得する。
// 取得失敗時は "main" にフォールバックし、その旨を warn する。
function getDefaultBranch(repoNwo) {
  const r = sh("gh", ["repo", "view", repoNwo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  if (r.status === 0) {
    const name = (r.stdout || "").trim();
    if (name) return name;
  }
  warn(`[PR-UP] Could not detect default branch for ${repoNwo}, falling back to "main"`);
  return "main";
}

// "owner/repo" 形式の文字列を git remote から取得する。
// ssh (git@github.com:owner/repo.git) / https どちらにも対応。
function getRepoNwo() {
  const r = sh("git", ["remote", "get-url", "origin"]);
  if (r.status !== 0) throw new Error("git remote get-url origin failed: " + (r.stderr || "").trim());
  const url = (r.stdout || "").trim();
  // ssh: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // https: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  throw new Error(`Cannot parse GitHub repo NWO from remote URL: ${url}`);
}

function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  if (process.env.PR_UP_DIAG === "1") {
    dumpDiag("pr-up diag (before)");
  }

  // local-only steps
  must("npm", ["test"]);
  must("node", ["scripts/gen-pr-body.js"]);
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  // reachability
  const reach = githubReachableWithRetry();
  if (!reach.ok) {
    warn(`[PR-UP] GitHub unreachable after retries (curl exit=${reach.status}). Fallback to manual steps.`);
    if (reach.stderr) warn(tailText(reach.stderr, 12));

    info("\n[PR-UP] Fallback (network-required steps):");
    info(`- Retry push in a network-reachable environment:\n  git push -u origin ${branch}`);
    info(`- PR body is already generated at /tmp/pr.md:\n  cat /tmp/pr.md`);
    info("- If you can access GitHub Web UI, paste /tmp/pr.md into the PR description.");
    process.exit(1);
  }

  // repo NWO & default branch（--repo / --base の齟齬による "No commits between" を防ぐ）
  const repoNwo = getRepoNwo();
  const defaultBranch = getDefaultBranch(repoNwo);
  info(`[PR-UP] repo=${repoNwo} base=${defaultBranch} head=${branch}`);

  // push
  const push = sh("git", ["push", "-u", "origin", branch]);
  if (push.status !== 0) {
    warn(`[PR-UP] PUSH FAILED`);
    warn(tailText(((push.stdout || "") + "\n" + (push.stderr || "")).trim(), 20));

    info("\n[PR-UP] Fallback (network-required steps):");
    info(`- Retry push in a network-reachable environment:\n  git push -u origin ${branch}`);
    info(`- PR body is already generated at /tmp/pr.md:\n  cat /tmp/pr.md`);
    info("- If you can access GitHub Web UI, paste /tmp/pr.md into the PR description.");
    process.exit(1);
  }

  // PR create/edit
  // --title は必須（なしだと gh が Usage を吐いて落ちる）。最終コミットの subject を使う。
  const title = must("git", ["log", "-1", "--pretty=%s"]);

  const list = sh("gh", [
    "pr", "list",
    "--repo", repoNwo,
    "--head", branch,
    "--json", "number",
    "--jq", ".[0].number"
  ]);
  const prNumber = list.status === 0 ? (list.stdout || "").trim() : "";

  if (prNumber) {
    const edit = sh("gh", [
      "pr", "edit", prNumber,
      "--repo", repoNwo,
      "--body-file", "/tmp/pr.md"
    ]);
    if (edit.status !== 0) {
      warn(`[PR-UP] gh pr edit failed. Falling back to manual Web UI paste.`);
      warn(tailText(((edit.stdout || "") + "\n" + (edit.stderr || "")).trim(), 20));
      const body = must("cat", ["/tmp/pr.md"]);
      info("\n[PR-UP] PR body (paste into Web UI):\n");
      info(body);
      process.exit(1);
    }
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    const create = sh("gh", [
      "pr", "create",
      "--repo", repoNwo,
      "--base", defaultBranch,
      "--head", branch,
      "--title", title,
      "--body-file", "/tmp/pr.md"
    ]);
    if (create.status !== 0) {
      warn(`[PR-UP] gh pr create failed. Falling back to manual Web UI paste.`);
      warn(tailText(((create.stdout || "") + "\n" + (create.stderr || "")).trim(), 20));
      const body = must("cat", ["/tmp/pr.md"]);
      info("\n[PR-UP] PR body (paste into Web UI):\n");
      info(body);
      process.exit(1);
    }
    info(`[PR-UP] Created PR: ${(create.stdout || "").trim()}`);
  }

  if (process.env.PR_UP_DIAG === "1") {
    dumpDiag("pr-up diag (after)");
  }
}

try {
  main();
} catch (e) {
  warn(`[PR-UP] FAILED: ${e && e.message ? e.message : String(e)}`);
  warn(`[PR-UP] If /tmp/pr.md exists, you can paste it into GitHub Web UI.`);
  process.exit(1);
}
