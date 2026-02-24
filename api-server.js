#!/usr/bin/env node
const { createApiServer } = require("./src/server/apiApp");

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";

const server = createApiServer();
server.listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`);
});
