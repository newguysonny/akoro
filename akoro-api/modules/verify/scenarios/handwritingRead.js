/**
 * grading.handwriting_read — can hanji (the parse worker on RunPod) read a learner's handwritten answer
 * photo well enough to hand the text to the AI marker? A measurement check, before anything is built on it.
 *
 * Four phone-photo-style handwriting samples (modules/verify/fixtures/handwriting/, with truth.json):
 * neat, fast and messy, small with a crossed-out word, and maths working. Each is sent to hanji as the
 * reader would send it; the check reports per sample:
 *   • word recall — how many of the written words hanji got right (order-free, case-free)
 *   • the time: queue wait + model time, and the first call (a possibly cold worker) apart from the rest
 *   • whether the crossed-out word was left out
 * Bars (params): recall ≥ minRecall on every sample; a warm read within warmSeconds.
 * Nothing is written; RunPod is billed per second of model time.
 */
import { readFile } from "node:fs/promises";

const DIR = new URL("../fixtures/handwriting/", import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Maths written one way and read another counts as the same: × / \times → x, ½ / \frac{1}{2} → 1/2, ² / ^2 → 2.
const norm = (s) => String(s || "").toLowerCase()
  .replace(/\\frac\{(\d+)\}\{(\d+)\}/g, " $1/$2 ").replace(/½/g, " 1/2 ").replace(/\\times|×|\*/g, " x ")
  .replace(/²|\^\{?2\}?/g, "2").replace(/\$/g, " ");
const words = (s) => norm(s).replace(/[^a-z0-9/ ]+/g, " ").split(/\s+/).filter(Boolean);

/** Share of the truth's words found in the read text (each read word used once). */
export function wordRecall(truth, read) {
  const pool = new Map();
  for (const w of words(read)) pool.set(w, (pool.get(w) || 0) + 1);
  const t = words(truth);
  let hit = 0;
  for (const w of t) { const n = pool.get(w) || 0; if (n) { hit++; pool.set(w, n - 1); } }
  return t.length ? hit / t.length : 0;
}

export const handwritingRead = {
  name: "grading.handwriting_read", area: "activities", risk: "read", timeoutMs: 420_000,
  description: "Measurement: hanji reads four handwritten answer photos (neat, fast/messy, crossed-out word, maths working); reports word recall, cold vs warm time and whether a crossed-out word was dropped. Bars: recall ≥ minRecall per sample, a warm read within warmSeconds.",
  params: { minRecall: { default: 0.85 }, warmSeconds: { default: 8 }, maxWaitSeconds: { default: 120 } },
  async run(ctx, p) {
    const lib = await import("../../records/index.js");
    if (!lib.extractEnabled?.() && !(process.env.RUNPOD_API_KEY && process.env.RUNPOD_PARSE_ENDPOINT_ID)) ctx.expect.blocked("hanji (RunPod) isn't configured on this server");
    const health = await lib.runpodEndpointHealth().catch((e) => ({ error: e.message }));
    ctx.note(`RunPod before: ${JSON.stringify(health?.workers || health).slice(0, 200)}`);
    const truth = JSON.parse(await readFile(new URL("truth.json", DIR), "utf8"));
    const results = [];
    let first = true;
    for (const [id, text] of Object.entries(truth)) {
      const b64 = (await readFile(new URL(`${id}.jpg`, DIR))).toString("base64");
      const t0 = Date.now();
      const job = await lib.parsePageRunAsync({ imageBase64: b64, maxNewTokens: 2048 }).catch((e) => ({ error: e.message }));
      if (job.error) { ctx.note(`${id}: not accepted — ${job.error}`); results.push({ id, error: job.error }); continue; }
      let st = null;
      while (Date.now() - t0 < Number(p.maxWaitSeconds) * 1000) {
        st = await lib.getParseJob({ jobId: job.jobId }).catch((e) => ({ status: "POLL_ERROR", error: e.message }));
        if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(st.status)) break;
        await wait(1000);
      }
      const secs = Math.round((Date.now() - t0) / 100) / 10;
      const read = st?.parsed?.markdown || "";
      const recall = Math.round(wordRecall(text, read) * 100) / 100;
      const struck = id.includes("crossed-out") ? (words(read).filter((w) => w === "energy").length > words(text).filter((w) => w === "energy").length ? "kept" : "dropped") : null;
      results.push({ id, secs, modelSecs: st?.wallMs ? Math.round(st.wallMs / 100) / 10 : null, status: st?.status, recall, struck, cold: first });
      ctx.note(`${id}: ${st?.status} in ${secs}s${st?.wallMs ? ` (model ${Math.round(st.wallMs / 100) / 10}s)` : ""}${first ? " [first call]" : ""} · recall ${Math.round(recall * 100)}%${struck ? ` · crossed-out word ${struck}` : ""} · read: "${read.replace(/\s+/g, " ").slice(0, 160)}"`);
      first = false;
    }
    const done = results.filter((r) => r.status === "COMPLETED");
    ctx.expect.ok("every sample was read", done.length === results.length && results.length > 0, results.map((r) => ({ id: r.id, status: r.status || r.error })));
    for (const r of done) ctx.expect.ok(`${r.id}: hanji reads at least ${Math.round(p.minRecall * 100)}% of the words`, r.recall >= Number(p.minRecall), r.recall);
    const warm = done.filter((r) => !r.cold);
    if (warm.length) {
      const slowest = Math.max(...warm.map((r) => r.secs));
      ctx.note(`warm reads: ${warm.map((r) => r.secs).join("s, ")}s · first call ${done.find((r) => r.cold)?.secs ?? "?"}s`);
      ctx.expect.ok(`a warm read takes at most ${p.warmSeconds}s`, slowest <= Number(p.warmSeconds), slowest);
    }
  },
};
