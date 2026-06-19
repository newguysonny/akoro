/**
 * trainingApi.js — connects the instructor app to the real agent-training
 * backend at /api/adaptive/training/*.
 *
 * Pipeline (backend): upload → Whisper transcription → GPT-4o style + segment
 * extraction → pgvector embeddings → orchestration config → XP summary.
 *
 * Progress is consumed by POLLING the run status/logs/insights endpoints
 * (all behind authenticateToken, reached with credentialed fetch). We avoid
 * EventSource because the SSE handler sends `Access-Control-Allow-Origin: *`,
 * which browsers reject for credentialed cross-origin streams in production.
 */

import { API } from './api.js';

const jget = (path) =>
  fetch(`${API}${path}`, { credentials: 'include' }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `GET ${path} -> ${r.status}`);
    return j;
  });

const jpost = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `POST ${path} -> ${r.status}`);
    return j;
  });

/* ── Upload an audio/video file to start a training run ───────────────── */
// Multipart POST → { runId, sessionId }. `onProgress(pct)` tracks the upload.
export function uploadTraining({ file, teacherId, agentId, subject, sessionTitle, onProgress }) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('teacherId', teacherId);
    fd.append('agentId', agentId);
    fd.append('subject', subject || 'General');
    if (sessionTitle) fd.append('sessionTitle', sessionTitle);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/adaptive/training/upload`);
    xhr.withCredentials = true; // send HttpOnly auth cookie
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let j = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* noop */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(j);
      else reject(new Error(j.error || j.message || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(fd);
  });
}

/* ── Run inspection endpoints ─────────────────────────────────────────── */
export const getRunStatus   = (runId)         => jget(`/api/adaptive/training/run/${runId}/status`);
export const getRunLogs     = (runId, from = 0) => jget(`/api/adaptive/training/run/${runId}/logs?from=${from}`);
export const getRunInsights = (runId, from = 0) => jget(`/api/adaptive/training/run/${runId}/insights?from=${from}`);

/* ── Poll a run to completion, streaming logs/insights/progress ───────── */
// Returns a stop() function. Callbacks: onProgress, onLog, onInsight,
// onComplete(summary), onError(err).
export function pollTrainingRun(runId, {
  onProgress, onLog, onInsight, onComplete, onError, intervalMs = 1200,
} = {}) {
  let stopped = false, logFrom = 0, insFrom = 0, failures = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const status = await getRunStatus(runId);
      onProgress?.({ phase: status.phase, pct: status.pct, totalXP: status.totalXP });

      const lg = await getRunLogs(runId, logFrom);
      if (lg.logs?.length) { lg.logs.forEach((l) => onLog?.(l)); logFrom = lg.from + lg.logs.length; }

      const ins = await getRunInsights(runId, insFrom);
      if (ins.insights?.length) { ins.insights.forEach((i) => onInsight?.(i)); insFrom += ins.insights.length; }

      failures = 0;
      if (status.status === 'complete') { stopped = true; onComplete?.(status.summary); return; }
      if (status.status === 'error')    { stopped = true; onError?.(new Error('Training run failed')); return; }
    } catch (e) {
      // Tolerate transient errors (run not registered yet, brief network blips).
      if (++failures > 8) { stopped = true; onError?.(e); return; }
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };

  tick();
  return () => { stopped = true; };
}

/* ── History + teacher training profile ───────────────────────────────── */
export const getTrainingSessions = (teacherId) => jget(`/api/adaptive/training/sessions/${teacherId}`);
export const getTrainingProfile  = (teacherId) => jget(`/api/adaptive/training/profile/${teacherId}`);

/* ── Live device-stream training (REST chunked) ───────────────────────── */
export const liveStreamStart = ({ teacherId, subject }) =>
  jpost('/api/adaptive/training/stream/start', { teacher_id: teacherId, subject });
export const liveStreamChunk = ({ sessionId, audioBase64, text }) =>
  jpost('/api/adaptive/training/stream/chunk', { session_id: sessionId, audio_base64: audioBase64, text });
export const liveStreamEnd = ({ sessionId }) =>
  jpost('/api/adaptive/training/stream/end', { session_id: sessionId });
