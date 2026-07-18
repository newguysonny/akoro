/**
 * CourseDetailsPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Play, Users, Clock, Star, Globe, Lock,
  CheckCircle2, Radio, ShoppingCart, CalendarPlus, MonitorPlay, BookOpen,
  Award, Swords, TrendingUp, Calendar, ArrowRight, Share2, Flag, Check, Plus, Video,
} from 'lucide-react';
import { API } from '../../services/api.js';
import { BRAND, GREEN, RED } from '../../constants.js';
import Toast from '../../components/common/Toast.jsx';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';

/* ── palette ──────────────────────────────────────────────── */
import { INK, MUTED, BORDER, LIGHT, BG, FONT, GlobalCss, card, Btn, Avatar, LiveBadge, StarRow, PLATFORMS, PlatformBadge, ActionChips, SectionTitle, DEFAULT_MODULES, DEFAULT_COURSE, VideoPlayer, Curriculum, RV_EMOJI, RV_BG, Reviews, AGENTS, BATTLES, BattleCard, BattlesSection, REVISIONS, RV_HOST_EMOJI, RV_HOST_BG, RevisionsSection, mapCourse, CourseOverview, EnrolledVideoView } from './parts.jsx';

export default function CourseDetailsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [courseType, setCourseType] = useState('live');
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [toast, setToast] = useState(null);

  const checkEnrolled = async (cid, seed = false) => {
    if (!cid) return seed;
    const prog = await fetch(`${API}/api/courses/${cid}/progress`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return seed || !!(prog && prog.success !== false && (prog.data || prog.overall_progress != null || prog.modules));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // Fetch the course by name (slug) or id, then probe enrollment with its real id.
      const res = await fetch(`${API}/api/courses/${slug}/full`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const mapped = mapCourse(res?.course || res);
      const enrolled = await checkEnrolled(mapped.course.id, mapped.enrolled);
      if (!alive) return;
      setData(mapped);
      setCourseType(mapped.type);
      setIsEnrolled(enrolled);
    })().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const view = data || mapCourse(null);

  // Enrol / purchase. Free → immediate enrolment; paid → Paystack checkout.
  const enroll = async () => {
    const cid = view.course.id;
    if (!cid || enrolling) return;
    setEnrolling(true);
    try {
      const r = await fetch(`${API}/api/payments/initiate`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: cid }),
      });
      if (r.status === 401) { localStorage.setItem('akoro_redirect', `/course/${slug}`); navigate('/signin'); return; }
      const d = await r.json().catch(() => ({}));
      const body = d.data || d;
      if (!r.ok) { setToast({ msg: d.message || body.message || 'Could not enrol', color: RED }); return; }
      if (body.free) { setIsEnrolled(true); setToast({ msg: 'Enrolled! 🎉', color: GREEN }); }
      else if (body.checkout_url) { window.location.href = body.checkout_url; }
      else { setToast({ msg: 'Enrolment started', color: GREEN }); }
    } catch { setToast({ msg: 'Network error — please retry', color: RED }); }
    finally { setEnrolling(false); }
  };

  // Real battles + open lobbies for this course → the Battles tab.
  useEffect(() => {
    const cid = view.course.id;
    if (!cid) return;
    let alive = true;
    const j = (p) => fetch(`${API}${p}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([j(`/api/battle/courses/${cid}/battles`), j(`/api/battle/courses/${cid}/battles/open`)]).then(([bd, od]) => {
      if (!alive) return;
      const cards = (bd?.battles || []).map((b) => {
        const st = b.status === 'live' ? 'live' : b.status === 'completed' ? 'completed'
          : (b.status === 'lobby' || b.status === 'scheduled') ? 'upcoming' : null;
        if (!st) return null;
        return {
          id: b.id, status: st, topic: b.topic || b.title,
          viewers: b.peak_viewers || b.total_participants || 0,
          a: { name: b.user_agents?.agent_name || 'Host agent', emoji: b.user_agents?.agent_emoji || '🤖', bg: '#EDE8F8', color: BRAND },
          b: { name: `${b.total_participants || 1} agents`, emoji: '⚔️', bg: '#FEF0E6', color: '#E8884A' },
          sa: 0, sb: 0,
        };
      }).filter(Boolean);
      const lobbies = (od?.open_battles || []).map((b) => ({
        id: b.id, topic: b.topic || b.title, difficulty: b.difficulty,
        spotsLeft: b.spots_left, participants: b.current_participants, alreadyJoined: b.already_joined,
      }));
      setData((prev) => (prev ? { ...prev, course: { ...prev.course, battles: cards, openLobbies: lobbies } } : prev));
    });
    return () => { alive = false; };
  }, [view.course.id]);

  // Return from Paystack (?payment=success) — the webhook creates the
  // enrolment; re-check access and clean the URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.get('payment') || !view.course.id) return;
    if (p.get('payment') === 'success') {
      checkEnrolled(view.course.id).then((ok) => {
        setIsEnrolled(ok);
        setToast({ msg: ok ? 'Payment confirmed — you’re enrolled! 🎉' : 'Payment received — enrolment finalising…', color: GREEN });
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [view.course.id]);

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: FONT, color: INK }}>
      <GlobalCss />
      {/* Nav */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${BORDER}`, position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 18px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 700, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}><ChevronLeft size={16} />Back</button>
          <div style={{ height: 20, width: 1, background: BORDER }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <AkoroLogo size={28} radius={8} />
            <span className="fs" style={{ fontSize: 17, fontWeight: 800, color: INK }}>Akoro</span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, padding: '4px 11px', borderRadius: 100, background: courseType === 'video' ? `${BRAND}14` : '#FEE2E2', color: courseType === 'video' ? BRAND : '#DC2626' }}>
            {courseType === 'video' ? '🎬 Video course' : '🔴 Live class'}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 18px 80px' }}>
        {loading ? (
          <div style={{ height: 200, borderRadius: 22, background: '#EDE8E1', animation: 'cp-pulse 1.5s ease infinite' }} />
        ) : isEnrolled && courseType === 'video' ? (
          <EnrolledVideoView course={view.course} modules={view.modules} />
        ) : (
          <CourseOverview
            type={courseType} isEnrolled={isEnrolled} course={view.course} modules={view.modules}
            onPlay={() => {}} onEnrol={enroll} enrolling={enrolling}
            onJoinLive={() => navigate('/app')} />
        )}
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}

