const { openDb, DEFAULT_TENANT } = require("./sqlite");

const db = openDb();

module.exports = {
  db,
  openDb,
  initDB: openDb,
  DEFAULT_TENANT,
};
