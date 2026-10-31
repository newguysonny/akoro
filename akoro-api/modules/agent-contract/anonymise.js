/**
 * agent-contract/anonymise.js — what a real-traffic episode looks like before
 * it is stored (training/SPEC.md §9). Pure.
 *
 * Typed placeholders replace what identifies a person; free text in tool
 * results keeps only short strings; an episode touching a sensitive topic is
 * dropped entirely (→ null). A second pass re-checks the output and drops the
 * episode if anything identifying is still there. Never stores the mapping.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?234|0)[789][01]\d{8}\b|\+?\d[\d\s().-]{8,}\d/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HANDLE = /(^|[\s(])@[A-Za-z0-9_]{3,40}\b/g;
const LONG_ID = /\b(?:[a-z]+_)?[A-Za-z0-9]{20,}\b/g;
const DOB = /\b(?:born|date of birth|dob)\b[^.\n]{0,40}/gi;

/** Sensitive topics: an episode that touches one is never kept (SPEC §9.3). */
export const SENSITIVE = /\b(?:abuse|abused|self[- ]?harm|suicid\w*|kill myself|pregnan\w*|sexual|rape|depress\w*|anxiety attack|hospital|diagnos\w*|medication|hiv|disabilit\w*|my (?:mum|mom|dad|father|mother|parents?) (?:hit|beat)|bully\w*|safeguard\w*|police|arrest\w*)\b/i;

const RESULT_STRING_CHARS = 160;

/** PURE: one string, with what identifies a person replaced. `names`: known names/usernames/schools for this learner. */
export function scrubText(text, { names = [] } = {}) {
  // Contacts and ids first: a name inside an email would otherwise break the email pattern.
  let out = String(text ?? "").replace(EMAIL, "<EMAIL>").replace(UUID, "<ID>").replace(PHONE, "<PHONE>").replace(HANDLE, "$1<USERNAME>").replace(DOB, "<DOB>").replace(LONG_ID, "<ID>");
  for (const n of names.filter((x) => typeof x === "string" && x.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "<NAME>");
  }
  return out;
}

function scrubValue(value, opts, { inResult = false } = {}) {
  if (typeof value === "string") {
    const s = scrubText(value, opts);
    return inResult && s.length > RESULT_STRING_CHARS ? `${s.slice(0, RESULT_STRING_CHARS)}…` : s;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, opts, { inResult }));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^(?:user_?id|student_?id|learner_?id|email|phone|password|token|secret|api_?key|full_?name|avatar_?url|address)$/i.test(k)) { out[k] = "<REDACTED>"; continue; }
      out[k] = scrubValue(v, opts, { inResult: inResult || k === "result" });
    }
    return out;
  }
  return value;
}

/** PURE: the stored form of a real episode, or null when it must not be kept. */
export function anonymiseEpisode(episode, { names = [] } = {}) {
  if (!episode) return null;
  const all = JSON.stringify([episode.turn_input?.messages, episode.steps]);
  if (SENSITIVE.test(all)) return null;
  const opts = { names };
  const out = {
    ...episode,
    source: "real",
    turn_input: { ...episode.turn_input, system: "<SYSTEM>", messages: scrubValue(episode.turn_input?.messages || [], opts), state: scrubValue(episode.turn_input?.state || {}, opts) },
    steps: scrubValue(episode.steps || [], opts),
    meta: { scenario: null, ms: episode.meta?.ms ?? null, created_at: episode.meta?.created_at ?? null },
  };
  // Second pass: anything identifying left → not kept.
  const left = JSON.stringify([out.turn_input.messages, out.turn_input.state, out.steps]);
  // Fresh patterns: the shared ones are global, and .test() on a global regex carries its position over.
  if (new RegExp(EMAIL.source, "i").test(left) || new RegExp(UUID.source, "i").test(left) || names.some((n) => n && n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(left))) return null;
  return out;
}
