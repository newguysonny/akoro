import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, PRIORITY_CONFIG, STUDENT_ID } from '../constants.js';
import { useWallet } from '../hooks/useWallet.js';
import { API, apiGet, apiPost, apiPatch } from '../services/api.js';
import { useLang } from '../contexts/LanguageContext.jsx';
import { useCart } from '../contexts/CartContext.jsx';

// Components
import TeacherNudge   from '../components/TeacherNudge.jsx';
import InstallBanner  from '../components/common/InstallBanner.jsx';
import SessionCard    from '../components/sessions/SessionCard.jsx';
import SelfStudyList  from '../components/sessions/SelfStudyList.jsx';
import SessionSheet   from '../components/sessions/SessionSheet.jsx';
import BlockRenderer  from '../components/sessions/BlockRenderer.jsx';
import TeachAgentModal   from '../components/teaching/TeachAgentModal.jsx';
import DecaySessionModal from '../components/teaching/DecaySessionModal.jsx';
import ConfigModal       from '../components/teaching/ConfigModal.jsx';
import AssessmentRoom     from '../components/assessment/AssessmentRoom.jsx';
import BattleModal       from '../components/battles/BattleModal.jsx';
import ChallengeModal    from '../components/battles/ChallengeModal.jsx';
import { BattlesTab, ChallengeRow } from '../components/battles/BattlesTab.jsx';
import AgentChatTab  from '../components/tabs/AgentChatTab.jsx';
import RankingsTab   from '../components/tabs/RankingsTab.jsx';
import DiscoveryTab  from '../components/tabs/DiscoveryTab.jsx';
import DiscoverHub   from '../components/tabs/DiscoverHub.jsx';
import Toast         from '../components/common/Toast.jsx';
import { ProgressBar, LiveBadge } from '../components/common/ProgressBar.jsx';
import { ZapIcon, MicIcon } from '../components/common/Icons.jsx';
import AddRecordModal from '../components/dashboard/AddRecordModal.jsx';
import NowStudyingBar from '../components/dashboard/NowStudyingBar.jsx';
import { useNowStudying } from '../utils/nowStudying.js';
import { isHigherEdUI } from '../utils/studyLevel.js';
import React from 'react';

// Hooks
import { useWebSocket }    from '../hooks/useWebSocket.js';
import { useAgentProfile } from '../hooks/useAgentProfile.js';
import { useSessionAPI }   from '../hooks/useSessionAPI.js';
import { useDecayAlerts }  from '../hooks/useDecayAlerts.js';
import { useBattleAPI }    from '../hooks/useBattleAPI.js';


export default function LearnerDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLang();
  const { count: cartCount } = useCart();
  const { balance: coinBalance, low: coinLow } = useWallet();

  // Top-level tab is mirrored in the URL (?tab=…) so the browser Back/Forward
  // buttons move between tabs instead of jumping straight out to the landing
  // page, and a deep-link / refresh restores the right tab.
  const VALID_TABS = ["sessions", "discovery", "rankings", "battles", "agent", "challenges"];
  const tabFromUrl = () => {
    const p = new URLSearchParams(location.search).get("tab");
    return VALID_TABS.includes(p) ? p : "sessions";
  };
  const [tab,               setTab]              = useState(tabFromUrl);
  // Higher-ed Discover has an inner view: the hub, or the courses feed the
  // hub's Courses card opens. Mirrored in the URL (?view=&q=) so Back/Forward
  // move between hub and courses like they do between tabs.
  const discoverViewFromUrl = () => new URLSearchParams(location.search).get("view") === "courses" ? "courses" : "hub";
  const discoverQFromUrl    = () => new URLSearchParams(location.search).get("q") || "";
  const [discoverView,  setDiscoverView]  = useState(discoverViewFromUrl);
  const [discoverQuery, setDiscoverQuery] = useState(discoverQFromUrl);
  // Keep tab in sync when the URL changes (Back/Forward, deep link).
  useEffect(() => {
    setTab(tabFromUrl());
    setDiscoverView(discoverViewFromUrl());
    setDiscoverQuery(discoverQFromUrl());
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  // A user tab switch pushes a history entry; the effect above then sets state.
  const goTab = (key) => navigate(key === "sessions" ? "/app" : `/app?tab=${key}`);
  const [sessionTab,        setSessionTab]        = useState("all");
  const [liveSubTab,        setLiveSubTab]        = useState("starting-soon");
  const [agentSubTab,       setAgentSubTab]       = useState("sessions");
  const [selfStudyCount,    setSelfStudyCount]    = useState(0);   // badge on the Self study tab
  const [liveSubjectFilter, setLiveSubjectFilter] = useState("all");
  const [agentSubjectFilter,setAgentSubjectFilter]= useState("all");
  const [subjectFilter,     setSubjectFilter]     = useState("all");
  const [selectedSession,   setSelectedSession]   = useState(null);
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [teachSession,      setTeachSession]      = useState(null); // now holds config OR null
  const [configOpen,        setConfigOpen]        = useState(false); // FAB → ConfigModal
  const [configInitial,     setConfigInitial]     = useState(null);  // pre-fill from session sheet
  const [decaySession,      setDecaySession]      = useState(null); // decay alert object
  const [assessSession,     setAssessSession]     = useState(null); // proctored assessment target
  const [acceptedIds,       setAcceptedIds]       = useState(new Set());
  const [battles,           setBattles]           = useState([]);
  const [toast,             setToast]             = useState(null);
  const [isOnline,          setIsOnline]          = useState(true);
  const [liveBattleModal,   setLiveBattleModal]   = useState(null);

  // ── API-driven state ─────────────────────────────────────────────────────
  const [sessions,     setSessions]     = useState([]);
  const [challenges,   setChallenges]   = useState([]);
  const [agentProfile, setAgentProfile] = useState({
    name:             '',
    emoji:            '🤖',
    teacherAgentId:   'nana-sargeant',
    guideName:        'NaNa Esumai',
    guideEmoji:       '🧠',
    guideRenderStyle: {
      bubbleBg:"rgba(124,58,237,0.10)", bubbleBorder:"#7C3AED",
      labelColor:"#7C3AED", ttsVoice:"alloy", assessStyle:"gentle",
    },
    ttsVoice: "alloy",
  });
  const [decayAlerts,  setDecayAlerts]  = useState([]);
  const [agentSessions, setAgentSessions] = useState([]);
  const [userProfile,  setUserProfile]  = useState(null);
  const [notifUnread,  setNotifUnread]  = useState(0);

  // ── Level-aware UI: add-record action (higher-ed only) ───────────────────
  // Sixth form / university / college / other see a + above Start Session;
  // school learners don't. The profile fetch below decides which tier renders,
  // so the button appears once the profile arrives — and never flashes for
  // school learners. Records are device-local for now (frontend-only).
  const [recordsOpen,  setRecordsOpen]  = useState(false);
  const [recordCount,  setRecordCount]  = useState(0);
  const higherEd = isHigherEdUI(userProfile || {});
  const refreshRecordCount = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`akoro_records_${userProfile?.id || 'me'}`) || '[]');
      setRecordCount(Array.isArray(raw) ? Math.min(raw.length, 99) : 0);
    } catch { setRecordCount(0); }
  }, [userProfile?.id]);
  useEffect(() => { if (higherEd) refreshRecordCount(); }, [higherEd, refreshRecordCount]);

  // ── Now studying — Spotify-style mini-bar ────────────────────────────────
  // Tracks the material or session the learner last opened, across all tabs
  // except the AI chat. Higher-ed gated like the records feature it leans on.
  const [now, nowActs] = useNowStudying(userProfile?.id);
  // Is the AI chat SURFACE showing? (Agent tab also hosts tasks/stats/self-study,
  // where the Now-Studying bar should still appear — only chat hides it.)
  const [chatActive, setChatActive] = useState(false);

  // Records live in localStorage; these helpers read/update one record's
  // progress without a full state mirror (the modal re-reads on open).
  const loadRecordsLocal = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`akoro_records_${userProfile?.id || 'me'}`) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }, [userProfile?.id]);
  const setRecordProgress = useCallback((id, progress) => {
    const list = loadRecordsLocal().map(r => r.id === id
      ? { ...r, progress: Math.max(0, Math.min(100, progress)), last_opened_at: new Date().toISOString() }
      : r);
    try { localStorage.setItem(`akoro_records_${userProfile?.id || 'me'}`, JSON.stringify(list)); } catch { /* private mode */ }
  }, [loadRecordsLocal, userProfile?.id]);

  // Opening a session tracks it as "now studying" — the bar then follows the
  // learner across tabs until they dismiss it or open something else.
  const openSessionTracked = useCallback((s) => {
    if (!s) return;
    setSelectedSession(s);
    nowActs.setCurrent({
      type: 'session',
      id: s.id,
      title: s.title || 'Study session',
      sub: (SUBJECTS[s.subject]?.label) || s.topic || 'Session',
      emoji: (SUBJECTS[s.subject]?.icon) || '📚',
      progress: s.progress || 0,
      snapshot: s,
    });
  }, [nowActs]);

  // Opening a record tracks it too; links open in a new tab right away — the
  // in-app viewer for uploads/pastes is future work, so say so instead of
  // pretending the file opened.
  const openRecordTracked = useCallback((r) => {
    if (!r) return;
    const kindLabel = r.kind === 'link' ? t('records.tab_link') : r.kind === 'paste' ? t('records.tab_paste') : t('records.tab_upload');
    nowActs.setCurrent({
      type: 'record',
      id: r.id,
      title: r.name,
      sub: kindLabel,
      emoji: r.kind === 'link' ? '🔗' : r.kind === 'paste' ? '📋' : '📎',
      progress: r.progress || 0,
    });
    if (!r.progress) { setRecordProgress(r.id, 10); nowActs.setProgress(r.id, 10); }
    if (r.kind === 'link' && r.url) { try { window.open(r.url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    else setToast({ msg: t('records.viewer_soon'), color: GOLD });
    setRecordsOpen(false);
  }, [nowActs, setRecordProgress, t]);

  // Self-reported completion for records (there's no playback to measure).
  const toggleRecordDone = useCallback((r) => {
    const p = (r.progress || 0) >= 100 ? 10 : 100;
    setRecordProgress(r.id, p);
    if (now.item?.id === r.id) nowActs.setProgress(r.id, p);
  }, [now.item, nowActs, setRecordProgress]);

  // Bar visibility: every tab except the AI chat surface, and never under a
  // full-screen sheet that has its own layout.
  const showNowBar = higherEd && !!now.item && !now.dismissed
    && !(tab === "agent" && chatActive) && !selectedSession && !selectedChallenge
    && !teachSession && !liveBattleModal && !configOpen && !recordsOpen;

  // ── Minimize — park a live session on the Now-Studying bar ──────────────
  const minimizeSessionSheet = () => {
    const live = [...agentSessions, ...sessions].find(x => x.id === selectedSession?.id);
    if (live) nowActs.setProgress(live.id, live.progress || 0);
    setSelectedSession(null);
    setToast(t('now.minimized_toast'));
  };
  const minimizeTeachSession = () => {
    const ts = teachSession;
    if (ts) {
      nowActs.setCurrent({
        type: 'session',
        id: ts.id || (ts.selfStudyId ? `self-${ts.selfStudyId}` : `teach-${ts.topic || 'session'}`),
        title: ts.title || ts.topic || t('now.teaching'),
        sub: (SUBJECTS[ts.subject]?.label) || ts.subject || t('now.teaching'),
        emoji: ts.agentEmoji || agentProfile.emoji || '🤖',
        progress: ts.progress || 0,
      });
    }
    setTeachSession(null);
    setToast(t('now.minimized_toast'));
  };
  const minimizeDecaySession = () => {
    const d = decaySession;
    if (d) {
      nowActs.setCurrent({
        type: 'session',
        id: `decay-${d.id || d.topic || 'session'}`,
        title: `${t('now.relearn')} ${d.topic || ''}`.trim(),
        sub: d.subject || '',
        emoji: '🔁',
        progress: 0,
      });
    }
    setDecaySession(null);
    loadAgentSessions();
    setToast(t('now.minimized_toast'));
  };
  // Battles keep running on the engine while parked — the modal is just a
  // window onto the socket feed, so closing it loses nothing. ▶ re-opens
  // with the freshest card from the battles list (snapshot as fallback).
  const minimizeBattle = () => {
    if (liveBattleModal) {
      const b = battles.find(x => x.id === liveBattleModal.id) || liveBattleModal;
      nowActs.setCurrent({
        type: 'battle',
        refId: b.id,
        id: `battle-${b.id}`,
        title: b.title || b.topic || 'Battle',
        sub: b.status === 'live' ? t('now.battle_live') : t('now.battle_lobby'),
        emoji: '⚔️',
        progress: 0,
        snapshot: b,
      });
    }
    setLiveBattleModal(null);
    setToast(t('now.minimized_toast'));
  };

  // Bar ▶ — resume. Sessions reopen (live copy preferred, snapshot fallback);
  // records re-run the record open flow.
  const openNowItem = () => {
    if (!now.item) return;
    if (now.item.type === 'battle') {
      // Prefer the freshest card (status may have flipped while parked);
      // fall back to the snapshot taken at minimize time.
      const fresh = battles.find(x => x.id === now.item.refId) || now.item.snapshot;
      if (fresh) setLiveBattleModal(fresh);
      else setToast(t('now.battle_ended'));
    } else if (now.item.type === 'session') {
      const live = [...agentSessions, ...sessions].find(x => x.id === now.item.id);
      openSessionTracked(live || now.item.snapshot || { id: now.item.id, title: now.item.title, progress: now.item.progress || 0 });
    } else {
      const r = loadRecordsLocal().find(x => x.id === now.item.id);
      if (r) openRecordTracked(r);
    }
  };

  useEffect(()=>{
    let alive = true;
    const poll = () => apiGet("/api/notifications?limit=1")
      .then(d=>{ if(alive) setNotifUnread(d?.unread ?? 0); })
      .catch(()=>{});
    poll();
    const t = setInterval(poll, 60000);
    return ()=>{ alive=false; clearInterval(t); };
  },[]);

  useEffect(()=>{
    // User profile — name, avatar, year group, XP for the header
    apiGet("/api/profiles/me")
      .then(d=>{ if(d?.id||d?.data?.id) setUserProfile(d.data||d); })
      .catch(()=>{});

    // Agent profile — student agent + guide agent
    apiGet("/api/user/agent")
      .then(res=>{
        const d = res?.data ?? res;
        if (d.agent_name) setAgentProfile({
          name:            d.agent_name,
          emoji:           d.agent_emoji  || '🤖',
          teacherAgentId:  d.teacher_agent_id || 'nana-sargeant',
          guideName:       d.guide_name   || 'NaNa Esumai',
          guideEmoji:      d.guide_emoji  || '🧠',
          guideRenderStyle:d.guide_render_style || {
            bubbleBg:"rgba(124,58,237,0.10)", bubbleBorder:"#7C3AED",
            labelColor:"#7C3AED", ttsVoice:"alloy", assessStyle:"gentle",
          },
          ttsVoice:        d.tts_voice    || "alloy",
        });
      })
      .catch(()=>{});

    // Sessions
    apiGet("/api/student/sessions")
      .then(d=>{ if(d.sessions?.length) setSessions(d.sessions); })
      .catch(()=>{});

    // Challenges + battles. Both answer { success, data } with the card shape
    // the tabs render, so we set them straight through — including the empty
    // case, which is a real answer ("nothing pending"), not a reason to keep
    // whatever was on screen before.
    loadBattles();

    // Self study — only the outstanding ones drive the tab badge.
    apiGet("/api/self-study/mine")
      .then(d=>setSelfStudyCount((d?.data??[]).filter(a=>a.status!=="complete").length))
      .catch(()=>{});

    // Decay alerts
    apiGet(`/api/adaptive/chat/decay/alerts/${STUDENT_ID}`)
      .then(d=>{ if(d.alerts?.length) setDecayAlerts(d.alerts); })
      .catch(()=>{});

    // Agent sessions (for Sessions + Revisions sub-tabs)
    loadAgentSessions();
  },[]);

  // Reload the persisted agent sessions — called on mount and whenever a
  // teaching/decay session closes so a new session shows up immediately.
  const loadAgentSessions = useCallback(() => {
    apiGet("/api/adaptive/teaching/sessions")
      .then(d=>{ setAgentSessions(d.sessions || []); })
      // An empty Sessions tab and a failing Sessions fetch looked identical
      // before this — say which one it is.
      .catch(e=>{ console.warn("[sessions] load failed:", e?.message || e); });
  },[]);

  // WebSocket — live class alerts + challenge notifications + decay alerts
  useEffect(()=>{
    let socket;
    try {
      if (typeof window !== "undefined" && window.io) {
        socket = window.io(API, { transports: ["websocket","polling"], withCredentials: true });

        socket.on("connect", () => {
          // Join user room (live alerts + challenges)
          socket.emit("subscribe-student", STUDENT_ID);
          // Gap 1 fix: also join student:{id} room for decay cron alerts
          socket.emit("join-student-room", STUDENT_ID);
        });

        // Live class starting soon
        socket.on("live_class_starting", alert => {
          setToast(`📡 ${alert.title} starts in ${alert.minutesUntil} min!`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:"starting-soon", scheduleBucket:"starting-soon",
                  minutesUntil: alert.minutesUntil, nextSession:`in ${alert.minutesUntil} min` }
              : s
          ));
          setSessionTab("live");
          setLiveSubTab("starting-soon");
        });

        // Live class now live
        socket.on("live_class_live", alert => {
          setToast(`🔴 ${alert.title} is now LIVE! Join now.`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:"live", scheduleBucket:"live",
                  nextSession:"LIVE", joinUrl: alert.joinUrl }
              : s
          ));
          setSessionTab("live");
          setLiveSubTab("live");
        });

        // Live class ended — only now does it leave the learner's list.
        socket.on("live_class_ended", ({ sessionId }) => {
          setSessions(prev => prev.filter(s => s.id !== sessionId));
        });

        // New challenge from peer
        socket.on("new_challenge", challenge => {
          setToast(`⚡ ${challenge.challenger} challenged you!`);
          setChallenges(prev => [challenge, ...prev]);
          goTab("challenges");
        });

        // Gap 2 fix: correct battle event name from backend
        socket.on("battle:participant-joined", data => {
          setBattles(prev => prev.map(b =>
            b.id === data.battleId ? { ...b, status:"live" } : b
          ));
        });

        // Gap 3: challenger notified their battle was accepted
        socket.on("battle_accepted", data => {
          setToast(`✅ ${data.opponent} accepted your challenge! Battle ${data.isImmediate ? "starting now" : "scheduled"}.`);
          setBattles(prev => prev.map(b =>
            b.id === data.battleId ? { ...b, status: data.status } : b
          ));
          // Auto-join the battle room
          socket.emit("join-battle", data.battleId);
        });

        // Gap 3: join battle room when told to
        socket.on("join_battle_room", ({ battleId }) => {
          socket.emit("join-battle", battleId);
        });

        // Gap 4 fix: topic-level decay alert from decayEngine cron
        socket.on("knowledge_decay_alert", data => {
          if (data.alerts?.length) {
            setDecayAlerts(prev => {
              const existing = new Set(prev.map(a => a.id));
              const newAlerts = data.alerts.filter(a => !existing.has(a.id));
              return newAlerts.length ? [...prev, ...newAlerts] : prev;
            });
          }
        });

        // Gap 4 fix: subtopic-level decay alert from decayEngine cron
        socket.on("subtopic_decay_alert", data => {
          if (data.alerts?.length) {
            setDecayAlerts(prev => {
              const existing = new Set(prev.map(a => a.id));
              const newAlerts = data.alerts.filter(a => !existing.has(a.id));
              return newAlerts.length ? [...prev, ...newAlerts] : prev;
            });
          }
        });

        // Generic in-app notification (purchases, payouts, reviews, classes…) —
        // bump the bell badge live so it doesn't need a refresh to appear.
        socket.on("notification", n => {
          setNotifUnread(u => (u || 0) + 1);
          if (n?.title) setToast(`🔔 ${n.title}`);
        });
      }
    } catch { /* socket.io not loaded — REST polling fallback */ }

    // Polling fallback — refresh live alerts every 60 s
    const poll = setInterval(()=>{
      apiGet("/api/student/live-alerts")
        .then(d=>{
          if (!d.alerts?.length) return;
          setSessions(prev => {
            const map = Object.fromEntries(d.alerts.map(a=>[a.sessionId,a]));
            return prev.map(s => {
              const a = map[s.id];
              if (!a) return s;
              return { ...s, status: a.status==="live"?"live":"starting-soon",
                scheduleBucket: a.bucket, minutesUntil: a.minutesUntil,
                nextSession: a.status==="live"?"LIVE":`in ${a.minutesUntil} min` };
            });
          });
        })
        .catch(()=>{});
    }, 60_000);

    return () => {
      socket?.disconnect?.();
      clearInterval(poll);
    };
  },[]);

  // Build sessionId → decayAlert lookup for session card badges
  const decayBySession = decayAlerts.reduce((acc, a) => {
    if (a.sessionId) acc[a.sessionId] = a;
    return acc;
  }, {});

  const bySubject = subjectFilter==="all" ? sessions : sessions.filter(s=>s.subject===subjectFilter);
  const liveBase  = liveSubjectFilter==="all" ? sessions : sessions.filter(s=>s.subject===liveSubjectFilter);
  // Each live sub-tab matches its own bucket — Live now and Starting soon are
  // separate pills so a live class shows under "Live now" for its whole window.
  const liveMatch = (s, tab) => s.type==="live" && s.scheduleBucket===tab;
  const filtered  = sessionTab==="all"   ? bySubject
                  : sessionTab==="live"  ? liveBase.filter(s=>liveMatch(s, liveSubTab))
                  : bySubject.filter(s=>s.type==="agent");

  // Agent sub-tab data
  // Prefer the richer /teaching/sessions data; fall back to the agent-type
  // items from /student/sessions (same source that drives the Agent tab count)
  // so the Sessions sub-tab is never empty when the count says there are some.
  const agentSessionsBase = agentSessions.length ? agentSessions : sessions.filter(s=>s.type==="agent");
  const agentSessionsFiltered = agentSubjectFilter==="all"
    ? agentSessionsBase
    : agentSessionsBase.filter(s=>s.subject===agentSubjectFilter);
  const agentRevisions = agentSubjectFilter==="all"
    ? decayAlerts
    : decayAlerts.filter(a=>a.subject===agentSubjectFilter);
  // Map decay alerts to session-card-compatible shape for agent tab
  const decayAsSessions = agentRevisions.map(a=>({
    id:             a.sessionId || a.id,
    type:           "agent",
    status:         "active",
    title:          a.topic,
    topic:          a.topic,
    subject:        a.subject,
    avatar:         null,
    tutor:          "AI Agent",
    level:          "Adaptive",
    nextSession:    `${a.daysSince}d ago`,
    topics:         1,
    revisions:      0,
    reviews:        0,
    progress:       a.confidence||0,
    unread:         0,
    priority:       "high",
    scheduleBucket: "later",
    // decay context
    hasDecay:       true,
    decayAlertId:   a.id,
  }));

  // Outstanding work that lives under Agent but isn't an adaptive session:
  // assigned self study, and topics due for revision. Declared after
  // decayAsSessions because it reads it — a const referenced above its
  // definition throws rather than being undefined.
  const agentExtras = selfStudyCount + decayAsSessions.length;

  const totalUnread       = sessions.reduce((sum,s)=>sum+s.unread,0);
  const pendingChallenges = challenges.filter(c=>!acceptedIds.has(c.id)).length;

  const handleAcceptChallenge = async () => {
    if (!selectedChallenge) return;
    const c = selectedChallenge;
    setAcceptedIds(prev => new Set([...prev, c.id]));
    setSelectedChallenge(null);
    try {
      // Persist against the real engine; it flips the battle live (or scheduled)
      // and enqueues the worker's start job. Use the REAL battle id it returns.
      const r = await apiPost(`/api/battle/challenges/${c.id}/accept`);
      const status = r.status || 'live';
      const battle = { id: r.battle_id, status, title: c.title, topic: c.title, xpPool: c.xpPrize };
      setBattles(prev => [battle, ...prev.filter(b => b.id !== battle.id)]);
      if (status === 'live') {
        setLiveBattleModal(battle);
        setToast(`⚡ Challenge accepted — the battle is starting!`);
      } else if (r.invited > 1) {
        // A class battle set by a teacher: accepting takes your seat, it does
        // not start the battle. Saying "starting!" here would send the learner
        // looking for a battle that is still waiting on their classmates.
        setToast(`✅ You're in — ${r.accepted} of ${r.invited} accepted so far.`);
      } else {
        setToast(`🗓 Battle scheduled — find it in Battles › Scheduled.`);
      }
    } catch (e) {
      setAcceptedIds(prev => { const n = new Set(prev); n.delete(c.id); return n; });
      // The server says WHY — expired, already resolved, not your challenge.
      setToast(e?.message || 'Could not accept the challenge. Please retry.');
    }
  };

  const handleDeclineChallenge = async () => {
    if (!selectedChallenge) return;
    const c = selectedChallenge;
    setSelectedChallenge(null);
    setAcceptedIds(prev => new Set([...prev, c.id]));   // hide it from the pending list
    try { await apiPost(`/api/battle/challenges/${c.id}/decline`, {}); }
    catch { /* non-fatal — the challenger just won't get the decline notice */ }
  };

  // Join a live class: the backend returns the meeting URL only once the
  // session is actually live. Surfaces the server's message otherwise
  // (not started yet / full → waitlisted / not enrolled).
  const joinLive = async (s) => {
    try {
      const res = await fetch(`${API}/api/live-sessions/${s.id}/join`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      const d = j?.data ?? j;
      if (res.ok && d?.meeting_url) { window.open(d.meeting_url, "_blank", "noopener"); return; }
      setToast(j?.message || d?.message || t('sheet.live_not_ready'));
    } catch {
      setToast(t('common.network_error'));
    }
  };

  const loadBattles = useCallback(() => {
    apiGet("/api/battle/my-challenges").then(d=>setChallenges(d?.data ?? [])).catch(()=>{});
    apiGet("/api/battle/my-battles").then(d=>setBattles(d?.data ?? [])).catch(()=>{});
  }, []);

  const NAV_ITEMS=[{key:"sessions",icon:"📚",label:t('nav.learn')},{key:"discovery",icon:"🧭",label:t('nav.discover')},{key:"rankings",icon:"🏆",label:t('nav.rankings')},{key:"battles",icon:"⚔️",label:t('nav.battles')},{key:"agent",icon:"🤖",label:t('nav.agent')}];
  // 'lobby' counts too: a battle waiting on its invitations is outstanding work,
  // and it can now sit there for the whole invite window rather than 5 seconds.
  // Only battles I am actually in. An unanswered invitation is counted by the
  // Challenges badge; counting it here too made one battle show as two pieces
  // of outstanding work, in two different places.
  const activeBattleCount=battles.filter(b=>["live","scheduled","lobby"].includes(b.status)
    && (b.myState == null || b.myState === "accepted")).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Nunito',sans-serif;background:#F3F1FF}
        a{display:contents}
        input::placeholder{color:#475569}
        @keyframes sheet-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.92)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
        @keyframes pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.5}}
        @keyframes bounce-dot{from{transform:translateY(0)}to{transform:translateY(-5px)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes xpPop{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-30px) scale(1.3)}}
        @keyframes scrollTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <div style={{ width:"100vw",height:"100vh",fontFamily:"'Nunito',sans-serif",background:"var(--ak-bg)",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative" }}>

        {/* HEADER */}
        <div style={{ background:"var(--ak-surface)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--ak-border)",padding:"14px 18px 0",zIndex:100,flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ display:"flex",alignItems:"center",gap:11 }}>
              <div style={{ position:"relative",cursor:"pointer" }} onClick={()=>navigate("/settings")}>
                {userProfile?.avatarUrl
                  ? <img src={userProfile.avatarUrl} alt="" style={{ width:38,height:38,borderRadius:"50%",objectFit:"cover",border:"2px solid #EDE9FE" }}/>
                  : <div style={{ width:38,height:38,borderRadius:"50%",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:15,fontWeight:900,border:"2px solid #EDE9FE" }}>
                      {(userProfile?.fullName||userProfile?.username||"?").trim().charAt(0).toUpperCase()}
                    </div>}
                <div style={{ position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:isOnline?GREEN:"var(--ak-text-muted)",border:"2px solid #fff",animation:isOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
              </div>
              <div>
                <p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0,lineHeight:1.2 }}>{userProfile?.fullName||userProfile?.username||"…"}</p>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)" }}>{(userProfile?.agent?.xpEarned ?? 0).toLocaleString()} XP{userProfile?.yearGroup?` · ${userProfile.yearGroup}`:""}</span></div>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <button onClick={()=>navigate("/wallet")} title={coinLow?"Low balance — tap to top up":"Coin balance"}
                style={{ display:"flex",alignItems:"center",gap:5,background:coinLow?`${RED}14`:`${GOLD}1F`,border:`1px solid ${coinLow?`${RED}55`:`${GOLD}55`}`,borderRadius:100,height:34,padding:"0 12px",cursor:"pointer" }}>
                <span style={{ fontSize:14,lineHeight:1 }}>🪙</span>
                <span style={{ fontSize:12.5,fontWeight:900,color:coinLow?"var(--ak-danger-text)":"var(--ak-warn-text)" }}>{(coinBalance||0).toLocaleString()}</span>
              </button>
              <button onClick={()=>navigate("/cart")} title="Cart"
                style={{ position:"relative",display:"flex",alignItems:"center",justifyContent:"center",background:`${BRAND}12`,border:`1px solid ${BRAND}3D`,borderRadius:100,width:34,height:34,cursor:"pointer" }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
                {cartCount>0&&(
                  <span style={{ position:"absolute",top:-3,right:-3,background:RED,color:"#fff",borderRadius:"50%",minWidth:16,height:16,padding:"0 4px",fontSize:9,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff" }}>
                    {cartCount>9?"9+":cartCount}
                  </span>
                )}
              </button>
              <button onClick={()=>navigate("/notifications")} title="Notifications"
                style={{ position:"relative",display:"flex",alignItems:"center",justifyContent:"center",background:`${BRAND}12`,border:`1px solid ${BRAND}3D`,borderRadius:100,width:34,height:34,cursor:"pointer" }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {notifUnread>0&&(
                  <span style={{ position:"absolute",top:-3,right:-3,background:RED,color:"#fff",borderRadius:"50%",minWidth:16,height:16,padding:"0 4px",fontSize:9,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff" }}>
                    {notifUnread>9?"9+":notifUnread}
                  </span>
                )}
              </button>
              <div onClick={()=>setIsOnline(o=>!o)} style={{ display:"flex",alignItems:"center",background:`${BRAND}12`,borderRadius:100,padding:4,cursor:"pointer",border:`1px solid ${BRAND}3D` }}>
                <div style={{ padding:"4px 12px",borderRadius:100,background:isOnline?BRAND:"transparent",color:isOnline?"#fff":"var(--ak-text-muted)",fontSize:11,fontWeight:700,transition:"all .22s ease" }}>{isOnline?"● Online":"Online"}</div>
              </div>
            </div>
          </div>
          {(tab==="sessions"||tab==="challenges")&&(
          <div style={{ display:"flex" }}>
            {[{key:"sessions",label:t('dash.my_sessions'),count:totalUnread,countColor:BRAND},{key:"challenges",label:t('dash.challenges'),count:pendingChallenges,countColor:RED}].map(({key,label,count,countColor})=>(
              <button key={key} onClick={()=>goTab(key)} style={{ flex:1,padding:"10px 0 12px",background:"none",border:"none",cursor:"pointer",fontSize:13,fontWeight:tab===key?800:600,color:tab===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${tab===key?BRAND:"transparent"}`,transition:"all .2s",display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontFamily:"'Nunito',sans-serif" }}>
                {label}{count>0&&<span style={{ background:tab===key?countColor:"var(--ak-tag-bg)",color:tab===key?"#fff":"var(--ak-text-sub)",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800 }}>{count}</span>}
              </button>
            ))}
          </div>
          )}
        </div>

        {/* SCROLLABLE CONTENT */}
        <div style={{ flex:1,overflowY:"auto",paddingBottom:showNowBar?136:72 }}>
          <div style={{ padding:"10px 12px 0" }}><InstallBanner/></div>
          <TeacherNudge/>
          {tab==="sessions"&&(
            <div style={{ background:"var(--ak-surface)",display:"flex",flexDirection:"column",minHeight:"100%" }}>
              {/* ── Top session type tabs ── */}
              <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
                {[
                  // The Agent tab holds three things — sessions, self study and
                  // revisions — so its badge has to count all three. Counting
                  // only sessions read "Agent 0" above a "Self study 1", which
                  // is the tab telling the learner there is nothing there while
                  // pointing at the thing that is.
                  {key:"all",    label:t('sessions.all'),          icon:"📚", count:bySubject.length + agentExtras},
                  {key:"live",   label:t('sessions.live_classes'),  icon:"📡", count:bySubject.filter(s=>s.type==="live").length},
                  {key:"agent",  label:t('sessions.agent'),         icon:"🤖", count:bySubject.filter(s=>s.type==="agent").length + agentExtras},
                ].map(({key,label,icon,count})=>(
                  <button key={key} onClick={()=>setSessionTab(key)} style={{ flex:1,padding:"10px 4px 11px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:sessionTab===key?800:600,color:sessionTab===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${sessionTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
                    <span style={{ fontSize:13 }}>{icon}</span>{label}<span style={{ fontSize:9.5,fontWeight:800,background:sessionTab===key?BRAND:"var(--ak-tag-bg)",color:sessionTab===key?"#fff":"var(--ak-text-sub)",borderRadius:8,padding:"1px 6px" }}>{count}</span>
                  </button>
                ))}
              </div>

              {/* ── Live Classes sub-tabs ── */}
              {sessionTab==="live"&&(
                <>
                  <div style={{ display:"flex",gap:7,padding:"10px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-bg)",flexShrink:0 }}>
                    {[
                      {key:"live",          label:t('sessions.live_now'),      icon:"🔴"},
                      {key:"starting-soon", label:t('sessions.starting_soon'), icon:"⏰"},
                      {key:"today",         label:t('sessions.today'),         icon:"📅"},
                      {key:"tomorrow",      label:t('sessions.tomorrow'),      icon:"🌅"},
                      {key:"week",          label:t('sessions.this_week'),     icon:"📆"},
                    ].map(({key,label,icon})=>{
                      const cnt = bySubject.filter(s=>liveMatch(s,key)).length;
                      const active = liveSubTab===key;
                      const isAlert = (key==="live"||key==="starting-soon")&&cnt>0;
                      return (
                        <button key={key} onClick={()=>setLiveSubTab(key)}
                          style={{ flexShrink:0,display:"flex",alignItems:"center",gap:5,
                            padding:"6px 13px",borderRadius:20,cursor:"pointer",fontFamily:"'Nunito',sans-serif",
                            fontWeight:active?800:600,fontSize:11.5,
                            border:`1.5px solid ${active?(isAlert?RED:BRAND):"var(--ak-border2)"}`,
                            background:active?(isAlert?`${RED}10`:`${BRAND}10`):"#fff",
                            color:active?(isAlert?RED:BRAND):"var(--ak-text-sub)",transition:"all .2s" }}>
                          {isAlert&&active&&<div style={{ width:6,height:6,borderRadius:"50%",background:RED,animation:"pulse-dot 1s ease-in-out infinite" }}/>}
                          <span>{icon}</span>{label}
                          {cnt>0&&<span style={{ fontSize:9,fontWeight:900,background:active?(isAlert?RED:BRAND):"var(--ak-tag-bg)",color:active?"#fff":isAlert?RED:"var(--ak-text-sub)",borderRadius:8,padding:"1px 5px" }}>{cnt}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {/* Subject filter for live classes */}
                  <div style={{ display:"flex",gap:7,padding:"8px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                    {[{key:"all",label:"All",icon:"📚"},{key:"maths",label:"Maths",icon:SUBJECTS.maths.icon},{key:"english",label:"English",icon:SUBJECTS.english.icon},{key:"science",label:"Science",icon:SUBJECTS.science.icon}].map(({key,label,icon})=>{
                      const color=SUBJECT_COLORS[key]||BRAND, active=liveSubjectFilter===key;
                      return <button key={key} onClick={()=>setLiveSubjectFilter(key)} style={{ flexShrink:0,padding:"5px 13px",borderRadius:20,cursor:"pointer",fontFamily:"'Nunito',sans-serif",fontWeight:active?800:600,fontSize:11.5,border:`1.5px solid ${active?color:"var(--ak-border2)"}`,background:active?`${color}10`:"var(--ak-surface)",color:active?color:"var(--ak-text-sub)",transition:"all .2s",display:"flex",alignItems:"center",gap:5 }}><span>{icon}</span>{label}</button>;
                    })}
                  </div>
                </>
              )}

              {/* ── Session list ── */}
              {/* ── All + Live filtered lists ── */}
              {sessionTab!=="agent"&&(
                filtered.length===0
                  ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10 }}>
                    <span style={{ fontSize:52,opacity:.2 }}>
                      {sessionTab==="live"?liveSubTab==="starting-soon"?"🔴":"📡":"📚"}
                    </span>
                    <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)" }}>
                      {sessionTab==="live"
                        ?(liveSubTab==="starting-soon"?t('sessions.none_starting'):liveSubTab==="today"?t('sessions.none_today'):liveSubTab==="tomorrow"?t('sessions.none_tomorrow'):t('sessions.none_week'))
                        :t('sessions.not_found')}
                    </p>
                  </div>
                  :filtered.map(s=>(
                    <SessionCard key={s.id} session={s}
                      onTap={openSessionTracked}
                      decayAlert={decayBySession[s.id]||null}
                      agentProfile={agentProfile}/>
                  ))
              )}

              {/* ── Agent sub-tabs: Sessions | Revisions ── */}
              {sessionTab==="agent"&&(
                <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
                  {/* Sub-tab bar */}
                  <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
                    {[
                      {key:"sessions",  label:t('sessions.sessions'),  icon:"📚", count:agentSessionsFiltered.length},
                      {key:"selfstudy", label:"Self study",            icon:"📖", count:selfStudyCount},
                      {key:"revisions", label:t('sessions.revisions'), icon:"🔄", count:agentRevisions.length},
                    ].map(({key,label,icon,count})=>{
                      const active=agentSubTab===key;
                      const isRevision=key==="revisions";
                      return (
                        <button key={key} onClick={()=>setAgentSubTab(key)}
                          style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",
                            fontSize:11.5,fontWeight:active?800:600,
                            color:active?(isRevision?RED:BRAND):"var(--ak-text-muted)",
                            borderBottom:`2.5px solid ${active?(isRevision?RED:BRAND):"transparent"}`,
                            transition:"all .2s",fontFamily:"'Nunito',sans-serif",
                            display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
                          <span style={{ fontSize:13 }}>{icon}</span>{label}
                          {count>0&&<span style={{ fontSize:9.5,fontWeight:900,
                            background:active?(isRevision?RED:BRAND):"var(--ak-tag-bg)",
                            color:active?"#fff":isRevision?RED:"var(--ak-text-sub)",
                            borderRadius:8,padding:"1px 6px" }}>{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {/* Subject filter chips */}
                  <div style={{ display:"flex",gap:7,padding:"10px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                    {[{key:"all",label:"All",icon:"📚"},
                      {key:"maths",label:"Maths",icon:SUBJECTS.maths.icon},
                      {key:"english",label:"English",icon:SUBJECTS.english.icon},
                      {key:"science",label:"Science",icon:SUBJECTS.science.icon},
                    ].map(({key,label,icon})=>{
                      const color=SUBJECT_COLORS[key]||BRAND, active=agentSubjectFilter===key;
                      return (
                        <button key={key} onClick={()=>setAgentSubjectFilter(key)}
                          style={{ flexShrink:0,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                            fontFamily:"'Nunito',sans-serif",fontWeight:active?800:600,fontSize:11.5,
                            border:`1.5px solid ${active?color:"var(--ak-border2)"}`,
                            background:active?`${color}10`:"#fff",
                            color:active?color:"var(--ak-text-sub)",transition:"all .2s",
                            display:"flex",alignItems:"center",gap:5 }}>
                          <span>{icon}</span>{label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Sessions sub-tab */}
                  {agentSubTab==="sessions"&&(
                    agentSessionsFiltered.length===0
                      ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                        <span style={{ fontSize:52,opacity:.2 }}>📚</span>
                        <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)" }}>{t('sessions.empty')}</p>
                        <p style={{ fontSize:12,color:"#D1D5DB",textAlign:"center" }}>{t('sessions.empty_hint')}</p>
                      </div>
                      :agentSessionsFiltered.map(s=>(
                        <SessionCard key={s.id} session={s}
                          onTap={openSessionTracked}
                          decayAlert={decayBySession[s.id]||null}
                          agentProfile={agentProfile}/>
                      ))
                  )}
                  {/* Self study sub-tab — teacher-assigned topics */}
                  {agentSubTab==="selfstudy"&&(
                    <SelfStudyList
                      subjectFilter={agentSubjectFilter}
                      onStart={brief=>{
                        setTeachSession({
                          ...brief,
                          agentName:  agentProfile.name,
                          agentEmoji: agentProfile.emoji,
                        });
                      }}/>
                  )}
                  {/* Revisions sub-tab */}
                  {agentSubTab==="revisions"&&(
                    decayAsSessions.length===0
                      ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                        <span style={{ fontSize:52,opacity:.2 }}>✅</span>
                        <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)" }}>{t('sessions.no_revisions')}</p>
                        <p style={{ fontSize:12,color:"#D1D5DB",textAlign:"center" }}>{t('sessions.all_up_to_date')}</p>
                      </div>
                      :decayAsSessions.map(s=>(
                        <SessionCard key={s.id} session={s}
                          onTap={openSessionTracked}
                          decayAlert={decayBySession[s.id]||decayAlerts.find(a=>a.id===s.decayAlertId)||null}
                          agentProfile={agentProfile}/>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
          {tab==="challenges"&&(
            <div style={{ background:"var(--ak-surface)",minHeight:"100%" }}>
              <div style={{ padding:"12px 18px 10px",borderBottom:"1px solid var(--ak-border)" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}><ZapIcon size={13} color={RED}/><span style={{ fontSize:12,fontWeight:800,color:"var(--ak-text-sec)" }}>{t('challenges.peer')}</span></div>
                <div style={{ display:"flex",gap:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:5 }}><div style={{ width:8,height:8,borderRadius:"50%",background:RED,animation:"pulse-dot 1.2s ease-in-out infinite" }}/><span style={{ fontSize:10.5,fontWeight:700,color:"var(--ak-text-sub)" }}>{t('challenges.immediate')}</span></div>
                  <div style={{ display:"flex",alignItems:"center",gap:5 }}><div style={{ width:8,height:8,borderRadius:"50%",background:BRAND }}/><span style={{ fontSize:10.5,fontWeight:700,color:"var(--ak-text-sub)" }}>{t('challenges.scheduled')}</span></div>
                </div>
              </div>
              {challenges.filter(c=>!acceptedIds.has(c.id)).length===0?(
                <div style={{ padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:12 }}>
                  <span style={{ fontSize:48,opacity:.25 }}>✅</span>
                  <p style={{ fontSize:14,fontWeight:800,color:"var(--ak-text-muted)",textAlign:"center" }}>{t('challenges.all_accepted')}</p>
                  <p style={{ fontSize:12,fontWeight:600,color:"#D1D5DB",textAlign:"center" }}>{t('challenges.check_battles')}</p>
                  <button onClick={()=>goTab("battles")} style={{ padding:"10px 22px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('challenges.go_to_battles')}</button>
                </div>
              ):challenges.filter(c=>!acceptedIds.has(c.id)).map(c=><ChallengeRow key={c.id} challenge={c} onTap={setSelectedChallenge}/>)}
            </div>
          )}
          {tab==="discovery" && (higherEd
            ? (discoverView==="courses"
              ? <>
                  {/* Back to the hub — the courses feed is one of the discovery
                      types, not the whole tab, for higher-ed learners. */}
                  <div style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 14px 0",background:"var(--ak-surface)" }}>
                    <button onClick={()=>navigate("/app?tab=discovery")} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 13px",borderRadius:20,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-sub)",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>{t('dhub.title')}
                    </button>
                    {discoverQuery&&<span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>🔍 {discoverQuery}</span>}
                  </div>
                  <DiscoveryTab initialQuery={discoverQuery}/>
                </>
              : <DiscoverHub
                  onOpenCourses={(q)=>navigate(`/app?tab=discovery&view=courses${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenCourse={(c)=>c?.slug&&navigate(`/course/${c.slug}`)}/>
              )
            : <DiscoveryTab/>)}
          {tab==="rankings" && <RankingsTab/>}
          {tab==="battles"  && <BattlesTab battles={battles} onViewChallenge={()=>goTab("challenges")} onBattleCreated={loadBattles}/>}
          {tab==="agent"    && <AgentChatTab onStartTeach={s=>{ setTeachSession(s); }} agentNameProp={agentProfile.name} agentEmojiProp={agentProfile.emoji} onChatActive={setChatActive}/>}
        </div>

        {/* Now studying — Spotify-style mini-bar (higher-ed, all tabs but chat) */}
        {showNowBar && (
          <NowStudyingBar
            item={now.item}
            onOpen={openNowItem}
            onAdd={()=>{ setRecordsOpen(true); refreshRecordCount(); }}
            onDismiss={nowActs.dismiss}/>
        )}

        {/* BOTTOM NAV */}
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:200,background:"var(--ak-surface)",backdropFilter:"blur(12px)",borderTop:"1px solid var(--ak-border)",padding:"8px 0 env(safe-area-inset-bottom,14px)",display:"flex",justifyContent:"space-around",minHeight:62 }}>
          {NAV_ITEMS.map(({key,icon,label})=>{
            // "Learn" (key "sessions") stays active on the Challenges sub-tab too.
            const navActive = tab===key || (key==="sessions" && tab==="challenges");
            return (
              <div key={key} onClick={()=>goTab(key)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",color:navActive?BRAND:"var(--ak-text-muted)",minWidth:56,padding:"2px 0" }}>
                <div style={{ position:"relative" }}>
                  <span style={{ fontSize:22 }}>{icon}</span>
                  {key==="sessions"&&totalUnread>0&&<div style={{ position:"absolute",top:-3,right:-6,width:14,height:14,borderRadius:"50%",background:BRAND,display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ fontSize:8,fontWeight:900,color:"#fff" }}>{totalUnread}</span></div>}
                  {key==="battles"&&activeBattleCount>0&&<div style={{ position:"absolute",top:-3,right:-6,width:14,height:14,borderRadius:"50%",background:RED,display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ fontSize:8,fontWeight:900,color:"#fff" }}>{activeBattleCount}</span></div>}
                  {key==="agent"&&<div style={{ position:"absolute",top:-2,right:-4,width:8,height:8,borderRadius:"50%",background:GREEN,border:"1.5px solid #fff" }}/>}
                </div>
                <span style={{ fontSize:10.5,fontWeight:navActive?800:600 }}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* FAB — now opens ConfigModal first. Sits above the now-studying bar
            when the bar is up (bar is ~56px over the nav). */}
        {!selectedSession&&!selectedChallenge&&!teachSession&&!configOpen&&tab!=="agent"&&tab!=="battles"&&tab!=="discovery"&&(
          <div onClick={()=>setConfigOpen(true)} style={{ position:"fixed",bottom:showNowBar?150:78,right:18,zIndex:900,background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,borderRadius:16,padding:"9px 16px",display:"flex",alignItems:"center",gap:7,boxShadow:`0 4px 18px ${BRAND}50`,cursor:"pointer" }}>
            <MicIcon size={15} color="#fff"/>
            <span style={{ fontSize:12,fontWeight:800,color:"#fff" }}>{t('dash.start_session')}</span>
          </div>
        )}

        {/* + FAB — add a record (upload / link / paste). Higher-ed learners only:
            sixth form, university, college, other. Sits just above Start Session. */}
        {higherEd&&!selectedSession&&!selectedChallenge&&!teachSession&&!configOpen&&!recordsOpen&&tab!=="agent"&&tab!=="battles"&&tab!=="discovery"&&(
          <div onClick={()=>{setRecordsOpen(true);refreshRecordCount();}} title={t('records.title')} aria-label={t('records.title')} style={{ position:"fixed",bottom:showNowBar?198:126,right:18,zIndex:900,width:40,height:40,borderRadius:"50%",background:"var(--ak-surface)",border:`1.5px solid ${BRAND}66`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:`0 3px 14px ${BRAND}33`,transition:"transform .15s" }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.8" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {recordCount>0&&<div style={{ position:"absolute",top:-4,right:-4,minWidth:16,height:16,borderRadius:9,background:BRAND,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px",border:"1.5px solid var(--ak-surface)" }}><span style={{ fontSize:8.5,fontWeight:900,color:"#fff" }}>{recordCount}</span></div>}
          </div>
        )}

        {/* ── Overlays ── */}

        {/* ConfigModal → opens before TeachAgentModal */}
        {configOpen && (
          <ConfigModal
            initial={configInitial}
            onStart={cfg => {
              setConfigOpen(false);
              setConfigInitial(null);
              // Inject the fetched student AI agent into the config
              setTeachSession({ ...cfg, agentName: agentProfile.name, agentEmoji: agentProfile.emoji });
            }}
            onCancel={() => { setConfigOpen(false); setConfigInitial(null); }}
          />
        )}

        {/* AddRecordModal — upload / link / paste (higher-ed learners only) */}
        <AddRecordModal
          open={recordsOpen}
          onClose={() => { setRecordsOpen(false); refreshRecordCount(); }}
          user={userProfile}
          onOpenRecord={openRecordTracked}
          onToggleDone={toggleRecordDone}
        />

        {/* TeachAgentModal — now receives config OR session */}
        {teachSession && (
          <TeachAgentModal
            onMinimize={minimizeTeachSession}
            session={teachSession?.topic ? null : teachSession}
            config={teachSession?.topic ? teachSession : null}
            // A self-study attempt has to know which session it became, or the
            // teacher's progress view points at nothing.
            onSessionStarted={sid=>{
              if (teachSession?.selfStudyId && sid) {
                // Best-effort, but not silent: if this never lands the teacher's
                // progress view points at no session, so leave a trail.
                apiPost(`/api/self-study/${teachSession.selfStudyId}/link`, { sessionId: sid })
                  .catch(e => console.warn('[self-study] could not link session', sid, e?.detail || e?.message));
              }
            }}
            onClose={()=>{ setTeachSession(null); loadAgentSessions(); }}
          />
        )}

        {/* DecaySessionModal — triggered from agent alerts tab */}
        {decaySession && (
          <DecaySessionModal
            onMinimize={minimizeDecaySession}
            alert={decaySession}
            agentProfile={agentProfile}
            onClose={() => { setDecaySession(null); loadAgentSessions(); }}
          />
        )}

        {selectedChallenge && <ChallengeModal challenge={selectedChallenge} onAccept={handleAcceptChallenge} onDecline={handleDeclineChallenge} onClose={()=>setSelectedChallenge(null)}/>}
        {/* AssessmentRoom — proctored Sergeant assessment (TF.js + WS gateway) */}
        {assessSession && (
          <AssessmentRoom
            topic={assessSession.topic}
            subject={assessSession.subject}
            objectives={assessSession.objectives || []}
            onClose={() => setAssessSession(null)}
          />
        )}

        {selectedSession && <SessionSheet
          onMinimize={minimizeSessionSheet}
          session={selectedSession}
          decayAlert={decayBySession[selectedSession.id] || (selectedSession.decayAlertId && decayAlerts.find(a=>a.id===selectedSession.decayAlertId)) || null}
          agentProfile={agentProfile}
          onClose={()=>{
            // Hand any progress the session earned back to the now-studying
            // bar — the live list holds the freshest progress value.
            const live = [...agentSessions, ...sessions].find(x => x.id === selectedSession.id);
            if (live) nowActs.setProgress(live.id, live.progress || 0);
            setSelectedSession(null);
          }}
          onAssess={s => { setSelectedSession(null); setAssessSession(s); }}
          onStartTeach={s=>{
            setSelectedSession(null);
            if (s.type === "live") { joinLive(s); return; }   // live class → open the meeting
            const decay = decayBySession[s.id] || (s.decayAlertId && decayAlerts.find(a=>a.id===s.decayAlertId)) || null;
            if (decay) {
              // Revise Teaching → DecaySessionModal
              setDecaySession(decay);
            } else if (s.hasHistory && s.type==="agent") {
              // Continue Teaching → TeachAgentModal with continuation mode
              setTeachSession({ ...s, mode:"continuation", agentName:agentProfile.name, agentEmoji:agentProfile.emoji });
            } else {
              // Fresh Teaching → ConfigModal → TeachAgentModal
              setConfigInitial({ topic:s.topic, subject:s.subject?s.subject.charAt(0).toUpperCase()+s.subject.slice(1):"Science" });
              setConfigOpen(true);
            }
          }}
        />}
        {liveBattleModal   && <BattleModal    battle={liveBattleModal}    onMinimize={minimizeBattle} onClose={()=>setLiveBattleModal(null)}/>}
        {toast && <Toast msg={toast} color={toast.startsWith("🗓")?BRAND:RED} onDone={()=>setToast(null)}/>}
      </div>
    </>
  );
}
