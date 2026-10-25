/**
 * modules/self-tooling/access.js — who has self-tooling.
 *
 * ON for everyone by default. The variables only turn it off:
 *   AKORO_SELF_TOOLING_ENABLED=false     master switch off — nobody has it.
 *   AKORO_SELF_TOOLING_REAL_USERS=false  only the seeded test learners (tester01–50
 *                                        @demo.akoro.app) and the named accounts below.
 *   AKORO_SELF_TOOLING_LEARNERS=@a,b@x   named real accounts (@username or email) that keep
 *                                        it while REAL_USERS is false.
 */
import db from "../../db.js";

// On unless set to "false" (or "0"/"off"): self-tooling is a default feature.
const onUnlessOff = (name) => !["false", "0", "off", "no"].includes(String(process.env[name] ?? "").trim().toLowerCase());
export const selfToolingEnabled = () => onUnlessOff("AKORO_SELF_TOOLING_ENABLED");
export const selfToolingRealUsers = () => onUnlessOff("AKORO_SELF_TOOLING_REAL_USERS");
const namedAccounts = () => String(process.env.AKORO_SELF_TOOLING_LEARNERS || "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

/** A seeded test learner: username tester01–tester99 AND a @demo.akoro.app email. */
export const isTestLearner = (u) => /^tester\d{2}$/i.test(String(u?.username || "")) && /@demo\.akoro\.app$/i.test(String(u?.email || ""));

/** Pure decision, for tests: (account, env) → allowed? */
export function decideAccess(user, { enabled, realUsers, named }) {
  if (!enabled || !user) return false;
  if (isTestLearner(user)) return true;
  if (realUsers) return true;
  return named.includes(String(user.username || "").toLowerCase()) || named.includes(String(user.email || "").toLowerCase());
}

const cache = new Map();   // userId → { ok, at }
const TTL_MS = 60_000;

/** Is self-tooling on for this learner? */
export async function selfToolingAllowedFor(userId) {
  if (!selfToolingEnabled() || !userId) return false;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const { data } = await db.from("users").select("username, email").eq("id", userId).maybeSingle();
  const ok = decideAccess(data, { enabled: true, realUsers: selfToolingRealUsers(), named: namedAccounts() });
  cache.set(userId, { ok, at: Date.now() });
  return ok;
}
