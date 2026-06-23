# Akoro Proctoring Service — FastAPI + InsightFace (ArcFace) + YOLO.
# CPU image, tuned for a small box (e.g. a $5 Railway/VM tier): light model
# packs (buffalo_s + yolov8n), CPU-only torch, and both models pre-fetched at
# build time so the first live frame isn't slow. For GPU swap the base for an
# nvidia/cuda runtime and install onnxruntime-gpu + a CUDA torch build.
FROM python:3.11-slim

# Runtime libs OpenCV / InsightFace need at execution time (kept in the image).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Light model defaults — overridable at runtime.
ENV FACE_PACK=buffalo_s \
    YOLO_WEIGHTS=yolov8n.pt \
    INSIGHTFACE_HOME=/app/.insightface

COPY requirements.txt .

# insightface and stringzilla ship only sdists and must compile C/C++ extensions,
# so a toolchain is required at build time. Install it, build the wheels, then
# purge it in the SAME layer so the final image stays small.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# Pre-fetch model weights at build time so the first request isn't slow:
#  • YOLO nano detector
#  • InsightFace buffalo_s pack (downloaded + unpacked by prepare())
RUN python -c "from ultralytics import YOLO; YOLO('${YOLO_WEIGHTS}')" && \
    python -c "from insightface.app import FaceAnalysis; \
fa=FaceAnalysis(name='${FACE_PACK}', providers=['CPUExecutionProvider']); \
fa.prepare(ctx_id=0, det_size=(320,320))"

COPY main.py .

# Railway (and most PaaS) inject $PORT; default to 8700 for local/VM runs.
ENV PORT=8700
EXPOSE 8700

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
