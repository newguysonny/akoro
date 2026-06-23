/**
 * proctoring/frameAnalyzer.js
 *
 * Backend frame analysis — the "heavy model" tier of the hybrid pipeline.
 *
 * The frontend (TensorFlow.js) already does fast, private, low-latency checks:
 * face count, presence, rough head pose. Those arrive as `clientSignals`. This
 * module adds the server-side tier:
 *
 *   • Object detection (phones / books / notes)  — YOLO-class model
 *   • Identity verification (live vs reference)   — ArcFace-class model
 *
 * Both are PLUGGABLE. If PROCTOR_SERVICE_URL is configured we POST the frame to
 * a Python microservice (YOLO + ArcFace) and use its results. If it isn't, we
 * fall back to the client signals plus light heuristics so the gateway is fully
 * functional without the GPU service — degraded, not broken.
 */

const SERVICE_URL = process.env.PROCTOR_SERVICE_URL || null;
const SERVICE_TIMEOUT_MS = 4000;

/**
 * Analyze one frame. Returns normalized boolean-ish signals the temporal
 * scorer consumes, plus any raw detail for the cheat-event log.
 *
 * @param {object} args
 * @param {string} args.frame         base64 JPEG (no data: prefix), 320x240
 * @param {object} args.clientSignals { faceCount, facePresent, lookingAway, headYaw, audioLevel }
 * @param {string} [args.referenceImage] base64 reference for identity check
 */
export async function analyzeFrame({ frame, clientSignals = {}, referenceImage = null }) {
  const cs = clientSignals;

  // Signals we can derive purely from the client's fast checks.
  const signals = {
    face_absent:    cs.facePresent === false || cs.faceCount === 0,
    multiple_faces: (cs.faceCount || 0) > 1,
    looking_away:   cs.lookingAway === true,
    audio_anomaly:  (cs.audioLevel ?? 0) > (cs.audioThreshold ?? 0.35),
    object_detected: false,
    face_mismatch:   false,
  };

  const detail = { source: "client", objects: [], identity: null };

  // Heavy tier — only if the GPU microservice is wired up.
  if (SERVICE_URL && frame) {
    try {
      const remote = await _callService({ frame, referenceImage });
      detail.source = "service";
      if (Array.isArray(remote.objects)) {
        detail.objects = remote.objects;
        // Flag prohibited items only (a "person" is handled by face count).
        signals.object_detected = remote.objects.some(o =>
          ["cell phone", "phone", "book", "laptop", "tablet", "tv", "remote"].includes(
            (o.label || "").toLowerCase()
          ) && (o.confidence ?? 1) >= 0.4
        );
      }
      if (remote.identity) {
        detail.identity = remote.identity;       // { match, similarity }
        if (referenceImage) signals.face_mismatch = remote.identity.match === false;
      }
      // Prefer the service's face count when present (more reliable than client).
      if (typeof remote.faceCount === "number") {
        signals.face_absent    = remote.faceCount === 0;
        signals.multiple_faces = remote.faceCount > 1;
      }
    } catch (e) {
      // Service down / slow — degrade to client signals, don't fail the frame.
      detail.serviceError = e.message;
    }
  }

  return { signals, detail };
}

async function _callService({ frame, referenceImage }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVICE_TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_URL.replace(/\/$/, "")}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ frame, reference: referenceImage }),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error(`proctor service ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const proctorServiceEnabled = () => Boolean(SERVICE_URL);
