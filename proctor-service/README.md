# Akoro Proctoring Service

The heavy vision tier for the **Session Assessment Gateway**. The browser
(TensorFlow.js / BlazeFace) handles fast, private, low-latency checks; this
service runs the GPU-class models the browser can't:

- **InsightFace (ArcFace)** — face detection, face count, identity verification
- **YOLOv8** — prohibited-item detection (phone, book, laptop, …)

It is **optional**. Without it the gateway still works using the client TF.js
signals; this service upgrades accuracy (real object detection + identity match)
and reduces false positives.

## Contract

The Node gateway calls one endpoint:

```
POST /analyze
  { "frame": "<base64 jpeg>", "reference": "<base64 jpeg|null>" }
→ { "faceCount": 3,
    "objects": [{ "label": "cell phone", "confidence": 0.82 }],
    "identity": { "match": true, "similarity": 0.51 } }
```

`GET /health` → `{ "ok": true }`.

## Run

```bash
# Local
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8700

# Docker
docker build -t akoro-proctor .
docker run -p 8700:8700 akoro-proctor
```

Then point the API at it:

```bash
# akoro-api/.env
PROCTOR_SERVICE_URL=http://localhost:8700
```

`frameAnalyzer.js` reads `PROCTOR_SERVICE_URL`; when set, every captured frame
is forwarded here. If this service is down or slow (>4s) the gateway silently
degrades to client signals — it never blocks the exam.

## Tuning

| Env | Default | Meaning |
|-----|---------|---------|
| `IDENTITY_THRESHOLD` | `0.38` | Cosine sim above which faces are the same person |
| `OBJECT_CONF` | `0.4` | Min YOLO confidence to flag a prohibited item |
| `YOLO_WEIGHTS` | `yolov8n.pt` | Swap for `yolov8s/m.pt` for higher accuracy |

## GPU

For real-time throughput at scale, build on `nvidia/cuda:12.x-runtime`, install
`onnxruntime-gpu`, and set the InsightFace provider to
`CUDAExecutionProvider` in `main.py`.

## Notes

- Reference embeddings are cached, so the registered photo is only encoded once
  per candidate, not on every frame.
- Models load lazily on first request — the container starts immediately and
  warms up on first use.
