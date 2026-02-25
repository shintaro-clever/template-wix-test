#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DOCS_AI = path.join(ROOT, "docs", "ai");
const KEYWORDS = ["bypass", "danger", "escalated"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(DOCS_AI);
let warnings = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");
  for (const kw of KEYWORDS) {
    if (text.toLowerCase().includes(kw)) {
      warnings += 1;
      console.warn(`[check:sot-dup] WARNING keyword="${kw}" file=${rel}`);
    }
  }
}

if (warnings === 0) {
  console.log("[check:sot-dup] OK");
}
process.exit(0);
