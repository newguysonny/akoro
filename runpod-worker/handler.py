"""
handler.py — RunPod serverless worker for hanji-dev/hanji-parse-4b
────────────────────────────────────────────────────────────────────
Document-parsing/OCR worker for the Qwen3-VL-4B fine-tune. This model is
PROMPT-COUPLED: it was fine-tuned to answer one exact prompt — the Hanji
production bbox_2d_json prompt (copied verbatim from the vendored
hanji-main source, src/extract/parse_prompts.py) — and answers with a
JSON array of layout blocks:

    [{"bbox_2d": [x1, y1, x2, y2], "text_content": "..."}]

Coordinates are normalized 0-1000 (left, top, right, bottom), tables come
back as GitHub-Flavored Markdown, figures come back as the "<image>"
sentinel, and an empty page is exactly []. Deviating from the prompt
degrades quality, so this handler ignores client prompts by default
(PARSE_MODEL_ALLOW_PROMPT=1 to override deliberately).

The /predict contract Hanji's own server uses (serving/server.py) is:
    request  {image_b64, prompt, max_new_tokens}
    response {raw, wall_ms, ...}
Our RunPod handler mirrors it, and additionally returns the parsed
`blocks` so callers don't each re-implement the JSON extraction.

Deployment contract (RunPod cached-models feature):
  • The endpoint's Model field is set to MODEL_NAME (default
    hanji-dev/hanji-parse-4b); RunPod pre-downloads the weights to
    /runpod-volume/huggingface-cache/hub/ and cold-host pulls are unbilled.
  • This handler resolves the cached snapshot and loads it OFFLINE —
    never a runtime download, never billed for one. Set
    RUNPOD_ALLOW_DOWNLOAD=1 only to intentionally bypass the cache.

Local test (needs a GPU box):
  python3 -u handler.py --test_input test_input.json
"""

import os

# Offline BEFORE transformers/huggingface_hub are imported — setdefault so
# an env var from the endpoint config can still override deliberately.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_CACHE", "/runpod-volume/huggingface-cache/hub")

import base64
import io
import json
import re
import threading
import time

import runpod
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForImageTextToText

# ── Configuration ────────────────────────────────────────────────────────
MODEL_ID       = os.environ.get("MODEL_NAME", "hanji-dev/hanji-parse-4b")
HF_CACHE_ROOT  = os.environ.get("HF_HUB_CACHE", "/runpod-volume/huggingface-cache/hub")
ALLOW_DOWNLOAD = os.environ.get("RUNPOD_ALLOW_DOWNLOAD", "0") == "1"
ALLOW_PROMPT   = os.environ.get("PARSE_MODEL_ALLOW_PROMPT", "0") == "1"
MAX_PIXELS     = int(os.environ.get("QWEN_MAX_IMAGE_PIXELS", "2000000"))  # training pixel cap
DEFAULT_MAX_NEW_TOKENS = int(os.environ.get("DEFAULT_MAX_NEW_TOKENS", "8192"))


# ── The exact prompt the model was fine-tuned on (hanji-main,
#    src/extract/parse_prompts.py → PRODUCTION_BBOX_2D_JSON_PROMPT). ──────
PRODUCTION_BBOX_2D_JSON_PROMPT = r"""Detect every BLOCK in this document and return a JSON array.

Schema: [{"bbox_2d":[x1,y1,x2,y2], "text_content":"..."}]
Coordinates: normalized 0-1000 page coordinates; [x1,y1,x2,y2] = [left,top,right,bottom].

EMPTY PAGE: If the page has no legible content, return exactly []. Otherwise, transcribe every legible content block; a page with only one legible item is not empty.

Your DEFAULT is to GROUP. Most such pages form 5-30 records; sparse pages may form only 1-4. More than 30 remains unusual. A
"block" is a semantic SECTION (a panel, a heading + its content, a key-value group,
or a whole table), NOT a single line, cell, or field. If you are emitting one record
per line, per cell, or per form field, STOP - that is WRONG. When a region is not a
clean table, you must STILL group it into section blocks; never fall back to
one-record-per-element.

Block categories:
- Text records: ONE record per block - a heading TOGETHER WITH the lines beneath it,
  a paragraph, a list, or a key-value field group. text_content = the block's text,
  with "\n" between its lines. DO NOT emit one record per line.
- Table records: a table or dense grid of cells, rendered as GitHub-Flavored Markdown
  (| col | col |\n|---|---|\n| cell | cell |). Never emit one record per cell or
  per row - the markdown carries every cell. A repeated item|amount list (receipt
  lines, menu items) IS a table.
  HEADERLESS TABLES: if a table has no visible column headings, DO NOT invent any.
  Render only the visible rows/cells in their observed order. If Markdown syntax needs
  a separator row, use empty header cells rather than synthetic names like "Column 1".
  TABLE CELL TEXT: cell contents must be plain visible text. Do NOT add Markdown
  emphasis or formatting inside cells (no **bold**, _italics_, backticks, or headings)
  unless that formatting is the only way to preserve information that is visible on
  the page.
  TALL TABLES: A logical table on one page is ONE block regardless of row count. Include
  every visible row in one GFM table. Its bbox_2d must tightly enclose the full table
  from the first row through the last row.
- Image records: ONE record per photo, figure, chart, scan, or non-text graphic.
  text_content = "<image>". Handwritten signatures, cursive e-signatures, initials,
  signature scribbles, and signature marks are ALWAYS images - do NOT transcribe or
  guess them, even if partly readable. Printed labels such as "Signature:" remain text.
  Do NOT emit for logos < 40 px wide.

CRITICAL - transcribe MEANING, not layout glyphs:
- Fill-in / blank lines: emit ONLY the label, NOT the blank. Write "Name:" - never
  "Name:________________". For signature fields, keep the printed label as text and
  emit the actual signature mark itself as an image record with text_content="<image>".
- NEVER reproduce decorative rules or separators - rows of *, -, _, =, ., or any
  repeated glyph. Omit them entirely; they are not content.
- Checkboxes / Y-N / selection fields: write the field and its options on one line with the marks inline - "<row label> Y [x] N [ ]", "<label>: [x] Yes [ ] No"; "[x]" filled, "[ ]" empty; one record per field, not per option.
- text_content must equal the VISIBLE text of the block - never pad, repeat, or
  continue a character run. No single text block exceeds ~20 lines; split a longer
  section at its sub-headings.

Grouping rules:
- A section heading and the content beneath it (down to the next heading) form ONE block.
- A field label and its value are ONE block - EVEN in a dense report header. Write
  "Visit Date: 08/12/2025" as one record; NEVER split the label from its value
  ("Visit Date:" + "08/12/2025" as two records is WRONG).
- On forms, when a key has an associated value, merge the key and value into the same
  block and bbox so the association is explicit. If several related key-value fields
  are visually grouped, emit the group as one block with one "Label: value" line per field.
- A bordered or visually-grouped PANEL (e.g. a "PRESCRIBER INFORMATION" box with all
  its fields) is ONE block - join its label:value pairs with "\n".
- A row of related cells that is NOT a clean table (a lab-result line, a transaction
  line) is ONE block - join the cells into one line; NEVER one record per cell.
- NEVER emit a bare value, a single cell, or a lone field as its own record.
- Keep COLUMNS separate: two side-by-side panels (e.g. Patient | Ordering Provider,
  Bill To | Ship To) are TWO blocks - never merge across the gutter.
- DO NOT merge unrelated neighboring panels or sections.
- Group by semantic relationship, NOT by bbox size. Small unrelated regions must stay
  separate. Example: a page title at the top-left and a page number at the top-right
  are TWO blocks, even if both boxes are small and on the same horizontal band. Only
  group items that belong to the same section, panel, list, table, or key-value group.
- Prefer CORRECT grouping over tight boxes: a block's bbox may be wide and may lightly
  touch a neighbor - do NOT over-split a section just to keep boxes small or separate.
- Page-edge content: if visible text touches or sits near the page boundary, inspect the
  full edge carefully and make the bbox include the entire visible glyphs/block, even if
  the box must start at 0 or end at 1000. Do NOT shrink edge boxes inward.
- Bbox coverage is strict: every transcribed character in text_content MUST be inside
  that record's bbox_2d, with no clipped letters. This matters most for small regions,
  rotated/non-horizontal text, page-edge text, headers/footers, stamps, and fax strips.
  Use a tight box around the actual region, but never make it so tight that any visible
  character you transcribed falls outside the box.

Output JSON only.
Checkboxes: transcribe every checkbox as [x] if marked or [ ] if unmarked, placed before its label (e.g. "[x] Allergies reviewed"; Y/N pairs as "Y [x] N [ ]"). Include every checkbox, including checkbox grids and Y/N option pairs."""

PRODUCTION_PROMPT = PRODUCTION_BBOX_2D_JSON_PROMPT


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


def resize_to_cap(img: Image.Image) -> Image.Image:
    """Shrink to the training pixel cap — bigger images cost tokens and
    drift from the resolution the checkpoint was trained at."""
    w, h = img.size
    if w * h <= MAX_PIXELS:
        return img
    scale = (MAX_PIXELS / (w * h)) ** 0.5
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def extract_blocks(raw: str):
    """Best-effort parse of the model's JSON array out of the raw output.
    Tolerates code fences and prose around the array; returns [] when the
    output carries no parsable array (caller decides what that means)."""
    if not raw:
        return []
    text = raw.strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        items = json.loads(text[start:end + 1])
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    blocks = []
    for it in items:
        if not isinstance(it, dict):
            continue
        bbox = it.get("bbox_2d", it.get("bbox"))
        text_content = it.get("text_content", it.get("text"))
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4 or text_content is None:
            continue
        try:
            blocks.append({
                "bbox_2d": [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])],
                "text_content": str(text_content),
            })
        except (TypeError, ValueError):
            continue
    # Reading order: top-to-bottom, then left-to-right (0-1000 space).
    blocks.sort(key=lambda b: (b["bbox_2d"][1], b["bbox_2d"][0]))
    return blocks


# ── Model load — LAZY, on the first request ──────────────────────────────
# Deliberately NOT at import. RunPod's build pipeline (and any boot probe)
# runs this container BEFORE the model cache volume exists; a module-level
# load there raised out of resolve_snapshot_path and killed the process
# before runpod.serverless.start() — the exact "Could not find
# runpod.serverless.start" build failure. Lazy loading keeps boot instant
# and harmless; the first job on a cold worker pays the ~10-20s VRAM load
# (FlashBoot + cached models keep that the only cold-start cost).
_model_lock = threading.Lock()
_processor  = None
_model      = None
_gpu_name   = "CPU"


class ModelUnavailable(RuntimeError):
    """The cached model can't be loaded right now. Reported per JOB — the
    worker process stays up so a config fix (Model field / cache mount)
    lands on the next job without a redeploy."""


def _ensure_model():
    """Load the model once per worker; never crash the process on failure."""
    global _processor, _model, _gpu_name
    if _model is not None:
        return _processor, _model, _gpu_name
    with _model_lock:
        if _model is not None:      # lost the race — it's loaded now
            return _processor, _model, _gpu_name
        try:
            _model_path = resolve_snapshot_path(MODEL_ID)
            print(f"[worker] loading {MODEL_ID} from {_model_path}")
            _processor = AutoProcessor.from_pretrained(
                _model_path, trust_remote_code=False, local_files_only=(not ALLOW_DOWNLOAD),
            )
            _model = AutoModelForImageTextToText.from_pretrained(
                _model_path,
                trust_remote_code=False,
                dtype="auto",                # bf16 weights, as shipped
                device_map="auto",           # single GPU → whole model on the GPU
                local_files_only=(not ALLOW_DOWNLOAD),
            )
            _model.eval()
            _gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
            print(f"[worker] ready — {_gpu_name}")
        except Exception as e:
            print(f"[worker] model unavailable: {e}")
            raise ModelUnavailable(str(e)) from e
        return _processor, _model, _gpu_name


# ── Prompt → the model's chat format ─────────────────────────────────────
def build_chat_text(processor, prompt: str) -> str:
    """The fine-tune is a CHAT model: it answers a user turn, inside its
    chat template, with the assistant turn opened. Fed the bare prompt (no
    <|im_start|>user … <|im_start|>assistant), it ended its turn at once —
    COMPLETED in ~1 s with empty output (live, 2026-10-10).

    The processor's own chat template is the source of truth: it places the
    image's <|vision_start|><|image_pad|><|vision_end|> run, which the
    processor then expands to the EXACT visual-token count (a bare '<image>'
    gave "tokens: 0" against N image features). If the snapshot ships no
    template, the same Qwen layout is built by hand. A prompt that already
    carries chat markup (operator override) is sent as-is."""
    if "<|im_start|>" in prompt:
        return prompt
    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]}]
    try:
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        if isinstance(text, str) and "<|image_pad|>" in text:
            return text
    except Exception as e:
        print(f"[worker] chat template unavailable ({e}) — using the Qwen layout")
    return (
        "<|im_start|>user\n<|vision_start|><|image_pad|><|vision_end|>"
        f"{prompt}<|im_end|>\n<|im_start|>assistant\n"
    )


# ── The handler ──────────────────────────────────────────────────────────
def handler(job):
    job_input = job.get("input") or {}
    started = time.time()

    image_b64 = job_input.get("image_b64") or job_input.get("image")
    if not isinstance(image_b64, str) or not image_b64.strip():
        return {"error": "image_b64 is required (PNG/JPEG, raw base64 or a data: URI)"}
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
    try:
        img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
    except Exception:
        return {"error": "image_b64 is not a valid image"}

    img = resize_to_cap(img)
    prompt = job_input.get("prompt") if ALLOW_PROMPT else None
    prompt = prompt if isinstance(prompt, str) and prompt.strip() else PRODUCTION_PROMPT
    try:
        max_new_tokens = int(job_input.get("max_new_tokens") or job_input.get("max_tokens") or DEFAULT_MAX_NEW_TOKENS)
    except (TypeError, ValueError):
        max_new_tokens = DEFAULT_MAX_NEW_TOKENS

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    images = [Image.open(io.BytesIO(buf.getvalue()))]

    try:
        processor, model, gpu_name = _ensure_model()
    except ModelUnavailable as e:
        # Readable per-job failure — the endpoint stays deployable and the
        # message names the fix (Model field / RUNPOD_ALLOW_DOWNLOAD).
        return {"error": f"Model unavailable: {e}"}
    text = build_chat_text(processor, prompt)
    inputs = processor(text=[text], images=images, return_tensors="pt").to(model.device)

    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)

    new_tokens = generated[0][inputs["input_ids"].shape[1]:]
    raw = processor.decode(new_tokens, skip_special_tokens=True)
    return {
        "raw": raw,
        # How many tokens the model produced: 1 with an empty `raw` means it
        # ended its turn at once (a prompt-format problem), not an empty page.
        "generated_tokens": len(new_tokens),
        "blocks": extract_blocks(raw),
        "image_size": list(img.size),
        "model": MODEL_ID,
        "gpu": gpu_name,
        "wall_ms": int((time.time() - started) * 1000),
    }


# ── Serverless start (rp_debug: --test_input test_input.json) ───────────
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
