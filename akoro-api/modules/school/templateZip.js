/**
 * templateZip.js — turn an uploaded .zip (a static website: index.html + CSS /
 * JS / images) into ONE self-contained HTML document that the site renderer can
 * store and serve. Referenced local assets are inlined: CSS/JS inline into the
 * document, images/fonts become data: URIs. External (http/https/data) URLs and
 * template {{variables}} are left untouched.
 */
import AdmZip from "adm-zip";

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4", webm: "video/webm",
};
const ext = (p) => (p.split(".").pop() || "").toLowerCase();
const isExternal = (u) => /^(https?:)?\/\//i.test(u) || /^(data|mailto|tel|#|\{\{)/.test(u);
const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function assembleTemplateFromZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new Error("The zip is empty.");

  // Pick the main HTML file: prefer an index.html, else the shallowest .html.
  const htmls = entries.filter((e) => /\.html?$/i.test(e.entryName));
  if (!htmls.length) throw new Error("No .html file found in the zip.");
  const main = htmls.find((e) => /(^|\/)index\.html?$/i.test(e.entryName))
    || htmls.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0];
  const baseDir = dirname(main.entryName);

  // Resolve a referenced path (relative to the HTML) to a zip entry.
  const find = (ref) => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "");
    const tries = [clean, baseDir ? `${baseDir}/${clean}`.replace(/\/+/g, "/") : null].filter(Boolean);
    for (const t of tries) {
      const hit = entries.find((e) => e.entryName === t);
      if (hit) return hit;
    }
    const base = clean.split("/").pop();
    return entries.find((e) => e.entryName.split("/").pop() === base) || null;
  };
  const dataUri = (entry) => {
    const mime = MIME[ext(entry.entryName)] || "application/octet-stream";
    return `data:${mime};base64,${entry.getData().toString("base64")}`;
  };

  // Inline url(...) references inside a CSS string (images/fonts → data URIs).
  const inlineCssUrls = (css) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    if (isExternal(ref)) return m;
    const e = find(ref);
    return e ? `url(${dataUri(e)})` : m;
  });

  let html = main.getData().toString("utf-8");

  // <link rel="stylesheet" href="x.css"> → <style>…</style>
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/stylesheet/i.test(tag) && !/\.css/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m || isExternal(m[1])) return tag;
    const e = find(m[1]);
    if (!e) return tag;
    return `<style>\n${inlineCssUrls(e.getData().toString("utf-8"))}\n</style>`;
  });

  // <script src="x.js"></script> → <script>…</script>
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, ref) => {
    if (isExternal(ref)) return tag;
    const e = find(ref);
    if (!e) return tag;
    return `<script>\n${e.getData().toString("utf-8")}\n</script>`;
  });

  // Remaining src="…" / href="…" pointing at bundled assets → data URIs.
  html = html.replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
    if (isExternal(ref) || /\.html?$/i.test(ref)) return m;
    const e = find(ref);
    if (!e || !MIME[ext(e.entryName)]) return m;
    return `${attr}="${dataUri(e)}"`;
  });

  // Inline-style background:url(...) and any leftover url(...) in the document.
  html = inlineCssUrls(html);

  return { html };
}
