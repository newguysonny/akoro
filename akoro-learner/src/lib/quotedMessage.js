/**
 * quotedMessage.js — a reader passage riding a chat message (the copilot
 * pattern: select text → it sits as a quote above the composer → the
 * learner types their question → both are sent).
 *
 * The session socket takes one message string, so the passage travels IN
 * the text, in a fixed shape the tutor reads and the chat parses back into
 * a quote card (live and when a session's history is restored):
 *
 *   Passage (page 3): "the selected words"
 *
 *   the learner's question
 */

export const QUOTE_MAX = 1500;
export const QUOTE_DEFAULT_QUESTION = 'Can you help me understand this passage?';

/** → { text, pageNumber } trimmed and capped, or null. */
export function makeQuote(text, pageNumber = null) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return {
    text: clean.length > QUOTE_MAX ? `${clean.slice(0, QUOTE_MAX)}…` : clean,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null,
  };
}

/** The message the socket receives. No quote → the question unchanged. */
export function withQuote(question, quote) {
  const ask = String(question || '').trim();
  if (!quote?.text) return ask;
  const where = quote.pageNumber ? ` (page ${quote.pageNumber})` : '';
  return `Passage${where}: "${quote.text}"\n\n${ask || QUOTE_DEFAULT_QUESTION}`;
}

const SHAPE = /^Passage(?: \(page (\d+)\))?: "([\s\S]*)"\n\n([\s\S]+)$/;

/** A sent message → { quote, question }; plain text → { quote: null, question: text }. */
export function parseQuoted(text) {
  const raw = String(text ?? '');
  const m = SHAPE.exec(raw);
  if (!m) return { quote: null, question: raw };
  return { quote: { text: m[2], pageNumber: m[1] ? Number(m[1]) : null }, question: m[3] };
}
