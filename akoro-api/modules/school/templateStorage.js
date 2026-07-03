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

  // Rewrite the main HTML's references (relative to the HTML) to public URLs.
  const resolve = (ref) => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
    return urlByRel[clean] || null;
  };
  let html = main.getData().toString("utf-8");
  html = html.replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
    if (isExternal(ref)) return m;
    const u = resolve(ref);
    return u ? `${attr}="${u}"` : m;
  });
  html = html.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    if (isExternal(ref)) return m;
    const u = resolve(ref);
    return u ? `url(${u})` : m;
  });
  return { html };
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
