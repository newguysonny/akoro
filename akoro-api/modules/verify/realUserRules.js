/**
 * modules/verify/realUserRules.js — phase V4's pure rules (no database, no
 * scenarios): when an admin's real-account run is refused, and the notice its
 * owner gets. Used by realUser.js; tested on their own.
 */
export const MAX_PER_ACCOUNT_PER_DAY = 3;

/** May this admin request start? `def` is the scenario. → null or the refusal reason. */
export function refusal({ enabled, account, def, reason, recentForAccount = 0 }) {
  if (!enabled) return "Real-account test runs are off on this server (VERIFY_REAL_USER_WRITES).";
  if (!account) return "No such account.";
  if (account.tester) return "That's a test account — use the normal gate for test accounts.";
  if (!def || def.risk !== "write" || !def.realUserSafe) return "That check isn't approved for real accounts.";
  const roles = def.realUserSafe.roles || ["student"];
  if (!roles.includes(account.role)) return `That check is for ${roles.join(" / ")} accounts, not ${account.role}s.`;
  if (String(reason || "").trim().length < 10) return "Say why (at least 10 characters) — it's kept in the audit log.";
  if (recentForAccount >= MAX_PER_ACCOUNT_PER_DAY) return `This account already had ${MAX_PER_ACCOUNT_PER_DAY} test runs in the last 24 hours.`;
  return null;
}

export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

/** The owner's notice, in plain words (no internal names). */
export function ownerNotice({ name, what, changes, cleanupOk, at }) {
  const when = new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  const tidy = cleanupOk
    ? `It ${changes}. Nothing else on your account was changed.`
    : `It ${changes}, but something it created may still be on your account. Our team has been alerted and will remove it.`;
  return {
    title: "We ran a quick check on your account",
    body: `Hi ${firstName(name)}, on ${when} the Akoro team ran an automatic check of ${what} on your account, to make sure it works properly for you. ${tidy} Questions? Write to support@akoro.app.`,
    sms: `Akoro: we ran a quick check of ${what} on your account (${when}). ${cleanupOk ? "Nothing was left behind." : "Our team will remove anything left behind."} Questions: support@akoro.app`,
  };
}
