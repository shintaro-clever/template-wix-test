const fs = require("fs");
const path = require("path");
const { handleArtifactsPost, handleArtifactsGet } = require("../../src/routes/artifacts");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { assert, requestLocal } = require("./_helpers");

async function run() {
  const artifactName = `artifact-${Date.now()}`;
  const relativePath = path.join(".ai-runs", `${artifactName}.txt`);
  const absolute = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, "artifact-body", "utf8");

  try {
    const postRes = await requestLocal(handleArtifactsPost, {
      method: "POST",
      url: "/api/artifacts",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: artifactName, path: relativePath }),
    });
    assert(postRes.statusCode === 201, "artifact register should return 201");

    const getRes = await requestLocal((req, res) => handleArtifactsGet(req, res, artifactName), {
      method: "GET",
      url: `/api/artifacts/${artifactName}`,
    });
    assert(getRes.statusCode === 200, "artifact get should return 200");
    assert(getRes.body.toString("utf8") === "artifact-body", "artifact body should match");

    const dupRes = await requestLocal(handleArtifactsPost, {
      method: "POST",
      url: "/api/artifacts",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: artifactName, path: relativePath }),
    });
    assert(dupRes.statusCode === 409, "duplicate artifact should return 409");
  } finally {
    db.prepare("DELETE FROM artifacts WHERE tenant_id=? AND name=?").run(DEFAULT_TENANT, artifactName);
    fs.rmSync(absolute, { force: true });
  }
}

module.exports = { run };
