import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { startMicCapture } from '../../utils/micCapture.js';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { acquireActivityLock } from '../../utils/activityLock.js';
import { useWakeLock } from '../../hooks/useWakeLock.js';
import { API, apiGet, apiPost } from '../../services/api.js';
import { guideReply } from '../../services/recordsApi.js';
const AGENT_CONFIG = { name: '', emoji: '🤖', guideName: 'NaNa Esumai', guideEmoji: '🧠', guideRenderStyle: {} };
import { XIcon, SparkleIcon, ZapIcon, BrainIcon, Icon } from '../common/Icons.jsx';
import SessionChatView from './SessionChatView.jsx';
import { makeQuote, withQuote } from '../../lib/quotedMessage.js';
import { materialText, localLearnSuggestions, learnSuggestionInput, shapeLearnSuggestions } from '../../lib/learnSuggestions.js';
import SessionReaderModal, { buildSessionReaderPages, useIsMobileView } from './SessionReaderModal.jsx';
import WhiteboardModal from './WhiteboardModal.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function TeachAgentModal({ session, config, onClose, onMinimize, onSessionStarted, onSessionSaved, content = null }) {
  // Hold the activity lock so an auto-reload can't interrupt a teaching session.
  useEffect(() => acquireActivityLock(), []);
  // Keep the screen awake while a session runs (teaching, continuation,
  // revision, agent sessions over records and course lessons). No-op where
  // the Wake Lock API is unsupported.
  useWakeLock();
  const { t } = useLang();
  const topic     = config?.topic    || session?.topic    || "your topic";
  const subject   = config?.subject  || session?.subject  || "science";
  const agentNm   = config?.agentName  || AGENT_CONFIG.name;
  const agentEm   = config?.agentEmoji || AGENT_CONFIG.emoji;
  const guideNm   = config?.guideName   || session?.guideName   || AGENT_CONFIG.guideName   || "NaNa Esumai";
  const guideEm   = config?.guideEmoji  || session?.guideEmoji  || AGENT_CONFIG.guideEmoji  || "🧠";
  const guideRS   = config?.guideRenderStyle || session?.guideRenderStyle || AGENT_CONFIG.guideRenderStyle || {};
  const ttsVoice  = "nova";   // student AI agent voice — consistent across all teachers
  const mode      = config?.mode || session?.mode || "fresh";
  const prevSessId = config?.sessionId || config?.id || session?.id || null;
  // A minimized session reopens with its live id: resume the surviving
  // orchestrator first (disconnect grace window); resume_failed falls back to
  // the normal start, which — with mode + sessionId — continues from the
  // saved history. Either way the conversation comes back.
  const resumeSid = config?.resumeSessionId || session?.resumeSessionId || null;

  const [sessionId,  setSessionId]  = useState(null);
  // The session is driven entirely over the WebSocket (start_adaptive_session →
  // session_ready, teacher_message → turn_complete, request_summary →
  // session_summary). Blocks start empty and a loading state shows until the
  // server responds — no REST, no fabricated content.
  const [blocks,     setBlocks]     = useState([]);
  const [initLoading, setInitLoading] = useState(true);
  const [prepNote, setPrepNote] = useState('');   // shown while the lesson is being prepared
  const [input,      setInput]      = useState("");
  const [quote,      setQuote]      = useState(null);   // a reader passage riding the next message
  const [recording,  setRecording]  = useState(false);
  const [seconds,    setSeconds]    = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("chat");
  const [summary,    setSummary]    = useState(null);
  const [summaryErr, setSummaryErr] = useState("");
  // A review with the teaching guide on what was just taught (battle/guideReview.js).
  const [review,     setReview]     = useState({ busy: false, msg: "" });
  const navigate = useNavigate();
  const requestReview = async () => {
    setReview({ busy: true, msg: "" });
    try {
      const r = await apiPost('/api/battle/guide-reviews', sessionId ? { sessionId } : { subject: session?.subject, topic: session?.topic });
      const id = r?.data?.battleId ?? r?.battleId;
      if (!id) throw new Error(r?.error || 'Could not start the review.');
      onClose?.();
      navigate(`/app?tab=battles&battle=${id}`);
    } catch (e) {
      setReview({ busy: false, msg: e?.message || 'Could not start the review.' });
    }
  };
  const [wsReady,    setWsReady]    = useState(false);
  // Socket lifecycle for the connection chip: "connecting" | "connected" | "reconnecting"
  const [connState,  setConnState]  = useState("connecting");
  const timerRef      = useRef(null);
  const wsRef         = useRef(null);
  const sessionIdRef  = useRef(resumeSid);
  const endedRef      = useRef(false);    // the session ended (by the learner, or by itself: every part taught / a limit)   // live session id — drives seamless resume on reconnect AND on minimize→restore
  // True the moment the learner minimizes: the unmount cleanup must NOT end
  // the server session then — a park keeps it resumable.
  const parkedRef     = useRef(false);
  const pendingSendRef = useRef(null);  // message typed during a drop — flushed on reconnect
  const mediaRef      = useRef(null);    // MediaRecorder — audio (blob) mode
  const voiceMediaRef = useRef(null);    // PCM capture handle — voice (streaming) mode
  const voiceReadyRef = useRef(false);   // backend STT connection open
  const chunksRef     = useRef([]);
  // How the human delivered their last message: 'text' | 'audio' | 'live'.
  // The agent mirrors this — text gets text, voice gets voice.
  const lastModalityRef = useRef("text");
  const speakSeqRef     = useRef(0);     // bumped per turn — stops stale speech queues

  // Streaming TTS refs
  const ttsAudioRef = useRef(null);   // current <audio> element
  const ttsMsRef    = useRef(null);   // MediaSource
  const ttsSbRef    = useRef(null);   // SourceBuffer
  const ttsQueueRef = useRef([]);     // pending ArrayBuffers while SourceBuffer is busy
  const ttsDoneRef  = useRef(false);  // server signalled stream complete
  const ttsChunksRef = useRef([]);    // accumulated mp3 bytes → replayable agent bubble

  const stopTts = () => {
    wsRef.current?.emit("stop_tts_stream");
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      try { URL.revokeObjectURL(ttsAudioRef.current.src); } catch {}
      ttsAudioRef.current = null;
    }
    ttsMsRef.current    = null;
    ttsSbRef.current    = null;
    ttsQueueRef.current = [];
    ttsDoneRef.current  = false;
    ttsChunksRef.current = [];
  };

  const streamTts = (text, seq) => {
    if (!wsRef.current?.connected || !text) return;
    stopTts();

    const ms    = new MediaSource();
    const audio = new Audio();
    ttsAudioRef.current = audio;
    ttsMsRef.current    = ms;
    ttsQueueRef.current = [];
    ttsDoneRef.current  = false;

    audio.src = URL.createObjectURL(ms);

    ms.addEventListener("sourceopen", () => {
      let sb;
      try { sb = ms.addSourceBuffer("audio/mpeg"); }
      catch { return; }
      ttsSbRef.current = sb;

      const flush = () => {
        if (sb.updating || ttsQueueRef.current.length === 0) return;
        sb.appendBuffer(ttsQueueRef.current.shift());
      };

      sb.addEventListener("updateend", () => {
        if (ttsSbRef.current !== sb) return;
        if (ttsQueueRef.current.length > 0) { flush(); return; }
        if (ttsDoneRef.current && !sb.updating) {
          try { ms.endOfStream(); } catch {}
        }
      });

      // Drain anything queued before sourceopen fired
      flush();
    }, { once: true });

    audio.play().catch(() => {});
    wsRef.current.emit("start_tts_stream", { text, voice: ttsVoice, seq });
  };

  const maybeSpeak = (text) => {
    if (lastModalityRef.current !== "text" && text) streamTts(text, speakSeqRef.current);
  };

  const [voiceStreaming, setVoiceStreaming] = useState(false);
  const [interimText,    setInterimText]   = useState("");     // audio chunks
  const [voiceLevel,     setVoiceLevel]    = useState(0);      // 0..1 mic loudness, for the meter
  const [cogState,       setCogState]      = useState(null);   // live cognitive state
  // Streaming tokens for the turn in flight — Protégé and Guide replies
  // appear token-by-token with a blinking cursor until turn_complete lands.
  const [liveStudent, setLiveStudent] = useState(null);
  const [liveGuide,   setLiveGuide]   = useState(null);
  const clearLiveStream = () => { setLiveStudent(null); setLiveGuide(null); };

  // Mid-session teacher switching
  const [guide,        setGuide]        = useState({ name: guideNm, emoji: guideEm });
  const [currentPair,  setCurrentPair]  = useState("nana-esumai");
  const [switchOpen,   setSwitchOpen]   = useState(false);
  const [switching,    setSwitching]    = useState(false);
  const [agentChoices, setAgentChoices] = useState(null);   // null = not yet loaded

  // ── Session material (records, course lessons) ───────────────────────────
  // `content` swaps the reader's session guide for REAL material — the
  // record's file, the course video — and puts a compact content box above
  // the composer: one tap from the chat to the material and back. The
  // teaching pump (WebSocket, teach-back, confidence, continuation) is
  // exactly the same; only what the reader shows changes.
  //   content = { state:'loading'|'ready'|'error',
  //               box:{ icon, title, sub }, pct, err,
  //               docTitle, sourceName, media, pages,
  //               renderPageContent }
  // ── Session reader (Fortizo split: reader left, this chat right) ─────────
  // Opened from the book control in the chat composer — or the content box.
  // Mobile gets a full-screen reader modal over the session; desktop/tablet
  // get the Fortizo split with this chat embedded as the right column. The
  // session itself (WebSocket, blocks, voice) never restarts — only the
  // shell moves.
  const [readerOpen, setReaderOpen]   = useState(false);
  const contentAutoRef = useRef(false);
  const [boardOpen, setBoardOpen]     = useState(false);
  const isMobileView                  = useIsMobileView();
  const readerReference = config?.reference || session?.reference || null;
  const readerPages = useMemo(
    () => buildSessionReaderPages({
      topic, subject,
      reference: readerReference,
      subtopics: config?.subtopics || session?.subtopics || [],
      objectives: config?.objectives || session?.objectives || {},
    }),
    // The material is fixed at session start; topic/subject don't change mid-session.
    [readerReference, config?.subtopics, session?.subtopics],
  );
  // Learn suggestions (LEARNING WITH GUIDE): about the material open in this
  // session, else the topic. The material-derived ones show at once; the AI
  // ones, grounded in the same text, replace them when they arrive.
  const learnBase = useMemo(() => {
    const ready = content?.state === 'ready';
    return {
      // The real topic only — not the "your topic" display fallback.
      topic: config?.topic || session?.topic || '', subject: config?.subject || session?.subject || '',
      title: ready ? (content.docTitle || '') : (readerReference?.name || ''),
      text: materialText({ content, reference: readerReference }),
      subtopics: config?.subtopics || session?.subtopics || [],
    };
    // The material is fixed once ready; re-derive only when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.state, content?.pages, readerReference, topic, subject]);
  const [aiLearn, setAiLearn] = useState(null);   // { key, list }
  const learnKey = `${learnBase.title}|${learnBase.topic}|${learnBase.text.length}`;
  const learnSuggestions = aiLearn?.key === learnKey && aiLearn.list.length >= 3 ? aiLearn.list : localLearnSuggestions(learnBase);
  const openReader      = () => { if (!content || content.state === 'ready') setReaderOpen(true); };
  // Opened from a link that names a study tool: the reader opens on it, once, when the material is ready.
  const openToolDone = useRef(false);
  useEffect(() => {
    if (!config?.openTool || openToolDone.current || (content && content.state !== 'ready')) return;
    openToolDone.current = true;
    setReaderOpen(true);
  }, [config?.openTool, content?.state]);
  // A citation chip on the protégé's message: open the reader on that page
  // and flash the cited box (or seek the recording). The key re-fires a
  // jump to the same place; closing clears it so a reopen doesn't replay it.
  const [readerJump, setReaderJump] = useState(null);
  const closeReader     = () => { setReaderOpen(false); setReaderJump(null); };
  const jumpToCitation = (cite) => {
    if (!cite || !content || content.state !== 'ready') return;
    setReaderJump({ cite, key: Date.now() });
    setReaderOpen(true);
  };
  // With real material, desktop/tablet open the split the moment it lands
  // (once). Mobile keeps the chat-first flow with the content box — UNLESS
  // the caller passes config.readerFirst (the Pharm.D topic flow: the
  // material is the destination, the chat session opens from the chat icon).
  useEffect(() => {
    if (content && content.state === 'ready' && (config?.readerFirst || !isMobileView) && !contentAutoRef.current) {
      contentAutoRef.current = true;
      setReaderOpen(true);
    }
    // Fires on the ready FLIP only (guarded by the once-ref) — re-running on
    // every content object identity would fight the learner's own toggling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.state, isMobileView]);
  // "Ask the tutor" in the reader's selection popover: the selection sits as
  // a quote above the composer and the learner types their own question
  // (the copilot pattern); both go in the next message. On mobile the reader
  // closes so the chat (and the quote) is actually visible.
  const explainSelection = (text, { pageNumber = null } = {}) => {
    const q = makeQuote(text, pageNumber);
    if (!q) return;
    setQuote(q);
    if (isMobileView) setReaderOpen(false);
  };

  // ── Session mode toggle (LEARN BY TEACHING ↔ LEARNING WITH GUIDE) ────────
  // "guide": the guide teacher and the human, no protégé, no WebSocket. The
  // guide's replies come from the API (POST /api/records/guide): taught from
  // the open document with citations that jump the reader, and saved per
  // learner per document (content.guide); a session without a document is
  // taught from its topic. The live teaching session (if running) is kept
  // intact underneath — toggling back restores it untouched.
  const [chatMode,      setChatMode]      = useState("teach");
  const [guideMessages, setGuideMessages] = useState([]);
  const [guideBusy,     setGuideBusy]     = useState(false);
  const guideLoadedRef  = useRef(false);
  const guideApi        = content?.guide || null;
  const guideOpening    = () => ({ role: "guide", text: t('teaching.guide_open').replace('{name}', guide.name) });
  // A live teaching session takes the guide mode too (Phase 6, D24): NaNa teaches over the same session —
  // her answers are evidence and the progress gate reads them. Without a live session (a document guide),
  // the guide chat stays the reader's own (POST /api/records/guide).
  const liveSession = () => !!(wsRef.current?.connected && sessionIdRef.current && !endedRef.current);
  const patchPendingGuide = (patch) => setGuideMessages(prev => {
    const next = [...prev];
    const at = next.map((m) => m.pending).lastIndexOf(true);
    if (at >= 0) next[at] = { ...next[at], ...patch };
    return next;
  });
  const toggleChatMode  = () => {
    const nextMode = chatMode === "teach" ? "guide" : "teach";
    if (liveSession()) wsRef.current.emit("set_teaching_mode", { mode: nextMode === "guide" ? "learn_with_guide" : "teach_agent" });
    setChatMode(m => (m === "teach" ? "guide" : "teach"));
    setGuideMessages(prev => prev.length ? prev : [guideOpening()]);
    // The learner's earlier guide lesson on this document, once.
    if (guideApi && !guideLoadedRef.current) {
      guideLoadedRef.current = true;
      guideApi.load().then((past) => {
        if (!past?.length) return;
        setGuideMessages((cur) => [guideOpening(), ...past.map((m) => ({
          role: m.role === "assistant" ? "guide" : "user", text: m.text, citations: m.citations || [],
        })), ...cur.slice(1)]);
      }).catch(() => {});
    }
  };
  // Asked once per material, the first time the guide chat opens.
  useEffect(() => {
    if (chatMode !== "guide" || aiLearn?.key === learnKey) return undefined;
    let live = true;
    // With a library document open, the suggestions come from its own pages (each cites one).
    apiPost('/api/adaptive/chat/learn-suggestions', { ...learnSuggestionInput(learnBase), ...(config?.document ? { document: config.document } : {}) }, { timeout: 20000 })
      .then((r) => { if (live) setAiLearn({ key: learnKey, list: shapeLearnSuggestions(r?.suggestions, r?.cited) }); })
      .catch(() => { if (live) setAiLearn({ key: learnKey, list: [] }); });
    return () => { live = false; };
  }, [chatMode, learnKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sendGuideMessage = (text) => {
    const clean = withQuote(text, quote);
    if (!clean || guideBusy) return;
    const question = String(text || '').trim() || 'Explain this passage.';
    const selection = quote ? { text: quote.text, ...(quote.pageNumber ? { pageNumber: quote.pageNumber } : {}) } : null;
    const history = guideMessages.filter((m) => m.role === 'user' || m.role === 'guide').slice(1);
    setInput("");
    setQuote(null);
    setGuideBusy(true);
    setGuideMessages(prev => [...prev, { role: "user", text: clean }, { role: "guide", text: "", pending: true }]);
    // Live session: the turn runs on the server (evidence, gate); the reply streams on guide_reply_token.
    if (liveSession()) { wsRef.current.emit("teacher_message", { message: clean, mode: "learn_with_guide" }); return; }
    const setReply = (patch) => setGuideMessages(prev => {
      const next = [...prev];
      const at = next.map((m) => m.pending).lastIndexOf(true);
      if (at >= 0) next[at] = { ...next[at], ...patch };
      return next;
    });
    let streamed = '';
    const send = guideApi ? guideApi.send : (opts) => guideReply(opts);
    send({
      message: question, selection, guideName: guide.name, topic, subject,
      ...(guideApi ? {} : { history }),
      onDelta: (d) => { streamed += d; setReply({ text: streamed }); },
    })
      .then((r) => setReply({ text: r?.answer || streamed, citations: r?.citations || [], pending: false }))
      .catch((e) => setReply({ role: "system", text: e?.message || t('teaching.guide_error'), pending: false }))
      .finally(() => setGuideBusy(false));
  };

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    // Connect WebSocket — the session lives entirely here. Import the socket
    // client directly (don't depend on a global window.io that may be unset
    // in some builds).
    const connect = io || (typeof window !== "undefined" ? window.io : null);
    if (connect) {
      const ws = connect(API, { transports:["websocket","polling"], withCredentials:true });
      wsRef.current = ws;

      // The server derives the learner from the authenticated socket. Do not
      // send a browser-controlled user or student identifier with a lesson.
      const startSession = () => ws.emit("start_adaptive_session", {
        topic,          subject,
        mode,
        sessionId:      prevSessId,
        teacherAgentId: config?.teacherAgentId || session?.teacherAgentId || AGENT_CONFIG.teacherAgentId,
        // Higher-ed reference text is capped by the upload endpoint; only this
        // short-lived session receives it, never a local record or later session.
        reference:      config?.reference || null,
        // { recordId } | { contentKey } — the server checks access, then
        // grounds every turn in the passages most relevant to it.
        document:       config?.document || null,
      });

      ws.on("connect", () => {
        setConnState("connected");
        // Seamless resume: if we already have a live session, re-bind to it
        // instead of starting a fresh one. The backend keeps the orchestrator
        // alive through a short grace window after a drop.
        if (sessionIdRef.current) {
          ws.emit("resume_session", { sessionId: sessionIdRef.current });
        } else {
          startSession();
        }
      });

      // Resumed onto the same orchestrator — re-enable sending and flush any
      // message typed during the drop. A REMOUNT (minimize → restore) arrives
      // with empty local blocks; the saved transcript the server sent with
      // the resume rebuilds them, so the parked conversation is exactly where
      // it was left. A mere reconnect keeps its intact blocks.
      ws.on("session_resumed", (d) => {
        setWsReady(true); setInitLoading(false);
        if (d?.historyBlocks?.length) setBlocks(prev => prev.length ? prev : d.historyBlocks);
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text, modality: p.modality }); }
      });

      // Orchestrator gone (server restart / different instance / grace expired)
      // — fall back to a fresh session, marking the break in the transcript.
      ws.on("resume_failed", () => {
        sessionIdRef.current = null;
        clearLiveStream();
        setBlocks(prev => prev.length
          ? [...prev, { type:"system-divider", label:"Reconnected — starting a new session" }]
          : prev);
        startSession();
      });

      // Connection dropped or failing — surface a reconnecting chip. Socket.IO
      // auto-reconnects; on success the "connect" handler above resumes.
      ws.on("disconnect",     () => { setConnState("reconnecting"); setLoading(false); });
      ws.on("connect_error",  () => setConnState("reconnecting"));
      ws.io?.on?.("reconnect_attempt", () => setConnState("reconnecting"));

      // Server acks immediately — show progress instead of a blank wait.
      ws.on("session_preparing", d => setPrepNote(`Preparing your lesson on ${d.topic}…`));
      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        onSessionStarted?.(d.sessionId);
        sessionIdRef.current = d.sessionId;
        setWsReady(true);
        setInitLoading(false); setPrepNote('');
        const gName  = d.guideProfile?.name  || guideNm;
        const gEmoji = d.guideProfile?.emoji || guideEm;
        if (d.guideProfile?.name) setGuide({ name: d.guideProfile.name, emoji: gEmoji });
        if (d.agentPairId) setCurrentPair(d.agentPairId);

        // Prefer the server-owned typed opening blocks. The objective tracker
        // remains the session's visible progress UI; the guide block carries a
        // safe learning state and next move instead of an internal phase.
        const opening = d.openingBlocks?.length
          ? d.openingBlocks
          : d.message
          ? [{ type:"guide", agent:gName, emoji:gEmoji, text:d.message }]
          : [];

        if (d.historyBlocks?.length) {
          setBlocks(prev => {
            const fresh = prev.filter(b => !b.faded && b.type !== "system-divider");
            return [...d.historyBlocks, { type:"system-divider", label:"Continuing from here" }, ...fresh, ...opening];
          });
        } else if (opening.length) {
          // Append (not replace) when a transcript already exists — e.g. a
          // fresh start after resume_failed should keep the prior messages.
          setBlocks(prev => prev.length ? [...prev, ...opening] : opening);
        }

        // Flush a message the user typed during the drop, if any.
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text, modality: p.modality }); }
      });

      // Backward compat
      // Persistence result for this session. The lesson runs off the in-memory
      // orchestrator, so a failed save is invisible without this — which is
      // precisely how sessions went missing from the Sessions tab.
      // onSessionStarted gets the LIVE id (resume_session, minimize); the
      // saved row's id (rowId) is what continuation and links need — the
      // adaptive_sessions id the server looks up later.
      ws.on("session_saved", d => {
        if (!d?.saved) console.error("[session] NOT saved — it will not appear in Sessions:", d?.error);
        else if (d.rowId) onSessionSaved?.(d.rowId);
      });

      ws.on("student_session_ready", d => { setSessionId(d.sessionId); onSessionStarted?.(d.sessionId); sessionIdRef.current = d.sessionId; setWsReady(true); setInitLoading(false); });

      // Summary delivered over the socket (replaces REST /teaching/summary).
      ws.on("session_summary", ({ summary }) => { setSummary(summary); setLoading(false); });
      ws.on("summary_error", ({ message }) => {
        console.warn("[TeachModal] summary failed:", message);
        setLoading(false);
        setSummaryErr("We couldn't generate your session summary right now. Please try again.");
      });

      ws.on("typing_start", () => setLoading(true));
      // ── Streaming token feedback ───────────────────────────────
      // The orchestrator streams Protégé and Guide tokens as they are
      // generated (student_token / guide_token). We accumulate them into
      // live bubbles with a blinking cursor; turn_complete then replaces
      // them with the authoritative blocks. Both payload shapes are
      // accepted ({token} from the node socket path, {text} from the
      // python SSE bridge contract).
      ws.on("student_token", (d) => setLiveStudent(prev => (prev || "") + (d?.token ?? d?.text ?? "")));
      // The guide's tip isn't shown as it streams: it arrives as ideas on the protégé's reply (turn_complete).
      ws.on("guide_token",   () => {});
      // Guide mode on the live session: NaNa's reply streams into the guide chat.
      ws.on("guide_reply_token", (d) => setGuideMessages(prev => {
        const next = [...prev];
        const at = next.map((m) => m.pending).lastIndexOf(true);
        if (at >= 0) next[at] = { ...next[at], text: (next[at].text || "") + (d?.token ?? "") };
        return next;
      }));
      ws.on("turn_complete", ({ blocks: newBlocks, currentPhase, teachingMode }) => {
        setLoading(false);
        clearLiveStream();
        if (teachingMode === "learn_with_guide") {
          const g = (newBlocks || []).find(b => b.type === "guide");
          patchPendingGuide({ text: g?.text || "", citations: g?.citations || [], pending: false });
          setGuideBusy(false);
          ws.emit("get_state");
          return;
        }
        if (newBlocks?.length) {
          setBlocks(prev => [...prev, ...newBlocks]);
          // TTS only when the human used voice — modality mirrors input.
          const agentBlock = newBlocks.find(b => b.type === "student-agent");
          maybeSpeak(agentBlock?.text);
          // Instant understanding read from the agent block; confusion comes
          // from the authoritative state snapshot we request below.
          if (agentBlock?.confidence != null)
            setCogState(prev => ({ ...prev, understanding: agentBlock.confidence, phase: currentPhase ?? prev?.phase }));
        }
        ws.emit("get_state");   // pull full cognitive snapshot for this turn
      });

      // Live cognitive state — both the push (state_update) and the
      // explicit snapshot (state_snapshot) resolve to the same shape.
      const applyState = (state) => {
        if (!state) return;
        const c = state.cognitive || state;
        setCogState(prev => ({
          understanding: c.understanding ?? prev?.understanding ?? 0,
          confusion:     c.confusion     ?? prev?.confusion     ?? 0,
          phase:         state.session?.phase ?? prev?.phase ?? null,
        }));
      };
      ws.on("state_update",   (state) => applyState(state));
      ws.on("state_snapshot", ({ state }) => applyState(state));

      // ── Mid-session teacher switching ──────────────────────────
      ws.on("agent_pair_switching", () => { setSwitching(true); setLoading(true); });
      ws.on("agent_pair_switched", d => {
        setSwitching(false);
        setLoading(false);
        setSwitchOpen(false);
        stopTts();                       // silence the previous teacher
        if (d.guideProfile?.name) setGuide({ name: d.guideProfile.name, emoji: d.guideProfile.emoji || "🧠" });
        if (d.agentPairId) setCurrentPair(d.agentPairId);
        const newGuideName = d.guideProfile?.name || "your guide";
        setBlocks(prev => [
          ...prev,
          { type:"system-divider", label:`Switched to ${newGuideName}` },
          ...(d.guideOpeningBlock ? [d.guideOpeningBlock] : d.message
            ? [{ type:"guide", agent:newGuideName, emoji:d.guideProfile?.emoji || "🧠", text:d.message }]
            : []),
        ]);
      });
      // The session ended itself (every part verified and the agent finished it, or a limit was reached).
      ws.on("session_ended", (d) => {
        endedRef.current = true;
        setLoading(false); setGuideBusy(false);
        if (d?.endedBy && d.endedBy !== "learner") {
          setBlocks(prev => [...prev, { type: "session-complete", text: d.endedBy === "objective_met"
            ? `Every part is taught — the session is complete.${d.summary?.xpEarned ? ` +${d.summary.xpEarned} XP earned.` : ""}`
            : "This session has reached its limit — what you taught is saved. You can start another any time." }]);
        }
      });
      ws.on("student_done", ()=>{});
      ws.on("guide_done",   ()=>{});
      ws.on("error", err => {
        console.warn("[TeachModal WS]", err.message);
        setLoading(false); setSwitching(false);
        clearLiveStream();   // a failed turn leaves no half-drawn bubbles
        // If the session never came up, surface the failure instead of leaving
        // the user on a silent spinner.
        if (!sessionIdRef.current) {
          setInitLoading(false);
          setBlocks(prev => prev.some(b => b.type === "system-divider") ? prev : [...prev, {
            type:"system-divider",
            label: err?.message ? `Couldn't start the session: ${err.message}` : "Couldn't start the session. Please try again.",
          }]);
        } else {
          // Mid-session failure (e.g. the turn errored). Surface it instead of
          // leaving the user staring at silence, and re-enable the composer.
          setBlocks(prev => [...prev, {
            type:"system-divider",
            label: err?.message ? `Couldn't get a reply: ${err.message}` : "Couldn't get a reply. Tap to try again.",
          }]);
        }
      });

      // ── Voice streaming events ─────────────────────────────────
      ws.on("voice_stream_ready", () => {
        // OpenAI realtime transcription open — start sending PCM chunks
        voiceReadyRef.current = true;
      });

      ws.on("voice_interim", ({ text, accumulated }) => {
        // Live grey text — words forming
        setInterimText((accumulated ? accumulated + " " : "") + text);
      });

      ws.on("voice_final", ({ accumulated }) => {
        // Sentence confirmed — update live display
        setInterimText(accumulated);
      });

      ws.on("voice_utterance_end", ({ transcript }) => {
        // Silence gap — update display
        setInterimText(transcript);
      });

      ws.on("voice_complete", ({ transcript }) => {
        // Stream closed — auto-submit transcript
        setVoiceStreaming(false);
        setInterimText("");
        if (transcript?.trim()) handleSend(transcript, "live");
      });

      ws.on("voice_error", ({ message }) => {
        // Shown, not logged.
        //
        // This was a console.warn and a silent flip-off, which is why a
        // server-side voice failure was indistinguishable from a dead button —
        // and why a misconfigured transcription session went unnoticed for
        // months. The server sends a real reason; the learner should read it.
        console.warn("[voice stream]", message);
        setVoiceStreaming(false);
        setInterimText("");
        setVoiceLevel(0);
        voiceMediaRef.current?.stop();
        voiceMediaRef.current = null;
        setBlocks(prev => [...prev, {
          type: "system-divider",
          label: message || "Voice couldn't start. You can keep typing.",
        }]);
      });

      // ── Streaming TTS events ───────────────────────────────────
      ws.on("tts_audio_chunk", ({ chunk, seq }) => {
        if (seq !== speakSeqRef.current) return;  // stale turn
        const bytes = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
        ttsChunksRef.current.push(bytes);         // keep a copy for replay
        const sb    = ttsSbRef.current;
        if (!sb) {
          // sourceopen hasn't fired yet — queue for later flush
          ttsQueueRef.current.push(bytes.buffer);
          return;
        }
        if (sb.updating) {
          ttsQueueRef.current.push(bytes.buffer);
        } else {
          sb.appendBuffer(bytes.buffer);
        }
      });

      ws.on("tts_stream_done", ({ seq }) => {
        if (seq !== speakSeqRef.current) return;
        ttsDoneRef.current = true;
        const sb = ttsSbRef.current;
        if (sb && !sb.updating && ttsQueueRef.current.length === 0) {
          try { ttsMsRef.current?.endOfStream(); } catch {}
        }
        // Attach the full spoken reply to the latest agent bubble so it can be
        // replayed (with its transcription already shown as the block text).
        if (ttsChunksRef.current.length) {
          const blob = new Blob(ttsChunksRef.current, { type:"audio/mpeg" });
          const url  = URL.createObjectURL(blob);
          setBlocks(prev => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].type === "student-agent") { copy[i] = { ...copy[i], audioUrl: url }; break; }
            }
            return copy;
          });
        }
      });

      ws.on("tts_stream_stopped", () => {
        // Backend confirmed abort — ensure local state is clean
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause();
          try { URL.revokeObjectURL(ttsAudioRef.current.src); } catch {}
          ttsAudioRef.current = null;
        }
        ttsMsRef.current  = null;
        ttsSbRef.current  = null;
        ttsDoneRef.current = false;
        ttsQueueRef.current = [];
      });

      ws.on("tts_error", ({ message }) => {
        console.warn("[tts stream]", message);
      });
    } else {
      // No realtime transport available — the session can't run.
      setInitLoading(false);
      setConnState("reconnecting");
    }

    return () => {
      stopTts();
      // Only a real close (X / Save & Close) ends the session. A MINIMIZE
      // parked it instead: the transcript is already saved per turn,
      // park_session ensured the DB row, and the disconnect grace window
      // keeps the orchestrator resumable — ending here would kill the very
      // session the Now-Studying bar is about to offer back.
      if (!parkedRef.current && !endedRef.current) wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  // ── Minimize = park, not end ────────────────────────────────────────────
  // The history is durable either way (every turn is appended server-side),
  // but a park also KEEPS THE CONTEXT: the live orchestrator survives the
  // disconnect grace window, so restoring resumes the same session — same
  // phase, same subtopic, same memory — instead of starting an empty one.
  // The live context rides up to the parent so the bar can restore THIS
  // session, not a config lookalike.
  const handleMinimize = () => {
    parkedRef.current = true;
    if (sessionIdRef.current) wsRef.current?.emit("park_session");
    onMinimize?.({ sessionId: sessionIdRef.current, mode, topic, subject });
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      clearInterval(timerRef.current);
      setSeconds(0);
    } else {
      stopTts(); // barge-in: stop agent speech before user records
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunksRef.current = [];
        const mr = new MediaRecorder(stream);
        mediaRef.current = mr;
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, { type:"audio/webm" });
          if (blob.size < 1000) return;
          // Keep the recording so it shows as a replayable bubble in the chat.
          const audioUrl = URL.createObjectURL(blob);
          setLoading(true);
          try {
            const form = new FormData();
            form.append("audio", blob, "voice.webm");
            const r = await fetch(`${API}/api/voice/transcribe`, {
              method:"POST", credentials:"include", body:form });
            const data = await r.json();
            const transcript = data.transcript?.trim();
            if (transcript) { setLoading(false); await handleSend(transcript, "audio", audioUrl); }
            else {
              setLoading(false);
              setBlocks(prev => [...prev, { type:"system-divider",
                label:"Couldn't hear that clearly — please try recording again." }]);
            }
          } catch {
            setLoading(false);
            setBlocks(prev => [...prev, { type:"system-divider",
              label:"Audio couldn't be processed. Please try again." }]);
          }
        };
        mr.start();
        setRecording(true);
        setSeconds(0);
        timerRef.current = setInterval(() => {
          setSeconds(s => {
            if (s >= 179) { mr.stop(); setRecording(false); clearInterval(timerRef.current); return 0; }
            return s + 1;
          });
        }, 1000);
      } catch {
        setRecording(true);
        timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
      }
    }
  };

  // ── Voice streaming (OpenAI realtime transcription) ────────────
  //
  // Capture lives in utils/micCapture.js. It used to be inline here, forcing
  // new AudioContext({ sampleRate: 24000 }) with no fallback — which mobile
  // browsers reject outright, so the constructor threw, the catch below logged
  // a console warning, and tapping the mic did nothing whatsoever. There was a
  // correct implementation in useVoiceSession.js the whole time; this file just
  // had its own copy. Now there is one.
  const toggleVoiceStream = async () => {
    if (voiceStreaming) {
      voiceMediaRef.current?.stop();
      voiceMediaRef.current = null;
      wsRef.current?.emit("stop_voice_stream");
      setVoiceStreaming(false);
      setInterimText("");
      setVoiceLevel(0);
      return;
    }
    stopTts(); // barge-in: stop agent speech before going live
    try {
      voiceMediaRef.current = await startMicCapture({
        isReady: () => voiceReadyRef.current && !!wsRef.current?.connected,
        onChunk: (audio) => wsRef.current.emit("voice_audio_chunk", { audio }),
        onLevel: setVoiceLevel,
      });
      // Chunks flow once voice_stream_ready fires.
      wsRef.current?.emit("start_voice_stream");
      setVoiceStreaming(true);
      setInterimText("");
    } catch (e) {
      // Said out loud. The old catch wrote one line to a console nobody has
      // open, so a denied microphone and a broken feature looked identical:
      // you tapped the button and nothing happened.
      setVoiceStreaming(false);
      setBlocks(prev => [...prev, {
        type: "system-divider",
        label: /denied|not allowed|permission/i.test(e?.message ?? "")
          ? "Microphone blocked. Allow mic access for this site, then tap the mic again."
          : "Couldn't start the microphone. Check no other app is using it, then try again.",
      }]);
    }
  };

  const handleSend = async (overrideText, modality = "text", audioUrl = null) => {
    // A quoted passage rides the typed message only (not voice or a resend).
    const text = overrideText != null ? String(overrideText).trim() : withQuote(input, quote);
    if (!text || loading) return;
    if (overrideText == null) { setInput(""); setQuote(null); }
    lastModalityRef.current = modality;
    speakSeqRef.current += 1;            // invalidate any queued speech from the prior turn
    setBlocks(prev => [...prev, { type:"user", text, modality, audioUrl }]);
    setLoading(true);

    // The session runs entirely over the WebSocket.
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text, modality });
      return;
    }

    // Not connected right now. If we have a resumable session, hold the message
    // and send it the moment we reconnect — the chip shows "Reconnecting…" and
    // the spinner stays up. Otherwise surface an honest failure.
    if (sessionIdRef.current) {
      pendingSendRef.current = { text, modality };
      return;
    }
    setBlocks(prev => [...prev, {
      type:"system-divider",
      label:"Lost connection to your tutor. Please reopen the session to continue.",
    }]);
    setLoading(false);
  };

  // ── Agent switching ────────────────────────────────────────────
  const openSwitch = async () => {
    setSwitchOpen(true);
    if (agentChoices) return;            // cached
    try {
      const d = await apiGet(`/api/adaptive/marketplace/my-agents/${STUDENT_ID}`);
      const platform = (d.platformAgents || []).map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || "🧠", subject: p.subject, kind: "platform",
      }));
      const trained = (d.purchasedAgents || []).map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || "🎓", subject: p.subject, teacher: p.teacherName, kind: "trained",
      }));
      setAgentChoices([...platform, ...trained]);
      if (d.defaultPairId) setCurrentPair(prev => prev === "nana-esumai" ? d.defaultPairId : prev);
    } catch {
      setAgentChoices([{ id: "nana-esumai", name: "NaNa Esumai & Sargeant", avatar: "🧠", subject: "All subjects", kind: "platform" }]);
    }
  };

  const performSwitch = (pairId) => {
    if (pairId === currentPair || switching) { setSwitchOpen(false); return; }
    if (!wsRef.current?.connected) return;
    setSwitching(true);
    // Ownership is evaluated against the authenticated socket identity server-side.
    wsRef.current.emit("switch_agent_pair", { newAgentPairId: pairId, topic });
  };

  const generateSummary = () => {
    setActiveTab("summary");
    setSummaryErr("");
    // Summary is generated over the WebSocket; session_summary / summary_error
    // events (registered above) resolve it.
    if (wsRef.current?.connected && wsReady) {
      setSummary(null);
      setLoading(true);
      wsRef.current.emit("request_summary");
    } else {
      setSummaryErr("We couldn't reach your tutor to generate a summary. Please try again.");
    }
  };

  // Summary view — own fullscreen container
  if (activeTab === "summary") {
    const sc = SUBJECT_COLORS[subject?.toLowerCase()] || BRAND;
    return (
      <div style={{ position:"fixed",inset:0,zIndex:3000,background:"var(--ak-bg)",
        display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif" }}>
        <div style={{ display:"flex",alignItems:"center",background:"var(--ak-tag-bg)",
          borderBottom:"1px solid var(--ak-border)",paddingTop:"calc(env(safe-area-inset-top, 0px) + 14px)" }}>
          {["chat","summary"].map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)}
              style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontWeight:activeTab===tab?800:600,
                color:activeTab===tab?sc:"var(--ak-text-muted)",
                borderBottom:`2px solid ${activeTab===tab?sc:"transparent"}`,
                fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>
              {tab==="chat" ? t('teaching.tab_chat') : t('teaching.tab_summary')}
            </button>
          ))}
          <div onClick={onClose} style={{ width:36,height:36,borderRadius:"50%",background:"var(--ak-tag-bg)",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginRight:12,flexShrink:0 }}>
            <XIcon size={15} color="var(--ak-text-muted)"/>
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>
          {loading&&!summary?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:16 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:`${sc}22`,border:`2px solid ${sc}`,display:"flex",alignItems:"center",justifyContent:"center",animation:"pulse-dot 1.2s ease-in-out infinite" }}><SparkleIcon size={22} color={sc}/></div>
              <p style={{ fontSize:14,fontWeight:700,color:"var(--ak-text-muted)",margin:0 }}>{t('teaching.generating_summary')}</p>
            </div>
          ):summaryErr?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:14,padding:"0 24px",textAlign:"center" }}>
              <p style={{ fontSize:14,fontWeight:700,color:"var(--ak-text-sub)",margin:0,lineHeight:1.6 }}>{summaryErr}</p>
              <button onClick={generateSummary} style={{ padding:"11px 22px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.retry') || 'Try again'}</button>
            </div>
          ):summary&&(
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                  <div><p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>{t('teaching.teaching_score')}</p><p style={{ fontSize:38,fontWeight:900,color:"var(--ak-text)",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"var(--ak-text-muted)" }}>/100</span></p></div>
                  <div style={{ textAlign:"right" }}><p style={{ fontSize:10,fontWeight:700,color:"var(--ak-text-muted)",margin:"0 0 4px" }}>{t('teaching.xp_earned')}</p><div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><ZapIcon size={14} color={GOLD}/><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>{summary.xpEarned}</span></div></div>
                </div>
              </div>
              <div style={{ background:"var(--ak-tag-bg)",border:"1px solid var(--ak-border)",borderRadius:14,padding:"14px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><BrainIcon size={13} color={sc}/><span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.3 }}>{t('teaching.agent_feedback')}</span></div>
                <p style={{ fontSize:13,fontWeight:600,color:"var(--ak-text-sec)",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {summary.keyConcepts?.length>0&&(
                <div style={{ background:"var(--ak-tag-bg)",border:"1px solid var(--ak-border)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"var(--ak-text-sub)",margin:"0 0 10px",letterSpacing:.3 }}>{t('teaching.key_concepts')}</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.strengths')}</p>{summary.strengthAreas?.map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-success-text)",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}</div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.gaps')}</p>{summary.gapsIdentified?.map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-warn-text)",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}</div>
              </div>
              {/* Not a battle: you never battle the guide. It asks, your protégé answers, a mark sheet. */}
              <div style={{ background:`${BRAND}0C`,border:`1px solid ${BRAND}26`,borderRadius:14,padding:"13px 14px",display:"flex",alignItems:"center",gap:12 }}>
                <Icon name="ti-clipboard-check" size={22} color={BRAND}/>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:12.5,fontWeight:900,color:"var(--ak-text)",margin:0 }}>Review with your teaching guide</p>
                  <p style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-text-sub)",margin:"2px 0 0",lineHeight:1.45 }}>Your guide asks questions on what you just taught; your protégé answers. A mark sheet, no opponent.</p>
                  {review.msg&&<p style={{ fontSize:11.5,fontWeight:800,color:RED,margin:"6px 0 0" }}>{review.msg}</p>}
                </div>
                <button onClick={requestReview} disabled={review.busy} style={{ padding:"9px 14px",borderRadius:12,border:"none",background:BRAND,color:"#fff",fontSize:12.5,fontWeight:900,cursor:review.busy?"default":"pointer",opacity:review.busy?.6:1,fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>{review.busy?"Starting…":"Request a review"}</button>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>{t('teaching.save_close')}</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chat view — SessionChatView is the root, no wrapper needed. When the
  // reader is open, the same live session is reused: embedded as the right
  // column on desktop/tablet (the Fortizo split — reader left, chat right),
  // or sitting underneath the full-screen reader modal on mobile. All session
  // state lives here, so opening/closing the reader never restarts anything.
  const sessionChat = (embedded) => (
    <SessionChatView
      blocks={blocks}
      loading={loading || (initLoading && blocks.length === 0)}
      loadingNote={initLoading && blocks.length === 0 ? prepNote : ''}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      quote={quote}
      onQuoteClear={() => setQuote(null)}
      topic={topic}
      subject={subject}
      reference={config?.reference || null}
      agentName={agentNm}
      agentEmoji={agentEm}
      mode={mode}
      userTurns={userTurns}
      showSummarize={userTurns >= 2 && !summary}
      onSummarize={generateSummary}
      onMinimize={handleMinimize}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      voiceStreaming={voiceStreaming}
      interimText={interimText}
      voiceLevel={voiceLevel}
      onToggleVoice={toggleVoiceStream}
      cognitive={cogState}
      guideLabel={`${guide.emoji} ${guide.name}`}
      onSwitchAgent={wsReady ? openSwitch : null}
      switching={switching}
      connState={connState}
      onClose={onClose}
      embedded={embedded}
      onOpenReader={readerOpen ? closeReader : openReader}
      onCite={content ? jumpToCitation : null}
      onOpenBoard={() => setBoardOpen(true)}
      materialBox={materialBox}
      chatMode={chatMode}
      onToggleChatMode={toggleChatMode}
      guide={{
        messages: guideMessages,
        onSend: sendGuideMessage,
        // A cited suggestion brings its passage along: the guide's answer starts from it.
        onSuggestion: (label, citation) => {
          setInput(label);
          if (citation?.quote) { const q = makeQuote(citation.quote, citation.pageNumber ?? null); if (q) setQuote(q); }
        },
        suggestions: learnSuggestions,
        guideName: guide.name,
        guideEmoji: guide.emoji,
      }}
      liveStudent={liveStudent}
      liveGuide={liveGuide}
    />
  );

  /* The content box — the session's material, one tap away. */
  const materialBox = content ? (
    <button
      type="button"
      onClick={openReader}
      disabled={content.state !== 'ready'}
      title={content.state === 'ready' ? 'Open the material' : content.state === 'loading' ? 'Opening…' : (content.err || 'Material unavailable')}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px',
        borderRadius: 14, cursor: content.state === 'ready' ? 'pointer' : 'default',
        background: 'var(--ak-surface)', border: `1.5px solid ${content.state === 'ready' ? `${BRAND}45` : 'var(--ak-border2)'}`,
        opacity: content.state === 'ready' ? 1 : 0.75, textAlign: 'left',
        fontFamily: "'Nunito',sans-serif",
      }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: content.state === 'error' ? 'rgba(239,68,68,.12)' : `${BRAND}16` }}>
        {content.state === 'loading' ? <span className="ti ti-loader-2" style={{ fontSize: 16, color: BRAND, animation: 'tam-spin 1s linear infinite' }}/>
          : <Icon name={content.state === 'error' ? 'ti-cloud-off' : (content.box?.icon || 'ti-file-text')} size={16} color={content.state === 'error' ? RED : BRAND}/>}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{content.box?.title || topic}</span>
        <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {content.state === 'loading' ? 'Opening the material…' : content.state === 'error' ? (content.err || 'Couldn’t open this material.') : (content.box?.sub || 'Tap to open')}
        </span>
        {content.state === 'ready' && content.pct != null && (
          <span style={{ display: 'block', height: 3.5, borderRadius: 99, background: 'var(--ak-tag-bg)', marginTop: 5, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, content.pct))}%`, borderRadius: 99, background: `linear-gradient(90deg,${BRAND}AA,${BRAND})`, transition: 'width .4s' }}/>
          </span>
        )}
      </span>
      {content.state === 'ready' && <span className="ti ti-chevron-right" style={{ fontSize: 15, color: 'var(--ak-text-sub)', flexShrink: 0 }}/>}
    </button>
  ) : null;

  /* The reader — the session guide, or the real material when present. */
  const readerProps = content ? {
    docTitle: content.docTitle || `${subject} — ${topic}`,
    sourceName: content.sourceName || 'Session material',
    pages: content.pages || [],
    media: content.media || null,
    renderPageContent: content.renderPageContent || null,
    rawPages: content.rawPages || false,
    initialTool: config?.openTool || null,
    pageBlocks: content.pageBlocks || null,
    transcript: content.transcript || null,
    onTranscribe: content.onTranscribe || null,
    transcribeState: content.transcribeState || null,
    transcribeError: content.transcribeError || null,
    // The community discussion attached to this content — every content
    // connected to one of the learner's communities carries its chat
    // into the reader. Null (plain topic sessions) keeps the old reader.
    discussion: content.discussion || null,
    // Ask (library records): whole-document Q&A with jump-to-source citations.
    ask: content.ask || null,
    tools: content.tools || null,
    artifacts: content.artifacts || null,
    onClose: closeReader,
    onExplainSelection: explainSelection,
    jumpTo: readerJump,
  } : {
    docTitle: `${subject} — ${topic}`,
    sourceName: readerReference?.name || "Session guide",
    pages: readerPages,
    onClose: closeReader,
    onExplainSelection: explainSelection,
  };

  return (
    <>
      <style>{'@keyframes tam-spin{to{transform:rotate(360deg)}}'}</style>
      {isMobileView ? (
        // Mobile: full-screen reader modal over the session chat (the chat
        // button inside the reader returns here).
        <>
          {sessionChat(false)}
          {readerOpen && <SessionReaderModal {...readerProps} onOpenChat={closeReader}/>}
        </>
      ) : readerOpen ? (
        // Desktop/tablet: the Fortizo split — reader left, live session right.
        <SessionReaderModal {...readerProps} chatNode={sessionChat(true)}/>
      ) : (
        sessionChat(false)
      )}

      {boardOpen && (
        <WhiteboardModal topic={topic} subject={subject} onClose={() => setBoardOpen(false)} />
      )}

      {switchOpen && (
        <div onClick={() => !switching && setSwitchOpen(false)}
          style={{ position:"fixed",inset:0,zIndex:3200,background:"rgba(6,6,18,.6)",
            backdropFilter:"blur(5px)",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:"var(--ak-surface)",width:"100%",maxWidth:540,maxHeight:"78vh",overflowY:"auto",
              borderRadius:"22px 22px 0 0",fontFamily:"'Nunito',sans-serif",
              animation:"sheet-up .28s cubic-bezier(.34,1.4,.6,1)",border:"1px solid var(--ak-border)" }}>
            <div style={{ padding:"12px 0 4px",display:"flex",justifyContent:"center" }}>
              <div style={{ width:38,height:4,borderRadius:4,background:"var(--ak-border3)" }}/>
            </div>
            <div style={{ padding:"6px 18px 26px" }}>
              <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"4px 0 3px" }}>{t('teaching.switch_teacher')}</p>
              <p style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)",margin:"0 0 16px",lineHeight:1.5 }}>
                {t('teaching.switch_sub')}
              </p>
              {!agentChoices ? (
                [0,1].map(i => <div key={i} style={{ height:64,borderRadius:14,background:"var(--ak-tag-bg)",marginBottom:9 }}/>)
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
                  {agentChoices.map(a => {
                    const active = a.id === currentPair;
                    return (
                      <button key={a.id} onClick={() => performSwitch(a.id)} disabled={switching || active}
                        style={{ display:"flex",alignItems:"center",gap:12,textAlign:"left",
                          background:active?"rgba(108,59,255,.16)":"var(--ak-tag-bg)",
                          border:`1.5px solid ${active?BRAND:"var(--ak-border)"}`,borderRadius:14,
                          padding:"12px 14px",cursor:(switching||active)?"default":"pointer",width:"100%" }}>
                        <div style={{ width:42,height:42,borderRadius:12,flexShrink:0,display:"flex",
                          alignItems:"center",justifyContent:"center",fontSize:22,background:"var(--ak-tag-bg)" }}>{a.avatar}</div>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:13.5,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{a.name}</div>
                          <div style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-muted)",marginTop:2 }}>
                            {a.kind === "platform" ? t('teaching.platform_default') : (a.teacher ? `by ${a.teacher}` : t('teaching.trained_agent'))}{a.subject ? ` · ${a.subject}` : ""}
                          </div>
                        </div>
                        {active && <span style={{ fontSize:10,fontWeight:900,color:BRAND,background:`${BRAND}22`,padding:"3px 9px",borderRadius:20,flexShrink:0 }}>{t('teaching.current')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}



export default TeachAgentModal;
