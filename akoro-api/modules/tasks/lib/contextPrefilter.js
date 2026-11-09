/**
 * modules/tasks/lib/contextPrefilter.js — Lever 3 of the token-cost plan
 * (akoro-token-cost-optimization…md): the "analyze_logs.py" pattern.
 *
 * The task context used to hand the model every attached file's FULL OCR text.
 * One 40-page upload is ~60k tokens dumped into a prompt that needs a few
 * hundred. This is the deterministic pre-filter that runs in code, before the
 * model sees anything:
 *   · drop empty files,
 *   · dedup OCR that is identical up to whitespace (the same photo uploaded twice),
 *   · cap each file, then cap the whole set, with an explicit truncation marker.
 *
 * PURE: no database, no clock, no randomness — so it is byte-for-byte testable
 * and its output for a given input never drifts. On ordinary small inputs it is
 * a no-op (the prompt is unchanged); it only bites when there is redundancy or
 * an oversized upload.
 */

export const DEFAULT_FILE_CHARS = 12_000;   // ~3k tokens per file
export const DEFAULT_TOTAL_CHARS = 40_000;  // ~10k tokens across all files

const normalize = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * preFilterFileTexts(fileTexts, { perFileChars, totalChars })
 *   fileTexts: [{ fileName, fileType, text, ... }]
 * → { fileTexts: [...kept, truncated...], stats: {…} }
 */
export function preFilterFileTexts(fileTexts = [], { perFileChars = DEFAULT_FILE_CHARS, totalChars = DEFAULT_TOTAL_CHARS } = {}) {
  const perFile = Math.max(1, Math.floor(perFileChars));
  const total = Math.max(perFile, Math.floor(totalChars));
  const stats = { filesIn: fileTexts.length, filesKept: 0, deduped: 0, truncated: 0, droppedTotal: 0, charsIn: 0, charsOut: 0 };

  const seen = new Set();
  const out = [];
  let used = 0;

  for (const f of fileTexts) {
    const text = String(f?.text ?? "");
    stats.charsIn += text.length;
    if (!text.trim()) continue;                              // empty
    const norm = normalize(text);
    if (seen.has(norm)) { stats.deduped++; continue; }       // identical up to whitespace
    seen.add(norm);

    const remaining = total - used;
    if (remaining <= 0) { stats.droppedTotal++; continue; }  // over the set budget

    const cap = Math.min(perFile, remaining);
    const body = text.length > cap ? text.slice(0, cap) : text;
    const cut = text.length > cap;
    if (cut) stats.truncated++;
    out.push(cut ? { ...f, text: `${body}\n…[truncated ${text.length - body.length} chars to fit context]` } : { ...f, text: body });
    used += body.length;
    stats.filesKept++;
  }

  stats.charsOut = out.reduce((n, f) => n + f.text.length, 0);
  return { fileTexts: out, stats };
}
