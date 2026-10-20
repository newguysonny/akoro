// Smoke: the deployed server is up, reports its build, and serves the tools.
export const healthBuild = {
  name: "smoke.health_build", area: "smoke", risk: "read",
  description: "/health answers OK and reports the deployed commit.",
  async run(ctx) {
    const r = await ctx.health();
    ctx.expect.status("health answers 200", r, 200);
    ctx.expect.ok("health reports a build commit", !!r.body?.build?.git, "RENDER_GIT_COMMIT is set on Render");
    ctx.note(`build ${r.body?.build?.git || "unknown"}`);
  },
};

export const toolsCatalogue = {
  name: "smoke.tools_catalogue", area: "smoke", risk: "read",
  description: "The learner tool catalogue loads and contains the core tools.",
  async run(ctx) {
    const { getLearnerChatTools } = await import("../../adaptive-learning/chat.js");
    const names = getLearnerChatTools().map((t) => t.name);
    ctx.expect.gte("tool count", names.length, 40);
    for (const t of ["get_learner_context", "create_task", "schedule_chat_follow_up", "list_chats", "read_chat", "post_to_chat", "search_agents"]) {
      ctx.expect.includes(`catalogue has ${t}`, names, t);
    }
    ctx.expect.eq("no duplicate tool names", names.length, new Set(names).size);
  },
};

// R2 (file storage) from INSIDE the server, with the server's own keys (2026-10-19):
// a presigned PUT from outside worked while every server-side R2 call failed and the
// "r2" breaker was open. This writes, reads and deletes one object directly (no
// breaker), tries the old bucket probe, and says each error — never a secret.
export const r2Live = {
  name: "smoke.r2_live", area: "smoke", risk: "read",
  description: "R2 file storage works from the server with its configured keys: write, read back and delete one object; reports the r2 breaker and any R2 error.",
  async run(ctx) {
    const { default: config } = await import("../../../config/index.js");
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const r2 = config.r2 || {};
    const shape = (v) => (v ? `${String(v).length} chars${/^\s|\s$/.test(String(v)) ? ", has surrounding spaces!" : ""}` : "MISSING");
    ctx.note(`config: enabled ${!!r2.enabled} · bucket ${r2.bucketName || "MISSING"} · account id ${shape(r2.accountId)} · key id ${shape(r2.accessKeyId)} · secret ${shape(r2.secretAccessKey)}`);
    if (!r2.enabled) ctx.expect.blocked("R2 is not configured on this server (R2_ACCESS_KEY_ID / R2_BUCKET_NAME unset)");
    const s3 = new S3Client({ region: "auto", endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } });
    const why = (e) => `${e?.name || "Error"}${e?.$metadata?.httpStatusCode ? ` ${e.$metadata.httpStatusCode}` : ""}: ${String(e?.message || e).slice(0, 200)}`;
    const key = `records/_probe/verify-${Date.now()}`;
    const body = `akoro r2 check ${new Date().toISOString()}`;
    let put = null, got = null, del = null, head = null;
    const t0 = Date.now();
    try { await s3.send(new PutObjectCommand({ Bucket: r2.bucketName, Key: key, Body: body, ContentType: "text/plain" })); put = "ok"; } catch (e) { put = why(e); }
    const putMs = Date.now() - t0;
    if (put === "ok") {
      try { const r = await s3.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: key })); got = (await r.Body.transformToString()) === body ? "ok" : "content differs"; } catch (e) { got = why(e); }
      try { await s3.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key })); del = "ok"; } catch (e) { del = why(e); }
    }
    try { await s3.send(new HeadBucketCommand({ Bucket: r2.bucketName })); head = "ok"; } catch (e) { head = why(e); }
    const { r2Breaker } = await import("../../../lib/r2Breaker.js");
    ctx.note(`put ${put} (${putMs} ms) · get ${got} · delete ${del} · HeadBucket ${head} · r2 breaker ${r2Breaker?.opened ? "OPEN" : r2Breaker?.halfOpen ? "half-open" : "closed"}`);
    ctx.expect.eq("the server can write to R2", put, "ok");
    ctx.expect.eq("…read it back", got, "ok");
    ctx.expect.eq("…and delete it", del, "ok");
  },
};

// Embeddings (2026-10-20): the provider the app uses (OpenAI, or our RunPod
// Qwen3-Embedding-0.6B padded to 1536) answers, and its vectors make sense —
// a sentence is closer to one about the same thing than to an unrelated one.
export const embeddingsLive = {
  name: "smoke.embeddings_live", area: "smoke", risk: "read",
  description: "The embedding provider answers through the app's seam with 1536-wide vectors (self-hosted: 1024 real dims + zeros), and related text scores higher than unrelated text.",
  async run(ctx) {
    const { embeddingsProvider, SELF_HOSTED_DIMENSIONS } = await import("../../../lib/embeddingProvider.js");
    const { openai } = await import("../../../lib/aiModel.js");
    const provider = embeddingsProvider();
    const texts = ["Mitochondria are the sites of aerobic respiration in a cell.", "Which part of the cell releases energy from glucose?", "The Niger Delta has many oil fields and creeks."];
    let res = null, error = null;
    const t0 = Date.now();
    try { res = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts, __payer: "platform", __feature: "embedding_probe" }); } catch (e) { error = String(e?.message || e).slice(0, 240); }
    ctx.note(`provider ${provider} · model ${res?.model || "?"} · ${Date.now() - t0} ms${error ? ` · error: ${error}` : ""}`);
    ctx.expect.ok("the embedding provider answers", !!res && !error, error);
    const v = (res?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    ctx.expect.eq("one vector per text", v.length, 3);
    ctx.expect.ok("1536 wide (the columns)", v.every((x) => x?.length === 1536), v.map((x) => x?.length));
    if (provider === "runpod") ctx.expect.ok("self-hosted: 1024 real dims, zeros after", v.every((x) => x.slice(SELF_HOSTED_DIMENSIONS).every((n) => n === 0) && x.slice(0, SELF_HOSTED_DIMENSIONS).some((n) => n !== 0)));
    const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
    if (v.length === 3) {
      const related = cos(v[0], v[1]), unrelated = cos(v[0], v[2]);
      ctx.note(`cosine: related ${related.toFixed(3)} · unrelated ${unrelated.toFixed(3)}`);
      ctx.expect.ok("related text is closer than unrelated text", related > unrelated, { related, unrelated });
    }
  },
};

// Choosing the self-hosted model (2026-10-20): the fixed test set on every
// deployed model, side by side — the stores are never touched. A report, not
// a verdict on which is better: it fails only when a model can't run or
// finds almost nothing.
export const embeddingsCompare = {
  name: "smoke.embeddings_compare", area: "smoke", risk: "read", timeoutMs: 480000,  // cold endpoints
  description: "Embeds the fixed test set (lib/embeddingEvalSet.js) with each deployed embedding model and reports recall@1, recall@5, MRR, by language, first-call and per-search time. Never touches the stores.",
  async run(ctx) {
    const { compareEmbeddings } = await import("../../../lib/embeddingCompare.js");
    const out = await compareEmbeddings();
    ctx.note(`${out.passages} passages · ${out.queries} questions · ${out.results.length} models`);
    ctx.expect.ok("at least one model to compare", out.results.length > 0, "set RUNPOD_EMBED_ENDPOINT_ID / RUNPOD_EMBED_BGE_ENDPOINT_ID");
    for (const r of out.results) {
      if (r.error) { ctx.note(`${r.key}: error ${r.error}`); ctx.expect.ok(`${r.key} runs`, false, r.error); continue; }
      const lang = Object.entries(r.byLang).map(([l, v]) => `${l} R@1 ${v.recall1}`).join(" · ");
      ctx.note(`${r.key}: R@1 ${r.recall1} · R@5 ${r.recall5} · MRR ${r.mrr} · ${lang} · first call ${r.firstCallMs} ms · per search ${r.searchEmbedMs} ms`);
      for (const m of r.misses.slice(0, 8)) ctx.note(`  ${r.key} miss: "${m.q}" → ${m.got} (wanted ${m.want}, rank ${m.rank})`);
      ctx.expect.ok(`${r.key} finds most answers in its top 5`, r.recall5 >= 0.6, r.recall5);
    }
  },
};

// Search without a vector (2026-10-20): a late or failed query embedding
// (lib/searchEmbedding.js) leaves the search its text half — including the
// curriculum, past-question and syllabus searches, which used to be
// vector-only and answer nothing.
export const searchTextFallback = {
  name: "smoke.search_text_fallback", area: "smoke", risk: "read",
  description: "With no query vector, match_curriculum / match_past_questions / match_syllabus still answer on text (lexical rows), and a question's embedding gives up at its time limit instead of holding the search.",
  async run(ctx) {
    const { default: db } = await import("../../../db.js");
    const { embedForSearch } = await import("../../../lib/searchEmbedding.js");
    const calls = [
      ["match_curriculum", { p_query_embedding: null, p_limit: 5, p_query_text: "photosynthesis in green plants" }],
      ["match_past_questions", { p_query_embedding: null, p_limit: 5, p_query_text: "photosynthesis chlorophyll light" }],
      ["match_syllabus", { p_query_embedding: null, p_match_count: 5, p_query_text: "photosynthesis chlorophyll" }],
    ];
    for (const [fn, args] of calls) {
      const t0 = Date.now();
      const { data, error } = await db.rpc(fn, args);
      const rows = data || [];
      ctx.note(`${fn}: ${error ? `error ${error.message}` : `${rows.length} rows on text`} (${Date.now() - t0} ms)${rows[0] ? ` · first: ${String(rows[0].topic || rows[0].topic_title || rows[0].stem || "").slice(0, 80)}` : ""}`);
      ctx.expect.ok(`${fn} answers without a vector`, !error, error?.message);
      ctx.expect.ok(`${fn} finds text matches`, rows.length > 0, rows.length);
      ctx.expect.ok(`${fn} marks them as text matches`, rows.every((r) => r.lexical === true), rows.map((r) => r.lexical));
    }
    const t0 = Date.now();
    const v = await embedForSearch("photosynthesis", { timeoutMs: 250, create: () => new Promise((r) => setTimeout(() => r({ data: [{ embedding: [1] }] }), 5000)) });
    const waited = Date.now() - t0;
    ctx.note(`a slow embedding: gave up after ${waited} ms`);
    ctx.expect.ok("a slow embedding gives up at its limit", v === null && waited < 1500, { v, waited });
  },
};
