# Lean runtime image — NO model weights inside.
# Weights come from RunPod's cached-models feature (endpoint Model field),
# resolved offline at /runpod-volume/huggingface-cache/hub/.
#
# COPY paths are REPO-ROOT-relative — RunPod's GitHub build runs
#   docker buildx build --file <repo>/runpod-worker/Dockerfile <repo>/
# i.e. the build context is the repository ROOT (verified in build logs
# 2026-10-09), so sources must be addressed through the folder. The
# root Dockerfile twin builds the same image from the same context.

FROM python:3.10-slim

WORKDIR /

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY runpod-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY runpod-worker/handler.py /

CMD ["python3", "-u", "handler.py"]
