const { db, DEFAULT_TENANT } = require("./index");

function nowIso() {
  return new Date().toISOString();
}

function createArtifact({
  tenantId = DEFAULT_TENANT,
  name,
  path,
  dbConn = db,
} = {}) {
  if (!name) {
    throw new Error("name is required");
  }
  if (!path) {
    throw new Error("path is required");
  }
  const ts = nowIso();
  try {
    dbConn
      .prepare(
        "INSERT INTO artifacts(tenant_id,name,path,created_at,updated_at) VALUES(?,?,?,?,?)"
      )
      .run(tenantId, name, path, ts, ts);
    return { ok: true };
  } catch (error) {
    if (
      error &&
      (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
        error.code === "SQLITE_CONSTRAINT_UNIQUE")
    ) {
      return { ok: false, failure_code: "artifact_conflict", status: 409 };
    }
    throw error;
  }
}

function getArtifactByName({
  tenantId = DEFAULT_TENANT,
  name,
  dbConn = db,
} = {}) {
  if (!name) {
    throw new Error("name is required");
  }
  return dbConn
    .prepare("SELECT tenant_id,name,path,created_at,updated_at FROM artifacts WHERE tenant_id=? AND name=?")
    .get(tenantId, name);
}

module.exports = {
  createArtifact,
  getArtifactByName,
};
