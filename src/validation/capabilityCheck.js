// src/validation/capabilityCheck.js
function validateCapability(ctx = {}, template = {}) {
  const mode = ctx.mode;
  const caps = Array.isArray(ctx.capabilities) ? ctx.capabilities : [];

  const requiredMode = template.required_mode;
  const requiredCaps = Array.isArray(template.required_capabilities)
    ? template.required_capabilities
    : [];

  if (requiredMode && mode !== requiredMode) {
    return { valid: false, failure_code: "mode_mismatch" };
  }

  for (const req of requiredCaps) {
    if (!caps.includes(req)) {
      return { valid: false, failure_code: "capability_missing" };
    }
  }

  return { valid: true };
}

module.exports = { validateCapability };
