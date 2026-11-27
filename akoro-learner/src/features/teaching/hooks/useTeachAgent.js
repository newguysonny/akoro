// Teaching session state, socket lifecycle, voice/tts and handlers.
//
// Extracted verbatim from TeachAgentModal: the modal keeps the markup and
// calls this hook once. No behaviour lives here that did not live in the
// component before.
import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { startMicCapture } from '../../../utils/micCapture.js';
import { STUDENT_ID } from '../../../constants.js';
import { acquireActivityLock } from '../../../utils/activityLock.js';
import { useWakeLock } from '../../../hooks/useWakeLock.js';
import { API, apiGet, apiPost } from '../../../services/api.js';
import { socketOptions } from '../../../client/socket';
import { makeQuote, withQuote } from '../../../lib/quotedMessage.js';
import { materialText, localLearnSuggestions, learnSuggestionInput, shapeLearnSuggestions } from '../../../lib/learnSuggestions.js';
import { APP_HOME } from '../../../config/target.js';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { useIsMobileView } from '../../../hooks/useIsMobileView.js';
import { buildSessionReaderPages } from '../components/sessionReaderModel.js';

const AGENT_CONFIG = { name: '', emoji: '🤖', guideName: 'NaNa Esumai', guideEmoji: '🧠', guideRenderStyle: {} };

export function useTeachAgent({ session, config, onClose, onMinimize, onSessionStarted, onSessionSaved, content = null }) {
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
      navigate(`${APP_HOME}?tab=battles&battle=${id}`);
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
  // The reader's chat state: "ask" — the Ask panel beside the reader (the
  // default for content); "agent" — the teaching session beside the reader.
  // The entry point chooses (config.chatState); without an Ask adapter there
  // is nothing to ask with, so the session chat shows.
  const readerChat = config?.chatState === "agent" || !content?.ask ? "agent" : "ask";
  // Lazy session start: in the reader's Ask state the teaching session does
  // not start at all — no socket, no start_adaptive_session — until the
  // learner actually goes to the session: an Agent session entry (readerChat
  // "agent"), closing the reader onto the session chat, or sending a reader
  // selection to the chat. Sessions with no Ask surface start immediately,
  // exactly as before.
  const [sessionLive, setSessionLive] = useState(() => readerChat === "agent");
  useEffect(() => { if (readerChat === "agent") setSessionLive(true); }, [readerChat]);
  const openReader      = () => { if (!content || content.state === 'ready') setReaderOpen(true); };
  // Opened from a link that names a study tool: the reader opens on it, once, when the material is ready.
  const openToolDone = useRef(false);
  useEffect(() => {
    if (!(config?.openTool || config?.openArtifact) || openToolDone.current || (content && content.state !== 'ready')) return;
    openToolDone.current = true;
    setReaderOpen(true);
  }, [config?.openTool, config?.openArtifact, content?.state]);
  // A citation chip on the protégé's message: open the reader on that page
  // and flash the cited box (or seek the recording). The key re-fires a
  // jump to the same place; closing clears it so a reopen doesn't replay it.
  const [readerJump, setReaderJump] = useState(null);
  const closeReader     = () => { setReaderOpen(false); setReaderJump(null); if (readerChat === "ask") setSessionLive(true); };
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
    if (isMobileView) { setReaderOpen(false); setSessionLive(true); }
  };

  // ── Learn suggestions — now the reader Ask panel's suggestions ──────────
  // The guide chat is gone; the grounded learn suggestions (local ones from
  // the material at once, AI ones from the same text when they land) feed
  // the Ask panel instead, via readerProps.ask.suggestions. Asked once per
  // material, and only when this session has an Ask surface at all.
  useEffect(() => {
    if (!content?.ask || aiLearn?.key === learnKey) return undefined;
    let live = true;
    // With a library document open, the suggestions come from its own pages (each cites one).
    apiPost('/api/adaptive/chat/learn-suggestions', { ...learnSuggestionInput(learnBase), ...(config?.document ? { document: config.document } : {}) }, { timeout: 20000 })
      .then((r) => { if (live) setAiLearn({ key: learnKey, list: shapeLearnSuggestions(r?.suggestions, r?.cited) }); })
      .catch(() => { if (live) setAiLearn({ key: learnKey, list: [] }); });
    return () => { live = false; };
  }, [learnKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    if (!sessionLive) return undefined;
    // Connect WebSocket — the session lives entirely here. Import the socket
    // client directly (don't depend on a global window.io that may be unset
    // in some builds).
    const connect = io || (typeof window !== "undefined" ? window.io : null);
    if (connect) {
      const ws = connect(API, socketOptions({ portal: "student" }));
      wsRef.current = ws;

      // The server derives the learner from the authenticated socket. Do not
      // send a browser-controlled user or student identifier with a lesson.
      // A direct session (§13.1): the dashboard asked POST /api/teaching/workflows
      // as the modal opened; its id joins the start when it arrives (never
      // more than a few seconds — without it the lesson still starts).
      const workflowIdNow = async () => config?.workflowId || session?.workflowId
        || (config?.workflowReady ? await Promise.race([config.workflowReady.catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]) : null);
      const startSession = async () => {
        const workflowId = await workflowIdNow();
        ws.emit("start_adaptive_session", {
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
          // Opened from a dashboard descriptor (§13.1), or created for this direct
          // session: the teaching workflow it belongs to. The server checks it is
          // this learner's and open.
          ...(workflowId ? { workflowId } : {}),
        });
      };

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
            // A resume opening carries its own recap card — it IS the seam,
            // so the "Continuing from here" divider would only repeat it.
            const hasRecap = opening.some(b => b.type === "resume-recap");
            return hasRecap
              ? [...d.historyBlocks, ...fresh, ...opening]
              : [...d.historyBlocks, { type:"system-divider", label:"Continuing from here" }, ...fresh, ...opening];
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
      ws.on("turn_complete", ({ blocks: newBlocks, currentPhase, teachingMode, assessment }) => {
        setLoading(false);
        clearLiveStream();
        // A short-check turn (teaching.request_assessment): its result card sits just before the protégé's line about it.
        const checkBlock = assessment?.items?.length ? [{ type: "lesson-check", assessment, topic }] : [];
        if (newBlocks?.length || checkBlock.length) {
          setBlocks(prev => [...prev, ...checkBlock, ...(newBlocks || [])]);
          // TTS only when the human used voice — modality mirrors input.
          const agentBlock = (newBlocks || []).find(b => b.type === "student-agent");
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
        setLoading(false);
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
  }, [sessionLive]);

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

  return {
    session, config, onClose, onMinimize, onSessionStarted, onSessionSaved, content,
    topic, subject, agentNm, agentEm, guideNm, guideEm, guideRS, mode, t,
    sessionId, blocks, initLoading, prepNote, input, setInput, quote, setQuote,
    recording, seconds, loading, activeTab, setActiveTab, summary, summaryErr, review,
    requestReview, wsReady, connState, userTurns, fmt,
    handleSend, handleMinimize, toggleRecording, toggleVoiceStream,
    voiceStreaming, interimText, voiceLevel, cogState, liveStudent, liveGuide,
    guide, switching, switchOpen, setSwitchOpen, agentChoices, openSwitch, performSwitch,
    generateSummary, isMobileView, readerOpen, boardOpen, setBoardOpen,
    openReader, closeReader, readerChat, jumpToCitation, explainSelection,
    readerJump, readerPages, readerReference, learnSuggestions,
  };
}
