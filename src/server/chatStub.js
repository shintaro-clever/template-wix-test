const { toPublicRunId, markRunRunning, markRunFinished } = require("../api/runs");
const { postMessage } = require("./threadsStore");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveFailureCode(error) {
  const known = normalizeText(error && error.failure_code);
  if (known) return known;
  return "local_stub_error";
}

function buildLocalStubAssistantReply({ content, provider, model }) {
  const safeProvider = normalizeText(provider) || "local_stub";
  const safeModel = normalizeText(model) || "local_stub";
  if (safeModel.toLowerCase().includes("fail")) {
    const err = new Error("local stub forced failure");
    err.failure_code = "local_stub_error";
    throw err;
  }
  const summary = normalizeText(content).slice(0, 200);
  return `[local_stub ${safeProvider}/${safeModel}] ${summary || "ok"}`;
}

function processChatTurnWithLocalStub(db, { runId, threadId, content, actorId = "assistant", aiSetting = null }) {
  const started = markRunRunning(db, runId);
  if (!started) {
    return { status: "failed", failure_code: "run_not_queued", assistant_message_id: null };
  }
  try {
    const provider = normalizeText(aiSetting && aiSetting.provider) || "local_stub";
    const model = normalizeText(aiSetting && aiSetting.model) || "local_stub";
    const assistantContent = buildLocalStubAssistantReply({ content, provider, model });
    const posted = postMessage(
      db,
      threadId,
      { role: "assistant", content: assistantContent, run_id: toPublicRunId(runId) },
      actorId
    );
    markRunFinished(db, runId, { status: "succeeded" });
    return {
      status: "succeeded",
      failure_code: null,
      assistant_message_id: posted.message_id,
    };
  } catch (error) {
    const failureCode = resolveFailureCode(error);
    try {
      markRunFinished(db, runId, { status: "failed", failureCode });
    } catch {
      // Ignore mark failure errors and continue returning failure state.
    }
    return {
      status: "failed",
      failure_code: failureCode,
      assistant_message_id: null,
    };
  }
}

module.exports = {
  processChatTurnWithLocalStub,
};
