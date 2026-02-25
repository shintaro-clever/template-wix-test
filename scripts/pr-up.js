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

function readDoctorJson() {
  const doctorPath = path.join(process.cwd(), "doctor.json");
  if (!fs.existsSync(doctorPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(doctorPath, "utf8"));
  } catch (error) {
    warn(`[PR-UP] doctor.json parse failed: ${error && error.message ? error.message : String(error)}`);
    return null;
  }
}

function resolveNetStatus(doctor) {
  if (!doctor) return null;
  const status = doctor.network && doctor.network.status ? doctor.network.status : (doctor.net && doctor.net.status ? doctor.net.status : null);
  if (status) return status;
  if (doctor.network && doctor.network.ok === false) return "NET_NG";
  if (doctor.net && doctor.net.ok === false) return "NET_NG";
  return null;
}

function findLatestOfflineSmoke() {
  const markerPath = path.join(process.cwd(), ".ai-runs", "latest_offline_smoke.json");
  if (!fs.existsSync(markerPath)) {
    return { ok: false, reason: "smoke未実行扱い: latest_offline_smoke.json がありません" };
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return { ok: false, reason: "smoke未実行扱い: latest_offline_smoke.json が壊れています" };
  }
  if (payload && payload.status === "ok") {
    return { ok: true };
  }
  const status = payload && payload.status ? payload.status : "unknown";
  return { ok: false, reason: `smoke未実行扱い: status=${status}` };
}

function printNativeFixGuide(details) {
  info("[PR-UP] Native modules check failed. npm test is skipped.");
  if (details && (details.required || details.found || details.nodeModules)) {
    const bits = [];
    if (details.nodeModules) bits.push(`nodeModules=${details.nodeModules}`);
    if (details.found) bits.push(`found=${details.found}`);
    if (details.required) bits.push(`required=${details.required}`);
    if (bits.length) info(`[PR-UP] Details: ${bits.join(" ")}`);
  }
  info("[PR-UP] Suggested recovery:");
  info("  (Recommended) volta pin node@22");
  info("  (Recommended) rm -rf node_modules");
  info("  (Recommended) npm install");
  info("  (Recommended) npm test");
  info("  (Temporary) npm rebuild better-sqlite3 --build-from-source");
  info("  (Temporary) npm test");
  info("[PR-UP] See docs/ai/runbooks/native-modules.md for criteria and details.");
}

function printNetNgGuide(status) {
  info(`[PR-UP] Network check failed (${status}). GitHub operations are blocked.`);
  info("[PR-UP] Recovery:");
  info("  1. Restore network connectivity.");
  info("  2. Re-run: node scripts/hub-doctor.js");
  info("  3. Re-run: node scripts/pr-up.js");
  info("[PR-UP] Patch export (offline to online):");
  info("  1. git status");
  info("  2. git diff > /tmp/patch.diff");
  info("  3. Move /tmp/patch.diff to a network-enabled environment and apply it.");
}

function printHangRiskGuide(details) {
  info("[PR-UP] hangRisk detected: minimal smoke missing or failed.");
  if (details && details.reason) {
    info(`[PR-UP] Details: ${details.reason}`);
  }
  info("[PR-UP] Run LaneB smoke first:");
  info("  node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator");
  info("[PR-UP] After it succeeds, re-run: node scripts/pr-up.js");
}

function main() {
  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  const doctor = readDoctorJson();
  const nativeStatus = doctor && doctor.native && doctor.native.better_sqlite3;
  const netStatus = resolveNetStatus(doctor);
  const netNg = netStatus && netStatus !== "NET_OK";
  const hangRisk = findLatestOfflineSmoke();

  const guards = [];
  if (netNg) {
    guards.push({ id: "NET_NG", priority: 1, handler: () => printNetNgGuide(netStatus) });
  }
  if (nativeStatus && nativeStatus.ok === false) {
    guards.push({ id: "NATIVE_BAD", priority: 2, handler: () => printNativeFixGuide(nativeStatus) });
  }
  if (!hangRisk.ok) {
    guards.push({ id: "HANG_RISK", priority: 3, handler: () => printHangRiskGuide(hangRisk) });
  }

  if (guards.length > 0) {
    const ordered = guards.sort((a, b) => a.priority - b.priority);
    info("[PR-UP] Guards triggered:");
    ordered.forEach((guard) => info(`  - ${guard.id}`));
    ordered.forEach((guard) => guard.handler());
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
