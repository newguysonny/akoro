# Lean runtime image — NO model weights inside.
# Weights come from RunPod's cached-models feature (endpoint Model field),
# resolved offline at /runpod-volume/huggingface-cache/hub/.
FROM python:3.10-slim

WORKDIR /

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py /

CMD ["python3", "-u", "handler.py"]
