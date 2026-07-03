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
  const htmls = entries.filter((e) => /\.html?$/i.test(e.entryName));
  if (!htmls.length) throw new Error("No .html file found in the zip.");
  const main = htmls.find((e) => /(^|\/)index\.html?$/i.test(e.entryName))
    || htmls.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0];

  const baseDir = dirname(main.entryName);
  const rel = (name) => (baseDir && name.startsWith(`${baseDir}/`) ? name.slice(baseDir.length + 1) : name);
  const folder = `templates/${schoolId}/${templateId}`;

  // Upload all files except the main HTML, preserving structure.
  const urlByRel = {};
  for (const e of entries) {
    if (e === main) continue;
    const relPath = rel(e.entryName);
    const dest = `${folder}/${relPath}`;
    const { error } = await db.storage.from(BUCKET).upload(dest, e.getData(), { contentType: mimeOf(relPath), upsert: true });
    if (error) throw new Error(`Upload failed for ${relPath}: ${error.message}`);
    urlByRel[relPath] = db.storage.from(BUCKET).getPublicUrl(dest).data.publicUrl;
  }

  // Rewrite an HTML string's references (relative to the main HTML) to
  // public Storage URLs. Used for the main page AND each sub-page's content.
  const resolve = (ref) => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
    return urlByRel[clean] || null;
  };
  const rewrite = (src) => src
    .replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
      if (isExternal(ref)) return m;
      const u = resolve(ref);
      return u ? `${attr}="${u}"` : m;
    })
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
      if (isExternal(ref)) return m;
      const u = resolve(ref);
      return u ? `url(${u})` : m;
    });

  const rawMain = main.getData().toString("utf-8");
  const html = rewrite(rawMain);

  // ── Builder import payload: one Page per extra .html + the main nav ──────
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const titleOf = (doc, fallback) =>
    strip(doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ||
    strip(doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || fallback;
  const slugOfFile = (relPath) => relPath.replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  // The builder chrome supplies nav + footer, so strip the template's own
  // baked-in ones from imported page content (no double navigation).
  const stripChrome = (body) => body
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  const pageContent = (doc) => {
    // Keep the page's own <style>/<link> styling so it renders faithfully.
    const headBits = [...doc.matchAll(/<style[\s\S]*?<\/style>/gi)].map((m) => m[0])
      .concat([...doc.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)].map((m) => m[0]));
    const body = doc.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || doc;
    return rewrite(`${headBits.join("\n")}\n${stripChrome(body)}`).trim();
  };

  const pages = htmls.filter((e) => e !== main).map((e) => {
    const relPath = rel(e.entryName);
    const doc = e.getData().toString("utf-8");
    return {
      slug: slugOfFile(relPath),
      title: titleOf(doc, slugOfFile(relPath).replace(/-/g, " ")),
      content: pageContent(doc),
    };
  });
  // The main page becomes an editable "home" page (rendered as the landing).
  pages.unshift({ slug: "home", title: titleOf(rawMain, "Home"), content: pageContent(rawMain) });

  // Nav from the RAW main HTML (hrefs still point at *.html files).
  const slugSet = new Set(pages.map((p) => p.slug));
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
