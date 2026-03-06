const crypto = require("crypto");
const { DEFAULT_TENANT } = require("../db");

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

function normalizeTitle(input) {
  return typeof input === "string" ? input.trim() : "";
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

  return { thread_id: threadId, project_id: id, title: normalizedTitle, created_at: now, updated_at: now };
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
         ) AS last_message_at
       FROM project_threads t
       WHERE t.tenant_id = ? AND t.project_id = ?
       ORDER BY t.updated_at DESC`
    )
    .all(DEFAULT_TENANT, id);
  return {
    threads: rows.map((row) => ({
      thread_id: row.thread_id,
      project_id: row.project_id,
      title: row.title,
      updated_at: row.updated_at,
      message_count: Number(row.message_count || 0),
      last_message_at: row.last_message_at || null,
    })),
  };
}

function getThread(db, threadId) {
  const id = normalizeId(threadId);
  if (!id) {
    throw validationError("thread_id is required");
  }
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
      `SELECT id AS message_id, author, body, created_at
       FROM thread_messages
       WHERE tenant_id = ? AND thread_id = ?
       ORDER BY created_at ASC`
    )
    .all(DEFAULT_TENANT, id);
  return {
    thread: {
      thread_id: row.thread_id,
      project_id: row.project_id,
      title: row.title,
      updated_at: row.updated_at,
      messages: messages.map((message) => ({
        message_id: message.message_id,
        author: message.author,
        body: message.body,
        created_at: message.created_at,
      })),
    },
  };
}

function postMessage(db, threadId, payload = {}, actor = null) {
  const id = normalizeId(threadId);
  if (!id) {
    throw validationError("thread_id is required");
  }
  const body = normalizeBody(payload && payload.body);
  if (!body) {
    throw validationError("body is required");
  }
  if (body.length > 4000) {
    throw validationError("body too long");
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
    "INSERT INTO thread_messages(tenant_id,id,thread_id,author,body,created_at) VALUES(?,?,?,?,?,?)"
  ).run(DEFAULT_TENANT, messageId, id, author, body, createdAt);
  db.prepare("UPDATE project_threads SET updated_at = ? WHERE tenant_id = ? AND id = ?").run(
    createdAt,
    DEFAULT_TENANT,
    id
  );
  return { message_id: messageId };
}

module.exports = {
  createThread,
  listThreadsByProject,
  getThread,
  postMessage,
  validationError,
  notFoundError,
};
