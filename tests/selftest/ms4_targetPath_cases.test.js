const { validateTargetPath } = require("../../src/validation/targetPath");
const { assert } = require("./_helpers");

async function run() {
  const traversal = validateTargetPath("src/../etc/passwd");
  assert(traversal.valid === false, "src/../etc/passwd should be invalid");

  const dot = validateTargetPath(".");
  assert(dot.valid === true, "dot path should be valid");

  const withCurrent = validateTargetPath("a/./b");
  assert(withCurrent.valid === true, "a/./b should be valid");

  const empty = validateTargetPath("");
  assert(empty.valid === false, "empty path should be invalid");

  const normal = validateTargetPath("src/components/Button.tsx");
  assert(normal.valid === true, "src/components/Button.tsx should be valid");
}

module.exports = { run };
