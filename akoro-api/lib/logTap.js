/**
 * lib/logTap.js — the last ~1500 server log lines, in memory.
 *
 * The agent console's "view logs" reads these: what the server printed while
 * a test turn ran (tool calls "[agent-chat] tool x → ok", warnings, errors),
 * without Render dashboard access. Import it first in app.js. Lines are
 * capped in length; the buffer lives only as long as the process.
 */
import { format } from "node:util";

const MAX_LINES = 1500;
const MAX_CHARS = 2000;
const ring = [];
let seq = 0;

if (!globalThis.__akoroLogTap) {
  globalThis.__akoroLogTap = true;
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        ring.push({ seq: ++seq, t: new Date().toISOString(), level: level === "info" ? "log" : level, msg: format(...args).slice(0, MAX_CHARS) });
        if (ring.length > MAX_LINES) ring.splice(0, ring.length - MAX_LINES);
      } catch { /* logging must never throw */ }
      orig(...args);
    };
  }
}

/** Lines after `since` (a seq number), optionally containing `filter`, newest last. */
export function readLogs({ since = 0, filter = "", level = "", limit = 300 } = {}) {
  const f = String(filter || "").toLowerCase();
  const out = ring.filter((l) => l.seq > Number(since || 0)
    && (!f || l.msg.toLowerCase().includes(f))
    && (!level || l.level === level));
  return { lines: out.slice(-Math.min(1000, Math.max(1, Number(limit) || 300))), lastSeq: seq };
}
export const logSeq = () => seq;
