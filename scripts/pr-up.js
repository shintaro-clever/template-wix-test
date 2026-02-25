#!/usr/bin/env node
/**
 * pr-up.js
 *
 * 1. main/master ブランチガード
 * 2. npm test
 * 3. gen-pr-body.js -> /tmp/pr.md 生成
 * 4. pr-body-verify.js バリデーション
 * 5. git push
 * 6. gh pr create / gh pr edit
 */

const { spawnSync } = require("child_process");
const path = require("path");

function shRaw(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function resolveVoltaBin() {
  const candidates = [];
  if (process.env.VOLTA_HOME) {
    candidates.push(path.join(process.env.VOLTA_HOME, "bin", "volta"));
  }
  candidates.push("/home/codespace/.volta/bin/volta");
  candidates.push("volta");
  for (const candidate of candidates) {
    const r = shRaw(candidate, ["--version"], { timeout: 3000 });
    if (r.status === 0) return candidate;
  }
  return null;
}

const VOLTA_BIN = resolveVoltaBin();
const HAS_VOLTA = Boolean(VOLTA_BIN);
const VOLTA_TARGETS = new Set(["node", "npm", "npx"]);

function shNodeTool(cmd, args, opts = {}) {
  if (HAS_VOLTA && VOLTA_TARGETS.has(cmd)) {
    return shRaw(VOLTA_BIN, ["run", cmd, ...args], opts);
  }
  return shRaw(cmd, args, opts);
}

function info(msg) { process.stdout.write(msg + "\n"); }
function warn(msg) { process.stderr.write(msg + "\n"); }

function tailText(text, lines = 12) {
  if (!text) return "";
  const arr = String(text).split("\n");
  return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

function failWithCommand(cmd, args, result, lines = 20) {
  const stderr = (result.stderr || "").trim();
  warn(`[PR-UP] FAILED: ${cmd} ${args.join(" ")}`);
  warn(tailText(stderr || (result.stdout || ""), lines));
  process.exit(1);
}

function getRepoNwo() {
  const args = ["remote", "get-url", "origin"];
  const r = shNodeTool("git", args);
  if (r.status !== 0) failWithCommand("git", args, r, 8);
  const url = (r.stdout || "").trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (m) return m[1];
  throw new Error(`Cannot parse GitHub repo NWO from remote URL: ${url}`);
}

function getDefaultBranch(repoNwo) {
  const args = ["repo", "view", repoNwo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"];
  const r = shNodeTool("gh", args);
  if (r.status === 0) {
    const name = (r.stdout || "").trim();
    if (name) return name;
  }
  warn("[PR-UP] Could not detect default branch, falling back to \"main\"");
  return "main";
}

function printFallback({ branch, repoNwo, defaultBranch, title }) {
  info("\n[PR-UP] Fallback commands:");
  info(`  git push -u origin ${branch}`);
  info(`  gh pr create --repo ${repoNwo} --base ${defaultBranch} --head ${branch} --title "${title}" --body-file /tmp/pr.md`);
}

function must(cmd, args, opts = {}) {
  const r = shNodeTool(cmd, args, opts);
  if (r.status !== 0) failWithCommand(cmd, args, r, 20);
  return (r.stdout || "").trim();
}

function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn("[PR-UP] Next: git checkout -b issue-<number>-<slug>");
    process.exit(1);
  }

  const repoNwo = getRepoNwo();
  const defaultBranch = getDefaultBranch(repoNwo);
  const title = must("git", ["log", "-1", "--pretty=%s"]);
  info(`[PR-UP] repo=${repoNwo} base=${defaultBranch} head=${branch}`);

  // Selftest lock phrase:
  // ネットワーク診断はNGですが、push/gh を継続して実行します。

  const npmRes = shNodeTool("npm", ["test"], { env: { ...process.env, SKIP_INTEGRATION_TESTS: "1" } });
  if (npmRes.status !== 0) failWithCommand("npm", ["test"], npmRes, 40);

  const genRes = shNodeTool("node", ["scripts/gen-pr-body.js"], { env: { ...process.env, PR_BASE_BRANCH: defaultBranch } });
  if (genRes.status !== 0) failWithCommand("node", ["scripts/gen-pr-body.js"], genRes, 20);

  const verifyRes = shNodeTool("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);
  if (verifyRes.status !== 0) {
    warn((verifyRes.stderr || verifyRes.stdout || "").trim());
    process.exit(1);
  }

  const pushArgs = ["push", "-u", "origin", branch];
  const pushRes = shNodeTool("git", pushArgs, { timeout: 30000 });
  if (pushRes.status !== 0) {
    warn("[PR-UP] PUSH FAILED");
    warn(tailText((pushRes.stderr || "").trim() || (pushRes.stdout || "").trim(), 20));
    printFallback({ branch, repoNwo, defaultBranch, title });
    process.exit(1);
  }

  const listArgs = ["pr", "list", "--repo", repoNwo, "--head", branch, "--json", "number", "--jq", ".[0].number"];
  const listRes = shNodeTool("gh", listArgs, { timeout: 30000 });
  const prNumber = listRes.status === 0 ? (listRes.stdout || "").trim() : "";

  if (prNumber) {
    const editArgs = ["pr", "edit", prNumber, "--repo", repoNwo, "--body-file", "/tmp/pr.md"];
    const editRes = shNodeTool("gh", editArgs, { timeout: 30000 });
    if (editRes.status !== 0) {
      warn("[PR-UP] gh pr edit failed");
      warn(tailText((editRes.stderr || "").trim() || (editRes.stdout || "").trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    const createArgs = ["pr", "create", "--repo", repoNwo, "--base", defaultBranch, "--head", branch, "--title", title, "--body-file", "/tmp/pr.md"];
    const createRes = shNodeTool("gh", createArgs, { timeout: 30000 });
    if (createRes.status !== 0) {
      warn("[PR-UP] gh pr create failed");
      warn(tailText((createRes.stderr || "").trim() || (createRes.stdout || "").trim(), 20));
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Created PR: ${(createRes.stdout || "").trim()}`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[PR-UP] FAILED: ${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
}
