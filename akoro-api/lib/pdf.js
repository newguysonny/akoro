/**
 * lib/pdf.js — the shared PDF primitives behind the app's generated PDFs.
 *
 * A4 page, DejaVu Sans (the dejavu-fonts-ttf package) through fontkit, a Flow
 * writer that wraps text down pages, and the style constants. Module-specific
 * layout (a submission's sections, a battle's questions) stays with its module.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
let FONTS = null;
const fonts = () => (FONTS ||= {
  regular: readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")),
  bold: readFileSync(path.join(FONT_DIR, "DejaVuSans-Bold.ttf")),
});
/** Right-to-left scripts need shaping pdf-lib doesn't do. */
const isRtl = (cp) => (cp >= 0x590 && cp <= 0x8ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

export const A4 = [595.28, 841.89];
export const M = 50;                  // margin
export const INK = rgb(0.11, 0.1, 0.09), MUTED = rgb(0.45, 0.43, 0.41), ACCENT = rgb(0.42, 0.23, 1), RULE = rgb(0.9, 0.89, 0.88);

export const letterOf = (i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Number(i)] ?? "?";
export const fmtDate = (iso) => {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
};

/** A writer that flows wrapped text down A4 pages, adding pages as needed. */
export class Flow {
  constructor(doc, regular, bold, glyphs) {
    Object.assign(this, { doc, regular, bold, glyphs, page: null, y: 0, replaced: 0 });
  }
  newPage() { this.page = this.doc.addPage(A4); this.y = A4[1] - M; return this.page; }
  ensure(h) { if (!this.page || this.y - h < M + 24) this.newPage(); }
  /** Characters the font can't draw become "?" (counted for the note). */
  clean(text) {
    let out = "";
    for (const ch of String(text ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
      const cp = ch.codePointAt(0);
      if (ch === "\n" || this.glyphs(cp)) out += ch;
      else if (cp >= 0x300 && cp <= 0x36f) continue;    // an unsupported combining mark — drop it
      else { out += "?"; this.replaced += 1; }
    }
    return out;
  }
  lines(text, size, font, width) {
    const out = [];
    for (const para of this.clean(text).split("\n")) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const next = line + word;
        if (font.widthOfTextAtSize(next, size) <= width || !line.trim()) {
          // A single word wider than the line is broken by characters.
          if (!line.trim() && font.widthOfTextAtSize(next, size) > width) {
            let chunk = "";
            for (const ch of next) {
              if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) { out.push(chunk); chunk = ""; }
              chunk += ch;
            }
            line = chunk;
          } else line = next;
        } else { out.push(line.trimEnd()); line = word.trimStart(); }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  text(text, { size = 10.5, bold = false, color = INK, indent = 0, gap = 4, lineGap = 1.38 } = {}) {
    const font = bold ? this.bold : this.regular;
    const width = A4[0] - M * 2 - indent;
    for (const l of this.lines(text, size, font, width)) {
      this.ensure(size * lineGap);
      this.y -= size * lineGap;
      if (l) this.page.drawText(l, { x: M + indent, y: this.y, size, font, color });
    }
    this.y -= gap;
  }
  rule(gap = 10) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= gap;
  }
  heading(text) { this.ensure(40); this.y -= 8; this.text(text, { size: 13, bold: true, color: ACCENT, gap: 6 }); }
  /** An embedded image, scaled to fit the column (never upscaled past 1×). */
  image(img, { indent = 0, maxH = 220, gap = 8 } = {}) {
    const maxW = A4[0] - M * 2 - indent;
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * s, h = img.height * s;
    this.ensure(h + gap);
    this.y -= h;
    this.page.drawImage(img, { x: M + indent, y: this.y, width: w, height: h });
    this.y -= gap;
  }
}

/** A new A4 document with the DejaVu fonts embedded and a Flow over it. */
export async function newPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts().regular, { subset: true });
  const bold = await doc.embedFont(fonts().bold, { subset: true });
  const probe = fontkit.create(fonts().regular);
  return { doc, flow: new Flow(doc, regular, bold, (cp) => !isRtl(cp) && probe.hasGlyphForCodePoint(cp)), regular };
}
export const PDF_STYLE = Object.freeze({ A4, M, INK, MUTED, ACCENT, letterOf, fmtDate });
