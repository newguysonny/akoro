/**
 * templateStorage.js — host uploaded template zips as REAL files in Supabase
 * Storage (bucket "school-sites"), instead of inlining everything into one
 * HTML string.
 *
 * Every file in the zip is uploaded preserving its relative folder structure
 * under templates/<school_id>/<template_id>/… so that asset-to-asset relative
 * references (e.g. a CSS `url(../img/bg.png)`) keep working. Only the MAIN HTML
 * (stored in the DB and served from the tenant domain) has its references
 * rewritten to absolute public Storage URLs.
 */
import AdmZip from "adm-zip";
import db from "../../db.js";

export const BUCKET = "school-sites";

const MIME = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript",
  html: "text/html", htm: "text/html", json: "application/json",
  xml: "application/xml", txt: "text/plain", map: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", mp4: "video/mp4", webm: "video/webm",
};
const ext = (p) => (p.split(".").pop() || "").toLowerCase();
const mimeOf = (p) => MIME[ext(p)] || "application/octet-stream";
const isExternal = (u) => /^(https?:)?\/\//i.test(u) || /^(data|mailto|tel|#|\{\{)/.test(u);
const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

// Create the bucket once (public). Ignores "already exists".
export async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message || "")) throw new Error(error.message);
}

// Upload a single buffer to the public bucket and return its public URL.
export async function uploadPublicFile(path, buffer, contentType) {
  const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Upload every asset in the zip; return the rewritten main HTML.
export async function uploadZipToStorage(buffer, { schoolId, templateId }) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new Error("The zip is empty.");
  // Zip-bomb guard: cap entry count and total decompressed size.
  if (entries.length > 300) throw new Error("That zip has too many files.");
  const totalBytes = entries.reduce((s, e) => s + (e.header?.size || 0), 0);
  if (totalBytes > 80 * 1024 * 1024) throw new Error("That zip expands too large (80MB limit).");
  const htmls = entries.filter((e) => /\.html?$/i.test(e.entryName));
  if (!htmls.length) throw new Error("No .html file found in the zip.");
  const main = htmls.find((e) => /(^|\/)index\.html?$/i.test(e.entryName))
    || htmls.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0];

  const baseDir = dirname(main.entryName);
  const rel = (name) => (baseDir && name.startsWith(`${baseDir}/`) ? name.slice(baseDir.length + 1) : name);
  const folder = `templates/${schoolId}/${templateId}`;

  // Upload all files except the main HTML, preserving structure.
  const urlByRel = {};
  // Reject any entry that escapes the destination folder (path traversal).
  const safeRel = (p) => p && !p.startsWith("/") && !p.split("/").some((seg) => seg === ".." || seg === "");
  for (const e of entries) {
    if (e === main) continue;
    const relPath = rel(e.entryName);
    if (!safeRel(relPath)) throw new Error(`Unsafe path in zip: ${e.entryName}`);
    const dest = `${folder}/${relPath}`;
    const { error } = await db.storage.from(BUCKET).upload(dest, e.getData(), { contentType: mimeOf(relPath), upsert: true });
    if (error) throw new Error(`Upload failed for ${relPath}: ${error.message}`);
    urlByRel[relPath] = db.storage.from(BUCKET).getPublicUrl(dest).data.publicUrl;
  }

  // Resolve a relative reference to a hosted asset URL. `fromDir` is the
  // referencing file's own directory so sub-page-relative refs (../css/x.css,
  // img/hero.jpg from pages/about.html) resolve correctly too.
  const resolveRef = (ref, fromDir = "") => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
    const stack = [];
    for (const seg of `${fromDir ? `${fromDir}/` : ""}${clean}`.split("/")) {
      if (seg === "..") stack.pop();
      else if (seg && seg !== ".") stack.push(seg);
    }
    return urlByRel[stack.join("/")] || urlByRel[clean] || null;
  };
  const rewrite = (src, fromDir = "") => src
    .replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
      if (isExternal(ref)) return m;
      const u = resolveRef(ref, fromDir);
      return u ? `${attr}="${u}"` : m;
    })
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
      if (isExternal(ref)) return m;
      const u = resolveRef(ref, fromDir);
      return u ? `url(${u})` : m;
    });

  const rawMain = main.getData().toString("utf-8");
  // Template-mode landing: assets → storage URLs (links to sibling .html files
  // resolve to their storage-hosted copies, which keep working relatively).
  const html = rewrite(rawMain);

  // ── Builder import payload ────────────────────────────────────────────────
  // Each .html becomes a Page saved as the FULL original document — scripts,
  // header/nav/footer, styles, everything — so imported pages render and
  // behave (mobile menu & all JS) exactly like the original template. The
  // site renderer serves full documents raw (isFullDocument), so no chrome
  // is layered on top. Only two rewrites are applied:
  //   1. internal .html links → the imported page's /slug (index → /)
  //   2. relative asset refs → hosted storage URLs
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const titleOf = (doc, fallback) =>
    strip(doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ||
    strip(doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || fallback;
  const slugOfFile = (relPath) => relPath.replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const slugSet = new Set(htmls.filter((e) => e !== main).map((e) => slugOfFile(rel(e.entryName))));
  slugSet.add("home");

  // Internal page links → builder slugs. Runs BEFORE the asset rewrite so
  // .html hrefs aren't first swallowed by the storage-URL pass. Keeps
  // ?query/#hash suffixes (e.g. contact.html#map → /contact#map).
  const rewritePageLinks = (doc, fromDir = "") => doc.replace(/\bhref\s*=\s*["']([^"']+)["']/gi, (m, ref) => {
    if (isExternal(ref)) return m;
    const suffixAt = ref.search(/[?#]/);
    const pathPart = suffixAt === -1 ? ref : ref.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? "" : ref.slice(suffixAt);
    if (!/\.html?$/i.test(pathPart)) return m;
    const stack = [];
    for (const seg of `${fromDir ? `${fromDir}/` : ""}${pathPart.replace(/^\.\//, "").replace(/^\//, "")}`.split("/")) {
      if (seg === "..") stack.pop();
      else if (seg && seg !== ".") stack.push(seg);
    }
    const clean = stack.join("/");
    if (/(^|\/)index\.html?$/i.test(clean)) return `href="/${suffix}"`;
    const slug = slugOfFile(clean);
    return slugSet.has(slug) ? `href="/${slug}${suffix}"` : m;
  });
  const fullPageDoc = (doc, fromDir = "") => rewrite(rewritePageLinks(doc, fromDir), fromDir).trim();

  const pages = htmls.filter((e) => e !== main).map((e) => {
    const relPath = rel(e.entryName);
    const doc = e.getData().toString("utf-8");
    return {
      slug: slugOfFile(relPath),
      title: titleOf(doc, slugOfFile(relPath).replace(/-/g, " ")),
      content: fullPageDoc(doc, dirname(relPath)),
    };
  });
  // The main page becomes an editable "home" page (rendered as the landing).
  pages.unshift({ slug: "home", title: titleOf(rawMain, "Home"), content: fullPageDoc(rawMain) });

  // Nav from the RAW main HTML (hrefs still point at *.html files) — imported
  // into the Menus builder so theme-mode pages/footer can reuse it.
  const navHtml = rawMain.match(/<nav[\s\S]*?<\/nav>/i)?.[0] || rawMain.match(/<header[\s\S]*?<\/header>/i)?.[0] || "";
  const menu = [];
  for (const m of navHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, inner] = m;
    const label = strip(inner);
    if (!label) continue;
    if (/^(https?:)?\/\//i.test(href)) { menu.push({ label, url: href }); continue; }
    if (/^(#|mailto|tel)/i.test(href)) continue;
    const clean = href.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
    if (/(^|\/)index\.html?$/i.test(clean) || clean === "") { menu.push({ label, url: "/" }); continue; }
    const slug = slugOfFile(clean);
    if (slugSet.has(slug)) menu.push({ label, slug });
  }

  return { html, importPayload: (pages.length || menu.length) ? { pages, menu } : null };
}

// Best-effort recursive delete of a template's asset folder.
export async function removeTemplateAssets(schoolId, templateId) {
  const root = `templates/${schoolId}/${templateId}`;
  const walk = async (prefix) => {
    const { data: items } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (!items?.length) return;
    const files = items.filter((i) => i.id).map((i) => `${prefix}/${i.name}`);
    if (files.length) await db.storage.from(BUCKET).remove(files);
    for (const f of items.filter((i) => !i.id)) await walk(`${prefix}/${f.name}`);
  };
  try { await walk(root); } catch { /* best-effort */ }
}
