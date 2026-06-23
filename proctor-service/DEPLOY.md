# Deploying the Proctoring Service (separate service)

The proctoring service runs as its **own** deployment, independent of
`akoro-api`. The API talks to it over HTTP via `PROCTOR_SERVICE_URL`. If that
env var is unset (or the service is down), the gateway degrades to client-only
TF.js signals — it never breaks the exam.

Light models are the default (`buffalo_s` + `yolov8n`) so it fits a small CPU
box.

---

## Option A — Railway (Docker)

1. **New service from this repo.** Railway → New → Deploy from GitHub repo →
   pick `newguysonny/akoro`.
2. **Point it at this folder.** Service → Settings → **Root Directory** =
   `proctor-service`. The included `railway.toml` selects the Dockerfile
   builder and the `/health` healthcheck automatically.
3. **Deploy.** First build is slow (installs torch + onnxruntime and
   pre-fetches both model packs); subsequent deploys are cached.
4. **Get the URL.** Settings → Networking → **Generate Domain**
   (e.g. `https://akoro-proctor-production.up.railway.app`).
5. **Wire the API.** In the **akoro-api** service variables, set:
   ```
   PROCTOR_SERVICE_URL=https://akoro-proctor-production.up.railway.app
   ```
   Redeploy / restart akoro-api so it picks up the var.
6. **Verify.**
   ```
   curl https://<your-domain>/health
   → {"ok":true,"facePack":"buffalo_s","yoloWeights":"yolov8n.pt",...}
   ```

### Cost note ($5 plan)
The resident footprint with both models is ~800MB–1GB RAM. To stay inside the
$5 credit, enable **serverless / sleep on inactivity** (Settings → choose the
serverless option) so the service only bills during live exams. Cold start is
a one-time ~10–30s model load on the first frame of an exam — acceptable since
the API tolerates a slow first frame (4s timeout, then graceful fallback).

---

## Option B — Any cloud VM (Docker)

```bash
git clone https://github.com/newguysonny/akoro.git
cd akoro/proctor-service

docker build -t akoro-proctor .
docker run -d --name akoro-proctor --restart unless-stopped \
  -p 8700:8700 \
  -e FACE_PACK=buffalo_s \
  -e YOLO_WEIGHTS=yolov8n.pt \
  -e IDENTITY_THRESHOLD=0.38 \
  -e OBJECT_CONF=0.4 \
  akoro-proctor

curl http://localhost:8700/health
```

Then on the API host set:
```
PROCTOR_SERVICE_URL=http://<vm-ip-or-host>:8700
```
Put it behind your reverse proxy / TLS if the VM is internet-facing.

---

## Tuning

| Env | Default | Meaning |
|-----|---------|---------|
| `FACE_PACK` | `buffalo_s` | InsightFace pack. `buffalo_l` = more accurate, more RAM |
| `YOLO_WEIGHTS` | `yolov8n.pt` | `yolov8s/m.pt` for better small-object accuracy |
| `DET_SIZE` | `320` | Face detector input size; lower = faster, less sensitive |
| `IDENTITY_THRESHOLD` | `0.38` | Cosine sim above which faces are the same person |
| `OBJECT_CONF` | `0.4` | Min YOLO confidence to flag a prohibited item |
