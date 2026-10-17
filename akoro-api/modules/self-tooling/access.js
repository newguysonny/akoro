/**
 * modules/self-tooling/access.js — who has self-tooling.
 *
 *   AKORO_SELF_TOOLING_ENABLED=true      master switch (default OFF). When on, the seeded
 *                                        test learners (tester01–50 @demo.akoro.app) always have it.
 *   AKORO_SELF_TOOLING_REAL_USERS=true   …and every real learner too.
 *   AKORO_SELF_TOOLING_LEARNERS=@a,b@x   …and these named real accounts (@username or email),
 *                                        to try it on a real account before everyone.
 *
 * Off unless the master switch is on; the extra variables only widen it.
 */
import db from "../../db.js";

const on = (name) => String(process.env[name] || "").toLowerCase() === "true";
export const selfToolingEnabled = () => on("AKORO_SELF_TOOLING_ENABLED");
export const selfToolingRealUsers = () => on("AKORO_SELF_TOOLING_REAL_USERS");
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
