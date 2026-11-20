/**
 * Course details — guest overview and enrolled video views.
 */
import { useState } from 'react';
import {
  Video, Users, Clock, Globe, ShoppingCart, Radio, Play, Check, Plus,
  CheckCircle2, Brain, Award, CalendarPlus, MonitorPlay, PartyPopper,
} from 'lucide-react';
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { API } from '../../../services/api.js';
import { Btn, Avatar, LiveBadge, StarRow, PlatformBadge, ActionChips } from './parts-ui.jsx';
import { VideoPlayer, Curriculum } from './parts-lessons.jsx';
import { Reviews } from './parts-reviews.jsx';
import { BattlesSection } from './parts-battles.jsx';
import { RevisionsSection } from './parts-revisions.jsx';
import { card, INK, MUTED, MUTED2, BORDER, LIGHT, BG, RED, FONT, initialsOf } from './parts-rules.js';

/* ── guest / overview view ────────────────────────────────── */
function CourseOverview({ type, isEnrolled, course, modules, onPlay, onEnrol, enrolling, onJoinLive, onAddToCart, addingCart, inCart, onAgentSession, onLessonMore }) {
  const isVideo = type === 'video';
  const isFree = course.priceLabel === 'Free';
  const tabs = isVideo ? ['about', 'curriculum', 'teachers', 'reviews'] : ['about', 'schedule', 'curriculum', 'teachers', 'reviews'];
  const [tab, setTab] = useState('about');
  const done = modules.reduce((a, m) => a + m.lessons.filter((l) => l.done).length, 0);
  const total = modules.reduce((a, m) => a + m.lessons.length, 0);
  const teachers = course.teachers
    ? course.teachers.map((t) => ({ initials: initialsOf(t.name), bg: '#C8E8D4', name: t.name, title: t.title || 'Instructor', bio: `Instructor for ${course.title}.` }))
    : [{ initials: initialsOf(course.instructor), bg: '#C8E8D4', name: course.instructor, title: 'Lead Instructor', bio: `Instructor for ${course.title}.` }];
  const schedule = course.schedule || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Hero */}
      <div style={{ position: 'relative', borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(135deg,#231a4d,#0d2137)' }}>
        <div style={{ position: 'relative', zIndex: 1, padding: 24, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 64, color: 'rgba(255,255,255,.9)' }}>{course.emoji?.startsWith('ti-') ? <Icon name={course.emoji} size={64}/> : (course.emoji || <Icon name="ti-book" size={64}/>)}</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {isVideo ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 900, padding: '2px 9px', borderRadius: 100, background: BRAND, color: '#fff' }}><Video size={10}/> VIDEO COURSE</span> : <LiveBadge />}
              {!isVideo && course.platform && <PlatformBadge platform={course.platform} />}
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', background: 'rgba(255,255,255,.1)', padding: '3px 10px', borderRadius: 100 }}>{course.subject}</span>
            </div>
            <h1 style={{ fontFamily: FONT, color: '#fff', fontSize: 24, fontWeight: 900, lineHeight: 1.2, margin: '0 0 6px' }}>{course.title}</h1>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              <StarRow rating={course.rating} count={course.ratingCount} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Users size={13} />{course.students} enrolled</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={13} />{course.hours} hours</span>
              {isVideo && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Globe size={13} />English</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>By <span style={{ color: '#C4B5FD' }}>{course.instructor}</span></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 180 }}>
            {!isEnrolled && (isVideo
              ? <Btn variant="primary" size="lg" onClick={onEnrol} style={{ background: '#fff', color: BRAND, border: '1.5px solid #fff', opacity: enrolling ? .6 : 1 }}><ShoppingCart size={15} />{enrolling ? 'Enrolling…' : isFree ? 'Enrol · Free' : `Buy · ${course.priceLabel}`}</Btn>
              : <Btn variant="red" size="lg" onClick={onEnrol} style={{ opacity: enrolling ? .6 : 1 }}><Radio size={15} />{enrolling ? 'Enrolling…' : 'Enrol · Join live'}</Btn>)}
            {!isEnrolled && onAddToCart && (
              <Btn variant="ghost" size="lg" onClick={onAddToCart} style={{ background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.55)', opacity: addingCart ? .6 : 1 }}>
                {inCart ? <><Check size={15} /> In cart — view</> : <><Plus size={15} /> {addingCart ? 'Adding…' : 'Add to cart'}</>}
              </Btn>
            )}
            {isEnrolled && isVideo && <Btn variant="primary" size="lg" onClick={onPlay} style={{ background: '#fff', color: BRAND, border: '1.5px solid #fff' }}><Play size={15} />Continue watching</Btn>}
            {isEnrolled && !isVideo && <Btn variant="red" size="lg" onClick={onJoinLive}><Radio size={15} />Join live now</Btn>}
          </div>
        </div>
        {isEnrolled && (
          <div style={{ position: 'relative', zIndex: 1, padding: '0 24px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}><span>Your progress</span><span>{done}/{total} lessons</span></div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.15)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${total ? (done / total) * 100 : 0}%`, background: BRAND, borderRadius: 4 }} /></div>
          </div>
        )}
      </div>

      {/* Action chips */}
      <ActionChips course={course} onAgentSession={() => {
        // Open on the first lesson that really exists — the viewer is honest
        // when the stream is not accessible to this learner yet.
        const firstLesson = (modules || []).flatMap((m) => m.lessons || []).find((l) => l?.id) || null;
        onAgentSession?.(firstLesson);
      }} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 14, width: 'fit-content', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800, textTransform: 'capitalize', background: tab === t ? INK : 'transparent', color: tab === t ? '#fff' : MUTED }}>{t}</button>
        ))}
      </div>

      {/* About */}
      {tab === 'about' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          <div style={{ gridColumn: 'span 1', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...card, padding: 22 }}>
              <h3 style={{ fontSize: 14, fontWeight: 900, color: INK, margin: '0 0 10px' }}>About this {isVideo ? 'course' : 'class'}</h3>
              <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7, margin: 0 }}>{course.description || 'A complete course covering the full syllabus with lessons, quizzes and an AI agent companion.'}</p>
            </div>
            <div style={{ ...card, padding: 22 }}>
              <h3 style={{ fontSize: 14, fontWeight: 900, color: INK, margin: '0 0 10px' }}>Requirements</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Basic prior knowledge of the subject', 'An Akoro account (free or Pro)', 'A device with internet access'].map((r) => (
                  <div key={r} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: MUTED }}><CheckCircle2 size={15} color={BRAND} style={{ flexShrink: 0, marginTop: 2 }} />{r}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!isEnrolled && (
              <div style={{ ...card, padding: 20 }}>
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: INK }}>{course.priceLabel}</div>
                </div>
                {isVideo
                  ? <Btn variant="primary" onClick={onEnrol} style={{ width: '100%', opacity: enrolling ? .6 : 1 }}><ShoppingCart size={14} />{enrolling ? 'Enrolling…' : 'Enrol now'}</Btn>
                  : <Btn variant="red" onClick={onEnrol} style={{ width: '100%', opacity: enrolling ? .6 : 1 }}><Radio size={14} />{enrolling ? 'Enrolling…' : 'Enrol · Join class'}</Btn>}
                <div style={{ textAlign: 'center', fontSize: 11, color: MUTED2, margin: '10px 0 14px' }}>30-day money-back guarantee</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5, color: MUTED }}>
                  {[[<Play size={13} />, isVideo ? `${course.hours}h on-demand video` : 'Live sessions'], [<Brain size={13} />, 'AI agent included'], [<Award size={13} />, 'Certificate of completion']].map(([ic, tx], i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: BRAND }}>{ic}</span>{tx}</div>)}
                </div>
              </div>
            )}
            <div style={{ ...card, padding: 20 }}>
              {[[`${course.students}`, 'Students enrolled'], [`${course.rating || '—'}`, 'Average rating'], [`${total}`, 'Lessons']].map(([v, l]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13.5 }}><span style={{ color: MUTED }}>{l}</span><span style={{ fontWeight: 800, color: INK }}>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule (live) */}
      {tab === 'schedule' && !isVideo && (
        <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(schedule.length ? schedule : [{ topic: 'Schedule to be announced', date: 'TBA', time: '', status: 'upcoming' }]).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderRadius: 14, border: `1px solid ${s.status === 'live' ? '#FECACA' : BORDER}`, background: s.status === 'live' ? '#FFF5F5' : s.status === 'recorded' ? LIGHT : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.status === 'live' ? RED : s.status === 'upcoming' ? BRAND : '#C9C5BE', animation: s.status === 'live' ? 'cp-pulse 1.3s ease infinite' : 'none' }} />
                <div><div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{s.topic}</div><div style={{ fontSize: 12, color: MUTED2 }}>{s.date}{s.time ? ` · ${s.time}` : ''}</div></div>
              </div>
              {s.status === 'live' && <Btn variant="red" size="sm" onClick={onJoinLive}><Radio size={11} />Join</Btn>}
              {s.status === 'upcoming' && <Btn variant="outline" size="sm"><CalendarPlus size={11} />RSVP</Btn>}
              {s.status === 'recorded' && <Btn variant="ghost" size="sm"><MonitorPlay size={11} />Replay</Btn>}
            </div>
          ))}
        </div>
      )}

      {/* Curriculum */}
      {tab === 'curriculum' && <Curriculum modules={modules} isEnrolled={isEnrolled} hours={course.hours} onPick={isEnrolled ? onPlay : null} onLessonMore={isEnrolled ? onLessonMore : null} />}

      {/* Teachers */}
      {tab === 'teachers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          {teachers.map((t, i) => (
            <div key={i} style={{ ...card, padding: 22 }}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                <Avatar initials={t.initials} bg={t.bg} size={52} />
                <div><div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{t.name}</div><div style={{ fontSize: 12, fontWeight: 800, color: BRAND }}>{t.title}</div></div>
              </div>
              <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>{t.bio}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reviews */}
      {tab === 'reviews' && <Reviews reviews={course.reviews} courseId={course.id} canReview={isEnrolled} />}

      {/* Always-on community sections */}
      <BattlesSection battles={course.battles} leaderboard={course.leaderboard} lobbies={course.openLobbies} />
      <RevisionsSection revisions={course.revisions} onJoinLive={onJoinLive} />
    </div>
  );
}

/* ── enrolled video player view ───────────────────────────── */
function EnrolledVideoView({ course, modules, onAgentSession, onLessonMore }) {
  const first = (() => {
    for (const m of modules) { const l = (m.lessons || []).find((x) => x.type === 'video'); if (l) return { ...l, module: m.title }; }
    return { title: 'Lesson', type: 'video', module: modules[0]?.title };
  })();
  const [lesson, setLesson] = useState(first);
  const [tab, setTab] = useState('content');
  const done = modules.reduce((a, m) => a + m.lessons.filter((l) => l.done).length, 0);
  const total = modules.reduce((a, m) => a + m.lessons.length, 0);
  const complete = total > 0 && done === total;

  const [certBusy, setCertBusy] = useState(false);
  const [certErr, setCertErr] = useState('');
  const getCertificate = async () => {
    if (!course.id || certBusy) return;
    setCertBusy(true); setCertErr('');
    try {
      const r = await fetch(`${API}/api/courses/${course.id}/certificate`, { method: 'POST', credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Certificate not available yet');
      const url = (d.data || d).certificate_url;
      if (url) window.open(url, '_blank'); else setCertErr('Certificate is generating — try again shortly');
    } catch (e) { setCertErr(e.message); }
    finally { setCertBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {complete && (
        <div style={{ ...card, padding: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'linear-gradient(135deg,#F0FFF6,#EAF6FF)', border: '1px solid #CDEBD8' }}>
          <PartyPopper size={34} color="#F59E0B" style={{ flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>Course complete!</div>
            <div style={{ fontSize: 12.5, color: MUTED }}>You’ve finished every lesson. Download your certificate.</div>
            {certErr && <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginTop: 4 }}>{certErr}</div>}
          </div>
          <Btn variant="primary" onClick={getCertificate} style={{ opacity: certBusy ? .6 : 1 }}><Award size={15} />{certBusy ? 'Preparing…' : 'Get certificate'}</Btn>
        </div>
      )}
      <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        <VideoPlayer lesson={lesson} courseEmoji={course.emoji} />
        <div style={{ background: '#0d1220', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div><div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>{lesson?.module}</div><div style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{lesson?.title}</div></div>
          <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{done}/{total} · {total ? Math.round((done / total) * 100) : 0}%</span>
        </div>
      </div>

      {/* Action chips */}
      <ActionChips course={course} onAgentSession={() => onAgentSession?.(lesson)} />

      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 14, width: 'fit-content', flexWrap: 'wrap' }}>
        {[['content', 'Course content'], ['about', 'About'], ['reviews', 'Reviews'], ['battles', 'Battles'], ['revisions', 'Live revisions']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800, background: tab === id ? INK : 'transparent', color: tab === id ? '#fff' : MUTED }}>{label}</button>
        ))}
      </div>

      {tab === 'content' && <Curriculum modules={modules} isEnrolled hours={course.hours} onPick={setLesson} currentTitle={lesson?.title} onLessonMore={onLessonMore} />}
      {tab === 'about' && <div style={{ ...card, padding: 22 }}><p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7, margin: 0 }}>{course.description || 'A complete course covering the full syllabus with lessons and quizzes.'}</p></div>}
      {tab === 'reviews' && <Reviews reviews={course.reviews} courseId={course.id} canReview />}
      {tab === 'battles' && <BattlesSection battles={course.battles} leaderboard={course.leaderboard} lobbies={course.openLobbies} />}
      {tab === 'revisions' && <RevisionsSection revisions={course.revisions} />}
    </div>
  );
}

export { CourseOverview, EnrolledVideoView };
