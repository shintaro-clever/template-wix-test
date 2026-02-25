// src/jobs/autoRoute.js
function detectInputType(inputs = {}) {
  if (inputs && typeof inputs === "object") {
    if (typeof inputs.file_key === "string" && inputs.file_key.trim()) {
      return { type: "figma_to_code" };
    }
    if (typeof inputs.repo_url === "string" && inputs.repo_url.trim()) {
      return { type: "code_to_figma" };
    }
  }
  return { type: "manual" };
}

module.exports = { detectInputType };
