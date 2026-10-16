/**
 * modules/verify/evidence.js — redaction and size caps for everything a run
 * stores (plan rule 37). Real-user runs are minimised harder: results and
 * replies are cut short and personal details are masked.
 */
const SECRET_KEY = /(token|secret|password|authorization|api[_-]?key|cookie|service[_-]?key|hash)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s-]{8,}\d)/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export function redact(value, { realUser = false, depth = 0 } = {}) {
  const maxStr = realUser ? 200 : 1200;
  if (depth > 8) return "[deep]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    let s = value.replace(JWT, "[token]").replace(EMAIL, (m) => (/@demo\.akoro\.app$/i.test(m) ? m : "[email]"));
    if (realUser) s = s.replace(PHONE, "[phone]");
    return s.length > maxStr ? `${s.slice(0, maxStr)}…` : s;
  }
  if (Array.isArray(value)) {
    const cap = realUser ? 10 : 40;
    const out = value.slice(0, cap).map((v) => redact(v, { realUser, depth: depth + 1 }));
    if (value.length > cap) out.push(`…${value.length - cap} more`);
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, { realUser, depth: depth + 1 });
    }
    return out;
  }
  return String(value);
}

/** Cap a whole evidence object to ~maxBytes of JSON (drops the biggest sections first). */
export function capEvidence(evidence, maxBytes = 96_000) {
  let e = evidence;
  const size = () => Buffer.byteLength(JSON.stringify(e));
  if (size() <= maxBytes) return e;
  e = { ...e, logs: (e.logs || []).slice(-60) };
  if (size() <= maxBytes) return e;
  e = { ...e, http: (e.http || []).map((x) => ({ method: x.method, path: x.path, status: x.status, ms: x.ms })) };
  if (size() <= maxBytes) return e;
  return { ...e, agent: (e.agent || []).map((t) => ({ prompt: t.prompt, tools: (t.tools || []).map((x) => x.tool) })), truncated: true };
}
