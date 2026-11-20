import db from "../../db.js";
import { safeCompare } from "../../lib/safeCompare.js";

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
export const MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1"];

let chatMod = null;
export const chat = async () => (chatMod ||= await import("../adaptive-learning/index.js"));

export const guard = (req, res, next) => {
  const want = process.env.AGENT_CONSOLE_KEY;
  if (!want) return res.status(501).json({ success: false, error: "Agent console not configured — set AGENT_CONSOLE_KEY on the server." });
  // Bearer too: a cloud environment's network secret can inject
  // "Authorization: Bearer <key>" but not a custom header.
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "")?.[1]?.trim();
  const got = req.get("x-agent-console-key") || bearer || req.query.key;
  if (!safeCompare(got, want)) return res.status(401).json({ success: false, error: "Bad console key" });
  next();
};

export const bad = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

/* The last 50 runs, newest first, kept in memory. */
export const runs = [];
export const keepRun = (r) => { runs.unshift(r); if (runs.length > 50) runs.length = 50; return r; };

/** @username, email or id of a LEARNER (and on the allow-list when one is set). */
export async function resolveLearner(raw) {
  const s = String(raw || "").trim();
  if (!s) throw Object.assign(new Error("Which test learner? Pass learner: @username, email or id."), { status: 400 });
  const cols = "id, full_name, username, email, role";
  const q = /^[0-9a-f-]{36}$/i.test(s) ? db.from("users").select(cols).eq("id", s)
    : s.includes("@") && !s.startsWith("@") ? db.from("users").select(cols).ilike("email", s)
    : db.from("users").select(cols).ilike("username", s.replace(/^@/, ""));
  const { data } = await q.limit(1);
  const u = data?.[0];
  if (!u) throw Object.assign(new Error(`No account found for "${s}".`), { status: 404 });
  if (!["student", "learner"].includes(String(u.role || "").toLowerCase())) {
    throw Object.assign(new Error(`${u.username || u.email} isn't a learner account.`), { status: 400 });
  }
  const allow = String(process.env.AGENT_CONSOLE_LEARNERS || "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (allow.length && !allow.includes(String(u.username || "").toLowerCase()) && !allow.includes(String(u.email || "").toLowerCase())) {
    throw Object.assign(new Error(`${u.username || u.email} isn't on AGENT_CONSOLE_LEARNERS — only listed test learners can be used.`), { status: 403 });
  }
  return { id: u.id, name: u.full_name || u.username, username: u.username, role: u.role };
}

export const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
