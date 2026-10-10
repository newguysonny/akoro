/**
 * modules/self-study/paperLayout.js — an assignment laid out like an exam
 * paper (reference/question-layout-for-activity: the NCEE papers).
 *
 * The questions stay ONE flat list (answers, marks and the stepper key on
 * the index); the paper layout rides beside them in details:
 *
 *   details.sections  [{ title, instructions }]   "SECTION A — In each of
 *                                                   the questions below…"
 *   details.passages  [{ title, text }]           a comprehension passage
 *                                                   several questions share
 *   question.section  index into sections         (optional)
 *   question.passage  index into passages         (optional)
 *   question.figure   { svg | src, caption }      drawn between the question
 *                                                   text and its options
 *
 * Figures are a small black-line SVG (AI-drawn) or an image the instructor
 * uploaded (a data: URL). Both are shown through <img>, which never runs
 * script; the SVG is also rebuilt from an allow-list here, so what is
 * stored is only shapes and text.
 */

const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "marker", "line", "polyline", "polygon", "rect", "circle", "ellipse", "path", "text", "tspan", "title",
]);
const SVG_ATTRS = new Set([
  "xmlns", "viewbox", "width", "height", "preserveaspectratio",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "dx", "dy", "points", "d",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity",
  "font-size", "font-family", "font-weight", "font-style", "text-anchor", "dominant-baseline", "transform",
  "marker-start", "marker-mid", "marker-end", "id", "refx", "refy", "markerwidth", "markerheight", "orient", "markerunits",
]);
const TEXT_PARENTS = new Set(["text", "tspan", "title"]);

export const LIMITS = Object.freeze({
  svgChars: 20_000,
  imageChars: 400_000,      // a data: URL — ~300 KB of image (the app downsizes uploads)
  figureBudget: 1_500_000,  // every figure on one assignment (the API body cap is 2 MB)
  sections: 12, passages: 8,
  sectionTitle: 120, sectionInstructions: 1200,
  passageTitle: 160, passageText: 8000, caption: 200,
});

const escText = (s) => String(s).replace(/&(?!(?:#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

/** Rebuild an SVG from the allow-list → a string, or null when nothing usable is left. */
export function sanitizeSvg(raw) {
  if (typeof raw !== "string") return null;
  const src = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<![^>]*>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  if (src.length > LIMITS.svgChars * 2) return null;
  const out = [];
  const stack = [];          // open allowed elements
  let skip = 0;              // depth inside a dropped element
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, close, rawName, rawAttrs, text] = m;
    if (text !== undefined) {
      if (!skip && stack.length && TEXT_PARENTS.has(stack[stack.length - 1]) && text.trim()) out.push(escText(text));
      continue;
    }
    const name = rawName.toLowerCase();
    const selfClosing = /\/\s*$/.test(rawAttrs);
    if (close) {
      if (skip) { skip -= 1; continue; }
      if (stack.length && stack[stack.length - 1] === name) { stack.pop(); out.push(`</${name}>`); }
      continue;
    }
    if (skip || !SVG_ELEMENTS.has(name) || (!stack.length && name !== "svg")) {
      if (!selfClosing) skip += 1;
      continue;
    }
    const attrs = [];
    const are = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = are.exec(rawAttrs))) {
      const key = a[1].toLowerCase();
      const value = (a[2] ?? a[3] ?? "").trim();
      if (!SVG_ATTRS.has(key) || value.length > 4000) continue;
      if (/javascript:|data:|expression\(|[<>]/i.test(value)) continue;
      if (/url\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value)) continue;
      const proper = key === "viewbox" ? "viewBox" : key === "preserveaspectratio" ? "preserveAspectRatio"
        : key === "refx" ? "refX" : key === "refy" ? "refY" : key === "markerwidth" ? "markerWidth"
        : key === "markerheight" ? "markerHeight" : key === "markerunits" ? "markerUnits" : key;
      if (name === "svg" && proper === "xmlns") continue;   // set below
      attrs.push(`${proper}="${escAttr(value)}"`);
    }
    if (name === "svg" && !stack.length) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    out.push(`<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}${selfClosing ? "/" : ""}>`);
    if (!selfClosing) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  const svg = out.join("");
  if (!svg.startsWith("<svg") || svg.length > LIMITS.svgChars) return null;
  if (!/<(line|polyline|polygon|rect|circle|ellipse|path|text)\b/.test(svg)) return null;   // nothing drawn
  return svg;
}

const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** One figure → { svg | src, caption? } or null. */
export function cleanFigure(f) {
  if (!f || typeof f !== "object") return null;
  const caption = typeof f.caption === "string" ? f.caption.trim().slice(0, LIMITS.caption) : "";
  if (typeof f.src === "string" && f.src.length <= LIMITS.imageChars && IMAGE_URL.test(f.src)) {
    return { src: f.src, ...(caption ? { caption } : {}) };
  }
  const svg = sanitizeSvg(f.svg);
  return svg ? { svg, ...(caption ? { caption } : {}) } : null;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const indexIn = (v, list) => (Number.isInteger(Number(v)) && v !== null && v !== "" && Number(v) >= 0 && Number(v) < list.length ? Number(v) : null);

/**
 * Clean the paper layout in an assignment's details (create and edit).
 * Unknown keys pass through; sections/passages/figures are bounded and any
 * reference to a section or passage that isn't there is dropped.
 */
export function cleanPaperDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const out = { ...details };
  const sections = (Array.isArray(details.sections) ? details.sections : [])
    .slice(0, LIMITS.sections)
    .map((s) => ({ title: str(s?.title, LIMITS.sectionTitle), instructions: str(s?.instructions, LIMITS.sectionInstructions) }));
  const passages = (Array.isArray(details.passages) ? details.passages : [])
    .slice(0, LIMITS.passages)
    .map((p) => ({ title: str(p?.title, LIMITS.passageTitle), text: str(p?.text, LIMITS.passageText) }));
  if (sections.length) out.sections = sections; else delete out.sections;
  if (passages.length) out.passages = passages; else delete out.passages;
  if (Array.isArray(details.questions)) {
    let budget = LIMITS.figureBudget;
    out.questions = details.questions.map((q) => {
      if (!q || typeof q !== "object") return q;
      const { section, passage, figure, ...rest } = q;
      const s = indexIn(section, sections);
      const p = indexIn(passage, passages);
      let f = cleanFigure(figure);
      if (f) {
        const size = (f.src || f.svg).length;
        if (size > budget) f = null; else budget -= size;
      }
      return { ...rest, ...(s != null ? { section: s } : {}), ...(p != null ? { passage: p } : {}), ...(f ? { figure: f } : {}) };
    });
  }
  return out;
}

/**
 * The paper in reading order: consecutive questions that share a section
 * (and passage) form one block, so a section's instructions and a
 * passage print once, above the questions that use them.
 * → [{ section: {title,instructions}|null, sectionIndex, passage|null, passageIndex, items: [{ q, i }] }]
 */
export function paperBlocks(details) {
  const qs = Array.isArray(details?.questions) ? details.questions : [];
  const sections = Array.isArray(details?.sections) ? details.sections : [];
  const passages = Array.isArray(details?.passages) ? details.passages : [];
  const blocks = [];
  qs.forEach((q, i) => {
    const s = q && typeof q === "object" && Number.isInteger(q.section) && sections[q.section] ? q.section : null;
    const p = q && typeof q === "object" && Number.isInteger(q.passage) && passages[q.passage] ? q.passage : null;
    const last = blocks[blocks.length - 1];
    if (last && last.sectionIndex === s && last.passageIndex === p) { last.items.push({ q, i }); return; }
    blocks.push({
      sectionIndex: s, section: s != null ? sections[s] : null,
      passageIndex: p, passage: p != null ? passages[p] : null,
      // A section's heading prints once — not again for its next passage.
      newSection: s != null && !(last && last.sectionIndex === s),
      items: [{ q, i }],
    });
  });
  return blocks;
}

/** The questions a passage covers, as "Questions 3–7" (1-based). */
export function passageRange(items) {
  const n = items.map((x) => x.i + 1);
  if (!n.length) return "";
  return n.length === 1 ? `Question ${n[0]}` : `Questions ${n[0]}–${n[n.length - 1]}`;
}

/** A figure as PNG bytes for a PDF (null when it can't be drawn). */
export async function figurePng(figure, { width = 900 } = {}) {
  if (!figure) return null;
  try {
    if (figure.src) {
      const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(figure.src);
      if (!m) return null;
      const bytes = Buffer.from(m[2], "base64");
      if (m[1] === "png" || m[1] === "jpeg") return { bytes, type: m[1] };
    }
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const input = figure.src ? Buffer.from(figure.src.split(",")[1], "base64") : Buffer.from(sanitizeSvg(figure.svg) || "");
    if (!input.length) return null;
    const img = await loadImage(input);
    const w0 = img.width || 400, h0 = img.height || 300;
    const scale = Math.min(3, width / w0);
    const c = createCanvas(Math.max(1, Math.round(w0 * scale)), Math.max(1, Math.round(h0 * scale)));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { bytes: c.toBuffer("image/png"), type: "png" };
  } catch {
    return null;
  }
}
