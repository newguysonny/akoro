/**
 * ProgrammePage.jsx
 * ─────────────────────────────────────────────────────────────
 * The generic published-programme experience the Discover hub's
 * programme cards open — the admin console's Program Courses tree
 * as learners see it, on REAL data via /api/programmes/catalogue
 * (services/programmesApi.js). Published-only at every level: the
 * API never returns draft programmes, courses or materials.
 *
 * Two views, like PharmDProgram:
 *   browse — programme hero (cover image or gradient fallback,
 *            name, description, duration, published-course count)
 *            and the section rows with their course cards (cover
 *            image or the admin's colour gradient).
 *   folder — one course: banner, instructor line, then "Course
 *            content" with the published materials. A material
 *            with a resource URL opens in a new tab.
 *
 * Empty states (the golden-path audit's three questions):
 *   · no sections at all → "No sections or courses yet — programme
 *     content is coming soon."
 *   · a section with no published course → "Courses for this
 *     section are coming soon."
 *   · a course with no published material → "Published learning
 *     materials for this course will appear here."
 *
 * Mounted in-tab by LearnerDashboard (?view=programme&programme=ID,
 * plus ?pcourse=ID for the open course) so the browser Back/Forward
 * walk hub > browse > folder like the Pharm.D chain does.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import Spinner from '../common/Spinner.jsx';
import { fetchProgramme, fetchProgrammeCourse } from '../../services/programmesApi.js';
import { FONT } from '../tabs/dhubTypes.js';

/* The admin console's six course-card gradients — same vocabulary. */
export const COURSE_G = [
  'linear-gradient(145deg,#ff6b52,#8a2c20)', 'linear-gradient(145deg,#6c3cff,#2d1b6e)',
  'linear-gradient(145deg,#14b8a0,#0b6b60)', 'linear-gradient(145deg,#4a8af0,#2652b5)',
  'linear-gradient(145deg,#ee4a73,#a11d45)', 'linear-gradient(145deg,#f0894a,#c0501a)',
];
const PROGRAMME_G = 'linear-gradient(140deg,#4C8DF0,#2E62D9)';

const TYPE_ICON = {
  pdf: 'ti-file-text', video: 'ti-video', audio: 'ti-headphones',
  note: 'ti-notes', link: 'ti-link', slides: 'ti-presentation',
};
const TYPE_LABEL = { pdf: 'PDF', video: 'Video', audio: 'Audio', note: 'Note', link: 'Link', slides: 'Slides' };

const Back = ({ label, onClick }) => (
  <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '12px 16px 0',
    padding: '7px 12px', borderRadius: 99, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)',
    color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
    <Icon name="ti-arrow-left" size={14} />{label}
  </button>
);

const EmptyNote = ({ children }) => (
  <div style={{ margin: '10px 16px 0', padding: '22px 18px', borderRadius: 14, border: '1px dashed var(--ak-border2)',
    background: 'var(--ak-surface)', textAlign: 'center' }}>
    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sec, #6B7280)' }}>{children}</p>
  </div>
);

/* One course card in a section row. */
function CourseCard({ c, onOpen }) {
  return (
    <div onClick={() => onOpen(c)} role="button" aria-label={c.title || c.code}
      style={{ cursor: 'pointer', borderRadius: 16, overflow: 'hidden', background: 'var(--ak-surface)',
        border: '1px solid var(--ak-border3)' }}>
      <div style={{ height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 900, fontSize: 15, letterSpacing: .4,
        ...(c.cover_url
          ? { backgroundImage: `url(${c.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: COURSE_G[c.color || 0] }) }}>
        {c.cover_url ? '' : (c.code || '').slice(0, 10)}
      </div>
      <div style={{ padding: '9px 11px 11px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.25 }}>{c.title || c.code}</p>
        <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)' }}>
          by {c.instructor || 'Akoro'} · {c.materials_count} {c.materials_count === 1 ? 'resource' : 'resources'}
        </p>
      </div>
    </div>
  );
}

/* ── The course folder view ───────────────────────────────────── */
function CourseFolder({ courseId, onBack }) {
  const [course, setCourse] = useState(undefined); // undefined = loading, null = missing
  useEffect(() => {
    let on = true;
    setCourse(undefined);
    fetchProgrammeCourse(courseId).then((c) => { if (on) setCourse(c); }).catch(() => { if (on) setCourse(null); });
    return () => { on = false; };
  }, [courseId]);

  if (course === undefined) return <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;
  if (!course) return (
    <>
      <Back label="Programme" onClick={onBack} />
      <EmptyNote>This course is not available right now.</EmptyNote>
    </>
  );

  const materials = course.materials ?? [];
  return (
    <div style={{ fontFamily: FONT, paddingBottom: 90 }}>
      <Back label={course.programme?.name || 'Programme'} onClick={onBack} />
      <div style={{ margin: '12px 16px 0', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--ak-border3)' }}>
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: .5,
          ...(course.cover_url
            ? { backgroundImage: `url(${course.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: COURSE_G[course.color || 0] }) }}>
          {course.cover_url ? '' : course.code}
        </div>
        <div style={{ padding: '12px 14px 14px', background: 'var(--ak-surface)' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--ak-text)' }}>{course.title || course.code}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)' }}>
            by {course.instructor || 'Akoro'}{course.section?.name ? ` · ${course.section.name}` : ''}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '18px 16px 6px' }}>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Course content</h3>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-sub)' }}>
          {materials.length} {materials.length === 1 ? 'resource' : 'resources'}
        </span>
      </div>

      {materials.length ? materials.map((m, n) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '8px 16px 0',
          padding: '11px 12px', borderRadius: 14, background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)' }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--ak-tag-bg, #F3F4F6)', flexShrink: 0,
            ...(m.thumb_url ? { backgroundImage: `url(${m.thumb_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}) }}>
            {m.thumb_url ? null : <Icon name={TYPE_ICON[m.type] || 'ti-file-text'} size={17} color="var(--ak-text-sec, #6B7280)" />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.3 }}>{n + 1}. {m.title}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)' }}>
              {TYPE_LABEL[m.type] || 'PDF'}{m.meta ? ` · ${m.meta}` : ''}
            </p>
          </div>
          {m.url && (
            <button onClick={() => window.open(m.url, '_blank', 'noopener')} aria-label={`Open ${m.title}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 99,
                border: 'none', background: 'var(--ak-text)', color: 'var(--ak-surface)', fontSize: 11.5, fontWeight: 800,
                cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
              Open<Icon name="ti-external-link" size={12} />
            </button>
          )}
        </div>
      )) : (
        <EmptyNote>Published learning materials for this course will appear here.</EmptyNote>
      )}
    </div>
  );
}

/* ── The programme browse view (default export) ───────────────── */
export default function ProgrammePage({ programmeId, onClose,
  courseRoute = null,   // the course id the URL says is open (null = browse)
  onCourseRoute,        // (id|null) — mirror a course transition into the URL
}) {
  const [p, setP] = useState(undefined); // undefined = loading, null = missing
  useEffect(() => {
    let on = true;
    setP(undefined);
    fetchProgramme(programmeId).then((d) => { if (on) setP(d); }).catch(() => { if (on) setP(null); });
    return () => { on = false; };
  }, [programmeId]);

  if (courseRoute) return <CourseFolder courseId={courseRoute} onBack={() => onCourseRoute?.(null)} />;

  if (p === undefined) return <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;
  if (!p) return (
    <>
      <Back label="Discover" onClick={onClose} />
      <EmptyNote>This programme is not available right now.</EmptyNote>
    </>
  );

  const sections = p.sections ?? [];

  return (
    <div style={{ fontFamily: FONT, paddingBottom: 90 }}>
      <Back label="Discover" onClick={onClose} />

      {/* Hero — cover image when supplied, gradient wash when not. */}
      <div style={{ margin: '12px 16px 0', borderRadius: 20, overflow: 'hidden', position: 'relative',
        minHeight: 132, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        ...(p.cover_url
          ? { backgroundImage: `url(${p.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: PROGRAMME_G }) }}>
        <div style={{ padding: '38px 16px 14px', background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.55))' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.3)' }}>{p.name}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>
            {[p.description, p.duration_label].filter(Boolean).join(' · ')}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 800, color: 'rgba(255,255,255,.75)' }}>
            {p.published_courses} published {p.published_courses === 1 ? 'course' : 'courses'}
          </p>
        </div>
      </div>

      {/* Sections → course cards. */}
      {sections.length ? sections.map((s) => (
        <div key={s.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '18px 16px 8px' }}>
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>{s.name}</h3>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-sub)' }}>
              {(s.courses ?? []).length} {(s.courses ?? []).length === 1 ? 'course' : 'courses'}
            </span>
          </div>
          {(s.courses ?? []).length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 11, padding: '0 16px' }}>
              {s.courses.map((c) => <CourseCard key={c.id} c={c} onOpen={(x) => onCourseRoute?.(x.id)} />)}
            </div>
          ) : (
            <EmptyNote>Courses for this section are coming soon.</EmptyNote>
          )}
        </div>
      )) : (
        <EmptyNote>No sections or courses yet — programme content is coming soon.</EmptyNote>
      )}
    </div>
  );
}
