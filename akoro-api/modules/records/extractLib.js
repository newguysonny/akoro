/**
 * modules/records/extractLib.js — the record extraction pipeline.
 *
 * Turns rendered document pages into reading-order markdown using the
 * hanji-parse-4b worker deployed on RunPod Serverless (runpod-worker/ in
 * the repo root). The worker is prompt-coupled: it owns the exact
 * production prompt the checkpoint was fine-tuned on and answers with
 * layout blocks — [{bbox_2d:[x1,y1,x2,y2] (0-1000), text_content}] —
 * with tables as GFM markdown and "<image>" sentinels for figures. This
 * lib only carries images to the endpoint and shapes the answers.
 *
 * Pages are rasterized CLIENT-side (the reader already renders PDFs and
 * images), so this side never needs a PDF renderer: the learner's browser
 * sends ≤8 JPEG pages per request, each page runs one /runsync call, and
 * results land in edu.content_parses — keyed by the STORAGE FILE KEY, not
 * the record or the user. A learner's own upload has a user-scoped key
 * (privacy inherits); a SHARED file (the discovery feed) has one key, so
 * it is parsed ONCE and every later opener reads the same rows for free.
 * content_jobs is the single-flight claim: concurrent first-openers don't
 * double-spend — the loser polls instead of running.
 *
 * Everything here runs without auth context; the routes own ownership
 * checks, caps and the enabled-501 contract.
 *
 * The db client is imported lazily inside the persistence helpers (the
 * uploader.js pattern) so the pure shaping helpers stay importable by
 * tests without Supabase env.
 */
/* The db client loads lazily inside the persistence helpers (uploader.js
   pattern) — the pure helpers above stay importable without Supabase env. */
const dbLazy = async () => (await import("../../db.js")).default;

/* ── The single-flight claim (edu.content_jobs) ───────────────────────────
   A runner CLAIMS (content_key, lane) before spending anything: another
   LIVE claim loses (poll instead), a finished/failed/stale claim is
   re-claimable (refresh / crashed worker). */
const CLAIM_STALE_MINUTES = 10;

export async function claimContentJob(contentKey, lane, userId) {
  const db = await dbLazy();
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - CLAIM_STALE_MINUTES * 60000).toISOString();
  const patch = { status: "running", started_by: userId, started_at: nowIso, updated_at: nowIso, result: null };
  // Flip an existing finished/failed/stale row — only if it isn't a live claim.
  const { data: flipped } = await db.schema("edu").from("content_jobs")
    .update(patch).eq("content_key", contentKey).eq("lane", lane)
    .or(`status.neq.running,updated_at.lt.${staleIso}`)
    .select("content_key");
  if (flipped?.length) return true;
  // No row to flip — claim it outright.
  const { error: insErr } = await db.schema("edu").from("content_jobs")
    .insert({ content_key: contentKey, lane, ...patch });
  if (!insErr) return true;
  // A row appeared under us: only win if it isn't a live claim.
  const { data: row } = await db.schema("edu").from("content_jobs")
    .select("status, updated_at").eq("content_key", contentKey).eq("lane", lane).maybeSingle();
  if (row && (row.status !== "running" || row.updated_at <= staleIso)) {
    const { data: again } = await db.schema("edu").from("content_jobs")
      .update(patch).eq("content_key", contentKey).eq("lane", lane)
      .or(`status.neq.running,updated_at.lt.${staleIso}`)
      .select("content_key");
    return !!again?.length;
  }
  return false;
}

export async function finishContentJob(contentKey, lane, status, result = null) {
  const db = await dbLazy();
  const { error } = await db.schema("edu").from("content_jobs")
    .update({ status, result, updated_at: new Date().toISOString() })
    .eq("content_key", contentKey).eq("lane", lane);
  if (error) throw error;
}

export async function getContentJob(contentKey, lane) {
  const db = await dbLazy();
  const { data } = await db.schema("edu").from("content_jobs")
    .select("status, started_at, updated_at, result")
    .eq("content_key", contentKey).eq("lane", lane).maybeSingle();
  return data || null;
}

const RUNPOD_API     = "https://api.runpod.ai";
const RUNSYNC_TIMEOUT_MS = 150_000;   // one 4B-model page ≈ seconds; queue spikes happen

export const MAX_PAGES_PER_REQUEST = 8;
export const MAX_RECORD_PAGES      = 60;    // a 60-page scan is ~15 batched requests
export const MAX_IMAGE_B64_CHARS   = 8 * 1024 * 1024;   // ≈ 6 MB JPEG after base64

export const recordsExtractionEnabled = () =>
  !!process.env.RUNPOD_API_KEY && !!process.env.RUNPOD_PARSE_ENDPOINT_ID;

/* ── Model-output shaping (pure — exported for the contract test) ─────── */

const IMAGE_SENTINEL     = "<image>";
const HANDWRITING_MARKER = "<hw>";

/** Tolerant parse of the model's JSON array out of a raw completion —
 *  survives code fences and stray prose. Prefer the worker's own
 *  `blocks`; this is the fallback for older worker images. */
export function parseBlocks(raw) {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let items;
  try { items = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const blocks = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const bbox = Array.isArray(it.bbox_2d) ? it.bbox_2d : it.bbox;
    const content = it.text_content ?? it.text;
    if (!Array.isArray(bbox) || bbox.length !== 4 || content == null) continue;
    const nums = bbox.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    blocks.push({ bbox_2d: nums, text_content: String(content) });
  }
  return sortBlocks(blocks);
}

/** Reading order: top-to-bottom, then left-to-right (0-1000 space). */
export const sortBlocks = (blocks) => [...blocks].sort((a, b) =>
  (a.bbox_2d[1] - b.bbox_2d[1]) || (a.bbox_2d[0] - b.bbox_2d[0]));

/** Blocks → one page's markdown. Handwritten-value markers are stripped
 *  (the value stays), figure sentinels become a visible placeholder. */
export function blocksToMarkdown(blocks) {
  const lines = [];
  for (const b of sortBlocks(Array.isArray(blocks) ? blocks : [])) {
    let text = String(b?.text_content ?? "")
      .replace(/<\/?hw>/g, "")          // handwriting marker (open or close form)
      .trim();
    if (!text) continue;
    if (text === IMAGE_SENTINEL) { lines.push("*[figure]*"); continue; }
    lines.push(text);
  }
  return lines.join("\n\n");
}

/* ── The RunPod call ───────────────────────────────────────────────────── */

/**
 * parsePageOnRunpod — one rendered page → { blocks, markdown, model }.
 * `fetchImpl` overrides fetch (the contract test's mock); everything else
 * comes from env. Throws with the endpoint's message on any failure —
 * the route turns that into a per-request error the reader shows.
 */
export async function parsePageOnRunpod({ imageBase64, maxNewTokens = 8192, fetchImpl = null } = {}) {
  const apiKey     = process.env.RUNPOD_API_KEY;
  const endpointId = process.env.RUNPOD_PARSE_ENDPOINT_ID;
  if (!apiKey || !endpointId) throw new Error("Extraction is not configured (RUNPOD_API_KEY / RUNPOD_PARSE_ENDPOINT_ID)");

  const fx = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNSYNC_TIMEOUT_MS);
  let payload;
  try {
    const res = await fx(`${RUNPOD_API}/v2/${endpointId}/runsync`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: { image_b64: imageBase64, max_new_tokens: maxNewTokens } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`RunPod HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    payload = await res.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("The parse worker took too long — try fewer pages at once");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (payload?.status && payload.status !== "COMPLETED") {
    throw new Error(`Parse job ${payload.status}${payload?.error ? `: ${payload.error}` : ""}`);
  }
  const out = payload?.output;
  if (!out || out.error) throw new Error(out?.error || "The parse worker returned no output");

  const blocks = (Array.isArray(out.blocks) && out.blocks.length ? out.blocks : parseBlocks(out.raw))
    .map((b) => ({
      bbox_2d: (Array.isArray(b?.bbox_2d) ? b.bbox_2d : []).slice(0, 4).map(Number),
      text_content: String(b?.text_content ?? ""),
    }))
    .filter((b) => b.bbox_2d.length === 4 && b.bbox_2d.every(Number.isFinite));
  return { blocks, markdown: blocksToMarkdown(blocks), model: out.model || null };
}

/* ── Persistence ───────────────────────────────────────────────────────── */

/** Upsert one parsed page into the SHARED per-file cache. */
export async function saveExtractionPage({ contentKey, pageNumber, blocks, markdown, model }) {
  const db = await dbLazy();
  const { data, error } = await db.schema("edu")
    .from("content_parses")
    .upsert(
      { content_key: contentKey, page_number: pageNumber, blocks: JSON.stringify(blocks), markdown, model },
      { onConflict: "content_key,page_number" },
    )
    .select("page_number, markdown, model, updated_at")
    .single();
  if (error) throw error;
  return { ...data, blocks: JSON.parse(data.blocks || "[]") };
}

/** The cached extraction for a FILE (any opener's money already spent). */
export async function getExtraction(contentKey) {
  const db = await dbLazy();
  const { data, error } = await db.schema("edu")
    .from("content_parses")
    .select("page_number, markdown, blocks, model, updated_at")
    .eq("content_key", contentKey)
    .order("page_number");
  if (error) throw error;
  const pages = (data || []).map((row) => ({
    pageNumber: row.page_number,
    markdown: row.markdown || "",
    blocks: typeof row.blocks === "string" ? JSON.parse(row.blocks || "[]") : (row.blocks || []),
    model: row.model,
    updatedAt: row.updated_at,
  }));
  return {
    pages,
    markdown: pages.map((p) => p.markdown).filter(Boolean).join("\n\n"),
    model: pages[0]?.model || null,
    updatedAt: pages[pages.length - 1]?.updatedAt || null,
  };
}
