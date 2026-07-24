/**
 * templateZip.js — turn an uploaded .zip (a static website: index.html + CSS /
 * JS / images) into self-contained HTML the site renderer can store and serve.
 * Local assets are inlined (CSS/JS into the document, images/fonts → data URIs).
 * External URLs and template {{variables}} are left untouched.
 *
 *   assembleTemplateFromZip  → { html }                    (single page: index)
 *   assembleMultiPageFromZip → { html, importPayload }     (every .html → a page
 *                              + a nav menu, inter-page links rewritten to slugs)
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

const slugForEntry = (entryName) => {
  const base = (entryName.split("/").pop() || "").replace(/\.html?$/i, "");
  if (/^index$/i.test(base)) return "home";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
};
const titleOf = (rawHtml, slug) => {
  const m = rawHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = (m && m[1].trim()) || "";
  return t || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

// ── Inline all local assets referenced by ONE html document ───────────────────
function inlinePage(rawHtml, baseDir, entries) {
  const find = (ref) => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "");
    const tries = [clean, baseDir ? `${baseDir}/${clean}`.replace(/\/+/g, "/") : null].filter(Boolean);
    for (const t of tries) { const hit = entries.find((e) => e.entryName === t); if (hit) return hit; }
    const base = clean.split("/").pop();
    return entries.find((e) => e.entryName.split("/").pop() === base) || null;
  };
  const dataUri = (entry) => `data:${MIME[ext(entry.entryName)] || "application/octet-stream"};base64,${entry.getData().toString("base64")}`;
  const inlineCssUrls = (css) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    if (isExternal(ref)) return m; const e = find(ref); return e ? `url(${dataUri(e)})` : m;
  });

  let html = rawHtml;
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/stylesheet/i.test(tag) && !/\.css/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m || isExternal(m[1])) return tag;
    const e = find(m[1]); if (!e) return tag;
    return `<style>\n${inlineCssUrls(e.getData().toString("utf-8"))}\n</style>`;
  });
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, ref) => {
    if (isExternal(ref)) return tag; const e = find(ref); if (!e) return tag;
    return `<script>\n${e.getData().toString("utf-8")}\n</script>`;
  });
  html = html.replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
    if (isExternal(ref) || /\.html?$/i.test(ref)) return m;
    const e = find(ref); if (!e || !MIME[ext(e.entryName)]) return m;
    return `${attr}="${dataUri(e)}"`;
  });
  return inlineCssUrls(html);
}

function readZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new Error("The zip is empty.");
  const htmls = entries.filter((e) => /\.html?$/i.test(e.entryName));
  if (!htmls.length) throw new Error("No .html file found in the zip.");
  const main = htmls.find((e) => /(^|\/)index\.html?$/i.test(e.entryName))
    || htmls.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0];
  return { entries, htmls, main };
}

// Single self-contained page (the index) — unchanged behaviour.
export function assembleTemplateFromZip(buffer) {
  const { entries, main } = readZip(buffer);
  return { html: inlinePage(main.getData().toString("utf-8"), dirname(main.entryName), entries) };
}

// Every .html in the zip → its own page, plus a nav menu, with inter-page links
// rewritten from filenames to builder slugs.
export function assembleMultiPageFromZip(buffer) {
  const { entries, htmls, main } = readZip(buffer);

  // filename (basename) → slug, so links like "about.html" resolve to /about.
  const slugByBase = {};
  for (const e of htmls) slugByBase[(e.entryName.split("/").pop() || "").toLowerCase()] = slugForEntry(e.entryName);

  // Rewrite <a href="x.html"> → href="/slug" (home → "/").
  const rewriteLinks = (html) => html.replace(/\bhref\s*=\s*["']([^"']+)["']/gi, (m, ref) => {
    if (isExternal(ref)) return m;
    const base = ref.split(/[?#]/)[0].split("/").pop().toLowerCase();
    if (!/\.html?$/i.test(base)) return m;
    const slug = slugByBase[base];
    if (!slug) return m;
    return `href="${slug === "home" ? "/" : "/" + slug}"`;
  });

  const pages = htmls.map((e) => {
    const raw = e.getData().toString("utf-8");
    const slug = slugForEntry(e.entryName);
    const content = rewriteLinks(inlinePage(raw, dirname(e.entryName), entries));
    return { slug, title: titleOf(raw, slug), content };
  });
  // Home first, then the rest.
  pages.sort((a, b) => (a.slug === "home" ? -1 : b.slug === "home" ? 1 : 0));

  // Menu: prefer the home page's own nav links; else one item per page.
  const homeRaw = main.getData().toString("utf-8");
  const menu = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = anchorRe.exec(homeRaw))) {
    const base = am[1].split(/[?#]/)[0].split("/").pop().toLowerCase();
    if (!/\.html?$/i.test(base)) continue;
    const slug = slugByBase[base];
    if (!slug || seen.has(slug)) continue;
    const label = am[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    seen.add(slug);
    menu.push({ label, slug });
  }
  if (!menu.length) {
    for (const p of pages) menu.push({ label: p.title, slug: p.slug });
  } else if (!seen.has("home")) {
    menu.unshift({ label: "Home", slug: "home" });
  }

  const home = pages.find((p) => p.slug === "home") || pages[0];
  return { html: home?.content || "", importPayload: { pages, menu } };
}
