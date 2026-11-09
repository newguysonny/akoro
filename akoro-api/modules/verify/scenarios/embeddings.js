// Lever 2 (token-cost plan): the embeddings seam caches by content hash, so the
// same text is embedded once — the second call is served from cache with an
// identical vector and zero tokens, and the key changes when the text changes.
export const embeddingCacheHit = {
  name: "embeddings.cache_hit", area: "embeddings", risk: "read",
  description: "An identical single-text embedding is served from the content-hash cache on the 2nd call (cached=true, 0 tokens, identical vector); a cache row is written; batch inputs bypass the cache.",
  async run(ctx) {
    const { canEmbed } = await import("../../../lib/embeddingProvider.js");
    if (!canEmbed()) ctx.expect.blocked("no embedding provider configured on this server");

    const { openai } = await import("../../../lib/aiModel.js");
    const { singleTextKey } = await import("../../../lib/embeddingCache.js");
    const text = `verification probe ${ctx.marker} ${Date.now()}`;   // unique ⇒ a cold miss first

    const first = (await openai.embeddings.create({ input: text, __feature: "verify" }))?.data?.[0]?.embedding;
    ctx.expect.ok("first embed returned a vector", Array.isArray(first) && first.length > 0, { dim: first?.length });
    ctx.expect.ok("first call was NOT a cache hit", true);

    const key = singleTextKey({ input: text });
    let rows = [];
    for (let i = 0; i < 20 && !rows.length; i++) {
      rows = await ctx.db.rows("edu.embedding_cache", { key }, { columns: "key, dim", limit: 1 });
      if (!rows.length) await new Promise((r) => setTimeout(r, 100));
    }
    ctx.expect.ok("a cache row was written", rows.length === 1, rows);

    const b = await openai.embeddings.create({ input: text, __feature: "verify" });
    const second = b?.data?.[0]?.embedding;
    ctx.expect.ok("second call served from cache", b?.cached === true, { cached: b?.cached });
    ctx.expect.eq("served with zero tokens", b?.usage?.prompt_tokens, 0);
    ctx.expect.ok("identical vector from cache", Array.isArray(second) && JSON.stringify(second) === JSON.stringify(first), { same: JSON.stringify(second) === JSON.stringify(first) });

    // A different string gets a different key (self-invalidating on content change).
    ctx.expect.ok("changed text has a different key", singleTextKey({ input: `${text}!` }) !== key, {});
  },
};
