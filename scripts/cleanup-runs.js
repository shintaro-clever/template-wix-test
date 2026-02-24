#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const RUN_ID_PATTERN = /^[a-z0-9]{8}-[a-f0-9]{6}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function printUsage() {
  console.log(`Usage: node scripts/cleanup-runs.js [--keep N] [--days D] [--apply] [--dir <path>]

Options:
  --keep N     Keep the newest N run directories (default: do not limit by count)
  --days D     Keep runs modified within the last D days (default: do not limit by age)
  --apply      Actually delete the selected runs (default: dry-run)
  --dir PATH   Target runs directory (default: <repo>/.ai-runs)
`);
}

function parseArgs(argv) {
  const options = {
    keep: null,
    days: null,
    apply: false,
    dir: path.join(process.cwd(), '.ai-runs')
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep' || arg === '-k') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--keep requires a value');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('--keep must be a non-negative integer');
      }
      options.keep = parsed;
      i += 1;
    } else if (arg === '--days' || arg === '-d') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--days requires a value');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('--days must be a non-negative number');
      }
      options.days = parsed;
      i += 1;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dir') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--dir requires a value');
      }
      options.dir = path.resolve(value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function listRunDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const entries = fs.readdirSync(rootDir);
  const runs = [];
  entries.forEach((entry) => {
    if (entry.startsWith('.')) {
      return;
    }
    if (!RUN_ID_PATTERN.test(entry)) {
      return;
    }
    const fullPath = path.join(rootDir, entry);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    runs.push({
      name: entry,
      path: fullPath,
      mtimeMs: stats.mtimeMs,
      mtime: stats.mtime
    });
  });
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs;
}

function formatDate(date) {
  return new Date(date).toISOString();
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
    return;
  }

  const dryRun = !options.apply;
  const runs = listRunDirectories(options.dir);
  const now = Date.now();
  const threshold = options.days != null ? now - options.days * DAY_MS : null;
  const toDelete = [];

  runs.forEach((run, index) => {
    const reasons = [];
    if (options.keep != null && index >= options.keep) {
      reasons.push(`beyond keep=${options.keep}`);
    }
    if (threshold != null && run.mtimeMs < threshold) {
      reasons.push(`older than ${options.days} days`);
    }
    if (reasons.length > 0) {
      toDelete.push({ ...run, reasons });
    }
  });

  console.log(`[cleanup-runs] Target directory: ${options.dir}`);
  console.log(`[cleanup-runs] Total run directories detected: ${runs.length}`);
  console.log(`[cleanup-runs] Mode: ${dryRun ? 'DRY-RUN (no deletions)' : 'APPLY (deletions enabled)'}`);
  if (options.keep != null) {
    console.log(`[cleanup-runs] Keeping newest ${options.keep} run(s)`);
  }
  if (options.days != null) {
    console.log(`[cleanup-runs] Removing runs older than ${options.days} day(s)`);
  }

  const keptCount = runs.length - toDelete.length;
  console.log(`[cleanup-runs] Runs kept: ${keptCount}`);
  console.log(`[cleanup-runs] 保持件数: ${keptCount}`);
  console.log(`[cleanup-runs] Runs selected for deletion: ${toDelete.length}`);

  if (!toDelete.length) {
    console.log('[cleanup-runs] No runs selected for deletion.');
    return;
  }

  console.log('[cleanup-runs] 削除対象一覧 (runs selected for deletion):');
  toDelete.forEach((entry) => {
    console.log(
      `  - ${entry.name} (mtime=${formatDate(entry.mtime)}, reasons=${entry.reasons.join(', ')})`
    );
  });

  if (!dryRun) {
    toDelete.forEach((entry) => {
      try {
        fs.rmSync(entry.path, { recursive: true, force: true });
      } catch (error) {
        console.error(`[cleanup-runs] Failed to delete ${entry.name}: ${error.message}`);
      }
    });
    console.log(`[cleanup-runs] 削除件数: ${toDelete.length}`);
  } else {
    console.log('[cleanup-runs] Dry-run complete. Use --apply to delete the listed runs.');
    console.log(`[cleanup-runs] 削除件数 (dry-run): ${toDelete.length}`);
  }
}

main();
