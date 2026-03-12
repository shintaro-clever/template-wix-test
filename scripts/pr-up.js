#!/usr/bin/env node

const { spawnSync } = require("child_process");

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 30000,
    ...options,
  });
}

function must(cmd, args, options = {}) {
  const result = run(cmd, args, options);
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    console.error(`[PR-UP] FAILED: ${cmd} ${args.join(" ")}`);
    console.error(stderr || stdout);
    process.exit(1);
  }
  return (result.stdout || "").trim();
}

function getDefaultBranch(repo) {
  const result = run("gh", ["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  return result.status === 0 ? (result.stdout || "").trim() || "main" : "main";
}

function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    console.error(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    process.exit(1);
  }

  must("npm", ["test"]);
  must("node", ["scripts/gen-pr-body.js"]);
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  const repoUrl = must("git", ["remote", "get-url", "origin"]);
  const repoMatch = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!repoMatch) {
    console.error(`[PR-UP] FAILED: could not parse GitHub repo from ${repoUrl}`);
    process.exit(1);
  }

  const repo = repoMatch[1];
  const base = getDefaultBranch(repo);
  const title = must("git", ["log", "-1", "--pretty=%s"]);

  must("git", ["push", "-u", "origin", branch]);

  const existingPr = run("gh", ["pr", "list", "--repo", repo, "--head", branch, "--json", "number", "--jq", ".[0].number"]);
  const prNumber = existingPr.status === 0 ? (existingPr.stdout || "").trim() : "";

  if (prNumber) {
    must("gh", ["pr", "edit", prNumber, "--repo", repo, "--body-file", "/tmp/pr.md", "--title", title]);
    console.log(`[PR-UP] Updated PR #${prNumber}`);
    return;
  }

  const created = must("gh", ["pr", "create", "--repo", repo, "--base", base, "--head", branch, "--title", title, "--body-file", "/tmp/pr.md"]);
  console.log(`[PR-UP] Created PR: ${created}`);
}

main();
