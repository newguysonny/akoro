"""
handler.py — RunPod serverless worker for hanji-dev/hanji-parse-4b
────────────────────────────────────────────────────────────────────
Document-parsing/OCR VLM worker. The model is a Qwen3-VL-4B fine-tune
(image-text-to-text), so this handler loads AutoProcessor +
AutoModelForImageTextToText — NOT AutoModelForCausalLM/text-generation,
which would crash on this checkpoint.

Deployment contract (RunPod cached-models feature):
  • The endpoint's Model field is set to MODEL_NAME (default
    hanji-dev/hanji-parse-4b); RunPod pre-downloads the weights to
    /runpod-volume/huggingface-cache/hub/ and cold-host pulls are unbilled.
  • This handler resolves the cached snapshot and loads it OFFLINE —
    never a runtime download, never billed for one. Set
    RUNPOD_ALLOW_DOWNLOAD=1 only to intentionally bypass the cache.

Local test (needs a GPU box or a CPU-tolerant setup):
  python3 -u handler.py --test_input test_input.json
"""

import os

# Offline BEFORE transformers/huggingface_hub are imported — setdefault so
# an env var from the endpoint config can still override deliberately.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_CACHE", "/runpod-volume/huggingface-cache/hub")

import base64
import time
import urllib.request

import runpod
import torch
from transformers import AutoProcessor, AutoModelForImageTextToText

# ── Configuration ────────────────────────────────────────────────────────
MODEL_ID       = os.environ.get("MODEL_NAME", "hanji-dev/hanji-parse-4b")
HF_CACHE_ROOT  = os.environ.get("HF_HUB_CACHE", "/runpod-volume/huggingface-cache/hub")
ALLOW_DOWNLOAD = os.environ.get("RUNPOD_ALLOW_DOWNLOAD", "0") == "1"
DEFAULT_MAX_NEW_TOKENS = int(os.environ.get("DEFAULT_MAX_NEW_TOKENS", "1024"))


# ── Cached-snapshot resolution (RunPod's HF cache layout) ───────────────
def resolve_snapshot_path(model_id: str) -> str:
    """models--org--name/snapshots/<hash> — refs/main first, else newest."""
    if "/" not in model_id:
        raise ValueError(f"model_id '{model_id}' must be in 'org/name' format")

    org, name = model_id.split("/", 1)
    model_root  = os.path.join(HF_CACHE_ROOT, f"models--{org}--{name}")
    refs_main   = os.path.join(model_root, "refs", "main")
    snapshots   = os.path.join(model_root, "snapshots")

    if os.path.isfile(refs_main):
        with open(refs_main, "r") as f:
            snapshot_hash = f.read().strip()
        candidate = os.path.join(snapshots, snapshot_hash)
        if os.path.isdir(candidate):
            return candidate

    if os.path.isdir(snapshots):
        versions = sorted(
            d for d in os.listdir(snapshots)
            if os.path.isdir(os.path.join(snapshots, d))
        )
        if versions:
            return os.path.join(snapshots, versions[0])

    if ALLOW_DOWNLOAD:
        # Deliberate bypass: let the Hub fetch it (billed transfer time).
        print(f"[worker] cache miss for {model_id} — RUNPOD_ALLOW_DOWNLOAD=1, downloading")
        return model_id

    raise RuntimeError(
        f"Cached model not found: {model_id}. Set the endpoint's Model field "
        f"to {model_id} (RunPod pre-caches it, unbilled), or set "
        f"RUNPOD_ALLOW_DOWNLOAD=1 to download at worker start (billed)."
    )


# ── Image loading (fallback when qwen_vl_utils isn't importable) ────────
def _load_image_pil(ref):
    from PIL import Image
    from io import BytesIO

    if isinstance(ref, bytes):
        return Image.open(BytesIO(ref)).convert("RGB")
    s = str(ref)
    if s.startswith("data:"):                       # data:image/png;base64,…
        payload = s.split(",", 1)[1] if "," in s else s
        return Image.open(BytesIO(base64.b64decode(payload))).convert("RGB")
    if s.startswith(("http://", "https://")):
        with urllib.request.urlopen(s, timeout=30) as r:
            return Image.open(BytesIO(r.read())).convert("RGB")
    if os.path.exists(s):                           # local path (rare in serverless)
        return Image.open(s).convert("RGB")
    try:                                            # bare base64
        return Image.open(BytesIO(base64.b64decode(s))).convert("RGB")
    except Exception:
        raise ValueError(f"unsupported image reference: {s[:80]}…")


def _vision_inputs(messages):
    """Images for the processor — qwen_vl_utils when present, PIL fallback."""
    try:
        from qwen_vl_utils import process_vision_info
        images, videos = process_vision_info(messages)
        return images or None, videos or None
    except ImportError:
        images = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "image":
                        images.append(_load_image_pil(part.get("image")))
        return (images or None), None


# ── Model load — ONCE per worker boot (this is the cold-start cost) ─────
print(f"[worker] resolving cached snapshot for {MODEL_ID} …")
_model_path = resolve_snapshot_path(MODEL_ID)
print(f"[worker] loading from {_model_path}")

_processor = AutoProcessor.from_pretrained(
    _model_path, trust_remote_code=False, local_files_only=(not ALLOW_DOWNLOAD),
)
_model = AutoModelForImageTextToText.from_pretrained(
    _model_path,
    trust_remote_code=False,
    torch_dtype="auto",          # bf16 weights, as shipped
    device_map="auto",           # single GPU → whole model on the GPU
    local_files_only=(not ALLOW_DOWNLOAD),
)
_model.eval()

_gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
print(f"[worker] ready — {_gpu_name}")


# ── Input normalization ──────────────────────────────────────────────────
def build_messages(job_input):
    """Accepts {prompt, image?, system?} or a full {messages: [...]} array.
    Plain-string message content is wrapped for the VLM template."""
    if isinstance(job_input.get("messages"), list) and job_input["messages"]:
        messages = []
        for msg in job_input["messages"]:
            role, content = msg.get("role", "user"), msg.get("content", "")
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            messages.append({"role": role, "content": content})
        return messages

    content = []
    if job_input.get("image"):
        content.append({"type": "image", "image": job_input["image"]})
    content.append({
        "type": "text",
        "text": job_input.get("prompt") or "Extract all text from this document as clean markdown.",
    })
    messages = [{"role": "user", "content": content}]
    if job_input.get("system"):
        messages.insert(0, {"role": "system", "content": [{"type": "text", "text": job_input["system"]}]})
    return messages


# ── The handler ──────────────────────────────────────────────────────────
def handler(job):
    job_input = job.get("input") or {}
    started = time.time()

    max_new_tokens = int(job_input.get("max_tokens", DEFAULT_MAX_NEW_TOKENS))
    temperature    = float(job_input.get("temperature", 0.7))
    do_sample      = bool(job_input.get("do_sample", True))
    messages       = build_messages(job_input)

    prompt_text = _processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
    )
    images, videos = _vision_inputs(messages)
    inputs = _processor(
        text=[prompt_text], images=images, videos=videos, return_tensors="pt",
    ).to(_model.device)

    with torch.inference_mode():
        generated = _model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=do_sample,
            temperature=temperature if do_sample else None,
        )

    completion = _processor.decode(
        generated[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    )
    return {
        "output": completion,
        "model": MODEL_ID,
        "gpu": _gpu_name,
        "timing_s": round(time.time() - started, 2),
    }


# ── Serverless start (rp_debug: --test_input test_input.json) ───────────
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
