/**
 * lib/codes.js — voucher code generation.
 * Self-contained: crypto only, no imports from elsewhere in Akoro.
 */
import { randomBytes } from "crypto";

// Excludes visually-ambiguous characters (0/O, 1/I/L) — codes are read aloud
// and typed by hand over WhatsApp, so every character must be unambiguous.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomSegment(len) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Generate one voucher code: XXXX-XXXX-XXXX (12 chars, ~62 bits entropy). */
export function generateCode() {
  return [randomSegment(4), randomSegment(4), randomSegment(4)].join("-");
}

/** Generate `n` unique codes (collision-checked against a provided set). */
export function generateCodes(n, existing = new Set()) {
  const out = [];
  while (out.length < n) {
    const c = generateCode();
    if (existing.has(c)) continue;   // astronomically rare, but never trust it
    existing.add(c);
    out.push(c);
  }
  return out;
}
