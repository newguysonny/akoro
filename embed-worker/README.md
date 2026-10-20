# RunPod worker — text embeddings (`Qwen/Qwen3-Embedding-0.6B` or `BAAI/bge-m3`)

Akoro's embeddings, self-hosted. The API's one embedding seam
(`akoro-api/lib/aiModel.js` → `lib/embeddingProvider.js`) calls this worker
when `EMBEDDINGS_PROVIDER=runpod`, asks for **1024** dims and pads them with
zeros to the database's **1536** columns — zeros change neither dot products
nor norms, so cosine similarity is the model's own.

**One image, one endpoint per model.** `EMBED_MODEL_ID` on the endpoint's
template says which model it runs; each model gets what its card prescribes:

| Model | Pooling | Padding | Dims | Query instruction |
|---|---|---|---|---|
| Qwen3-Embedding-0.6B | last token | left | 32–1024 (MRL) | optional |
| bge-m3 | CLS | right | 1024 only | none (ignored) |

| File | Purpose |
|---|---|
| `handler.py` | Lazy model load (first job, RunPod cache, offline), pooling per model, L2-normalised, batched |
| `embedcore.py` | Pure: model profiles, input checks, batching (unit-tested without torch) |
| `Dockerfile` | Lean image, no weights inside; built from the repo root |
| `test/` | Contract tests (`node --test embed-worker/test/*.test.mjs`) |

## Deploy
`.github/workflows/deploy-embed-worker.yml` — same pattern as the hanji parse
worker, on changes to `embed-worker/**`; it updates both templates. One-time
setup is in the workflow header. Per endpoint: Model field and
`EMBED_MODEL_ID` = the model, the smallest GPU, **Active workers 0**
(scale to zero), Max workers 1–2.

## API
```json
{ "input": { "input": ["text", "…"], "dimensions": 1024, "instruction": "optional (Qwen3)" } }
→ { "embeddings": [[…1024]], "dimensions": 1024, "model": "<EMBED_MODEL_ID>",
    "usage": { "prompt_tokens": 12, "total_tokens": 12 } }
```
≤ 64 texts per job, ≤ 8000 chars each. Errors come back as `{ "error": "bad_input: …" | "model_unavailable: …" }`.

## Choosing a model, then switching the app over
1. API env (Render): `RUNPOD_API_KEY`, `RUNPOD_EMBED_ENDPOINT_ID` (Qwen3),
   `RUNPOD_EMBED_BGE_ENDPOINT_ID` (bge-m3). The app keeps using OpenAI.
2. Compare: `POST /api/admin/embeddings/compare`, or gate suite
   `embeddings-compare` — a fixed test set (`akoro-api/lib/embeddingEvalSet.js`)
   on each model: recall@1/@5, MRR, English vs Pidgin, first-call and
   per-search time. The stores are never touched.
3. Switch: `EMBEDDINGS_PROVIDER=runpod`, `EMBEDDINGS_MODEL=qwen3-embedding-0.6b`
   or `bge-m3`. `GET /api/admin/embeddings/provider` must say `ok: true, dims: 1536`.
4. `POST /api/admin/embeddings/reembed-all {"confirm": true}` — clears every
   vector in the nine stores and refills them with the chosen model (search
   runs on its text half meanwhile; two models' vectors are never mixed).
   Changing `EMBEDDINGS_MODEL` later is another switch: re-embed again.
5. Gate: suite `embeddings` (`smoke.embeddings_live`).
