/**
 * VoiceChatPanel — realtime voice conversation with the AI study assistant,
 * using Deepgram's Agent (speech-to-speech) WebSocket. Ported UI/behavior
 * from the deepgram-voice-agent-demo reference app onto our chat page.
 *
 * Lifecycle: mint token -> open mic -> open Deepgram socket -> send Settings
 * -> stream mic PCM in, play agent PCM out, surface live transcript.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, PhoneOff, Loader2, AlertCircle } from 'lucide-react';
import { API } from '../../services/api.js';
import VoiceOrb from './VoiceOrb.jsx';
import { createAudioBuffer, playAudioBuffer, downsample, convertFloat32ToInt16, normalizeVolume } from './voiceAudioUtils.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../../constants.js';

const STATUS_LABEL = {
  none: 'Starting…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', sleeping: 'Paused',
};

export default function VoiceChatPanel({ onClose, onExchange }) {
  const [status, setStatus] = useState('none'); // none | listening | thinking | speaking | sleeping
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [agentVolume, setAgentVolume] = useState(0);
  const [userVolume, setUserVolume] = useState(0);
  const [liveText, setLiveText] = useState({ user: '', assistant: '' });
  const [orbSize, setOrbSize] = useState({ width: 220, height: 220 });

  const orbBoxRef = useRef(null);
  const socketRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioCtxInRef = useRef(null);
  const audioCtxOutRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const agentAnalyserRef = useRef(null);
  const userAnalyserRef = useRef(null);
  const startTimeRef = useRef(-1);
  const keepAliveRef = useRef(null);
  const scheduledSourcesRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!orbBoxRef.current) return;
    const el = orbBoxRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setOrbSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const teardown = useCallback(() => {
    mountedRef.current = false;
    try { clearInterval(keepAliveRef.current); } catch {}
    try { socketRef.current?.close(); } catch {}
    try { processorRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioCtxInRef.current?.close(); } catch {}
    try { audioCtxOutRef.current?.close(); } catch {}
    scheduledSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    scheduledSourcesRef.current = [];
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const bufferAudio = useCallback((data) => {
    const ctx = audioCtxOutRef.current;
    if (!ctx) return;
    const buffer = createAudioBuffer(ctx, data);
    if (!buffer) return;
    scheduledSourcesRef.current.push(playAudioBuffer(ctx, buffer, startTimeRef, agentAnalyserRef.current));
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      // 1. Mint a Deepgram agent token + role-aware prompt from our backend.
      const res = await fetch(`${API}/api/voice/agent-token`, { method: 'POST', credentials: 'include' });
      const cfg = await res.json();
      if (!res.ok || !cfg.access_token) throw new Error(cfg.error || 'Could not start voice chat');

      // 2. Open the mic.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: false },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      micStreamRef.current = stream;

      const audioCtxIn = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxInRef.current = audioCtxIn;
      const source = audioCtxIn.createMediaStreamSource(stream);
      sourceRef.current = source;
      userAnalyserRef.current = audioCtxIn.createAnalyser();
      userAnalyserRef.current.fftSize = 2048;
      userAnalyserRef.current.smoothingTimeConstant = 0.96;
      source.connect(userAnalyserRef.current);

      const processor = audioCtxIn.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const audioCtxOut = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 24000 });
      audioCtxOutRef.current = audioCtxOut;
      agentAnalyserRef.current = audioCtxOut.createAnalyser();
      agentAnalyserRef.current.fftSize = 2048;
      agentAnalyserRef.current.smoothingTimeConstant = 0.96;

      // Volume meters driving the orb.
      const agentData = new Uint8Array(agentAnalyserRef.current.frequencyBinCount);
      const userData = new Uint8Array(userAnalyserRef.current.frequencyBinCount);
      const meter = () => {
        if (!mountedRef.current) return;
        setAgentVolume(normalizeVolume(agentAnalyserRef.current, agentData, 48));
        setUserVolume(normalizeVolume(userAnalyserRef.current, userData, 48));
        requestAnimationFrame(meter);
      };
      requestAnimationFrame(meter);

      // 3. Open the Deepgram Agent WebSocket.
      const socket = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', ['bearer', cfg.access_token]);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (!mountedRef.current) return;
        socket.send(JSON.stringify({
          type: 'Settings',
          audio: {
            input: { encoding: 'linear16', sample_rate: 16000 },
            output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
          },
          agent: {
            listen: { provider: { type: 'deepgram', model: 'nova-3' } },
            speak: { provider: { type: 'deepgram', model: 'aura-asteria-en' } },
            think: { provider: { type: 'open_ai', model: 'gpt-4o' }, prompt: cfg.prompt },
            greeting: cfg.greeting,
          },
        }));
        keepAliveRef.current = setInterval(() => {
          try { socket.send(JSON.stringify({ type: 'KeepAlive' })); } catch {}
        }, 10000);
        source.connect(processor);
        processor.connect(audioCtxIn.destination);
        processor.onaudioprocess = (e) => {
          if (mutedRef.current) return;
          const input = e.inputBuffer.getChannelData(0);
          const down = downsample(input, audioCtxIn.sampleRate, 16000);
          socket.send(convertFloat32ToInt16(down));
        };
        setStatus('listening');
      });

      socket.addEventListener('error', () => { if (mountedRef.current) setError('Connection error — please try again.'); });
      socket.addEventListener('close', () => { if (mountedRef.current) setStatus((s) => (s === 'none' ? s : 'sleeping')); });

      socket.addEventListener('message', (event) => {
        if (!mountedRef.current) return;
        if (event.data instanceof ArrayBuffer) { bufferAudio(event.data); return; }
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.role === 'user') {
          setLiveText((p) => ({ ...p, user: msg.content || '' }));
        }
        if (msg.role === 'assistant') {
          setStatus('speaking');
          setLiveText((p) => ({ ...p, assistant: msg.content || '' }));
        }
        if (msg.type === 'UserStartedSpeaking') {
          setStatus('listening');
          scheduledSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
          scheduledSourcesRef.current = [];
        }
        if (msg.type === 'AgentAudioDone') setStatus('listening');
        if (msg.type === 'ConversationText' && msg.role && msg.content && onExchange) {
          onExchange({ role: msg.role, content: msg.content });
        }
      });
    } catch (err) {
      setError(err.message || 'Could not access the microphone.');
      setStatus('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { start(); return () => teardown(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => setMuted((m) => { mutedRef.current = !m; return !m; });

  const end = () => { teardown(); onClose?.(); };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: `linear-gradient(180deg, ${LIGHT}, ${WHITE})` }}>
      {error ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 320, textAlign: 'center' }}>
          <AlertCircle size={28} color={RED} />
          <p style={{ fontSize: 13.5, color: INK, margin: 0 }}>{error}</p>
          <button onClick={start} style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Try again</button>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Back to text chat</button>
        </div>
      ) : (
        <>
          <div ref={orbBoxRef} style={{ width: 220, height: 220, maxWidth: '60vw', maxHeight: '60vw', cursor: 'default' }}>
            <VoiceOrb width={orbSize.width} height={orbSize.height} agentVolume={agentVolume} userVolume={userVolume} status={status} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 13, fontWeight: 700, color: status === 'speaking' ? AMBER : MUTED }}>
            {status === 'none' && <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} />}
            {STATUS_LABEL[status] || 'Connecting…'}
          </div>

          <div style={{ minHeight: 44, maxWidth: 420, textAlign: 'center', marginTop: 14, padding: '0 8px' }}>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: INK, margin: 0 }}>
              {liveText.assistant || liveText.user || 'Say hello to get started…'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22 }}>
            <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} style={{ width: 48, height: 48, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: muted ? '#FEE2E2' : WHITE, color: muted ? RED : MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {muted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
            <button onClick={end} title="End voice chat" style={{ width: 54, height: 54, borderRadius: '50%', border: 'none', background: RED, color: WHITE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(239,68,68,.35)' }}>
              <PhoneOff size={21} />
            </button>
          </div>
          <p style={{ fontSize: 10.5, color: MUTED2, marginTop: 16 }}>Powered by Deepgram voice AI · AI can make mistakes</p>
        </>
      )}
    </div>
  );
}
