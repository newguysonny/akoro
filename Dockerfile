# Root Dockerfile — RunPod GitHub-integration shim for the parse worker.
#
# RunPod's GitHub importer takes the Dockerfile path "from the root of the
# repository" but does not document which BUILD CONTEXT it uses. This file
# is the repo-root-context twin of runpod-worker/Dockerfile (whose COPYs
# are relative to its own folder and build correctly when the context IS
# that folder):
#
#   Dockerfile path: runpod-worker/Dockerfile  → builds when context = runpod-worker/
#   Dockerfile path: Dockerfile (this file)    → builds when context = repo root
#
# If a build fails with "COPY failed … not found", switch the endpoint's
# Dockerfile path to the other one. Keep the two files in lockstep.
#
# Lean runtime image — NO model weights inside. Weights come from RunPod's
# cached-models feature (endpoint Model field), resolved offline at
# /runpod-volume/huggingface-cache/hub/.

FROM python:3.10-slim

WORKDIR /

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY runpod-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY runpod-worker/handler.py /

CMD ["python3", "-u", "handler.py"]
