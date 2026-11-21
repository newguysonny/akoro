import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, PRIORITY_CONFIG, STUDENT_ID } from '../../constants.js';
import { useWallet } from '../../hooks/useWallet.js';
import { API, apiGet, apiPost, apiPatch } from '../../services/api.js';
import { socketOptions } from '../../client/socket';
import { listRecords, setRecordProgress as setRecordProgressApi } from '../../services/recordsApi.js';
import { useLocalList, useSentinel, pagedStatusText } from '../../lib/usePagedList.js';
import RecordTeachSession from '../../components/library/RecordTeachSession.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { useCart } from '../../contexts/CartContext.jsx';

// Components
import TeacherNudge   from '../../components/TeacherNudge.jsx';
import NeedsYouHomeCard from '../../components/dashboard/NeedsYouHomeCard.jsx';
import { onActivityEvent } from '../../services/activitySocket.js';
import InstallBanner  from '../../components/common/InstallBanner.jsx';
import SessionCard    from '../../components/sessions/SessionCard.jsx';
import SelfStudyList  from '../../components/sessions/SelfStudyList.jsx';
import SessionSheet   from '../../components/sessions/SessionSheet.jsx';
import BlockRenderer  from '../../components/sessions/BlockRenderer.jsx';
import {
  TeachAgentModal,
  ConceptTrackerModal,
  AdaptiveControlsModal,
  DecaySessionModal,
  DecayReviewModal,
  ConfigModal,
} from '../teaching/index.js';
import { AssessmentRoom, ExamPrepConfidenceModal } from '../activities/index.js';
import BattleModal, {
  ChallengeModal,
  BattlesTab,
  ChallengesList,
} from '../battles/index.js';
import { fetchChallengeRequests } from '../../services/agentNetworkApi.js';
import AgentChatTab  from '../agent-chat/index.js';
import RankingsTab   from '../../components/tabs/RankingsTab.jsx';
import DiscoveryTab  from '../../components/tabs/DiscoveryTab.jsx';
import DiscoverHub   from '../../components/tabs/DiscoverHub.jsx';
import Toast         from '../../components/common/Toast.jsx';
import { ProgressBar, LiveBadge } from '../../components/common/ProgressBar.jsx';
import { ZapIcon, MicIcon, Icon } from '../../components/common/Icons.jsx';
import NowStudyingBar from '../../components/dashboard/NowStudyingBar.jsx';
import PharmDProgram from '../../features/pharmd/index.js';
import ProgrammePage from '../../components/programmes/ProgrammePage.jsx';
import { programmeBySlug } from '../../lib/disciplineProgrammes.js';
import { rememberDiscipline } from '../../lib/disciplineCache.js';
import ContentsDiscoveryTab from '../../components/tabs/ContentsDiscoveryTab.jsx';
import { AppShell, SidebarToggle } from '../../components/AppShell.jsx';
import { NavIcon } from '../../components/common/NavIcons.jsx';
import ProfileDrawer from '../../components/ProfileDrawer.jsx';
import { useNowStudying } from '../../utils/nowStudying.js';
import { useHigherEd } from '../../hooks/useStudyTier.js';
import { featureGated } from '../../utils/planOverride.js';
import { getAlarmChoice, startAlarm, stopAlarm } from '../../services/alarmSound.js';
import React from 'react';

// Hooks
import { useWebSocket }    from '../../hooks/useWebSocket.js';
import { useAgentProfile } from '../../hooks/useAgentProfile.js';
import { useSessionAPI }   from '../../hooks/useSessionAPI.js';
import { useDecayAlerts }  from './hooks/useDecayAlerts.js';
import { useBattleAPI }    from '../../hooks/useBattleAPI.js';
import { openFor, workflowIdFromSearch } from '../../lib/workflowRoute.js';
import { APP_HOME } from '../../config/target.js';


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
  // The hub's inner views mirror in the URL (?view=&q=, plus ?course= for
  // the Pharm D programme page) so Back/Forward move between hub, courses
  // feed and the Pharm D browse/folder chain like they do between tabs.
  const discoverViewFromUrl = () => {
    const v = new URLSearchParams(location.search).get("view");
    return v === "courses" || v === "pharmd" || v === "contents" || v === "programme" || v === "more" || v === "discipline" ? v : "hub";
  };
  const discoverQFromUrl    = () => new URLSearchParams(location.search).get("q") || "";
  const pharmdCourseFromUrl = () => new URLSearchParams(location.search).get("course") || null;
  // The static discipline programme page (?view=discipline&slug=engineering).
  const programmeSlugFromUrl = () => new URLSearchParams(location.search).get("slug") || null;
  // Every programme card opens the programme page; PHARM.D keeps its catalogue,
  // the rest render the same page with a coming-soon panel.
  const openDiscipline = (slug) => navigate(slug === 'pharmd'
    ? `${APP_HOME}?tab=discovery&view=pharmd`
    : `${APP_HOME}?tab=discovery&view=discipline&slug=${encodeURIComponent(slug)}`);
  // The generic published-programme page (?view=programme&programme=ID,
  // ?pcourse=ID for its open course) — the hub's programme cards.
  const programmeIdFromUrl     = () => new URLSearchParams(location.search).get("programme") || null;
  const programmeCourseFromUrl = () => new URLSearchParams(location.search).get("pcourse") || null;
  // The focused discovery feeds (Teaching guide / Live classes): ?focus=
  // on the courses view — same feed, one rail.
  const discoveryFocusFromUrl = () => {
    const f = new URLSearchParams(location.search).get("focus");
    return f === "guides" || f === "live" ? f : null;
  };
  const [discoverView,  setDiscoverView]  = useState(discoverViewFromUrl);
  const [discoverQuery, setDiscoverQuery] = useState(discoverQFromUrl);
  // Keep tab in sync when the URL changes (Back/Forward, deep link).

  // ── "Ding, new assignment" ─────────────────────────────────────────────
  // The teacher's assign action emits self_study_assigned into this learner's
  // user room. One ambient socket hears it: chime, toast, and poke any
  // mounted Activity page to refetch. Best-effort end to end — a missed
  // announcement never blocks the work itself, which is already saved.
  useEffect(() => {
    const TYPE_LABEL = { self_study: 'Self study', assignment: 'Assignment', project: 'Project', live_course: 'Live course', multi_stage: 'Multi-stage journey' };
    const TYPE_EMOJI = { self_study: '📖', assignment: '✏️', project: '🗂️', live_course: '📺', multi_stage: '🧩' };
    return onActivityEvent(({ assignment } = {}) => {
      if (!assignment?.title) return;
      const label = TYPE_LABEL[assignment.type] || 'Activity';
      const emoji = TYPE_EMOJI[assignment.type] || '📌';
      // A two-note chime — a courtesy, never a requirement (autoplay rules
      // may silence it until the learner has interacted; the toast still lands).
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          [[880, 0], [1174.66, 0.13]].forEach(([freq, at]) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            const t0 = ctx.currentTime + at;
            o.type = 'sine'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
            o.connect(g); g.connect(ctx.destination);
            o.start(t0); o.stop(t0 + 0.55);
          });
          setTimeout(() => ctx.close?.(), 1200);
        }
      } catch { /* no audio — fine */ }
      setToast({ msg: `${emoji} New ${label.toLowerCase()}: ${assignment.title}`, color: BRAND });
      window.dispatchEvent(new CustomEvent('ak:activity-changed', { detail: assignment }));
    });
  }, []);
  useEffect(() => {
    setTab(tabFromUrl());
    setDiscoverView(discoverViewFromUrl());
    setDiscoverQuery(discoverQFromUrl());
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  // A user tab switch pushes a history entry; the effect above then sets state.
  // Plan gate (utils/planOverride.js — the Settings test switch): a tap on
  // a plan-gated destination lands on the paywall instead of the tab, with
  // the trigger naming the locked feature. The bottom nav, the tab pills
  // and every "go to battles" CTA route through goTab, so one seam gates
  // them all. Deep links still resolve — route guards arrive with billing.
  const GATED_TABS = { battles: "Battles", rankings: "Rankings" };
  const goTab = (key) => {
    const feature = GATED_TABS[key];
    if (feature && featureGated(feature)) return navigate(`/upgrade?trigger=${key}`);
    navigate(key === "sessions" ? APP_HOME : `${APP_HOME}?tab=${key}`);
  };
  const [sessionTab,        setSessionTab]        = useState("all");
  const [liveSubTab,        setLiveSubTab]        = useState("starting-soon");
  const [agentSubTab,       setAgentSubTab]       = useState("sessions");
  const [selfStudyCount,    setSelfStudyCount]    = useState(0);   // badge on the Self study tab
  const [liveSubjectFilter, setLiveSubjectFilter] = useState("all");
  const [agentSubjectFilter,setAgentSubjectFilter]= useState("all");
  const [subjectFilter,     setSubjectFilter]     = useState("all");
  const [selectedSession,   setSelectedSession]   = useState(null);
  const [recordViewer,      setRecordViewer]      = useState(null); // a record open as a TEACHING session
  const [shelfRecords,      setShelfRecords]      = useState([]);   // the server shelf (skip-queue + resume)
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [teachSession,      setTeachSession]      = useState(null); // now holds config OR null
  const [configOpen,        setConfigOpen]        = useState(false); // FAB → ConfigModal
  const [configInitial,     setConfigInitial]     = useState(null);  // pre-fill from session sheet
  const [decaySession,      setDecaySession]      = useState(null); // decay alert object
  const [assessSession,     setAssessSession]     = useState(null); // proctored assessment target
  const [examPrepOpen,      setExamPrepOpen]      = useState(false); // learner-owned generated-practice loop
  const [conceptTrackerOpen,setConceptTrackerOpen] = useState(false); // canonical tracker projection
  const [adaptiveControlsOpen,setAdaptiveControlsOpen] = useState(false); // learner-selected controls / clear
  const [acceptedIds,       setAcceptedIds]       = useState(new Set());
  const [battles,           setBattles]           = useState([]);
  const [toast,               setToast]               = useState(null);
  // This is the server-backed autonomy consent, not browser connectivity.
  // Defaulting false keeps the agent offline until the API confirms an opt-in.
  const [agentOnline,         setAgentOnline]         = useState(false);
  const [agentAutonomyLoaded, setAgentAutonomyLoaded] = useState(false);
  const [agentAutonomySaving, setAgentAutonomySaving] = useState(false);
  const [liveBattleModal,     setLiveBattleModal]     = useState(null);
  // A link straight to one battle (?tab=battles&battle=<id>) — e.g. an Agent
  // Check's "Watch in Battles" in the chat: the Battles tab, with that battle open.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("battle");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    setTab("battles");
    setLiveBattleModal((open) => (open?.id === id ? open : { id, status: "live" }));
  }, [location.search]);

  // A link straight to one workflow (?workflow=<id>, Grand Plan §13.1): the
  // server's descriptor names what opens — the modal or tab, with the
  // workflowId — and the app follows it; it never guesses from a session's
  // shape. The param is dropped once followed, so a later render can't reopen it.
  useEffect(() => {
    const workflowId = workflowIdFromSearch(location.search);
    if (!workflowId) return undefined;
    let gone = false;
    const rest = new URLSearchParams(location.search);
    rest.delete("workflow");
    const left = rest.toString();
    apiGet(`/api/workflows/dashboard/${workflowId}`)
      .then((d) => {
        if (gone) return;
        const open = openFor(d?.workflow);
        if (!open) return;
        if (open.kind === "teaching") {
          setTeachSession({ topic: open.topic, subject: open.subject, mode: open.mode, sessionId: open.sessionId, workflowId: open.workflowId, agentName: agentProfile.name, agentEmoji: agentProfile.emoji });
        } else if (open.kind === "decay_review") {
          setDecaySession({ id: null, topic: open.topic, subject: open.subject, workflowId: open.workflowId });
        } else if (open.kind === "assessment") {
          setAssessSession({ topic: open.topic, subject: open.subject, workflowId: open.workflowId, assessmentId: open.assessmentId });
        } else if (open.kind === "battle") {
          navigate(`${APP_HOME}?tab=battles&battle=${encodeURIComponent(open.battleId)}`, { replace: true });
          return;
        } else if (open.kind === "agent_chat") {
          navigate(`${APP_HOME}?tab=agent`, { replace: true });
          return;
        }
        navigate(left ? `${APP_HOME}?${left}` : APP_HOME, { replace: true });
      })
      .catch((e) => { console.warn("[workflow] could not open", workflowId, e?.message || e); });
    return () => { gone = true; };
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /* Agent sessions page in from the server 10 at a time (scroll-to-
     fetch-more); the ref holds the cursor between fetches. */
  const [agentSessionsTotal, setAgentSessionsTotal] = useState(0);
  const agentSessionsPageRef = useRef({ cursor: null, done: true, loading: false });
  const [userProfile,  setUserProfile]  = useState(null);
  // Phones: the profile photo opens the account drawer; tablet/desktop keep going straight to Settings.
  const [drawer, setDrawer] = useState(false);
  const openProfile = () => { if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 768px)").matches) setDrawer(true); else navigate("/settings"); };
  const [notifUnread,  setNotifUnread]  = useState(0);

  // ── Level-aware UI tier ──────────────────────────────────────────────────
  // Sixth form / university / college / other get the discovery hub feed and
  // the Now-Studying bar; school learners get the plain discovery feed.
  // Tier comes from the shared cached hook (useStudyTier.js) — correct on
  // the FIRST render, no school-UI flash; the profile fetch below still
  // feeds the header (name, avatar, XP).
  const higherEd = useHigherEd();

  // ── Now studying — Spotify-style mini-bar ────────────────────────────────
  // Tracks the material or session the learner last opened, across all tabs
  // except the AI chat. Higher-ed gated like the records feature it leans on.
  const [now, nowActs] = useNowStudying(userProfile?.id);
  // Reopen request for a parked Pharm.D topic (the Now-Studying bar's
  // resume) — passed to the Discover hub, which opens the programme on it.
  const [pharmdFocus, setPharmdFocus] = useState(null);
  // Is the AI chat SURFACE showing? (Agent tab also hosts tasks/stats/self-study,
  // where the Now-Studying bar should still appear — only chat hides it.)
  const [chatActive, setChatActive] = useState(false);

  // ── Schedule alarm — the chosen ringtone (settings › Schedule alarm)
  //    rings when a scheduled live class hits its moment, with a
  //    stoppable banner. Choice + uploaded sound live in the
  //    alarmSound service (device-local, like records).
  const [alarmBanner, setAlarmBanner] = useState(null);
  const ringAlarm = (title) => {
    if (getAlarmChoice() === 'none') return;   // silenced
    setAlarmBanner({ title });
    startAlarm();
  };
  // An ignored ring must not ring forever — cap it, and always stop on
  // unmount so navigating away can't leave a dangling interval.
  useEffect(() => {
    if (!alarmBanner) return undefined;
    const id = setTimeout(() => { stopAlarm(); setAlarmBanner(null); }, 25000);
    return () => clearTimeout(id);
  }, [alarmBanner]);
  useEffect(() => () => stopAlarm(), []);

  // Records live on the server now (the Library shelf) — progress goes
  // straight there, and the Now-Studying bar mirrors it optimistically.
  const setRecordProgress = useCallback((id, progress) => {
    setRecordProgressApi(id, Math.max(0, Math.min(100, progress))).catch(() => { /* offline — next open re-syncs */ });
  }, []);

  // The shelf feeds the skip-queue and the bar's ▶ resume. A viewer close
  // re-syncs it so progress on the cards is current.
  const loadShelfRecords = useCallback(() => {
    listRecords().then(setShelfRecords).catch(() => { /* offline — keep what we have */ });
  }, []);
  useEffect(() => { loadShelfRecords(); }, [loadShelfRecords]);

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
      emoji: (SUBJECTS[s.subject]?.icon) || 'ti-book',
      progress: s.progress || 0,
      snapshot: s,
    });
  }, [nowActs]);

  // Opening a record tracks it in the Now-Studying bar AND opens it as a
  // TEACHING session — the learner teaches their agent over the record's
  // material. Links stay links (new tab).
  const openRecordTracked = useCallback((r) => {
    if (!r) return;
    const kindLabel = r.kind === 'link' ? t('records.tab_link') : r.kind === 'paste' ? t('records.tab_paste') : t('records.tab_upload');
    nowActs.setCurrent({
      type: 'record',
      id: r.id,
      title: r.name,
      sub: kindLabel,
      emoji: r.kind === 'link' ? 'ti-link' : r.kind === 'paste' ? 'ti-clipboard' : 'ti-paperclip',
      progress: r.progress || 0,
    });
    if (!r.progress) { setRecordProgress(r.id, 10); nowActs.setProgress(r.id, 10); }
    if (r.kind === 'link' && r.url) { try { window.open(r.url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    else setRecordViewer(r);
  }, [nowActs, setRecordProgress, t]);

  // Bar visibility: every tab except the AI chat surface, and never under a
  // full-screen sheet that has its own layout.
  const showNowBar = higherEd && !!now.item && !now.dismissed
    && !(tab === "agent" && chatActive) && !selectedSession && !selectedChallenge
    && !teachSession && !liveBattleModal && !configOpen && !recordViewer;

  // Skip queue for the tablet bar's previous / next (Spotify-style track
  // skip): sessions skip through sessions, records through records, and
  // skipping RE-PARKS the neighbour on the bar (nothing opens) the way a
  // player swaps tracks without opening the full screen. Battles never
  // queue. Minimized teach/decay sessions use synthetic ids that no queue
  // contains, so their skips disable until something trackable is parked.
  const nowStudyQueue = useMemo(() => {
    if (!now.item) return [];
    if (now.item.type === 'record') return shelfRecords;
    if (now.item.type === 'session') return [...agentSessions, ...sessions];
    return [];
  }, [now.item, agentSessions, sessions, shelfRecords]);
  const canSkipNow = now.item?.type !== 'battle' && nowStudyQueue.length > 1
    && nowStudyQueue.some(x => x && x.id === now.item.id);
  const skipNowStudy = (dir) => {
    if (!canSkipNow || !now.item) return;
    const q = nowStudyQueue;
    const i = q.findIndex(x => x && x.id === now.item.id);
    if (i < 0) return;
    const nx = q[(i + dir + q.length) % q.length];
    if (!nx || nx.id === now.item.id) return;
    if (now.item.type === 'record') {
      nowActs.setCurrent({
        type: 'record', id: nx.id, title: nx.name,
        sub: nx.kind === 'link' ? t('records.tab_link') : nx.kind === 'paste' ? t('records.tab_paste') : t('records.tab_upload'),
        emoji: nx.kind === 'link' ? 'ti-link' : nx.kind === 'paste' ? 'ti-clipboard' : 'ti-paperclip',
        progress: nx.progress || 0,
      });
    } else {
      nowActs.setCurrent({
        type: 'session', id: nx.id,
        title: nx.title || 'Study session',
        sub: (SUBJECTS[nx.subject]?.label) || nx.topic || 'Session',
        emoji: (SUBJECTS[nx.subject]?.icon) || 'ti-book',
        progress: nx.progress || 0, snapshot: nx,
      });
    }
  };

  // ── Minimize — park a live session on the Now-Studying bar ──────────────
  const minimizeSessionSheet = () => {
    const live = [...agentSessions, ...sessions].find(x => x.id === selectedSession?.id);
    if (live) nowActs.setProgress(live.id, live.progress || 0);
    setSelectedSession(null);
    setToast(t('now.minimized_toast'));
  };
  const minimizeTeachSession = (parked) => {
    const ts = teachSession;
    if (ts) {
      // The live session id from the modal (fallback: whatever the state
      // already carried). It rides in the snapshot so the bar reopens the
      // SAME session — resumes it while the grace window holds, continues
      // from its saved history afterwards. No conversation lost to minimize.
      const liveId = parked?.sessionId || ts.sessionId || null;
      nowActs.setCurrent({
        type: 'session',
        id: ts.id || (ts.selfStudyId ? `self-${ts.selfStudyId}` : `teach-${ts.topic || 'session'}`),
        title: ts.title || ts.topic || t('now.teaching'),
        sub: (SUBJECTS[ts.subject]?.label) || ts.subject || t('now.teaching'),
        emoji: ts.agentEmoji || agentProfile.emoji || '🤖',
        progress: ts.progress || 0,
        // The session itself rides along — the bar reopens it DIRECTLY,
        // no details sheet in between.
        snapshot: { __restore: 'teach', teach: { ...ts, sessionId: liveId } },
      });
    }
    setTeachSession(null);
    setToast(t('now.minimized_toast'));
  };
  const minimizeDecaySession = (parked) => {
    const d = decaySession;
    if (d) {
      nowActs.setCurrent({
        type: 'session',
        id: `decay-${d.id || d.topic || 'session'}`,
        title: `${t('now.relearn')} ${d.topic || ''}`.trim(),
        sub: d.subject || '',
        emoji: 'ti-refresh',
        progress: 0,
        // The decay alert rides along so the bar reopens revision DIRECTLY.
        // The live session id rides with it: restore resumes the parked
        // session (or continues its saved history) — the re-teach
        // conversation survives minimize.
        snapshot: { __restore: 'decay', decay: { ...d, ...(parked?.sessionId ? { resumeSessionId: parked.sessionId } : {}) } },
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
        emoji: 'ti-swords',
        progress: 0,
        snapshot: b,
      });
    }
    setLiveBattleModal(null);
    setToast(t('now.minimized_toast'));
  };

  // Bar ▶ — resume. Sessions reopen (live copy preferred, snapshot fallback);
  // records re-run the record open flow.
  const openNowItem = async () => {
    if (!now.item) return;
    if (now.item.type === 'battle') {
      // Prefer the freshest card (status may have flipped while parked);
      // fall back to the snapshot taken at minimize time.
      const fresh = battles.find(x => x.id === now.item.refId) || now.item.snapshot;
      if (fresh) setLiveBattleModal(fresh);
      else setToast(t('now.battle_ended'));
    } else if (now.item.type === 'course') {
      // A parked agent session (course video) — straight back to the course,
      // reopening the session on the exact lesson.
      const snap = now.item.snapshot;
      if (snap?.slug) navigate(`/course/${snap.slug}${snap.lessonId ? `?agent=${snap.lessonId}` : ''}`);
      else setToast(t('now.session_ended'));
    } else if (now.item.type === 'session') {
      // Continue STRAIGHT into the session — no intermediate details sheet.
      // A parked snapshot (minimized teach/decay) restores its own modal;
      // a shelf session routes exactly the way the sheet's CTA used to:
      // live class → join, decay → revise, agent w/ history → continuation,
      // fresh → teaching config.
      const live = [...agentSessions, ...sessions].find(x => x.id === now.item.id);
      const snap = now.item.snapshot;
      if (snap?.__restore === 'teach' && snap.teach) {
        const ts = snap.teach;
        // Resume the SAME live session first (minimize grace window); the
        // modal falls back to a continuation of the saved history on
        // resume_failed — either way the parked conversation comes back.
        setTeachSession(ts.id || ts.sessionId
          ? { ...ts, mode: 'continuation', resumeSessionId: ts.sessionId || ts.id }
          : ts);
      } else if (snap?.__restore === 'decay' && snap.decay) {
        setDecaySession(snap.decay);   // carries resumeSessionId when a live session was parked
      } else if (live) {
        if (live.type === 'live') { joinLive(live); return; }
        const decay = decayBySession[live.id] || (live.decayAlertId && decayAlerts.find(a=>a.id===live.decayAlertId)) || null;
        if (decay) setDecaySession(decay);
        else if (live.hasHistory && live.type === 'agent') setTeachSession({ ...live, mode: 'continuation', agentName: agentProfile.name, agentEmoji: agentProfile.emoji });
        else { setConfigInitial({ topic: live.topic, subject: live.subject ? live.subject.charAt(0).toUpperCase()+live.subject.slice(1) : 'Science' }); setConfigOpen(true); }
      } else {
        setToast(t('now.session_ended'));
      }
    } else if (now.item.type === 'record') {
      let r = shelfRecords.find(x => x.id === now.item.id);
      if (!r) {
        // Shelf state may be stale (added on another device) — try fresh.
        try { r = (await listRecords()).find(x => x.id === now.item.id) || null; }
        catch { r = null; }
      }
      if (r) openRecordTracked(r);
    } else if (now.item.type === 'library') {
      // Content parked from the Library shelf or a folder — its route rides
      // in the snapshot; resume is just the navigation.
      if (now.item.snapshot?.path) navigate(now.item.snapshot.path);
      else setToast(t('now.session_ended'));
    } else if (now.item.type === 'pharmd') {
      // A parked Pharm.D topic — straight onto the programme page at its
      // course; the focus prop makes PharmDProgram reopen the exact topic.
      const c = now.item.snapshot?.code;
      setPharmdFocus({ ...now.item.snapshot, ts: Date.now() });
      navigate(`${APP_HOME}?tab=discovery&view=pharmd${c ? `&course=${encodeURIComponent(c)}` : ''}`);
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

  // What the agent is doing RIGHT NOW (background work stream). The socket
  // pushes labels; a quiet stretch of 90s falls back to the static subtitle.
  const [agentActivity, setAgentActivity] = useState(null);
  const agentActivityTimer = useRef(null);
  const absorbAgentActivity = useCallback((label) => {
    setAgentActivity(label || null);
    if (agentActivityTimer.current) clearTimeout(agentActivityTimer.current);
    if (label) agentActivityTimer.current = setTimeout(() => setAgentActivity(null), 90_000);
  }, []);

  const toggleAgentAutonomy = useCallback(async () => {
    if (!agentAutonomyLoaded || agentAutonomySaving) return;
    const previous = agentOnline;
    const next = !previous;
    setAgentOnline(next); // responsive UI; API remains the source of authority.
    setAgentAutonomySaving(true);
    try {
      // One switch, both consents: online = due-task check-ins AND the
      // background planner (level 2). Offline pauses everything and keeps
      // the learner's planner level for when they come back online.
      const response = await apiPatch("/api/adaptive/chat/autonomy",
        next ? { enabled: true, level: 2 } : { enabled: false });
      const saved = typeof response?.enabled === "boolean" ? response.enabled : next;
      setAgentOnline(saved);
      setToast(saved
        ? "Agent online — it may open a chat when a task is due, and the background planner proposes next steps for you to approve."
        : "Agent offline — due-task chats and the background planner are paused.");
    } catch (error) {
      setAgentOnline(previous);
      setToast(error?.message || "Could not update your agent setting. Please retry.");
    } finally {
      setAgentAutonomySaving(false);
    }
  }, [agentAutonomyLoaded, agentAutonomySaving, agentOnline]);

  // The latest loadBattles, for socket handlers registered once on mount.
  const reloadBattles = useRef(null);
  useEffect(()=>{
    // User profile — name, avatar, year group, XP for the header
    apiGet("/api/profiles/me")
      .then(d=>{
        const profile = d?.data || d;
        if (profile?.id) {
          setUserProfile(profile);
          rememberDiscipline(profile.discipline);   // first paint after reload
        }
      })
      .catch(()=>{});

    // Read the durable preference every fresh dashboard load. A failed read
    // leaves the agent safely Offline rather than treating local UI state as
    // permission for a background worker.
    apiGet("/api/adaptive/chat/autonomy")
      .then(d=>{ setAgentOnline(Boolean(d?.enabled)); })
      .catch(()=>{ setAgentOnline(false); })
      .finally(()=>setAgentAutonomyLoaded(true));

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
    apiGet("/api/adaptive/teaching/sessions?limit=10")
      .then(d=>{
        setAgentSessions(d.sessions || []);
        setAgentSessionsTotal(typeof d.total === "number" ? d.total : (d.sessions || []).length);
        agentSessionsPageRef.current = { cursor: d.nextCursor || null, done: !d.nextCursor, loading: false };
      })
      // An empty Sessions tab and a failing Sessions fetch looked identical
      // before this — say which one it is.
      .catch(e=>{ console.warn("[sessions] load failed:", e?.message || e); });
  },[]);

  /* The agent sessions next page (10). Value-based cursor: sessions
     updated above it never shift the pages. */
  const loadMoreAgentSessions = useCallback(async () => {
    const st = agentSessionsPageRef.current;
    if (st.loading || st.done || !st.cursor) return;
    st.loading = true;
    try {
      const d = await apiGet(`/api/adaptive/teaching/sessions?limit=10&cursor=${encodeURIComponent(st.cursor)}`);
      st.cursor = d.nextCursor || null;
      st.done = !d.nextCursor;
      if (typeof d.total === "number") setAgentSessionsTotal(d.total);
      setAgentSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...(d.sessions || []).filter((s) => !seen.has(s.id))];
      });
    } catch { /* keep what's shown — the sentinel can retry */ }
    st.loading = false;
  },[]);

  // WebSocket — live class alerts + challenge notifications + decay alerts
  useEffect(()=>{
    let socket;
    try {
      if (typeof window !== "undefined" && window.io) {
        socket = window.io(API, socketOptions({ portal: "student" }));

        socket.on("connect", () => {
          // The server joins only rooms for the authenticated socket identity.
          socket.emit("subscribe-student");
          socket.emit("join-student-room");
        });

        // Live class starting soon
        socket.on("live_class_starting", alert => {
          setToast(`${alert.title} starts in ${alert.minutesUntil} min!`);
          ringAlarm(`${alert.title} — ${alert.minutesUntil} min!`);
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
          setToast(`${alert.title} is now LIVE! Join now.`);
          ringAlarm(`${alert.title} is LIVE now!`);
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

        // New challenge from peer — the full card (same shape as a reload).
        // De-duplicated: a battle re-announced must not appear twice.
        socket.on("new_challenge", challenge => {
          setToast(`${challenge.challenger || "Someone"} challenged you!`);
          setChallenges(prev => [challenge, ...prev.filter(c => c.id !== challenge.id)]);
          goTab("challenges");
        });

        // Someone took a seat in an open battle: refresh, don't guess. (This
        // used to flip the battle to "live" on any join.)
        socket.on("battle:participant-joined", () => reloadBattles.current?.());

        // Anything that changes a battle's state reloads the lists, so a card
        // never sits on a stale status until a full page reload.
        for (const ev of ["battle:started", "battle:cancelled", "battle:over", "battle_declined", "battle_ready"]) {
          socket.on(ev, () => reloadBattles.current?.());
        }

        // Gap 3: challenger notified their battle was accepted
        socket.on("battle_accepted", data => {
          setToast(`${data.opponent} accepted your challenge! Battle ${data.isImmediate ? "starting now" : "scheduled"}.`);
          setBattles(prev => prev.map(b =>
            b.id === data.battleId ? { ...b, status: data.status } : b
          ));
          // Auto-join the battle room
          socket.emit("join-battle", data.battleId);
        });

        // Gap 3: join battle room when told to
        socket.on("join_battle_room", ({ battleId }) => {
          socket.emit("join-battle", battleId);
          reloadBattles.current?.();
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
          if (n?.title) setToast(`${n.title}`);
        });

        // Agent activity — what the background agent is doing at this moment
        // ("Checking your schedule\u2026", "Preparing a check-in\u2026").
        socket.on("agent:activity", ({ label } = {}) => absorbAgentActivity(label));
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
  /* The composed sessions list is fetched whole (live + agent merged and
     bucket-sorted server-side) — it reveals 10 at a time locally. */
  const sessionsLocal = useLocalList(filtered, 10, `${sessionTab}|${liveSubTab}|${subjectFilter}|${liveSubjectFilter}`);

  // Agent sub-tab data
  // Prefer the richer /teaching/sessions data; fall back to the agent-type
  // items from /student/sessions (same source that drives the Agent tab count)
  // so the Sessions sub-tab is never empty when the count says there are some.
  const agentSessionsBase = agentSessions.length ? agentSessions : sessions.filter(s=>s.type==="agent");
  const agentSessionsFiltered = agentSubjectFilter==="all"
    ? agentSessionsBase
    : agentSessionsBase.filter(s=>s.subject===agentSubjectFilter);
  /* Agent sessions reveal 10 at a time; when the reveal runs out and the
     server still has pages, the same sentinel fetches the next 10. */
  const [agentShown, setAgentShown] = useState(10);
  useEffect(() => { setAgentShown(10); }, [agentSubjectFilter, agentSubTab, sessionTab]);
  const agentVisible = agentSessionsFiltered.slice(0, agentShown);
  const agentHasMoreServer = agentSessions.length > 0 && agentSessionsTotal > agentSessions.length;
  const agentHasMore = agentShown < agentSessionsFiltered.length || agentHasMoreServer;
  const onAgentSentinel = useCallback(() => {
    if (agentShown < agentSessionsFiltered.length) setAgentShown((s) => s + 10);
    else loadMoreAgentSessions();
  }, [agentShown, agentSessionsFiltered.length, loadMoreAgentSessions]);
  const agentSentinelRef = useSentinel(onAgentSentinel, sessionTab==="agent" && agentSubTab==="sessions" && agentHasMore);
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

  // Open challenge requests other agents posted count towards Challenges too.
  const [openRequestCount, setOpenRequestCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => fetchChallengeRequests().then(d => { if (alive) setOpenRequestCount((d?.requests || []).length); }).catch(() => {});
    load();
    const id = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const totalUnread       = sessions.reduce((sum,s)=>sum+s.unread,0);
  const pendingChallenges = challenges.filter(c=>!acceptedIds.has(c.id)).length + openRequestCount;

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
        setToast(`Challenge accepted — the battle is starting!`);
      } else if (r.invited > 1) {
        // A class battle set by a teacher: accepting takes your seat, it does
        // not start the battle. Saying "starting!" here would send the learner
        // looking for a battle that is still waiting on their classmates.
        setToast(`You're in — ${r.accepted} of ${r.invited} accepted so far.`);
      } else {
        setToast({msg:'Battle scheduled — find it in Battles › Scheduled.',color:BRAND});
      }
      // The stub above shows at once; the real card (lineup, start time, HP
      // rule…) replaces it as soon as the lists reload.
      loadBattles();
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
    try {
      await apiPost(`/api/battle/challenges/${c.id}/decline`, {});
      setToast('Challenge declined.');
      loadBattles();
    } catch (e) {
      // It didn't go through — put it back and say so, rather than letting
      // the card vanish while the battle still waits on this learner.
      setAcceptedIds(prev => { const n = new Set(prev); n.delete(c.id); return n; });
      setToast(e?.message || 'Could not decline — please try again.');
    }
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
    apiGet("/api/battle/my-challenges", { cache: false }).then(d=>setChallenges(d?.data ?? [])).catch(()=>{});
    apiGet("/api/battle/my-battles", { cache: false }).then(d=>setBattles(d?.data ?? [])).catch(()=>{});
  }, []);
  reloadBattles.current = loadBattles;

  // Bottom-nav destinations. No icon field any more: the key IS the
  // NavIcon name (NavIcons.jsx) — the same icon set the AppShell
  // sidebar uses, so a destination reads identically on every surface.
  const NAV_ITEMS=[{key:"sessions",label:t('nav.learn')},{key:"discovery",label:t('nav.discover')},{key:"rankings",label:t('nav.rankings')},{key:"battles",label:t('nav.battles')},{key:"agent",label:t('nav.agent')}];
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

      {/* AppShell — admin-style frame: sidebar nav on tablet/desktop, nothing
          (bottom nav stays) on mobile. Live badge counts mirror the bottom
          nav's badges, and the parked now-studying item renders in the
          sidebar on desktop while the fixed bar covers mobile — both driven
          by the same showNowBar flag so they can never disagree. */}
      <AppShell
        badges={{ learn: totalUnread, battles: activeBattleCount, agentOnline }}
        nowStudying={showNowBar ? {
          item: now.item,
          onOpen: openNowItem,
          onAdd: () => navigate('/library?add=1'),
          onDismiss: nowActs.dismiss,
          onPrev: now.item?.type !== 'battle' ? () => skipNowStudy(-1) : null,
          onNext: now.item?.type !== 'battle' ? () => skipNowStudy(1) : null,
          canSkip: canSkipNow,
        } : null}>
      <div style={{ width:"100%",height:"100%",fontFamily:"'Nunito',sans-serif",background:"var(--ak-bg)",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative" }}>

        {/* HEADER — app chrome on every tab (profile, wallet, cart,
            notifications, agent toggle), pinned above the scroll area.
            The Learn/Challenges pills render inside it only on Learn.
            Mobile (≤768px) is LEARN-ONLY: on the other tabs the header
            gets .ak-mobile-hide and index.css drops it, giving the tab
            the full viewport (the bottom nav carries the chrome there).
            Tablet/desktop keep it on every tab. */}
        <div className={`ak-dash-header${(tab!=="sessions"&&tab!=="challenges") ? " ak-mobile-hide" : ""}`}
          style={{ background:"var(--ak-surface)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--ak-border)",padding:(tab==="sessions"||tab==="challenges")?"14px 18px 0":"14px 18px 14px",zIndex:100,flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ display:"flex",alignItems:"center",gap:11 }}>
              <SidebarToggle/>
              <div style={{ position:"relative",cursor:"pointer" }} data-testid="header-profile" onClick={openProfile}>
                {userProfile?.avatarUrl
                  ? <img src={userProfile.avatarUrl} alt="" style={{ width:38,height:38,borderRadius:"50%",objectFit:"cover",border:"2px solid #EDE9FE" }}/>
                  : <div style={{ width:38,height:38,borderRadius:"50%",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:15,fontWeight:900,border:"2px solid #EDE9FE" }}>
                      {(userProfile?.fullName||userProfile?.username||"?").trim().charAt(0).toUpperCase()}
                    </div>}
                <div style={{ position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:agentOnline?GREEN:"var(--ak-text-muted)",border:"2px solid #fff",animation:agentOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
              </div>
              <div>
                <p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0,lineHeight:1.2 }}>{userProfile?.fullName||userProfile?.username||"…"}</p>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)" }}>{(userProfile?.agent?.xpEarned ?? 0).toLocaleString()} XP{userProfile?.yearGroup?` · ${userProfile.yearGroup}`:""}</span></div>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <button onClick={()=>navigate("/wallet")} title={coinLow?"Low balance — tap to top up":"Coin balance"}
                style={{ display:"flex",alignItems:"center",gap:5,background:coinLow?`${RED}14`:`${GOLD}1F`,border:`1px solid ${coinLow?`${RED}55`:`${GOLD}55`}`,borderRadius:100,height:34,padding:"0 12px",cursor:"pointer" }}>
                <Icon name="ti-coins" size={15} color={GOLD}/>
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
              <button type="button" onClick={toggleAgentAutonomy}
                aria-pressed={agentOnline}
                aria-label={agentOnline ? "Turn autonomous Agent offline" : "Turn autonomous Agent online"}
                disabled={!agentAutonomyLoaded || agentAutonomySaving}
                title={agentOnline
                  ? "Agent online: due-task check-ins and the background planner (proposals you approve) run while you're away."
                  : "Agent offline: no due-task chats, no background planning."}
                style={{ display:"flex",alignItems:"center",background:`${BRAND}12`,borderRadius:100,padding:4,cursor:agentAutonomyLoaded&&!agentAutonomySaving?"pointer":"wait",border:`1px solid ${BRAND}3D`,opacity:agentAutonomyLoaded?1:.7 }}>
                <span style={{ padding:"4px 12px",borderRadius:100,background:agentOnline?BRAND:"transparent",color:agentOnline?"#fff":"var(--ak-text-muted)",fontSize:11,fontWeight:700,transition:"all .22s ease",display:"flex",alignItems:"center",gap:5 }}>
                  {agentOnline&&<span style={{width:6,height:6,borderRadius:"50%",background:"#fff",display:"inline-block"}}/>}
                  {agentAutonomySaving ? "Saving…" : agentOnline ? "Agent online" : "Agent offline"}
                </span>
              </button>
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

        {/* SCROLLABLE CONTENT — .ak-dash-scroll trims the bottom-nav
            clearance on desktop, where the nav is hidden (index.css). */}
        <div className="ak-dash-scroll" style={{ flex:1,overflowY:"auto",paddingBottom:showNowBar?136:72 }}>
          <div style={{ padding:"10px 12px 0" }}><InstallBanner/></div>
          <TeacherNudge/>
          {tab==="sessions"&&<NeedsYouHomeCard/>}
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
                  {key:"all",    label:t('sessions.all'),          icon:"ti-book", count:bySubject.length + agentExtras},
                  {key:"live",   label:t('sessions.live_classes'),  icon:"ti-broadcast", count:bySubject.filter(s=>s.type==="live").length},
                  {key:"agent",  label:t('sessions.agent'),         icon:"ti-robot", count:bySubject.filter(s=>s.type==="agent").length + agentExtras},
                ].map(({key,label,icon,count})=>(
                  <button key={key} onClick={()=>setSessionTab(key)} style={{ flex:1,padding:"10px 4px 11px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:sessionTab===key?800:600,color:sessionTab===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${sessionTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
                    <Icon name={icon} size={13}/>{label}<span style={{ fontSize:9.5,fontWeight:800,background:sessionTab===key?BRAND:"var(--ak-tag-bg)",color:sessionTab===key?"#fff":"var(--ak-text-sub)",borderRadius:8,padding:"1px 6px" }}>{count}</span>
                  </button>
                ))}
              </div>

              {/* ── Live Classes sub-tabs ── */}
              {sessionTab==="live"&&(
                <>
                  <div style={{ display:"flex",gap:7,padding:"10px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-bg)",flexShrink:0 }}>
                    {[
                      {key:"live", label:t('sessions.live_now'), icon:"ti-circle-dot"},
                      {key:"starting-soon", label:t('sessions.starting_soon'), icon:"ti-alarm"},
                      {key:"today", label:t('sessions.today'), icon:"ti-calendar"},
                      {key:"tomorrow", label:t('sessions.tomorrow'), icon:"ti-sunrise"},
                      {key:"week", label:t('sessions.this_week'), icon:"ti-calendar-month"},
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
                          <Icon name={icon} size={12}/>{label}
                          {cnt>0&&<span style={{ fontSize:9,fontWeight:900,background:active?(isAlert?RED:BRAND):"var(--ak-tag-bg)",color:active?"#fff":isAlert?RED:"var(--ak-text-sub)",borderRadius:8,padding:"1px 5px" }}>{cnt}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {/* Subject filter for live classes */}
                  <div style={{ display:"flex",gap:7,padding:"8px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                    {[{key:"all",label:"All",icon:"ti-book"},{key:"maths",label:"Maths",icon:SUBJECTS.maths.icon},{key:"english",label:"English",icon:SUBJECTS.english.icon},{key:"science",label:"Science",icon:SUBJECTS.science.icon}].map(({key,label,icon})=>{
                      const color=SUBJECT_COLORS[key]||BRAND, active=liveSubjectFilter===key;
                      return <button key={key} onClick={()=>setLiveSubjectFilter(key)} style={{ flexShrink:0,padding:"5px 13px",borderRadius:20,cursor:"pointer",fontFamily:"'Nunito',sans-serif",fontWeight:active?800:600,fontSize:11.5,border:`1.5px solid ${active?color:"var(--ak-border2)"}`,background:active?`${color}10`:"var(--ak-surface)",color:active?color:"var(--ak-text-sub)",transition:"all .2s",display:"flex",alignItems:"center",gap:5 }}><Icon name={icon} size={12}/>{label}</button>;
                    })}
                  </div>
                </>
              )}

              {/* ── Session list ── */}
              {/* ── All + Live filtered lists ── */}
              {sessionTab!=="agent"&&(
                filtered.length===0
                  ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10 }}>
                    <Icon name={sessionTab==="live"?liveSubTab==="starting-soon"?"ti-circle-dot":"ti-broadcast":"ti-book"} size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
                    <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)" }}>
                      {sessionTab==="live"
                        ?(liveSubTab==="starting-soon"?t('sessions.none_starting'):liveSubTab==="today"?t('sessions.none_today'):liveSubTab==="tomorrow"?t('sessions.none_tomorrow'):t('sessions.none_week'))
                        :t('sessions.not_found')}
                    </p>
                  </div>
                  :(<>
                    {sessionsLocal.visible.map(s=>(
                      <SessionCard key={s.id} session={s}
                        onTap={openSessionTracked}
                        decayAlert={decayBySession[s.id]||null}
                        agentProfile={agentProfile}/>
                    ))}
                    {sessionsLocal.total > 10 && (
                      <div ref={sessionsLocal.sentinelRef} style={{ textAlign:"center",fontSize:12,fontWeight:700,color:"var(--ak-text-muted)",padding:"14px 0 6px" }}>
                        {pagedStatusText({ shown: sessionsLocal.shown, total: sessionsLocal.total, hasMore: sessionsLocal.hasMore })}
                      </div>
                    )}
                  </>)
              )}

              {/* ── Agent sub-tabs: Sessions | Revisions ── */}
              {sessionTab==="agent"&&(
                <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
                  {/* Sub-tab bar */}
                  <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
                    {[
                      {key:"sessions", label:t('sessions.sessions'), icon:"ti-book", count:(agentSubjectFilter==="all" && agentSessions.length) ? Math.max(agentSessionsTotal, agentSessionsFiltered.length) : agentSessionsFiltered.length},
                      {key:"selfstudy", label:"Self study", icon:"ti-book-2", count:selfStudyCount},
                      {key:"revisions", label:t('sessions.revisions'), icon:"ti-refresh", count:agentRevisions.length},
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
                          <Icon name={icon} size={13}/>{label}
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
                    {[{key:"all",label:"All",icon:"ti-book"},
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
                          <Icon name={icon} size={12}/>{label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Sessions sub-tab */}
                  {agentSubTab==="sessions"&&(
                    agentSessionsFiltered.length===0
                      ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                        <Icon name="ti-book" size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
                        <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)" }}>{t('sessions.empty')}</p>
                        <p style={{ fontSize:12,color:"#D1D5DB",textAlign:"center" }}>{t('sessions.empty_hint')}</p>
                      </div>
                      :(<>
                        {agentVisible.map(s=>(
                          <SessionCard key={s.id} session={s}
                            onTap={openSessionTracked}
                            decayAlert={decayBySession[s.id]||null}
                            agentProfile={agentProfile}/>
                        ))}
                        {(agentSessionsFiltered.length > 10 || agentHasMoreServer) && (
                          <div ref={agentSentinelRef} style={{ textAlign:"center",fontSize:12,fontWeight:700,color:"var(--ak-text-muted)",padding:"14px 0 6px" }}>
                            {(agentSubjectFilter==="all" && agentSessions.length)
                              ? pagedStatusText({ shown: Math.min(agentShown, agentSessionsFiltered.length), total: Math.max(agentSessionsTotal, agentSessionsFiltered.length), hasMore: agentHasMore })
                              : (agentHasMore ? "Scroll for more" : `All ${agentSessionsFiltered.length} shown`)}
                          </div>
                        )}
                      </>)
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
                        <Icon name="ti-check" size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
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
            // One list, one compact card per challenge; a card opens the challenge sheet (ChallengesList.jsx).
            <ChallengesList
              invites={challenges.filter(c=>!acceptedIds.has(c.id))}
              onOpenInvite={setSelectedChallenge}
              onCount={setOpenRequestCount}
              onBattleCreated={loadBattles}
              onSeriesChanged={loadBattles}/>
          )}
          {tab==="discovery" && (higherEd
            ? (discoverView==="courses"
              // The courses feed (all rails), or its focused variants —
              // ?focus=guides / live, the Teaching guide and Live classes
              // discovery pages the hub's cards open. Same UI, one rail.
              ? <DiscoveryTab initialQuery={discoverQuery} focus={discoveryFocusFromUrl()}/>
              // The Pharm D programme page, mounted IN-TAB (inside the shell:
              // side nav, header, Now-Studying) on desktop/tablet — on mobile
              // it renders itself as the full-screen takeover. ?view=pharmd +
              // ?course=CODE mirror the hub > browse > folder chain so the
              // browser Back/Forward follow it.
              // The Contents/Materials feed — the community's shared
              // uploads (videos, audio, notes, PDFs), Udemy-style.
              : discoverView==="more"
              ? <DiscoverHub
                  programmeList
                  userId={userProfile?.id}
                  discipline={userProfile?.discipline}
                  onOpenDiscipline={openDiscipline}
                  onOpenMore={()=>navigate(`${APP_HOME}?tab=discovery&view=more`)}
                  onOpenContents={(q)=>navigate(`${APP_HOME}?tab=discovery&view=contents${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenRail={(rail,q)=>navigate(`${APP_HOME}?tab=discovery&view=courses&focus=${rail}${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenCourses={(q)=>navigate(`${APP_HOME}?tab=discovery&view=courses${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenCourse={(c)=>c?.slug&&navigate(`/course/${c.slug}`)}
                  onOpenRecord={openRecordTracked}
                  onOpenBattles={()=>goTab('battles')}
                  onOpenCommunity={(c)=>c?.id&&navigate(`/communities/${c.id}`)}
                  onOpenFolder={(f)=>navigate(`/library${f?.id?`?folder=${encodeURIComponent(f.id)}`:""}`)}
                  onOpenAgent={(a)=>a?.id&&navigate(`/agent/${a.id}`)}/>
              : discoverView==="discipline"
              ? <PharmDProgram
                  programme={programmeBySlug(programmeSlugFromUrl())}
                  comingSoon={programmeSlugFromUrl() !== 'pharmd'}
                  onClose={()=>navigate(`${APP_HOME}?tab=discovery&view=more`)}
                  onCourseRoute={()=>{}}/>
              : discoverView==="contents"
              ? <ContentsDiscoveryTab initialQuery={discoverQuery}/>
              : discoverView==="pharmd"
              ? <PharmDProgram
                  onClose={()=>navigate(`${APP_HOME}?tab=discovery`)}
                  courseRoute={pharmdCourseFromUrl()}
                  onCourseRoute={(c)=>navigate(`${APP_HOME}?tab=discovery&view=pharmd${c?`&course=${encodeURIComponent(c)}`:""}`)}
                  focus={pharmdFocus}
                  onFocusConsumed={()=>setPharmdFocus(null)}/>
              // A published programme from the admin catalogue — the generic
              // programme page (sections → published courses → materials).
              : discoverView==="programme" && programmeIdFromUrl()
              ? <ProgrammePage
                  programmeId={programmeIdFromUrl()}
                  onClose={()=>navigate(`${APP_HOME}?tab=discovery`)}
                  courseRoute={programmeCourseFromUrl()}
                  onCourseRoute={(c)=>navigate(`${APP_HOME}?tab=discovery&view=programme&programme=${encodeURIComponent(programmeIdFromUrl())}${c?`&pcourse=${encodeURIComponent(c)}`:""}`)}/>
              : <DiscoverHub
                  userId={userProfile?.id}
                  discipline={userProfile?.discipline}
                  onOpenDiscipline={openDiscipline}
                  onOpenMore={()=>navigate(`${APP_HOME}?tab=discovery&view=more`)}
                  onOpenProgramme={(p)=>p?.id&&navigate(`${APP_HOME}?tab=discovery&view=programme&programme=${encodeURIComponent(p.id)}`)}
                  onOpenContents={(q)=>navigate(`${APP_HOME}?tab=discovery&view=contents${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenRail={(rail,q)=>navigate(`${APP_HOME}?tab=discovery&view=courses&focus=${rail}${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenCourses={(q)=>navigate(`${APP_HOME}?tab=discovery&view=courses${q?`&q=${encodeURIComponent(q)}`:""}`)}
                  onOpenCourse={(c)=>c?.slug&&navigate(`/course/${c.slug}`)}
                  onOpenRecord={openRecordTracked}
                  onOpenBattles={()=>goTab('battles')}
                  onOpenCommunity={(c)=>c?.id&&navigate(`/communities/${c.id}`)}
                  onOpenFolder={(f)=>navigate(`/library${f?.id?`?folder=${encodeURIComponent(f.id)}`:""}`)}
                  onOpenAgent={(a)=>a?.id&&navigate(`/agent/${a.id}`)}
                  onOpenPharmdCourse={(code)=>navigate(`${APP_HOME}?tab=discovery&view=pharmd${code?`&course=${encodeURIComponent(code)}`:""}`)}/>
              )
            : <DiscoveryTab/>)}
          {tab==="rankings" && <RankingsTab/>}
          {tab==="battles"  && <BattlesTab battles={battles} invites={challenges} onViewChallenge={()=>goTab("challenges")} onBattleCreated={loadBattles}/>}
          {tab==="agent"    && <AgentChatTab onStartTeach={s=>{ setTeachSession(s); }} onTeachTopic={({ topic, subject })=>{ setConfigInitial({ topic, subject: subject ? subject.charAt(0).toUpperCase()+subject.slice(1) : 'Science' }); setConfigOpen(true); }} onStartExamPrep={()=>setExamPrepOpen(true)} onOpenConceptTracker={()=>setConceptTrackerOpen(true)} onOpenAdaptiveControls={()=>setAdaptiveControlsOpen(true)} agentNameProp={agentProfile.name} agentEmojiProp={agentProfile.emoji} onChatActive={setChatActive}
            agentOnline={agentOnline} agentAutonomyLoaded={agentAutonomyLoaded} agentAutonomySaving={agentAutonomySaving}
            onToggleAgentAutonomy={toggleAgentAutonomy}
            agentActivity={agentActivity}/>}
        </div>

        {/* Schedule alarm banner — the ringtone's visible half: what's
            ringing + Stop. Auto-stops after 25s if ignored. */}
        {alarmBanner && (
          <div className="ak-alarm-banner" style={{
            position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
            zIndex: 2600, maxWidth: 'min(420px, calc(100vw - 32px))', width: 'max-content',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--ak-surface)', border: `1.5px solid ${BRAND}66`,
            borderRadius: 16, padding: '10px 12px 10px 14px',
            boxShadow: '0 10px 34px rgba(0,0,0,.22)',
            fontFamily: "'Nunito',sans-serif",
            animation: 'sheet-up .3s ease',
          }}>
            <span style={{ fontSize: 20, display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }}>🔔</span>
            <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alarmBanner.title}</p>
            <button onClick={()=>{ stopAlarm(); setAlarmBanner(null); }}
              style={{ flexShrink: 0, height: 32, padding: '0 14px', borderRadius: 100, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff',
                fontSize: 11.5, fontWeight: 900, fontFamily: "'Nunito',sans-serif",
                boxShadow: `0 2px 10px ${BRAND}44` }}>
              {t('alarm.stop')}
            </button>
          </div>
        )}

        {/* Now studying — Spotify-style mini-bar (higher-ed, all tabs but chat) */}
        {showNowBar && (
          <NowStudyingBar
            item={now.item}
            onOpen={openNowItem}
            onAdd={()=>navigate('/library?add=1')}
            onDismiss={nowActs.dismiss}/>
        )}

        {/* BOTTOM NAV — mobile only; hidden by CSS above 768px where the
            AppShell sidebar takes over. */}
        <div className="ak-bottom-nav" style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:200,background:"var(--ak-surface)",backdropFilter:"blur(12px)",borderTop:"1px solid var(--ak-border)",padding:"8px 0 env(safe-area-inset-bottom,14px)",display:"flex",justifyContent:"space-around",minHeight:62 }}>
          {NAV_ITEMS.map(({key,label})=>{
            // "Learn" (key "sessions") stays active on the Challenges sub-tab too.
            const navActive = tab===key || (key==="sessions" && tab==="challenges");
            return (
              <div key={key} onClick={()=>goTab(key)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",color:navActive?BRAND:"var(--ak-text-muted)",minWidth:56,padding:"2px 0" }}>
                <div style={{ position:"relative" }}>
                  <NavIcon name={key} size={24} active={navActive}/>
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
          <div onClick={()=>setConfigOpen(true)} className="ak-fab" style={{ position:"fixed",bottom:showNowBar?150:78,right:18,zIndex:900,background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,borderRadius:16,padding:"9px 16px",display:"flex",alignItems:"center",gap:7,boxShadow:`0 4px 18px ${BRAND}50`,cursor:"pointer" }}>
            <MicIcon size={15} color="#fff"/>
            <span style={{ fontSize:12,fontWeight:800,color:"#fff" }}>{t('dash.start_session')}</span>
          </div>
        )}

        {/* ── Overlays ── */}

        {/* ConfigModal → opens before TeachAgentModal */}
        {configOpen && (
          <ConfigModal
            initial={configInitial}
            higherEd={higherEd}
            onStart={cfg => {
              setConfigOpen(false);
              setConfigInitial(null);
              // A direct session is a teaching workflow first (Grand Plan §13.1,
              // Scenario A): the modal opens at once and joins the workflow's id
              // to its start when it arrives. A failure never blocks the lesson.
              const workflowReady = apiPost('/api/teaching/workflows', { topic: cfg.topic, subject: cfg.subject || null })
                .then((r) => r?.workflowId || null).catch(() => null);
              // Inject the fetched student AI agent into the config
              setTeachSession({ ...cfg, workflowReady, agentName: agentProfile.name, agentEmoji: agentProfile.emoji });
            }}
            onCancel={() => { setConfigOpen(false); setConfigInitial(null); }}
          />
        )}

        {/* TeachAgentModal — now receives config OR session */}
        {teachSession && (
          <TeachAgentModal
            onMinimize={minimizeTeachSession}
            session={teachSession?.topic ? null : teachSession}
            config={teachSession?.topic ? teachSession : null}
            // A self-study attempt has to know which session it became, or the
            // teacher's progress view points at nothing. The live session id
            // is also remembered on the state itself — a minimize parks it in
            // the Now-Studying snapshot, and restoring reopens THIS session
            // instead of a fresh empty one.
            onSessionStarted={sid=>{
              if (sid) setTeachSession(prev => prev ? { ...prev, sessionId: sid } : prev);
            }}
            // The link needs the saved session row's id (adaptive_sessions.id),
            // not the live one — with the live id it was refused every time.
            onSessionSaved={sid=>{
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
          // Phase 8: a Review is the Decay Review workflow (check → recall → retest → re-teach); a parked
          // live decay session still reopens in its own modal.
          decaySession.resumeSessionId
            ? <DecaySessionModal onMinimize={minimizeDecaySession} alert={decaySession} agentProfile={agentProfile} onClose={() => { setDecaySession(null); loadAgentSessions(); }} />
            : <DecayReviewModal alert={decaySession} agentProfile={agentProfile} onMinimize={minimizeDecaySession} onClose={() => { setDecaySession(null); loadAgentSessions(); }} />
        )}

        {selectedChallenge && <ChallengeModal challenge={selectedChallenge} onAccept={handleAcceptChallenge} onDecline={handleDeclineChallenge} onClose={()=>setSelectedChallenge(null)}/>}
        {/* AssessmentRoom — proctored Sergeant assessment (TF.js + WS gateway) */}
        {assessSession && (
          <AssessmentRoom
            topic={assessSession.topic}
            subject={assessSession.subject}
            objectives={assessSession.objectives || []}
            workflowId={assessSession.workflowId || null}
            assessmentId={assessSession.assessmentId || null}
            onClose={() => setAssessSession(null)}
          />
        )}
        {examPrepOpen && <ExamPrepConfidenceModal
          onClose={()=>setExamPrepOpen(false)}
          onStartTeach={config=>{
            setExamPrepOpen(false);
            setTeachSession({ ...config, agentName:agentProfile.name, agentEmoji:agentProfile.emoji });
          }}
        />}
        {conceptTrackerOpen && <ConceptTrackerModal onClose={()=>setConceptTrackerOpen(false)} />}
        {adaptiveControlsOpen && <AdaptiveControlsModal onClose={()=>setAdaptiveControlsOpen(false)} />}

        {/* A record opened as a TEACHING session — the learner teaches
            their agent over the record's material (chat + content box,
            reader on demand). Close hands the earned progress back to the
            Now-Studying bar. */}
        {recordViewer && (
          <RecordTeachSession
            record={recordViewer}
            onClose={() => { setRecordViewer(null); loadShelfRecords(); loadAgentSessions(); }}
            onMinimize={() => { setRecordViewer(null); setToast(t('now.minimized_toast')); }}
            onOpened={(r) => { if (now.item?.id === r.id) nowActs.setProgress(r.id, Math.max(10, r.progress || 10)); }}
            onProgress={(r, pct) => { if (now.item?.id === r.id) nowActs.setProgress(r.id, pct); setRecordProgress(r.id, pct); }}
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
        {toast && <Toast msg={typeof toast==='string'?toast:toast.msg} color={typeof toast==='string'?RED:(toast.color||RED)} onDone={()=>setToast(null)}/>}
      </div>
      <ProfileDrawer open={drawer} onClose={()=>setDrawer(false)} profile={userProfile} higherEd={higherEd} coinBalance={coinBalance}/>
      </AppShell>
    </>
  );
}
