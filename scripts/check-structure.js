#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const REQUIRED_PATHS = [
  "agents",
  "agents/rules",
  "agents/commands",
  "agents/skills",
  "docs/ai",
  "docs/ai/core",
  "docs/ai/development",
  "docs/ai/guidelines",
  "docs/ai/management",
  "docs/ai/helpers",
  "docs/ai/implementation-guides",
];

const EXECUTABLE_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".sh",
  ".rb",
  ".py",
  ".ts",
]);

const errors = [];

function checkRequiredPaths() {
  for (const relPath of REQUIRED_PATHS) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      errors.push(`missing required path: ${relPath}`);
    }
  }
}

function checkCommandsFrontmatter() {
  const commandsDir = path.join(ROOT, "agents/commands");
  if (!fs.existsSync(commandsDir)) {
    return;
  }
  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    if (entry.name === "_TEMPLATE.md") {
      continue;
    }
    const relPath = path.join("agents/commands", entry.name);
    const absPath = path.join(ROOT, relPath);
    const content = fs.readFileSync(absPath, "utf8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
    if (!match) {
      errors.push(`missing frontmatter block in: ${relPath}`);
      continue;
    }
    const frontmatterBody = match[1];
    if (!/^\s*description\s*:\s*.+$/m.test(frontmatterBody)) {
      errors.push(`missing required frontmatter field "description" in: ${relPath}`);
    }
  }
}

function hasExecutableFile(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

function checkSkillsStructure() {
  const skillsDir = path.join(ROOT, "agents/skills");
  if (!fs.existsSync(skillsDir)) {
    return;
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    // Ignore template directories from executable checks.
    if (entry.name.startsWith("_")) {
      continue;
    }
    const relDir = path.join("agents/skills", entry.name);
    const absDir = path.join(ROOT, relDir);
    const readmePath = path.join(absDir, "README.md");
    if (!fs.existsSync(readmePath)) {
      errors.push(`missing README.md in: ${relDir}`);
    }
    if (!hasExecutableFile(absDir)) {
      errors.push(`missing executable artifact in: ${relDir}`);
    }
  }
}

function main() {
  checkRequiredPaths();
  checkCommandsFrontmatter();
  checkSkillsStructure();

  if (errors.length > 0) {
    process.stderr.write("[check:structure] NG\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("[check:structure] OK\n");
}

main();
