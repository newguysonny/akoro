/**
 * CourseDetailsPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Play, Users, Clock, Star, Globe, Lock,
  CheckCircle2, Radio, ShoppingCart, CalendarPlus, MonitorPlay, BookOpen,
  Brain, Award, Swords, TrendingUp, Calendar, ArrowRight, Share2, Flag, Check, Plus, Video,
} from 'lucide-react';
import { API } from '../../services/api.js';
import { BRAND } from '../../constants.js';

/* ── palette ──────────────────────────────────────────────── */
import { INK, LIGHT, FONT, GlobalCss, card, Btn, Avatar, LiveBadge, StarRow, PLATFORMS, PlatformBadge, ActionChips, SectionTitle, DEFAULT_MODULES, DEFAULT_COURSE, VideoPlayer, Curriculum, RV_EMOJI, RV_BG, Reviews, AGENTS, BATTLES, BattleCard, BattlesSection, REVISIONS, RV_HOST_EMOJI, RV_HOST_BG, RevisionsSection, mapCourse, CourseOverview, EnrolledVideoView } from './parts.jsx';

export default function CourseDetailsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [courseType, setCourseType] = useState('live');
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // Fetch the course by name (slug) or id, then probe enrollment with its real id.
      const res = await fetch(`${API}/api/courses/${slug}/full`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const mapped = mapCourse(res?.course || res);
      let enrolled = mapped.enrolled;
      const cid = mapped.course.id;
      if (cid) {
        const prog = await fetch(`${API}/api/courses/${cid}/progress`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        enrolled = enrolled || !!(prog && prog.success !== false && (prog.data || prog.overall_progress != null || prog.modules));
      }
      if (!alive) return;
      setData(mapped);
      setCourseType(mapped.type);
      setIsEnrolled(enrolled);
    })().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const view = data || mapCourse(null);

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: FONT, color: INK }}>
      <GlobalCss />
      {/* Nav */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${BORDER}`, position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 18px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 700, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}><ChevronLeft size={16} />Back</button>
          <div style={{ height: 20, width: 1, background: BORDER }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Brain size={15} color="#fff" strokeWidth={2.5} /></div>
            <span style={{ fontWeight: 900, fontSize: 16, color: INK }}>Akoro</span>
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
          <CourseOverview type={courseType} isEnrolled={isEnrolled} course={view.course} modules={view.modules} onPlay={() => {}} />
        )}
      </div>
    </div>
  );
}

