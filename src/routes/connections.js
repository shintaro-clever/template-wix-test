const { callFigmaApi } = require("../figma/api");

const PLAN_LIMIT_PATTERNS = [
  /starter/i,
  /plan/i,
  /limit/i,
  /月\s*6/i,
  /6\s*per\s*month/i,
  /monthly/i,
];

function extractStatusCode(error) {
  if (!error) return 0;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  const message = String(error.message || "");
  const match = message.match(/Figma API (\d{3})/);
  return match ? Number(match[1]) : 0;
}

function isPlanLimitMessage(error) {
  const message = String(error && error.message ? error.message : "");
  return PLAN_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

function mapFigmaVerifyError(error) {
  const status = extractStatusCode(error);
  if (status === 429) {
    return { status: 429, failure_code: "rate_limit" };
  }
  if (status === 403 && isPlanLimitMessage(error)) {
    return { status: 403, failure_code: "plan_limit_exceeded" };
  }
  if (status === 404) {
    return { status: 404, failure_code: "not_found" };
  }
  return { status: 500, failure_code: "service_unavailable" };
}

async function verifyFigmaConnection({ token, file_key }) {
  await callFigmaApi({
    token,
    endpoint: `/files/${file_key}`,
  });
  return { ok: true };
}

module.exports = {
  verifyFigmaConnection,
  mapFigmaVerifyError,
  extractStatusCode,
};
