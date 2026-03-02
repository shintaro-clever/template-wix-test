function defaultEnglishMessage(code, fallback = "request failed") {
  const map = {
    VALIDATION_ERROR: "validation failed",
    NOT_FOUND: "not found",
    SERVICE_UNAVAILABLE: "service unavailable",
    UNAUTHORIZED: "unauthorized",
    FORBIDDEN: "forbidden",
    INTERNAL_ERROR: "internal error",
  };
  if (code && map[code]) {
    return map[code];
  }
  return fallback;
}

function buildErrorBody({ code, message, message_en, details } = {}) {
  const normalizedMessage = typeof message === "string" && message.trim() ? message : "request failed";
  const normalizedDetails =
    details && typeof details === "object" ? { ...details } : {};
  if (code && !normalizedDetails.code) {
    normalizedDetails.code = code;
  }
  return {
    message: normalizedMessage,
    message_en:
      typeof message_en === "string" && message_en.trim()
        ? message_en
        : defaultEnglishMessage(code, normalizedMessage),
    details: normalizedDetails,
  };
}

module.exports = {
  buildErrorBody,
  defaultEnglishMessage,
};
