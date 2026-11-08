/**
 * richText.js — a tiny, dependency-free markdown-subset parser for chat
 * messages. Pure data in → pure blocks out, so it is unit-testable in node
 * and the React component renders it as elements — there is NO HTML anywhere
 * in this pipeline, so model output can never inject markup.
 *
 * Supported (the subset the agent prompts promise):
 *   ### Heading (up to ####)      **bold**   *italic* / _italic_   `code`
 *   - bullet / * bullet           1. numbered          --- horizontal rule
 *   [label](/app?…) [label](/?…)  an in-app link (only /app paths or the app's
 *                                 own home — anything else stays literal text)
 * Blank lines split paragraphs; a single line break continues the paragraph.
 * Anything unterminated (**ab, `ab) stays literal text.
 */

// [label](/app…) — a link inside the app only; the label is plain text.
// …or the app site's own home: "/" or "/?tab=…" (never "//host").
const LINK = /^\[([^\]\n]{1,120})\]\((\/app(?:[/?#][^\s)]*)?|\/(?:[?#][^\s)]*)?)\)/;

const inline = (text) => {
  const out = [];
  let bold = false, italic = false, code = false, buf = "";
  const flush = () => { if (buf) { out.push({ text: buf, bold, italic, code }); buf = ""; } };

  // A marker only toggles when its closer exists later — unterminated
  // markers stay literal text instead of bolding the rest of the message.
  const hasCloser = (marker, from) => text.includes(marker, from);
  // Single-* / _ italics open only at a word boundary so snake_case_ids
  // survive; the closing side is handled by the hasCloser scan.
  const alnum = (c) => /[A-Za-z0-9]/.test(c);
  const boundaryOK = (i) => i === 0 || !alnum(text[i - 1]);

  // Toggling rules: an OPENING marker needs a later closer; a CLOSING marker
  // (we are inside the span) always closes. Unterminated openers stay literal.
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i);
    const link = !code && rest.startsWith("[") ? rest.match(LINK) : null;
    if (link) {
      flush();
      out.push({ text: link[1], bold, italic, code: false, href: link[2] });
      i += link[0].length - 1;
      continue;
    }
    if (!code && rest.startsWith("**")) {
      if (bold || hasCloser("**", i + 2)) { flush(); bold = !bold; i += 1; }
      else { buf += "**"; i += 1; }   // literal — both stars consumed as text
      continue;
    }
    if (!code && !rest.startsWith("**") && (rest.startsWith("*") || rest.startsWith("_"))) {
      // Single-char marker: the loop's i++ is the whole skip — do NOT add
      // another, or the marker eats the first letter inside the span.
      if (italic || (boundaryOK(i) && hasCloser(text[i], i + 1))) { flush(); italic = !italic; continue; }
    }
    if (rest.startsWith("`")) {
      if (code || hasCloser("`", i + 1)) { flush(); code = !code; }
      else buf += text[i];
      continue;
    }
    buf += text[i];
  }
  flush();
  return out.filter((s) => s.text.length);
};

export function parseRich(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [], list = null;

  const closeList = () => { if (list) { blocks.push(list); list = null; } };
  const closeParagraph = () => { if (paragraph.length) { blocks.push({ type: "p", spans: inline(paragraph.join("\n")) }); paragraph = []; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) { closeList(); closeParagraph(); continue; }
    if (/^(-{3,}|={3,}|\*{3,})$/.test(trimmed)) { closeList(); closeParagraph(); blocks.push({ type: "hr" }); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(); closeParagraph();
      // Chat bubbles only need three visual tiers — map everything deeper to h3.
      const level = Math.min(heading[1].length, 3);
      blocks.push({ type: "h", level, spans: inline(heading[2]) });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) { closeParagraph(); if (!list || list.type !== "ul") { closeList(); list = { type: "ul", items: [] }; } list.items.push(inline(bullet[1])); continue; }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) { closeParagraph(); if (!list || list.type !== "ol") { closeList(); list = { type: "ol", items: [] }; } list.items.push(inline(numbered[1])); continue; }

    closeList();
    paragraph.push(line);
  }
  closeList(); closeParagraph();
  return blocks;
}
