#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const uiDir = path.resolve(__dirname, "../apps/hub/static/ui");
const partialsDir = path.join(uiDir, "partials");
const sidebarPath = path.join(partialsDir, "sidebar.html");
const headerPath = path.join(partialsDir, "header.html");

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractByRegex(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1].trim() : "";
}

function extractPageTitle(text) {
  const fromComment = extractByRegex(text, /<!--\s*PAGE_TITLE:\s*([\s\S]*?)\s*-->/i);
  if (fromComment) return fromComment;

  const fromKeyComment = extractByRegex(text, /<!--\s*PAGE_TITLE_KEY:\s*([\s\S]*?)\s*-->/i);
  if (fromKeyComment) return fromKeyComment;

  const fromIncludeNote = extractByRegex(
    text,
    /\{\{PAGE_TITLE\}\}\s*->\s*([^,\n\r)]*)/i,
  );
  if (fromIncludeNote) return fromIncludeNote;

  const fromTitleTag = extractByRegex(text, /<title>\s*([^<]+)\s*<\/title>/i);
  if (fromTitleTag) {
    const parts = fromTitleTag.split("-").map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : fromTitleTag;
  }

  return "";
}

function extractHeaderRightContent(text) {
  const blockStyle = extractByRegex(text, /<!--[\s\S]*?HEADER_RIGHT_CONTENT:\s*([\s\S]*?)-->/i);
  if (blockStyle) return blockStyle.replace(/\\"/g, "\"");

  const value = extractByRegex(text, /\{\{HEADER_RIGHT_CONTENT\}\}\s*->\s*([\s\S]*?)\)\s*-->/i);
  return value.replace(/\\"/g, "\"");
}

function replaceIncludeBlock(text, partialName, replacement) {
  const escaped = escapeRegExp(partialName);
  const pair = new RegExp(
    `<!--\\s*#include\\s+virtual="${escaped}"\\s*-->\\s*\\n?\\s*<!--\\s*include:\\s*${escaped}[\\s\\S]*?-->`,
    "gi",
  );
  const singleSsi = new RegExp(`<!--\\s*#include\\s+virtual="${escaped}"\\s*-->`, "gi");
  const singleBuild = new RegExp(`<!--\\s*include:\\s*${escaped}[\\s\\S]*?-->`, "gi");

  let out = text.replace(pair, replacement);
  out = out.replace(singleSsi, replacement);
  out = out.replace(singleBuild, replacement);
  return out;
}

function collapseDuplicateBlock(text, block) {
  if (!block) return text;
  const escapedBlock = escapeRegExp(block);
  const dup = new RegExp(`(?:${escapedBlock}\\s*){2,}`, "g");
  return text.replace(dup, `${block}\n`);
}

function collapseConsecutiveTag(text, tagName) {
  const re = new RegExp(`(<${tagName}\\b[\\s\\S]*?<\\/${tagName}>)\\s*\\1+`, "gi");
  return text.replace(re, "$1\n");
}

function buildOneFile(filePath, sidebarHtml, headerTemplate) {
  const original = readUtf8(filePath);
  const pageTitle = extractPageTitle(original);
  const headerRightContent = extractHeaderRightContent(original);

  let headerHtml = headerTemplate;
  if (pageTitle) {
    headerHtml = headerHtml.replace(/\{\{PAGE_TITLE\}\}/g, pageTitle);
  }
  headerHtml = headerHtml.replace(/\{\{HEADER_RIGHT_CONTENT\}\}/g, headerRightContent);

  let built = original;
  built = replaceIncludeBlock(built, "partials/sidebar.html", sidebarHtml);
  built = replaceIncludeBlock(built, "partials/header.html", headerHtml);
  built = collapseDuplicateBlock(built, sidebarHtml);
  built = collapseDuplicateBlock(built, headerHtml);
  built = collapseConsecutiveTag(built, "aside");
  built = collapseConsecutiveTag(built, "header");

  if (built !== original) {
    fs.writeFileSync(filePath, built, "utf8");
    return true;
  }
  return false;
}

function main() {
  const sidebarHtml = readUtf8(sidebarPath).trim();
  const headerTemplate = readUtf8(headerPath).trim();

  const entries = fs.readdirSync(uiDir, { withFileTypes: true });
  const htmlFiles = entries
    .filter((ent) => ent.isFile() && ent.name.endsWith(".html"))
    .map((ent) => path.join(uiDir, ent.name));

  let changed = 0;
  for (const filePath of htmlFiles) {
    if (buildOneFile(filePath, sidebarHtml, headerTemplate)) {
      changed += 1;
      process.stdout.write(`[build:ui] updated ${path.relative(uiDir, filePath)}\n`);
    }
  }
  process.stdout.write(`[build:ui] done (changed: ${changed})\n`);
}

main();
