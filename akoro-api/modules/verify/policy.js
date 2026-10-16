/**
 * modules/verify/policy.js — what the gate may do, enforced in code.
 *
 * The coding agent's instructions are not the security boundary; this is
 * (plan rule 34). Who may call the gate, which accounts a run may act as,
 * and which risk classes each account allows.
 *
 *   test learners (tester01–50 @demo.akoro.app)  read · dry · write (writes need VERIFY_ALLOW_WRITES)
 *   real users (any other learner)                read · dry only — never a real change (rule 35)
 */
import db from "../../db.js";

export const RISKS = ["read", "dry", "write"];
export const TARGET = ["production", "local", "sandbox"].includes(process.env.VERIFY_TARGET) ? process.env.VERIFY_TARGET : "production";
export const LIMITS = {
  maxConcurrent: Math.max(1, Number(process.env.VERIFY_MAX_CONCURRENT) || 2),
  runTimeoutMs: Math.max(5_000, Number(process.env.VERIFY_RUN_TIMEOUT_MS) || 120_000),
  maxRepeats: 5,
};
export const writesAllowed = () => String(process.env.VERIFY_ALLOW_WRITES || "").toLowerCase() === "true";

/** Same key as the agent console: Authorization: Bearer, x-agent-console-key or ?key=. */
export function guard(req, res, next) {
  const want = process.env.AGENT_CONSOLE_KEY;
  if (!want) return res.status(501).json({ success: false, error: "Verification gate not configured — set AGENT_CONSOLE_KEY on the server." });
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "")?.[1]?.trim();
  const got = req.get("x-agent-console-key") || bearer || req.query.key;
  if (got !== want) return res.status(401).json({ success: false, error: "Bad gate key" });
  next();
}

/** A seeded test learner: username tester01–tester99 AND a @demo.akoro.app email. */
export const isTester = (u) => /^tester\d{2}$/i.test(String(u?.username || "")) && /@demo\.akoro\.app$/i.test(String(u?.email || ""));

export class PolicyError extends Error {
  constructor(message) { super(message); this.name = "PolicyError"; }
}

/** @username, email or id → { id, username, email, role, name, tester }. */
export async function resolveAccount(handle) {
  const s = String(handle || "").trim();
  if (!s) throw new PolicyError("No account given — pass learner: @username, email or id.");
  const cols = "id, full_name, username, email, role, deactivated_at, deleted_at";
  const q = /^[0-9a-f-]{36}$/i.test(s) ? db.from("users").select(cols).eq("id", s)
    : s.includes("@") && !s.startsWith("@") ? db.from("users").select(cols).ilike("email", s)
    : db.from("users").select(cols).ilike("username", s.replace(/^@/, ""));
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`Account lookup failed: ${error.message}`);
  const u = data?.[0];
  if (!u) throw new PolicyError(`No account found for "${s}".`);
  if (u.deactivated_at || u.deleted_at) throw new PolicyError(`${u.username} is deactivated.`);
  return { id: u.id, username: u.username, email: u.email, role: String(u.role || "student"), name: u.full_name || u.username, tester: isTester(u) };
}

/** May a scenario of `risk` act as `account`? Throws PolicyError with the reason. */
export function assertMayActAs(account, risk) {
  if (!RISKS.includes(risk)) throw new PolicyError(`Unknown risk class "${risk}".`);
  if (risk === "write") {
    if (!account.tester) throw new PolicyError(`Real users are read-only to the gate — "${account.username}" can't be used by a write scenario. Use a test learner (tester01–50).`);
    if (!writesAllowed()) throw new PolicyError("Write scenarios are off — set VERIFY_ALLOW_WRITES=true to allow them on test learners.");
  }
}
