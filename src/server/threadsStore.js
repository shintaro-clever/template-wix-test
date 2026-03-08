const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db");
const { KINDS, buildPublicId, parsePublicIdFor, isUuid } = require("../id/publicIds");
const { parseRunIdInput, toPublicRunId } = require("../api/runs");

function validationError(message, details = {}) {
  const merged = { failure_code: "validation_error", ...details };
  return {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details: merged,
    failure_code: "validation_error",
  };
}

function notFoundError(message = "thread not found") {
  return {
    status: 404,
    code: "NOT_FOUND",
    message,
    details: { failure_code: "not_found" },
    failure_code: "not_found",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(input) {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeBody(input) {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeRole(input) {
  const role = typeof input === "string" ? input.trim().toLowerCase() : "";
  return role;
}

function normalizeTitle(input) {
  return typeof input === "string" ? input.trim() : "";
}

function summarizeMessage(content, max = 120) {
  const text = normalizeBody(content).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function toPublicThreadId(internalId) {
  return isUuid(internalId) ? buildPublicId(KINDS.thread, internalId) : internalId;
}

function parseThreadIdInput(threadId) {
  const id = normalizeId(threadId);
  if (!id) {
    throw validationError("thread_id is required");
  }
  if (isUuid(id)) {
    return { internalId: id, publicId: toPublicThreadId(id), mode: "legacy_uuid" };
  }
  const parsed = parsePublicIdFor(KINDS.thread, id);
  if (!parsed.ok) {
    throw validationError(parsed.message || "thread_id format is invalid", parsed.details || {});
  }
  return { internalId: parsed.internalId, publicId: parsed.publicId, mode: "public_id" };
}

function createThread(db, projectId, title) {
  const id = normalizeId(projectId);
  if (!id) throw validationError("project_id is required");

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) throw validationError("title is required");
  if (normalizedTitle.length > 100) throw validationError("title too long (max 100)");

  const project = db
    .prepare("SELECT id FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1")
    .get(DEFAULT_TENANT, id);
  if (!project) {
    const err = new Error("project not found");
    err.status = 404; err.code = "NOT_FOUND"; err.failure_code = "not_found";
    err.details = { failure_code: "not_found" };
    throw err;
  }

  const now = nowIso();
  const threadId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO project_threads(tenant_id,id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).run(DEFAULT_TENANT, threadId, id, normalizedTitle, now, now);

  return { thread_id: toPublicThreadId(threadId), project_id: id, title: normalizedTitle, created_at: now, updated_at: now };
}

function listThreadsByProject(db, projectId) {
  const id = normalizeId(projectId);
  if (!id) {
    throw validationError("project_id is required");
  }
  const rows = db
    .prepare(
      `SELECT
         t.id AS thread_id,
         t.project_id AS project_id,
         t.title AS title,
         t.updated_at AS updated_at,
         (
           SELECT COUNT(*)
           FROM thread_messages m
           WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
         ) AS message_count,
         (
           SELECT MAX(m.created_at)
           FROM thread_messages m
           WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
         ) AS last_message_at,
         (
           SELECT COALESCE(NULLIF(m.content, ''), m.body, '')
           FROM thread_messages m
           WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS latest_message_content,
         (
           SELECT COALESCE(NULLIF(m.role, ''), CASE WHEN lower(COALESCE(m.author, ''))='assistant' THEN 'assistant' ELSE 'user' END)
           FROM thread_messages m
           WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS latest_message_role,
         (
           SELECT m.created_at
           FROM thread_messages m
           WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS latest_message_created_at
       FROM project_threads t
       WHERE t.tenant_id = ? AND t.project_id = ?
       ORDER BY t.updated_at DESC`
    )
    .all(DEFAULT_TENANT, id);
  return {
    threads: rows.map((row) => ({
      thread_id: toPublicThreadId(row.thread_id),
      project_id: row.project_id,
      title: row.title,
      updated_at: row.updated_at,
      message_count: Number(row.message_count || 0),
      last_message_at: row.last_message_at || null,
      latest_summary: summarizeMessage(row.latest_message_content),
      latest_message_role: normalizeRole(row.latest_message_role) || null,
      latest_message_created_at: row.latest_message_created_at || null,
    })),
  };
}

function getThread(db, threadId) {
  const parsed = parseThreadIdInput(threadId);
  const id = parsed.internalId;
  const row = db
    .prepare(
      `SELECT id AS thread_id, project_id, title, updated_at
       FROM project_threads
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`
    )
    .get(DEFAULT_TENANT, id);
  if (!row) {
    return null;
  }
  const messages = db
    .prepare(
      `SELECT id AS message_id, author, body, role, content, run_id, created_at
       FROM thread_messages
       WHERE tenant_id = ? AND thread_id = ?
       ORDER BY created_at ASC`
    )
    .all(DEFAULT_TENANT, id);
  return {
    thread: {
      thread_id: toPublicThreadId(row.thread_id),
      project_id: row.project_id,
      title: row.title,
      updated_at: row.updated_at,
      messages: messages.map((message) => ({
        message_id: message.message_id,
        role: normalizeRole(message.role) || (normalizeRole(message.author) === "assistant" ? "assistant" : "user"),
        content: normalizeBody(message.content) || normalizeBody(message.body),
        run_id: isUuid(message.run_id) ? toPublicRunId(message.run_id) : (normalizeBody(message.run_id) || null),
        // backward compatibility for existing UI/tests
        author: message.author,
        body: message.body,
        created_at: message.created_at,
      })),
    },
  };
}

function postMessage(db, threadId, payload = {}, actor = null) {
  const parsed = parseThreadIdInput(threadId);
  const id = parsed.internalId;
  const content = normalizeBody(payload && (payload.content !== undefined ? payload.content : payload.body));
  if (!content) {
    throw validationError("content is required");
  }
  if (content.length > 4000) {
    throw validationError("content too long");
  }
  const roleInput = normalizeRole(payload && payload.role);
  const role = roleInput || "user";
  if (!["user", "assistant"].includes(role)) {
    throw validationError("role is invalid");
  }
  const runIdInput = normalizeBody(payload && payload.run_id);
  let internalRunId = null;
  if (runIdInput) {
    const parsedRunId = parseRunIdInput(runIdInput);
    if (!parsedRunId.ok) {
      throw validationError(parsedRunId.message || "run_id format is invalid", parsedRunId.details || {});
    }
    internalRunId = parsedRunId.internalId;
  }

  const existing = db
    .prepare("SELECT id FROM project_threads WHERE tenant_id = ? AND id = ? LIMIT 1")
    .get(DEFAULT_TENANT, id);
  if (!existing) {
    throw notFoundError("thread not found");
  }

  const createdAt = nowIso();
  const messageId = crypto.randomUUID();
  const author = typeof actor === "string" && actor.trim() ? actor.trim() : "user";
  db.prepare(
    "INSERT INTO thread_messages(tenant_id,id,thread_id,author,body,role,content,run_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
  ).run(DEFAULT_TENANT, messageId, id, author, content, role, content, internalRunId, createdAt);
  db.prepare("UPDATE project_threads SET updated_at = ? WHERE tenant_id = ? AND id = ?").run(
    createdAt,
    DEFAULT_TENANT,
    id
  );
  return { message_id: messageId };
}

function getThreadProjectId(db, threadId) {
  const parsed = parseThreadIdInput(threadId);
  const row = db
    .prepare("SELECT project_id FROM project_threads WHERE tenant_id = ? AND id = ? LIMIT 1")
    .get(DEFAULT_TENANT, parsed.internalId);
  return row ? row.project_id : null;
}

module.exports = {
  createThread,
  listThreadsByProject,
  getThread,
  postMessage,
  getThreadProjectId,
  toPublicThreadId,
  parseThreadIdInput,
  validationError,
  notFoundError,
};
