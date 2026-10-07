/**
 * useVoiceAnswer — reliable record→transcribe mic for the assessment.
 *
 * Instead of a live realtime STT socket (needs Realtime API access + an
 * authenticated socket, and fails silently), this records the answer with
 * MediaRecorder and POSTs it to /api/voice/transcribe (Deepgram/Whisper) over
 * authenticated fetch, then hands back the transcript. Tap to start, tap to
 * send.
 */
import { useState, useRef, useCallback } from 'react';
import { API, getPortal, withAuth } from '../services/api.js';

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const t of opts) { try { if (window.MediaRecorder?.isTypeSupported?.(t)) return t; } catch { /* ignore */ } }
  return '';
}

export function useVoiceAnswer({ onTranscript }) {
  const [recording, setRecording]   = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError]     = useState('');
  const mrRef     = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const start = useCallback(async () => {
    setMicError('');
    if (!window.MediaRecorder) { setMicError('Recording isn’t supported on this browser — please type.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setRecording(false);
        if (blob.size < 1200) { setMicError('That was too short — hold the mic while you answer.'); return; }
        setTranscribing(true);
        try {
          const ext = (mr.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const fd = new FormData();
          fd.append('audio', blob, `answer.${ext}`);
          const r = await fetch(`${API}/api/voice/transcribe`, {
            ...withAuth({ method: 'POST', headers: { 'X-Akoro-Portal': getPortal() } }), body: fd,
          });
          const d = await r.json().catch(() => ({}));
          if (r.status === 402) setMicError('Voice needs coins — top up, or type your answer.');
          else if (r.ok && d.transcript?.trim()) onTranscript(d.transcript.trim());
          else setMicError(d.error || 'Couldn’t catch that — try again or type your answer.');
        } catch {
          setMicError('Transcription failed — please type your answer.');
        } finally { setTranscribing(false); }
      };
      mrRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setMicError('Microphone access is needed to answer by voice.');
      setRecording(false);
    }
  }, [onTranscript]);

  const stop = useCallback(() => {
    try { mrRef.current?.state === 'recording' && mrRef.current.stop(); } catch { /* ignore */ }
  }, []);

  return { recording, transcribing, micError, start, stop };
}
