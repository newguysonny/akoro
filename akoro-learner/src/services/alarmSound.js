/**
 * alarmSound.js — the schedule alarm: which sound rings when a scheduled
 * live class is due, and how it plays.
 *
 * Two sound sources, exactly like the avatar picker's emoji/upload split:
 *   · PLATFORM DEFAULTS — four synthesized ringtones (WebAudio oscillators,
 *     same technique as the dashboard's activity chime): no asset files, no
 *     download, work offline;
 *   · DEVICE UPLOAD — any audio file the learner picks (mp3/m4a/ogg/wav…),
 *     kept in IndexedDB via the offline cache, played through <audio loop>.
 *
 * The choice is device-local (localStorage key + IDB blob) — like records,
 * it is a preference of this browser, not a synced profile field.
 *
 * Playback contract:
 *   · previewAlarm(choice) — one-shot listen (settings sheet ▶ buttons);
 *   · startAlarm()/stopAlarm() — the alarm itself: the default patterns
 *     repeat ring-ring…ring-ring like a phone until stopped; an upload
 *     loops. The dashboard rings on the live_class_starting /
 *   · live_class_live socket events and shows a stoppable banner.
 *
 * Autoplay caveat (same as the existing activity chime): browsers may keep
 * the AudioContext suspended until the learner has interacted with the
 * page. In practice a signed-in learner has tapped plenty before a
 * scheduled class fires; if not, the ring is silent but the banner + toast
 * still land. Best effort, never a crash.
 */
import { cacheGet, cacheSet } from './offlineCache.js';

const CHOICE_KEY    = 'akoro_alarm_sound';
const CUSTOM_KEY    = 'alarm_sound_custom';   // offline-cache key: { blob, name }
const MAX_CUSTOM_MB = 5;

/* ── Platform defaults — ids map to PATTERNS below ── */
export const ALARM_DEFAULTS = [
  { id: 'chime',    label: 'Classic Chime'   },
  { id: 'bell',     label: 'School Bell'     },
  { id: 'beeps',    label: 'Alarm Beeps'     },
  { id: 'arpeggio', label: 'Bright Arpeggio' },
];

/** Current choice: 'none' | 'default:<id>' | 'custom'. Default: chime. */
export function getAlarmChoice() {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    if (v === 'none' || v === 'custom' || (v && v.startsWith('default:'))) return v;
  } catch { /* ssr / private mode */ }
  return 'default:chime';
}

/** Persist the choice (fire-and-forget, device-local). */
export function storeAlarmChoice(choice) {
  try { localStorage.setItem(CHOICE_KEY, choice); } catch { /* private mode */ }
}

/** Human label for the settings row. */
export function alarmChoiceLabel(choice, customName) {
  if (choice === 'none')  return '🔇 Silent';
  if (choice === 'custom') return customName || 'Uploaded sound';
  const d = ALARM_DEFAULTS.find((x) => `default:${x.id}` === choice);
  return d ? d.label : 'Classic Chime';
}

/* ── Device upload — IndexedDB blob + lazy object URL ── */
export async function getCustomAlarmMeta() {
  const rec = await cacheGet(CUSTOM_KEY);
  return rec?.data?.name ? { name: rec.data.name } : null;
}

/** Store an uploaded sound. Throws Error(message) on bad type/size. */
export async function saveCustomAlarm(file) {
  if (!file) throw new Error('No file picked');
  if (!/^audio\//.test(file.type || '')) throw new Error('Please pick an audio file (mp3, m4a, ogg, wav…)');
  if (file.size > MAX_CUSTOM_MB * 1024 * 1024) throw new Error(`Audio must be under ${MAX_CUSTOM_MB}MB`);
  await cacheSet(CUSTOM_KEY, { blob: file, name: file.name || 'Uploaded sound' });
  revokeCustomUrl();
  return { name: file.name || 'Uploaded sound' };
}

export async function clearCustomAlarm() {
  await cacheSet(CUSTOM_KEY, null);
  revokeCustomUrl();
}

/* ── WebAudio — shared context, one scheduled pattern at a time ── */
let _ctx = null;
function audioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return _ctx;
  } catch { return null; }
}

/* Each pattern schedules notes on the context and returns its length in
   seconds. Sine/triangle + gain envelopes — same DNA as the dashboard's
   activity chime, just more opinionated. */
const NOTE = (ctx, dest, { freq, at, dur = 0.5, type = 'sine', peak = 0.16 }) => {
  const o = ctx.createOscillator(), g = ctx.createGain();
  const t0 = ctx.currentTime + at;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05);
};

const PATTERNS = {
  /* E5 → A5 → D6, the polite three-note chime */
  chime(ctx, dest) {
    [[659.25, 0], [880, 0.15], [1174.66, 0.3]].forEach(([f, a]) => NOTE(ctx, dest, { freq: f, at: a, dur: 0.55 }));
    return 1.0;
  },
  /* A struck bell (fundamental + inharmonic overtone), twice — ding…ding */
  bell(ctx, dest) {
    [0, 0.95].forEach((at) => {
      NOTE(ctx, dest, { freq: 587.33, at, dur: 0.85, peak: 0.18 });
      NOTE(ctx, dest, { freq: 1568,   at, dur: 0.45, peak: 0.05 });
    });
    return 1.9;
  },
  /* Four urgent square-ish beeps */
  beeps(ctx, dest) {
    [0, 0.28, 0.56, 0.84].forEach((at) => NOTE(ctx, dest, { freq: 880, at, dur: 0.16, type: 'square', peak: 0.1 }));
    return 1.1;
  },
  /* Rising major arpeggio, two passes */
  arpeggio(ctx, dest) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => NOTE(ctx, dest, { freq: f, at: i * 0.11, dur: 0.3, type: 'triangle', peak: 0.15 }));
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => NOTE(ctx, dest, { freq: f, at: 0.6 + i * 0.11, dur: 0.42, type: 'triangle', peak: 0.15 }));
    return 1.4;
  },
};

/* Pattern lengths (seconds) — static, so loop/preview timing never has
   to "dry-run" a pattern to measure it. Keep in step with PATTERNS. */
const PATTERN_LEN = { chime: 1.0, bell: 1.9, beeps: 1.1, arpeggio: 1.4 };

/* ── Custom (uploaded) playback — lazy object URL + one <audio> ── */
let _customUrl = null, _customAudio = null;
function revokeCustomUrl() {
  try { if (_customUrl) URL.revokeObjectURL(_customUrl); } catch { /* ignore */ }
  _customUrl = null;
}
async function customAudio() {
  const rec = await cacheGet(CUSTOM_KEY);
  const blob = rec?.data?.blob;
  if (!blob) return null;
  try {
    if (!_customUrl) _customUrl = URL.createObjectURL(blob);
    if (!_customAudio) {
      _customAudio = new Audio();
      _customAudio.loop = true;
      _customAudio.volume = 0.9;
    }
    _customAudio.src = _customUrl;
    return _customAudio;
  } catch { return null; }
}

/** Play a default pattern once by id (best effort). */
function playPatternOnce(id) {
  const ctx = audioCtx();
  if (!ctx) return;
  try { (PATTERNS[id] || PATTERNS.chime)(ctx, ctx.destination); } catch { /* ignore */ }
}

/* ── Preview (settings sheet) ── */
let _previewTimer = null;
export function stopPreview() {
  try { if (_previewTimer) clearTimeout(_previewTimer); } catch { /* ignore */ }
  _previewTimer = null;
  try { if (_customAudio) { _customAudio.loop = false; _customAudio.pause(); } } catch { /* ignore */ }
}

/** One-shot listen: defaults ring once-ish, uploads play ~8s. */
export async function previewAlarm(choice) {
  stopPreview();
  if (!choice || choice === 'none') return;
  if (choice === 'custom') {
    const a = await customAudio();
    if (!a) return;
    try {
      a.loop = false;
      a.currentTime = 0;
      await a.play();
      _previewTimer = setTimeout(() => { try { a.pause(); } catch { /* ignore */ } }, 8000);
    } catch { /* autoplay blocked — best effort */ }
    return;
  }
  const id = choice.replace('default:', '');
  playPatternOnce(id);
  /* a two-ring preview so the "ringtone" character comes across */
  _previewTimer = setTimeout(() => playPatternOnce(id), (PATTERN_LEN[id] + 0.9) * 1000);
}


/* ── The alarm itself — ring until stopped ── */
let _alarmTimer = null, _alarmAudio = null;
export function stopAlarm() {
  try { if (_alarmTimer) clearInterval(_alarmTimer); } catch { /* ignore */ }
  _alarmTimer = null;
  try { if (_alarmAudio) _alarmAudio.pause(); } catch { /* ignore */ }
  _alarmAudio = null;
}

export async function startAlarm() {
  stopAlarm();
  const choice = getAlarmChoice();
  if (choice === 'none') return;
  if (choice === 'custom') {
    const a = await customAudio();
    if (!a) return;
    _alarmAudio = a;
    try { a.loop = true; a.currentTime = 0; await a.play(); } catch { /* autoplay blocked */ }
    return;
  }
  const id = choice.replace('default:', '');
  playPatternOnce(id);
  _alarmTimer = setInterval(() => playPatternOnce(id), (PATTERN_LEN[id] + 1.3) * 1000);  // ring-ring…ring-ring
}
