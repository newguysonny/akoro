"""
embedcore.py — the pure parts of the embedding worker (no torch, no model):
which model needs what (pooling, padding, dims), input checks and batching.
Unit-tested on its own (test/core_check.py).
"""

MAX_TEXTS = 64          # per job — callers send one text, or a batch of chunks
MAX_CHARS = 8000        # per text, as the API already caps
DEFAULT_DIMENSIONS = 1024
MIN_DIMENSIONS = 32     # Qwen3-Embedding is trained with MRL: 32..1024 for the 0.6B


class BadInput(ValueError):
    """The job's input is wrong — reported to the caller, never retried."""


# One image, one endpoint per model (each endpoint caches its own). What each
# model card prescribes:
#   Qwen3-Embedding  last-token pooling (left padding), MRL dims 32..1024,
#                    queries may carry an instruction
#   bge-m3           CLS pooling (right padding), always 1024 dims, no instruction
PROFILES = {
    "qwen3": {"pooling": "last", "padding_side": "left", "mrl": True, "instruct": True},
    "bge-m3": {"pooling": "cls", "padding_side": "right", "mrl": False, "instruct": False},
}


def model_profile(model_id):
    """The profile for a Hugging Face model id; an unknown model is refused at load."""
    name = str(model_id or "").lower()
    if "qwen3-embedding" in name:
        return dict(PROFILES["qwen3"])
    if "bge-m3" in name:
        return dict(PROFILES["bge-m3"])
    raise ValueError(f"unsupported embedding model: {model_id} (Qwen3-Embedding or bge-m3)")


def parse_input(job_input, profile=None):
    """{ input: str | [str], dimensions?: int, instruction?: str } → (texts, dims, instruction)."""
    profile = profile or PROFILES["qwen3"]
    if not isinstance(job_input, dict):
        raise BadInput("input must be an object")
    raw = job_input.get("input", job_input.get("texts"))
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        raise BadInput("input: a string or a non-empty list of strings is required")
    if len(raw) > MAX_TEXTS:
        raise BadInput(f"input: at most {MAX_TEXTS} texts per job")
    texts = []
    for t in raw:
        if not isinstance(t, str):
            raise BadInput("input: every item must be a string")
        texts.append(t[:MAX_CHARS] if t.strip() else " ")
    dims = job_input.get("dimensions", DEFAULT_DIMENSIONS)
    try:
        dims = int(dims)
    except (TypeError, ValueError):
        raise BadInput("dimensions must be an integer")
    if dims < MIN_DIMENSIONS or dims > DEFAULT_DIMENSIONS:
        raise BadInput(f"dimensions must be between {MIN_DIMENSIONS} and {DEFAULT_DIMENSIONS}")
    if not profile["mrl"] and dims != DEFAULT_DIMENSIONS:
        raise BadInput(f"this model gives {DEFAULT_DIMENSIONS} dimensions only (it isn't trained to be cut)")
    instruction = job_input.get("instruction")
    if instruction is not None and not isinstance(instruction, str):
        raise BadInput("instruction must be a string")
    # A model without an instruction format embeds queries as they are.
    return texts, dims, ((instruction or "").strip()[:300] if profile["instruct"] else "")


def with_instruction(texts, instruction):
    """Qwen3-Embedding's query format; documents are embedded as they are."""
    if not instruction:
        return texts
    return [f"Instruct: {instruction}\nQuery:{t}" for t in texts]


def batches(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]

