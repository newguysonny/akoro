/**
 * documentRenderer.js — turn a document/form template (HTML body + page
 * settings) plus filled values into a print-ready page that looks and prints
 * exactly like the real paper document.
 *
 * Templates use {{variable}} placeholders. Fields are typically dotted-underline
 * spans (class "fill") so a blank form still shows the lines, and a filled one
 * shows the value on the line. Tables / section headers are plain HTML.
 */
function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const fillVars = (html, data) =>
  String(html || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => escapeHtml(data?.[k] ?? ""));

// mm dimensions per page size (portrait).
const PAGE_DIMS = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210], Legal: [215.9, 355.6] };

export function renderDocument({ body, css, pageSize = "A4", orientation = "portrait", data = {} } = {}) {
  const filled = fillVars(body, data);
  const [w, h] = PAGE_DIMS[pageSize] || PAGE_DIMS.A4;
  const [pw, ph] = orientation === "landscape" ? [h, w] : [w, h];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @page { size: ${pageSize} ${orientation}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9e9ee; }
  body { font-family: 'Times New Roman', Georgia, serif; color: #000; font-size: 12pt; line-height: 1.45; }
  .page { width: ${pw}mm; min-height: ${ph}mm; padding: 16mm 14mm; margin: 16px auto; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.18); position: relative; }
  .doc-body table { border-collapse: collapse; width: 100%; }
  .doc-body td, .doc-body th { border: 1px solid #000; padding: 6px 9px; vertical-align: top; }
  .doc-body table.plain td, .doc-body table.plain th { border: none; padding: 2px 6px; }
  .doc-body h1 { font-size: 15pt; text-align: center; margin: 0 0 2px; text-transform: uppercase; letter-spacing: .5px; }
  .doc-body h2 { font-size: 13pt; margin: 16px 0 8px; }
  .doc-body h3 { font-size: 12pt; margin: 12px 0 6px; }
  .doc-body .sub { text-align: center; font-size: 10.5pt; margin: 0 0 12px; }
  .doc-body .fill { display: inline-block; min-width: 140px; border-bottom: 1px dotted #000; padding: 0 4px; }
  .doc-body .row { display: flex; gap: 8px; align-items: baseline; margin: 6px 0; }
  .doc-body .grow { flex: 1; border-bottom: 1px dotted #000; }
  @media print {
    html, body { background: #fff; }
    .page { box-shadow: none; margin: 0; width: auto; min-height: auto; }
  }
  ${css || ""}
</style>
</head>
<body>
  <div class="page"><div class="doc-body">${filled}</div></div>
</body>
</html>`;
}
