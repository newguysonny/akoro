/**
 * useSpeakReply — read an agent reply aloud (POST /api/voice/speak, OpenAI
 * TTS). One reply plays at a time; speaking another stops the first.
 * Voice costs coins: a 402 says so instead of failing silently.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '../services/api.js';
import { speakableText } from '../lib/speech.js';

export function useSpeakReply({ voice = 'nova' } = {}) {
  const [speakingId, setSpeakingId] = useState(null);   // the message being read
  const [loadingId, setLoadingId] = useState(null);
  const [speakError, setSpeakError] = useState('');
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const stop = useCallback(() => {
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    audioRef.current = null;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(async (id, markdown) => {
    stop();
    const text = speakableText(markdown);
    if (!text) return;
    setSpeakError(''); setLoadingId(id);
    try {
      const r = await fetch(`${API}/api/voice/speak`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
        body: JSON.stringify({ text, voice }),
      });
      if (r.status === 402) { setSpeakError('Listening needs coins — top up to hear replies.'); return; }
      if (!r.ok) { setSpeakError('Couldn’t read that aloud — try again.'); return; }
      const url = URL.createObjectURL(await r.blob());
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { if (audioRef.current === audio) stop(); };
      setSpeakingId(id);
      await audio.play().catch(() => { setSpeakError('Tap Listen to hear the reply.'); stop(); });
    } catch {
      setSpeakError('Couldn’t read that aloud — check your connection.');
    } finally { setLoadingId(null); }
  }, [stop, voice]);

  useEffect(() => stop, [stop]);   // leaving the chat stops the voice
  return { speak, stop, speakingId, loadingId, speakError, clearSpeakError: () => setSpeakError('') };
}
