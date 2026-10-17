/**
 * Pure validation for learner-submitted Agent Chat tool/integration requests.
 *
 * The agent sends a concise, privacy-minimised capability request—not the raw
 * chat prompt. Keeping this dependency-free lets the contract be tested without
 * booting the database-backed API.
 */
export const TOOL_REQUEST_CATEGORIES = new Set([
  "study_support",
  "organisation",
  "integration",
  "accessibility",
  "other",
]);

export const TOOL_REQUEST_STATUSES = new Set([
  "new",
  "under_review",
  "planned",
  "approved",
  "declined",
  "implemented",
  "expired",
]);

/** Set only by the capability decision flow (a grant + resume), never by a plain status edit. */
export const DECISION_ONLY_STATUSES = new Set(["approved", "expired"]);

export function boundedText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/[\r\n\x00]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

/**
 * Validate the learner-approved product request that may be stored for admins.
 * No transcript, attachment, account detail, or unbounded model output belongs
 * in this record.
 */
function containsSensitiveDetail(value) {
  const text = String(value || "");
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /(?:\+?\d[\s().-]?){8,}\d/.test(text)
    || /\b(?:password|passcode|api[ _-]?key|access[ _-]?token|bearer[ _-]?token|secret)\b/i.test(text);
}

export function normaliseToolRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("A tool request is required");
  }
  const allowed = new Set(["title", "description", "category"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new Error("tool request contains unexpected data");
  }
  const title = boundedText(body.title, 120);
  const description = boundedText(body.description, 800);
  const category = boundedText(body.category, 40).toLowerCase();
  if (title.length < 6 || title.length > 120) {
    throw new Error("title must be 6 to 120 characters");
  }
  if (description.length < 20 || description.length > 800) {
    throw new Error("description must be 20 to 800 characters");
  }
  if (!TOOL_REQUEST_CATEGORIES.has(category)) {
    throw new Error("category is invalid");
  }
  if (containsSensitiveDetail(`${title}\n${description}`)) {
    throw new Error("Remove contact details, passwords, tokens, and other secrets before submitting a tool request");
  }
  return { title, description, category };
}

/** Only an admin may move a request through this deliberately small workflow. */
export function normaliseToolRequestUpdate(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("An update is required");
  }
  const allowed = new Set(["status", "adminNote"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new Error("tool request update contains unexpected data");
  }
  const update = {};
  if (Object.hasOwn(body, "status")) {
    const status = boundedText(body.status, 40).toLowerCase();
    if (!TOOL_REQUEST_STATUSES.has(status)) throw new Error("status is invalid");
    update.status = status;
  }
  if (Object.hasOwn(body, "adminNote")) {
    if (typeof body.adminNote !== "string") throw new Error("adminNote is invalid");
    update.admin_note = boundedText(body.adminNote, 1_000) || null;
  }
  if (!Object.keys(update).length) throw new Error("status or adminNote is required");
  return update;
}
