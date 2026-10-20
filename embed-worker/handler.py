"""
RunPod Serverless worker — text embeddings: Qwen/Qwen3-Embedding-0.6B or
BAAI/bge-m3, whichever EMBED_MODEL_ID names. One image, one endpoint per
model (each endpoint caches its own model); both give 1024 dims.

The API's single embedding seam (akoro-api lib/aiModel.js) calls this
endpoint's /runsync with { input: [texts], dimensions: 1024 } and pads the
1024-dim vectors to the database's 1536 columns (zeros don't change cosine
similarity).

Boot is INERT, like the parse worker: the model loads on the first job from
RunPod's model cache (the endpoint's Model field = EMBED_MODEL_ID), offline;
a load failure fails that job readably and the worker stays up.

Input  { "input": str | [str], "dimensions"?: 32..1024, "instruction"?: str }
Output { "embeddings": [[float]], "dimensions": int, "model": str,
         "usage": { "prompt_tokens": int, "total_tokens": int } }
"""
import os
import threading

import runpod

from embedcore import BadInput, batches, model_profile, parse_input, with_instruction

MODEL_ID = os.environ.get("EMBED_MODEL_ID", "Qwen/Qwen3-Embedding-0.6B")
HF_CACHE_ROOT = os.environ.get("HF_CACHE_ROOT", "/runpod-volume/huggingface-cache/hub")
ALLOW_DOWNLOAD = os.environ.get("RUNPOD_ALLOW_DOWNLOAD", "") == "1"
MAX_TOKENS = int(os.environ.get("EMBED_MAX_TOKENS", "8192"))
BATCH = int(os.environ.get("EMBED_BATCH", "16"))
PROFILE = model_profile(MODEL_ID)

_model_lock = threading.Lock()
_tokenizer = None
_model = None
_device = None


class ModelUnavailable(RuntimeError):
    """The cached model can't be loaded right now — reported per job."""


def resolve_snapshot_path(model_id):
    """models--org--name/snapshots/<hash> — refs/main first, else newest."""
    org, name = model_id.split("/", 1)
    root = os.path.join(HF_CACHE_ROOT, f"models--{org}--{name}")
    refs_main = os.path.join(root, "refs", "main")
    snapshots = os.path.join(root, "snapshots")
    if os.path.isfile(refs_main):
        with open(refs_main) as f:
            candidate = os.path.join(snapshots, f.read().strip())
        if os.path.isdir(candidate):
            return candidate
    if os.path.isdir(snapshots):
        versions = sorted(d for d in os.listdir(snapshots) if os.path.isdir(os.path.join(snapshots, d)))
        if versions:
            return os.path.join(snapshots, versions[-1])
    if ALLOW_DOWNLOAD:
        print(f"[embed] cache miss for {model_id} — RUNPOD_ALLOW_DOWNLOAD=1, downloading")
        return model_id
    raise RuntimeError(f"Cached model not found: {model_id}. Set the endpoint's Model field to {model_id}, "
                       f"or RUNPOD_ALLOW_DOWNLOAD=1 to download at worker start.")


def _ensure_model():
    """Load once per worker; never crash the process on failure."""
    global _tokenizer, _model, _device
    if _model is not None:
        return _tokenizer, _model, _device
    with _model_lock:
        if _model is not None:
            return _tokenizer, _model, _device
        try:
            import torch
            from transformers import AutoModel, AutoTokenizer
            path = resolve_snapshot_path(MODEL_ID)
            print(f"[embed] loading {MODEL_ID} from {path}")
            # Qwen3: left padding, so the last position is every sequence's last real
            # token (last-token pooling). bge-m3: right padding, CLS at position 0.
            _tokenizer = AutoTokenizer.from_pretrained(path, padding_side=PROFILE["padding_side"], local_files_only=not ALLOW_DOWNLOAD)
            _device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.float16 if _device == "cuda" else torch.float32
            _model = AutoModel.from_pretrained(path, dtype=dtype, local_files_only=not ALLOW_DOWNLOAD).to(_device)
            _model.eval()
            print(f"[embed] ready on {_device}")
        except Exception as e:
            print(f"[embed] model unavailable: {e}")
            raise ModelUnavailable(str(e)) from e
        return _tokenizer, _model, _device


def embed(texts, dims):
    """Pooled as the model card prescribes (last token or CLS), cut to `dims`
    (MRL, Qwen3 only — bge-m3 is always asked for its full 1024), L2-normalised."""
    import torch
    import torch.nn.functional as F
    tokenizer, model, device = _ensure_model()
    out, tokens = [], 0
    with torch.no_grad():
        for chunk in batches(texts, BATCH):
            batch = tokenizer(chunk, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="pt").to(device)
            tokens += int(batch["attention_mask"].sum().item())
            hidden = model(**batch).last_hidden_state
            pooled = hidden[:, 0] if PROFILE["pooling"] == "cls" else hidden[:, -1]
            vectors = F.normalize(pooled[:, :dims].float(), p=2, dim=1)
            out.extend(vectors.cpu().tolist())
    return out, tokens


def handler(job):
    try:
        texts, dims, instruction = parse_input(job.get("input") or {}, PROFILE)
    except BadInput as e:
        return {"error": f"bad_input: {e}"}
    try:
        vectors, tokens = embed(with_instruction(texts, instruction), dims)
    except ModelUnavailable as e:
        return {"error": f"model_unavailable: {e}"}
    return {
        "embeddings": vectors, "dimensions": dims, "model": MODEL_ID,
        "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
