/**
 * modules/records/linkSnapshot.js — a saved link becomes readable.
 *
 * The server fetches the page (SSRF-guarded), extracts its main text and
 * metadata, stores the text on the record and indexes it, so the shared reader,
 * Generate tools, Ask and search treat a link like a pasted document. Failure
 * is honest and non-destructive: the record stays a bookmark with link_status
 * 'failed' and a short reason.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { indexRecord } from "./searchLib.js";

const dbLazy = async () => (await import("../../db.js")).default;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_TEXT = 180_000;
const UA = "AkoroLinkReader/1.0 (+https://akoro.ng)";

const IPV4_PRIVATE = [
  [/^0\./, "this network"], [/^10\./, "private"],
  [/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, "carrier NAT"],
  [/^127\./, "loopback"], [/^169\.254\./, "link-local"],
  [/^172\.(1[6-9]|2\d|3[01])\./, "private"], [/^192\.0\.0\./, "protocol"],
  [/^192\.168\./, "private"], [/^198\.(1[89])\./, "benchmark"],
  [/^(22[4-9]|23\d|24\d|25[0-5])\./, "multicast/reserved"],
];

export function privateAddress(ip) {
  const v = String(ip || "").toLowerCase();
  if (net.isIPv4(v)) {
    const hit = IPV4_PRIVATE.find(([re]) => re.test(v));
    return hit ? hit[1] : null;
  }
  if (!net.isIPv6(v)) return "invalid address";
  if (v === "::1" || v === "::") return "loopback";
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return "link-local";
  if (v.startsWith("fc") || v.startsWith("fd")) return "private";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return privateAddress(mapped[1]);
  return null;
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("That link is not a valid URL."); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) links can be read.");
  if (url.username || url.password) throw new Error("Links with credentials are not supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That address is not public.");
  }
  const literal = privateAddress(host);
  if (literal) throw new Error("That address is not public.");
  let addresses = [];
  try { addresses = await dns.lookup(host, { all: true }); }
  catch { throw new Error("That site could not be reached."); }
  if (!addresses.length) throw new Error("That site could not be reached.");
  for (const a of addresses) {
    const bad = privateAddress(a.address);
    if (bad) throw new Error("That address is not public.");
  }
  return url;
}

async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("That page is too large to read.");
    return buf.toString("utf8");
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new Error("That page is too large to read."); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchPage(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual", signal: ctrl.signal, credentials: "omit",
        headers: { "User-Agent": UA, Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      });
    } catch {
      clearTimeout(timer);
      throw new Error("That site did not respond in time.");
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("That link redirected somewhere unreadable.");
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`That site answered ${res.status}.`);
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    if (!/^text\/(html|plain)/.test(type)) throw new Error("That link is not a readable web page.");
    const body = await readCapped(res);
    return { url: url.toString(), type, body };
  }
  throw new Error("That link redirects too many times.");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
const decode = (s) => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const meta = (html, name) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i");
  return decode((re.exec(html) || alt.exec(html) || [])[1] || "").trim();
};

export function extractReadable(html, baseUrl) {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "";
  const title = (meta(html, "og:title") || meta(html, "twitter:title") || decode(titleTag)).replace(/\s+/g, " ").trim();
  const description = meta(html, "og:description") || meta(html, "description");
  let image = meta(html, "og:image") || meta(html, "twitter:image");
  if (image) { try { image = new URL(image, baseUrl).toString(); } catch { image = ""; } }
  let body = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|canvas|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body)?.[1]
    || /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body)?.[1]
    || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(body)?.[1]
    || body;
  const text = decode(main
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/section|\/article|\/blockquote|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  return { title, description, image, text };
}

async function updateRecord(id, patch) {
  const db = await dbLazy();
  const { data, error } = await db.schema("edu").from("records").update(patch).eq("id", id)
    .select("id, user_id, kind, name, mime, file_key, content, link_status, link_title, link_description, link_image, link_error").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Fetch, extract, store and index one saved link. Never throws to the caller. */
export async function snapshotLinkRecord(record) {
  if (!record?.id || record.kind !== "link" || !record.url) return null;
  let host = record.url;
  try { host = new URL(record.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  try {
    const page = await fetchPage(record.url);
    const { title, description, image, text } = page.type.startsWith("text/plain")
      ? { title: host, description: "", image: "", text: decode(page.body).slice(0, MAX_TEXT) }
      : extractReadable(page.body, page.url);
    if (!text || text.length < 40) throw new Error("That page had no readable text.");
    const name = !record.name || record.name === host || record.name === record.url ? (title || host).slice(0, 255) : record.name;
    const updated = await updateRecord(record.id, {
      content: text, name,
      link_status: "ready", link_title: title || name, link_description: description || null,
      link_image: image || null, link_error: null, link_fetched_at: new Date().toISOString(),
    });
    if (updated) {
      void indexRecord({ userId: updated.user_id, recordId: updated.id, name: updated.name, pasteText: text, bill: false, sourceType: "link", docAt: updated.link_fetched_at })
        .catch(() => {});
    }
    return updated;
  } catch (err) {
    const reason = String(err?.message || err).slice(0, 200);
    await updateRecord(record.id, { link_status: "failed", link_error: reason, link_fetched_at: new Date().toISOString() }).catch(() => {});
    return null;
  }
}
