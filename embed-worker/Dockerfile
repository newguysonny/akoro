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

COPY embed-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY embed-worker/embedcore.py embed-worker/handler.py /

CMD ["python3", "-u", "handler.py"]
