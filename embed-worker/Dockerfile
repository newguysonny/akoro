# Lean runtime image for the embedding worker — NO model weights inside.
# Weights come from RunPod's cached-models feature (the endpoint's Model
# field = Qwen/Qwen3-Embedding-0.6B), resolved offline at
# /runpod-volume/huggingface-cache/hub/.
#
# Build context is the REPOSITORY ROOT (like runpod-worker):
#   docker buildx build --file embed-worker/Dockerfile .
# Built and deployed by .github/workflows/deploy-embed-worker.yml.

FROM python:3.10-slim

WORKDIR /

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# triton (bundled with torch) JIT-compiles a small host-side launcher the
# first time a GPU kernel runs, and shells out to gcc for it. Qwen3's rotary
# embedding reaches it on the first job; python:3.10-slim ships no toolchain,
# so every Qwen3 job died with "RuntimeError: Failed to find C compiler"
# (RunPod log 2026-10-23 — the parse worker's 2026-10-09 failure, same fix).
# bge-m3 never reaches that path, which is why it ran on this same image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY embed-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY embed-worker/embedcore.py embed-worker/handler.py /

CMD ["python3", "-u", "handler.py"]
