# Akoro Proctoring Service — FastAPI + InsightFace (ArcFace) + YOLO.
# CPU image by default; for GPU swap the base for an nvidia/cuda runtime and
# install onnxruntime-gpu + a CUDA torch build.
FROM python:3.11-slim

# OpenCV / InsightFace runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch YOLO weights at build time so the first request isn't slow.
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY main.py .

ENV PORT=8700
EXPOSE 8700

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
