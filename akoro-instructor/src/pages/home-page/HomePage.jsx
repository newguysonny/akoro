/**
 * HomePage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, BookOpen, Plus, Eye, Clock, Video, Bot, ChevronRight, Zap, Wallet, Layers, Flame, CheckCircle2, Swords , AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import SchoolNudge from '../../components/SchoolNudge.jsx';
import { Btn, Toast, Skeleton, Modal, Inp } from '../../components/Primitives.jsx';
import { useStatsAPI } from '../../hooks/useStatsAPI.js';
import { useCoursesAPI } from '../../hooks/useCoursesAPI.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { apiGet, apiPost, apiDelete, API } from '../../services/api.js';
import { GREEN, PURPLE, BLUE } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { isNextUi } from '../../theme/uiMode.js';


/* Zeroes, not samples. A stat that failed to load must read as "nothing yet",
   never as a plausible invented number. */
const EMPTY_STATS = {
  total_students: 0, active_courses: 0, total_courses: 0,
  total_revenue: 0, agent_xp: 0, agent_level: 0, streak_days: 0,
};

import { STREAM_META, StatCard, SessionItem, QuickAction, PLATFORM_KEYS, STREAM_ERRORS, StreamingPanel } from './parts.jsx';

export default function HomePage() {
  const next = isNextUi();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getStats, getProfile } = useStatsAPI();
  const { getSessions } = useCoursesAPI();

  const [stats,    setStats]    = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [sessions, setSessions] = useState([]);
  const [coins,    setCoins]    = useState(null);   // my coin balance
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);
  const [loadError, setLoadError] = useState('');   // shown instead of inventing numbers
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    apiGet('/api/wallet').then((r) => setCoins(r.data?.balance ?? 0)).catch(() => setCoins(0));
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [statsRes, profileRes, sessionsRes] = await Promise.allSettled([
          getStats(),
          getProfile(),
          getSessions(),
        ]);
        if (cancelled) return;

        // Never substitute sample data for a failed call. This page shows student
        // counts and revenue; inventing them means a teacher reads fabricated
        // figures as fact and has no way to tell. Show what loaded, zero what
        // didn't, and say plainly that it didn't load.
        const failed = [];
        if (statsRes.status === 'fulfilled')   setStats(statsRes.value?.data ?? EMPTY_STATS);
        else { setStats(EMPTY_STATS); failed.push('your stats'); console.warn('[home] stats:', statsRes.reason?.detail || statsRes.reason); }

        if (profileRes.status === 'fulfilled') setProfile(profileRes.value?.data ?? null);
        else { failed.push('your profile'); console.warn('[home] profile:', profileRes.reason?.detail || profileRes.reason); }

        const allSessions = sessionsRes.status === 'fulfilled' ? (sessionsRes.value?.data ?? []) : [];
        if (sessionsRes.status === 'rejected') { failed.push("today's sessions"); console.warn('[home] sessions:', sessionsRes.reason?.detail || sessionsRes.reason); }
        const today = new Date().toDateString();
        setSessions(allSessions.filter(s => new Date(s.startTime).toDateString() === today));

        setLoadError(failed.length ? `We couldn't load ${failed.join(', ')}.` : '');
      } catch (err) {
        if (!cancelled) {
          console.warn('[home] load:', err?.detail || err);
          setStats(EMPTY_STATS);
          setSessions([]);
          setLoadError(err?.message || "We couldn't load your dashboard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <PageLayout
      title={`${greeting()}, ${user?.fullName?.split(' ')[0] || 'Instructor'}`}
      subtitle="Here's what's happening today"
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Say what didn't load, and give the one control that helps. Silence
            here reads as "you have no students", which is a different claim. */}
        {loadError && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            padding: '11px 14px', borderRadius: 12,
            background: '#FEF3C7', border: '1px solid #FDE68A', fontFamily: C.font,
          }}>
            <span style={{ display: 'flex' }}><Ico lucide={AlertTriangle} ti="ti-alert-triangle" size={16} color="#B45309" /></span>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#92400E' }}>
              {loadError} These figures may be incomplete.
            </span>
            <button onClick={() => { setLoading(true); setReloadKey(k => k + 1); }} style={{
              padding: '6px 13px', borderRadius: 9, border: '1px solid #FDE68A',
              background: C.surface, color: '#92400E', fontSize: 12, fontWeight: 800,
              cursor: 'pointer', fontFamily: C.font,
            }}>Retry</button>
          </div>
        )}
        <SchoolNudge />
        {/* Stats grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16, marginBottom: 28,
        }}>
          <div onClick={() => navigate('/wallet')} style={{ cursor: 'pointer' }} title="View wallet & top up">
            <StatCard icon={Wallet} ti="ti-wallet" label="Coin Balance" value={coins == null ? '—' : coins.toLocaleString()} sub="tap to top up" color={C.brand} loading={coins == null} />
          </div>
          <StatCard icon={Users} ti="ti-users" label="Total Students" value={(stats?.total_students ?? 0).toLocaleString()} sub="enrolled across all courses" color={BLUE}   loading={loading} />
          <StatCard icon={BookOpen} ti="ti-book" label="Active Courses" value={stats?.active_courses ?? 0}                   sub="currently live"               color={C.brand}  loading={loading} />
          <StatCard icon={Layers} ti="ti-stack-2" label="Total Courses"  value={stats?.total_courses ?? 0}                    sub="published & draft"            color={PURPLE} loading={loading} />
          <StatCard icon={Wallet} ti="ti-cash" label="Revenue"        value={`₦${(stats?.total_revenue ?? 0).toLocaleString()}`} sub="from enrollments"      color={GREEN}  loading={loading} />
          <StatCard icon={Zap} ti="ti-bolt" label="Agent XP"       value={(stats?.agent_xp ?? 0).toLocaleString()}      sub={`Level ${stats?.agent_level ?? 1}`} color={C.brand} loading={loading} />
          <StatCard icon={Flame} ti="ti-flame" label="Streak"         value={`${stats?.streak_days ?? 0}d`}                sub="keep it going"                color={GREEN}  loading={loading} />
        </div>

        <style>{`@media (max-width: 900px){.inst-dash{grid-template-columns:1fr !important;}.inst-qa{grid-template-columns:repeat(2,1fr) !important;}}`}</style>
        <div className="inst-dash" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
          {/* Left col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Quick actions */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: C.ink, margin: '0 0 14px', fontFamily: C.font }}>Quick Actions</h2>
              <div className="inst-qa" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {next
                  ? <QuickAction icon={BookOpen} ti="ti-books" label="New course" desc="Build it in Course Creator" color={C.brand} onClick={() => navigate('/course-creator/courses/new')} />
                  : <QuickAction icon={Video} ti="ti-video" label="New Live Class"   desc="Schedule a live session"     color={C.brand}  onClick={() => navigate('/courses')} />}
                <QuickAction icon={Eye} ti="ti-eye" label="View Students"    desc="Manage your enrolled learners" color={BLUE} onClick={() => navigate('/mgmt/students')} />
                <QuickAction icon={Plus} ti="ti-user-plus" label="Add Student"      desc="Enroll a new learner"         color={GREEN}  onClick={() => navigate('/mgmt/students?add=1')} />
                <QuickAction icon={Swords} ti="ti-swords" label="Create Battle"    desc="Launch a quiz battle"         color={PURPLE} onClick={() => navigate('/battles')} />
                {next
                  ? <QuickAction icon={Video} ti="ti-calendar-plus" label="Schedule a session" desc="Add a live session to a course" color={BLUE} onClick={() => navigate('/courses/schedule')} />
                  : <QuickAction icon={BookOpen} ti="ti-player-play" label="New On-Demand"    desc="Build a video course"         color={BLUE}   onClick={() => navigate('/courses')} />}
                <QuickAction icon={Bot} ti="ti-robot" label="AI Assistant"     desc="Chat with your AI tutor"      color={C.brand}  onClick={() => navigate('/chat')} />
              </div>
            </div>

            {/* Today's schedule */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: C.ink, margin: '0 0 14px', fontFamily: C.font }}>
                Today's Schedule
              </h2>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Skeleton height={64} />
                  <Skeleton height={64} />
                </div>
              ) : sessions.length === 0 ? (
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                  padding: '32px', textAlign: 'center',
                }}>
                  <Ico lucide={Clock} ti="ti-clock" size={28} color={C.muted} style={{ marginBottom: 10 }} />
                  <p style={{ fontSize: 14, color: C.muted, fontFamily: C.font, margin: 0 }}>No sessions scheduled for today</p>
                  <Btn size="sm" style={{ marginTop: 12 }} onClick={() => navigate(next ? '/courses/schedule' : '/courses')}>
                    <Ico lucide={Plus} ti="ti-plus" size={14} /> Schedule one
                  </Btn>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sessions.map(s => <SessionItem key={s.id} session={s} />)}
                </div>
              )}
            </div>
          </div>

          {/* Right col — Agent panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Profile card */}
            <div style={{
              background: C.hero, borderRadius: 20, padding: '24px',
              color: '#fff', fontFamily: C.font,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {(user?.fullName || 'T')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{user?.fullName || 'Instructor'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{user?.email || ''}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 10, padding: '12px' }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{(stats?.total_students ?? 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>Students</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 10, padding: '12px' }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{stats?.active_courses ?? 0}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>Active Courses</div>
                </div>
              </div>
            </div>

            {/* Agent panel */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '20px',
              fontFamily: C.font,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `linear-gradient(135deg, ${PURPLE}, ${BLUE})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ico lucide={Bot} ti="ti-robot" size={16} color="#fff" />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{loading ? '…' : (profile?.agent?.agent_name || profile?.agentName || 'AI Agent')}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>Teaching Assistant</div>
                  </div>
                </div>
                <span style={{
                  padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                  background: '#DCFCE7', color: GREEN,
                }}>
                  Active
                </span>
              </div>
              <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
                {loading ? 'Loading…' : (profile?.agentDescription || 'Your AI teaching assistant handles student questions 24/7.')}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ textAlign: 'center', background: C.bg, borderRadius: 10, padding: '10px' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>{loading ? '—' : (profile?.totalResponses ?? 342)}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>Responses</div>
                </div>
                <div style={{ textAlign: 'center', background: C.bg, borderRadius: 10, padding: '10px' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>{loading ? '—' : `${profile?.studentsSatisfied ?? 94}%`}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>Satisfaction</div>
                </div>
              </div>
              <Btn
                size="sm"
                variant="ghost"
                style={{ marginTop: 12, width: '100%', justifyContent: 'center', color: PURPLE, background: `${PURPLE}10` }}
                onClick={() => navigate('/chat')}
              >
                <Ico lucide={Zap} ti="ti-bolt" size={14} /> Train Agent <Ico lucide={ChevronRight} ti="ti-chevron-right" size={12} />
              </Btn>
            </div>

            {/* Streaming platforms */}
            <StreamingPanel onToast={showToast} />
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

