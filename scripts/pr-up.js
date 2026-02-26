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
const fs = require("fs");
const path = require("path");
const https = require("https");

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

function checkNetwork(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: "HEAD",
        host: "github.com",
        path: "/",
        timeout: timeoutMs
      },
      (res) => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
        resolve({
          ok,
          detail: ok ? null : `status=${res.statusCode}`
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error) => {
      resolve({ ok: false, detail: error && error.message ? error.message : "network error" });
    });
    req.end();
  });
}

function writePatchFile(branch) {
  const patchesDir = "/tmp/patches";
  fs.mkdirSync(patchesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stamp}-${branch}.patch`;
  const target = path.join(patchesDir, filename);
  const diff = must("git", ["diff", "--binary", "HEAD"]);
  fs.writeFileSync(target, diff, "utf8");
  return target;
}

function must(cmd, args, opts = {}) {
  const r = shNodeTool(cmd, args, opts);
  if (r.status !== 0) failWithCommand(cmd, args, r, 20);
  return (r.stdout || "").trim();
}

async function main() {
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

  const netCheck = await checkNetwork(3000);
  if (!netCheck.ok) {
    const detail = netCheck.detail || "(詳細なし)";
    info(`[PR-UP] NET_NG: ネットワーク到達不可 (${detail})`);
    const patchPath = writePatchFile(branch);
    info(`[PR-UP] パッチを作成しました: ${patchPath}`);
    info("[PR-UP] NET_OK な端末で以下を実行してください:");
    info(`  git checkout ${branch}`);
    info(`  git apply ${patchPath}`);
    info("  npm test");
    info(`  git push -u origin ${branch}`);
    info(`  gh pr create --repo ${repoNwo} --base ${defaultBranch} --head ${branch} --title "${title}" --body-file /tmp/pr.md`);
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

main().catch((error) => {
  process.stderr.write(`[PR-UP] FAILED: ${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
});
