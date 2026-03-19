#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 30000,
    ...options,
  });
}

function fail(cmd, args, result) {
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  console.error(`[PR-UP] FAILED: ${cmd} ${args.join(" ")}`);
  console.error(stderr || stdout);
  process.exit(1);
}

function must(cmd, args, options = {}) {
  const result = run(cmd, args, options);
  if (result.status !== 0) {
    fail(cmd, args, result);
  }
  return (result.stdout || "").trim();
}

function getRepo() {
  const repoUrl = must("git", ["remote", "get-url", "origin"]);
  const match = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) {
    console.error(`[PR-UP] FAILED: could not parse GitHub repo from ${repoUrl}`);
    process.exit(1);
  }
  return match[1];
}

function getTokenFromGitCredentialStore() {
  const result = run(
    "git",
    [
      "-c",
      "credential.helper=store",
      "-c",
      "credential.https://github.com.helper=",
      "credential",
      "fill",
    ],
    { input: "protocol=https\nhost=github.com\n\n" }
  );
  if (result.status !== 0) {
    fail("git", ["credential", "fill"], result);
  }
  const token = (result.stdout || "")
    .split("\n")
    .find((line) => line.startsWith("password="));
  if (!token) {
    console.error("[PR-UP] FAILED: GitHub token was not found in git credential store");
    process.exit(1);
  }
  return token.slice("password=".length);
}

function mustGh(token, args, options = {}) {
  return must("gh", args, {
    ...options,
    env: {
      ...process.env,
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
    },
  });
}

function mustGitPush(args) {
  return must("git", [
    "-c",
    "credential.helper=store",
    "-c",
    "credential.https://github.com.helper=",
    ...args,
  ]);
}

function writeJsonTempFile(payload) {
  const file = path.join(os.tmpdir(), `pr-up-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  return file;
}

function getDefaultBranch(token, repo) {
  const result = run("gh", ["api", `repos/${repo}`, "--jq", ".default_branch"], {
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  });
  if (result.status === 0) {
    const name = (result.stdout || "").trim();
    if (name) return name;
  }
  console.error("[PR-UP] Could not detect default branch, falling back to \"main\"");
  return "main";
}

function getExistingPrNumber(token, repo, owner, branch) {
  const result = run(
    "gh",
    [
      "api",
      `repos/${repo}/pulls?state=open&head=${owner}:${branch}`,
      "--jq",
      ".[0].number // empty",
    ],
    {
      env: {
        ...process.env,
        GH_TOKEN: token,
        GITHUB_TOKEN: token,
      },
    }
  );
  if (result.status !== 0) {
    fail("gh", ["api", `repos/${repo}/pulls?state=open&head=${owner}:${branch}`], result);
  }
  return (result.stdout || "").trim();
}

function createOrUpdatePr(token, repo, branch, base, title, body) {
  const [owner] = repo.split("/");
  const prNumber = getExistingPrNumber(token, repo, owner, branch);

  if (prNumber) {
    const payloadFile = writeJsonTempFile({ title, body });
    const url = mustGh(token, [
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/pulls/${prNumber}`,
      "--input",
      payloadFile,
      "--jq",
      ".html_url",
    ]);
    fs.unlinkSync(payloadFile);
    return { action: "Updated", url, prNumber };
  }

  const payloadFile = writeJsonTempFile({ title, head: branch, base, body });
  const url = mustGh(token, [
    "api",
    "-X",
    "POST",
    `repos/${repo}/pulls`,
    "--input",
    payloadFile,
    "--jq",
    ".html_url",
  ]);
  fs.unlinkSync(payloadFile);
  return { action: "Created", url, prNumber: null };
}

function checkNetwork(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = https.request(
      { method: "HEAD", host: "github.com", path: "/", timeout: timeoutMs },
      (res) => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
        resolve({ ok, detail: ok ? null : `status=${res.statusCode}` });
      }
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (error) => {
      resolve({ ok: false, detail: error && error.message ? error.message : "network error" });
    });
    req.end();
  });
}

async function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    console.error(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    process.exit(1);
  }

  must("npm", ["test"]);
  must("node", ["scripts/gen-pr-body.js"]);
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  const repo = getRepo();
  const token = getTokenFromGitCredentialStore();
  const base = getDefaultBranch(token, repo);
  const title = must("git", ["log", "-1", "--pretty=%s"]);
  const body = fs.readFileSync("/tmp/pr.md", "utf8");

  const netCheck = await checkNetwork(3000);
  if (!netCheck.ok) {
    const detail = netCheck.detail || "(詳細なし)";
    console.error(`[PR-UP] NET_NG: ネットワーク到達不可 (${detail})`);
    console.error("[PR-UP] ネットワークが回復したら以下を実行してください:");
    console.error(`  git push -u origin ${branch}`);
    console.error(`  gh pr create --repo ${repo} --base ${base} --head ${branch} --title "${title}" --body-file /tmp/pr.md`);
    process.exit(1);
  }

  mustGitPush(["push", "-u", "origin", branch]);
  const result = createOrUpdatePr(token, repo, branch, base, title, body);
  console.log(`[PR-UP] ${result.action} PR: ${result.url}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
