/** self-study/routinesCore.js — pure helpers for weekly routines (routines.js). */

/** PURE: the routine a key names among the instructor's — its id, or its title (the agent often sends the title). → routine | null; throws (409) when the title is ambiguous */
export function matchRoutine(list, key) {
  const k = String(key || "").trim();
  if (!k) return null;
  const byId = list.find((r) => r.id === k);
  if (byId) return byId;
  const norm = (t) => String(t || "").trim().toLowerCase().replace(/^["'“”]+|["'“”]+$/g, "");
  const named = list.filter((r) => norm(r.title) === norm(k));
  if (named.length > 1) throw Object.assign(new Error(`${named.length} routines are called "${k}" — which one (its day)?`), { status: 409 });
  return named[0] || null;
}
