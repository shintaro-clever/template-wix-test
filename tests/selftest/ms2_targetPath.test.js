const { validateTargetPath } = require("../../src/validation/targetPath");
const { assert } = require("./_helpers");

async function run() {
  const nullResult = validateTargetPath(null);
  assert(nullResult.valid === true, "null should be valid");
  assert(nullResult.normalized === null, "null should normalize to null");

  const normal = validateTargetPath("foo/bar.txt");
  assert(normal.valid === true, "normal path should be valid");
  assert(normal.normalized === "foo/bar.txt", "normal path should normalize");

  const withParent = validateTargetPath("../secret.txt");
  assert(withParent.valid === false, "'..' path should be invalid");

  const absolute = validateTargetPath("/etc/passwd");
  assert(absolute.valid === false, "absolute path should be invalid");
}

module.exports = { run };
