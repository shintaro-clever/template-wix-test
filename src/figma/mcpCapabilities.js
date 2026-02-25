// src/figma/mcpCapabilities.js
// MS0–MS4: MCP tool catalog (13 entries)
const MCP_TOOLS = Object.freeze([
  "figma.read_file",
  "figma.read_nodes",
  "figma.write_nodes",
  "figma.verify",
  "code.scan_repo",
  "code.read_file",
  "code.write_file",
  "code.search",
  "jobs.create",
  "jobs.list",
  "runs.create",
  "runs.list",
  "artifacts.put",
]);

module.exports = { MCP_TOOLS };
