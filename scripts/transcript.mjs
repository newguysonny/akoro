#!/usr/bin/env node
// Dump a learner's Agent Chat transcripts from the API, as plain text.
// The messages live in chat_sessions / chat_messages and are readable through
// GET /api/adaptive/chat/sessions and /sessions/:id/messages (authenticated as
// that learner) — the same data the app's chat history shows.
//
// Usage:
//   node scripts/transcript.mjs <email> [password]
//   node scripts/transcript.mjs tester01@demo.akoro.app
//
// Env:
//   AKORO_API_URL   default https://akoro-sandbox.onrender.com
//   AKORO_PASSWORD  default Password123!
//   AKORO_SESSION   only this session id

const BASE = (process.env.AKORO_API_URL || "https://akoro-sandbox.onrender.com").replace(/\/+$/, "");
const EMAIL = process.argv[2];
const PASSWORD = process.argv[3] || process.env.AKORO_PASSWORD || "Password123!";
const ONLY = process.env.AKORO_SESSION || null;

if (!EMAIL) {
  console.error("usage: node scripts/transcript.mjs <email> [password]");
  process.exit(1);
}

async function j(method, path, body, token) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${data?.message || data?.error || ""}`.trim());
  return data;
}

const login = await j("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD }).catch((e) => {
  console.error("login failed:", e.message);
  process.exit(1);
});
const token = login?.data?.accessToken;
if (!token) { console.error("no accessToken in login response"); process.exit(1); }

const sessionsResp = await j("GET", "/api/adaptive/chat/sessions", null, token);
const sessions = Array.isArray(sessionsResp) ? sessionsResp : (sessionsResp.data || sessionsResp.sessions || []);
const list = ONLY ? sessions.filter((s) => s.id === ONLY) : sessions;

console.log(`# ${EMAIL} — ${list.length} chat(s) on ${BASE}\n`);

const stamp = (v) => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 16) : "");
const who = (role) => (role === "user" ? "You" : role === "assistant" || role === "agent" ? "Agent" : role);

for (const s of list) {
  const resp = await j("GET", `/api/adaptive/chat/sessions/${s.id}/messages`, null, token);
  const msgs = Array.isArray(resp) ? resp : (resp.data || resp.messages || []);
  console.log(`\n===== ${s.title || "(untitled)"} · ${s.id} · ${stamp(s.last_message_at)} =====`);
  for (const m of msgs) {
    const text = String(m.text ?? m.content ?? "").trim();
    if (!text) continue;
    console.log(`\n[${who(m.role)}] ${stamp(m.created_at)}`);
    console.log(text);
  }
}
