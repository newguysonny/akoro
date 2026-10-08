# RunPod worker — `hanji-dev/hanji-parse-4b` (document parsing / OCR VLM)

A RunPod Serverless worker for the **hanji-parse-4b** model — a Qwen3-VL-4B
fine-tune for document parsing (image-text-to-text). Pair it with RunPod's
**cached models** feature and **FlashBoot** for seconds-not-minutes cold
starts.

> ⚠️ **Why this handler differs from the generic template**: hanji-parse-4b is
> NOT a text-generation (`AutoModelForCausalLM`) model — it's a vision-language
> model. This handler loads `AutoProcessor` + `AutoModelForImageTextToText`,
> applies the Qwen chat template, and accepts images (URL, base64 or data URI)
> alongside the prompt.

## Files

| File | Purpose |
|---|---|
| `handler.py` | Loads the cached model offline, serves OCR/document-parse requests |
| `Dockerfile` | Lean runtime image — **no weights inside** |
| `requirements.txt` | runpod, torch, transformers ≥4.57 (Qwen3-VL), qwen-vl-utils |
| `test_input.json` | Local test payload (`python3 -u handler.py --test_input test_input.json`) |

## Deploy (RunPod console)

1. **Build & push the image** — from this folder:
   ```bash
   docker build -t <dockerhub-user>/hanji-parse-worker:latest .
   docker push <dockerhub-user>/hanji-parse-worker:latest
   ```
2. **Serverless → New Endpoint**
   - Container image: your pushed tag
   - **Model field: `hanji-dev/hanji-parse-4b`** ← RunPod pre-downloads the
     weights to `/runpod-volume/huggingface-cache/hub/` and tries to start
     workers on hosts that already have it; cold-host pulls are **unbilled**.
     (One cached model per endpoint.)
   - **FlashBoot: ON** — caches the container *image* on worker NVMe so scale-ups
     skip the multi-GB image pull. Weights still load into VRAM per cold worker
     (~10–20 s for a 4B model); FlashBoot removes the *other* minutes.
   - **GPU: pin a 24 GB card** (RTX 4090 / RTX A40 / L4). The 4B model in bf16
     needs ~9 GB weights + vision tower + activations — 16 GB is the floor, 24 GB
     is comfortable for full document pages.
   - **Max workers: a hard cap** (3–5) so runaway traffic can't scale your bill.
   - Active workers: 0 (scale to zero between jobs).
3. Deploy. First invocation on a cold host downloads + loads; afterwards the
   handler resolves the cached snapshot **offline** (`HF_HUB_OFFLINE=1`) — no
   runtime downloads, ever.

## API

`POST /run` (or `/runsync`) on the endpoint URL with your RunPod API key:

```jsonc
// document parse / OCR
{ "input": {
    "prompt": "Convert this document to clean markdown.",
    "image": "https://example.com/scan.png",          // URL, data URI or bare base64
    "max_tokens": 1024
}}

// plain chat (no image)
{ "input": { "prompt": "What is 84 * 3 / 2?", "max_tokens": 128 } }

// full control
{ "input": { "messages": [
    { "role": "user", "content": [
      { "type": "image", "image": "data:image/png;base64,…" },
      { "type": "text",  "text": "Extract the invoice total." } ] } ] } }
```

Response: `{ "output": "<markdown/text>", "model": "hanji-dev/hanji-parse-4b", "gpu": "…", "timing_s": 3.2 }`

## Environment variables (all optional)

| Var | Default | Meaning |
|---|---|---|
| `MODEL_NAME` | `hanji-dev/hanji-parse-4b` | Any HF model id the endpoint caches |
| `HF_HUB_CACHE` | `/runpod-volume/huggingface-cache/hub` | RunPod's cache root |
| `RUNPOD_ALLOW_DOWNLOAD` | `0` | `1` = bypass the cache and download at boot (billed) |
| `DEFAULT_MAX_NEW_TOKENS` | `1024` | Default generation length |

## Local test (GPU machine)

```bash
pip install -r requirements.txt
python3 -u handler.py --test_input test_input.json
```

## Note on your own HF copy

RunPod pulls straight from `hanji-dev/hanji-parse-4b` (public, Apache-2.0) —
**this worker doesn't need the akoro HF mirror**. The mirror console
(`/api/hf/mirror` on the akoro API) is only if you also want
`<your-account>/hanji-parse-4b` to exist on Hugging Face itself.
