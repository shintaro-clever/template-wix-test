const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function resolvePath(relPath) {
  return path.resolve(REPO_ROOT, String(relPath || ""));
}

module.exports = {
  REPO_ROOT,
  resolvePath,
};
