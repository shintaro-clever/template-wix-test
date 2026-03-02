const fs = require("fs");
const path = require("path");

const DEFAULT_ALLOWED_PATHS = ["vault/tmp/"];

function normalizeRelativePath(fileName = "") {
  const base = typeof fileName === "string" ? fileName.trim() : "";
  const fallback = `figma_ingest_${Date.now()}.json`;
  const safe = base || fallback;
  const normalized = path.posix.normalize(`vault/tmp/${safe}`.replace(/\\/g, "/"));
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("invalid ingest path");
  }
  return normalized;
}

function ensureAllowedPath(relativePath, allowedPaths = DEFAULT_ALLOWED_PATHS) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const ok = (allowedPaths || []).some((prefix) => normalized.startsWith(String(prefix)));
  if (!ok) {
    throw new Error("ingest path blocked by allowed_paths");
  }
}

function writeIngestFile({ fileName, buffer, allowedPaths = DEFAULT_ALLOWED_PATHS }) {
  const relativePath = normalizeRelativePath(fileName);
  ensureAllowedPath(relativePath, allowedPaths);
  const absolutePath = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);
  return {
    relative_path: relativePath,
    absolute_path: absolutePath,
    size: buffer.length,
  };
}

module.exports = {
  DEFAULT_ALLOWED_PATHS,
  normalizeRelativePath,
  ensureAllowedPath,
  writeIngestFile,
};
