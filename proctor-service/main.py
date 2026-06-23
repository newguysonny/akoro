"""
Akoro Proctoring Service — heavy vision tier for the Session Assessment Gateway.

The Node gateway (akoro-api/modules/adaptive-learning/proctoring/frameAnalyzer.js)
POSTs each captured frame here when PROCTOR_SERVICE_URL is configured. This
service runs the GPU-class models the browser can't:

  • InsightFace (ArcFace)  — face detection + count + identity embedding
  • YOLO (ultralytics)     — prohibited-item detection (phone, book, laptop…)

Contract (must match frameAnalyzer.js):
  POST /analyze
    { "frame": "<base64 jpeg>", "reference": "<base64 jpeg|null>" }
  → { "faceCount": int,
      "objects": [{ "label": str, "confidence": float }],
      "identity": { "match": bool, "similarity": float } | null }

Models load lazily on first request so the container starts fast and a missing
GPU degrades to CPU rather than crashing.
"""

import base64
import os
from functools import lru_cache

import numpy as np
import cv2
from fastapi import FastAPI
from pydantic import BaseModel

# Cosine-similarity threshold above which two faces are the "same person".
# ArcFace embeddings on normalized faces typically separate same/different
# around 0.35–0.45; 0.38 is a reasonable proctoring default.
IDENTITY_THRESHOLD = float(os.getenv("IDENTITY_THRESHOLD", "0.38"))

# Items that count as prohibited (COCO class names from YOLO).
PROHIBITED = {"cell phone", "book", "laptop", "tv", "remote", "keyboard", "tablet"}
OBJECT_CONF = float(os.getenv("OBJECT_CONF", "0.4"))

app = FastAPI(title="Akoro Proctoring Service", version="1.0")


class AnalyzeRequest(BaseModel):
    frame: str
    reference: str | None = None


# ── Lazy model loaders ───────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def face_model():
    from insightface.app import FaceAnalysis
    fa = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    fa.prepare(ctx_id=0, det_size=(320, 320))
    return fa


@lru_cache(maxsize=1)
def object_model():
    from ultralytics import YOLO
    return YOLO(os.getenv("YOLO_WEIGHTS", "yolov8n.pt"))


# ── Helpers ──────────────────────────────────────────────────────────────────
def _decode(b64: str):
    if not b64:
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def _cosine(a, b):
    a = a / (np.linalg.norm(a) + 1e-8)
    b = b / (np.linalg.norm(b) + 1e-8)
    return float(np.dot(a, b))


# Reference embeddings are cached per a short hash so we don't recompute the
# registered photo on every one of the candidate's frames.
@lru_cache(maxsize=256)
def _reference_embedding(ref_hash: str, ref_b64: str):
    img = _decode(ref_b64)
    if img is None:
        return None
    faces = face_model().get(img)
    if not faces:
        return None
    return faces[0].normed_embedding


# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "identity_threshold": IDENTITY_THRESHOLD}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    img = _decode(req.frame)
    if img is None:
        return {"faceCount": 0, "objects": [], "identity": None}

    # Faces + identity
    faces = face_model().get(img)
    face_count = len(faces)

    identity = None
    if req.reference and face_count >= 1:
        ref_emb = _reference_embedding(str(hash(req.reference)), req.reference)
        if ref_emb is not None:
            # Compare the largest (closest) face against the reference.
            live = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            sim = _cosine(np.asarray(ref_emb), np.asarray(live.normed_embedding))
            identity = {"match": sim >= IDENTITY_THRESHOLD, "similarity": round(sim, 4)}

    # Prohibited objects
    objects = []
    try:
        results = object_model().predict(img, conf=OBJECT_CONF, verbose=False)
        for r in results:
            names = r.names
            for box in r.boxes:
                label = names[int(box.cls)]
                if label in PROHIBITED:
                    objects.append({"label": label, "confidence": round(float(box.conf), 3)})
    except Exception as e:  # object detection is best-effort
        objects = []
        print(f"[proctor] object detection error: {e}")

    return {"faceCount": face_count, "objects": objects, "identity": identity}
