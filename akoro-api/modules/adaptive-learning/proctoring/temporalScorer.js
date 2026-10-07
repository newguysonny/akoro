/**
 * proctoring/temporalScorer.js
 *
 * Temporal cheat-probability scorer.
 *
 * A single suspicious frame means little — people glance away, lean out of
 * frame, get a knock on the door. What matters is the *pattern over time*.
 * This is the cheap, deterministic stand-in for the "LSTM over time" idea:
 * a rolling window of per-frame signals, decayed and weighted, producing a
 * 0–1 cheat probability that's stable against single-frame noise.
 *
 * Swap the `score()` body for a real sequence model later — the interface
 * (push signals, read probability + active flags) stays the same.
 */

// How many recent frames the window holds (~1 min at 1 frame / 2s).
const WINDOW = 30;

// Per-signal weights — how much each contributes to instantaneous suspicion.
// Tuned so a single signal can't max out the score; sustained combinations do.
const WEIGHTS = {
  face_absent:     0.35,   // no face detected
  multiple_faces:  0.55,   // another person in frame
  face_mismatch:   0.60,   // live face != registered identity
  object_detected: 0.50,   // phone / book / notes
  looking_away:    0.20,   // head pose / gaze off-screen
  audio_anomaly:   0.25,   // background speech / unusual noise
};

// A signal must persist past this fraction of the window before it escalates
// from "noted" to a hard cheat event. Stops one-off blips from flagging.
const PERSISTENCE = {
  face_absent:    0.30,
  multiple_faces: 0.15,
  face_mismatch:  0.20,
  object_detected:0.20,
  looking_away:   0.50,
  audio_anomaly:  0.40,
};

export class TemporalScorer {
  constructor() {
    this.frames = [];          // [{ ts, signals: {name:boolean} }]
    this.peakProbability = 0;
  }

  /**
   * Push one frame's boolean signals. Returns the current assessment:
   *   { probability, level, active: [signalNames], escalations: [events] }
   */
  push(signals = {}, ts = Date.now()) {
    this.frames.push({ ts, signals });
    if (this.frames.length > WINDOW) this.frames.shift();
    return this.score();
  }

  score() {
    const n = this.frames.length;
    if (n === 0) return { probability: 0, level: "clear", active: [], escalations: [] };

    // Recency-decayed weighted sum, normalised by the same decayed weight mass
    // so the score is a true 0–1 ratio regardless of window fill.
    let weighted = 0, mass = 0;
    const counts = {};

    this.frames.forEach((f, i) => {
      const recency = (i + 1) / n;                 // newest frames weigh more
      for (const [name, w] of Object.entries(WEIGHTS)) {
        mass += w * recency;
        if (f.signals[name]) {
          weighted += w * recency;
          counts[name] = (counts[name] || 0) + 1;
        }
      }
    });

    const probability = mass > 0 ? Math.min(1, weighted / mass) : 0;
    this.peakProbability = Math.max(this.peakProbability, probability);

    // Signals currently firing, and those persistent enough to escalate.
    const active = Object.keys(counts);
    const escalations = active
      .filter(name => (counts[name] / n) >= (PERSISTENCE[name] ?? 0.3))
      .map(name => ({
        type:     name,
        ratio:    +(counts[name] / n).toFixed(2),
        severity: this._severity(name, counts[name] / n),
      }));

    return {
      probability: +probability.toFixed(3),
      level:       this._level(probability),
      active,
      escalations,
    };
  }

  _level(p) {
    if (p >= 0.7) return "high";
    if (p >= 0.4) return "elevated";
    if (p >= 0.15) return "low";
    return "clear";
  }

  _severity(name, ratio) {
    const base = WEIGHTS[name] || 0.3;
    const s = base * (0.5 + ratio);   // weight × how sustained it is
    if (s >= 0.5) return "high";
    if (s >= 0.3) return "medium";
    return "low";
  }

  snapshot() {
    return {
      framesAnalyzed:  this.frames.length,
      peakProbability: +this.peakProbability.toFixed(3),
      current:         this.score(),
    };
  }
}
