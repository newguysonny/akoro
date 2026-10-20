# RunPod worker — `Qwen/Qwen3-Embedding-0.6B` (text embeddings)

Akoro's embeddings, self-hosted. The API's one embedding seam
(`akoro-api/lib/aiModel.js` → `lib/embeddingProvider.js`) calls this endpoint
when `EMBEDDINGS_PROVIDER=runpod`, asks for **1024** dims (the model's full
size, Matryoshka-trained) and pads them with zeros to the database's **1536**
columns — zeros change neither dot products nor norms, so cosine similarity is
the model's own.

| File | Purpose |
|---|---|
| `handler.py` | Lazy model load (first job, RunPod cache, offline), last-token pooling, L2-normalised, batched |
| `embedcore.py` | Pure input checks + batching (unit-tested without torch) |
| `Dockerfile` | Lean image, no weights inside; built from the repo root |
| `test/` | Contract tests (`node --test embed-worker/test/*.test.mjs`) |

## Deploy
`.github/workflows/deploy-embed-worker.yml` — same pattern as the parse worker,
on changes to `embed-worker/**`. One-time setup is in the workflow header.

Endpoint: **Model field `Qwen/Qwen3-Embedding-0.6B`**, the smallest GPU,
**Active workers 1** (every search embeds its question — no cold starts),
Max workers 2–3.

## API
```json
{ "input": { "input": ["text", "…"], "dimensions": 1024, "instruction": "optional" } }
→ { "embeddings": [[…1024]], "dimensions": 1024, "model": "Qwen/Qwen3-Embedding-0.6B",
    "usage": { "prompt_tokens": 12, "total_tokens": 12 } }
```
≤ 64 texts per job, ≤ 8000 chars each. Errors come back as `{ "error": "bad_input: …" | "model_unavailable: …" }`.

## Switching the app over
1. Deploy, then set on the API (Render): `EMBEDDINGS_PROVIDER=runpod`,
   `RUNPOD_EMBED_ENDPOINT_ID`, `RUNPOD_API_KEY`.
2. `GET /api/admin/embeddings/provider` — a live probe must say `ok: true, dims: 1536`.
3. `POST /api/admin/embeddings/reembed-all {"confirm": true}` — clears every
   vector in the nine stores and refills them with the new model in the
   background (search runs on its text half meanwhile; vectors from two models
   are never mixed). Progress: `GET /api/admin/embeddings` → `reembed`.
4. Gate: suite `embeddings` (`smoke.embeddings_live`).
