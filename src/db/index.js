const { openDb, DEFAULT_TENANT } = require("./sqlite");

const db = openDb();

module.exports = {
  db,
  openDb,
  DEFAULT_TENANT,
};
