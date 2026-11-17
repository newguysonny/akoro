/**
 * Course Approvals — the admin side of the Course Creator review flow
 * (reference/Kpemu Course Builder.html, admin view): the Review queue
 * (courses instructors submitted, with Open / Changes / Approve exactly
 * like the prototype), an All-courses view over every instructor's
 * builder course, and a read-only inspection page per course — the
 * publish checklist, the course facts, the content outline and the
 * phone-style student preview — with Approve & publish / Request changes
 * / Unpublish. Live against /api/course-builder, where an admin token
 * sees every course; instructors build in the instructor app's Course
 * Creator and the two sides share one status flow:
 * draft → review → published (a "Request changes" note lands back on the
 * instructor's Publish tab).
 *
 * Same vocabulary as the ported builder: the pages render inside the
 * admin PageLayout as a centred 760px column, classes keep the
 * reference's names (scoped under .caroot), dialogs are styled modals —
 * never browser prompts — and the drawn SVGs stay drawn SVGs.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../../services/api.js';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
import { PageSkeleton } from '../../components/Primitives.jsx';
import './ca.css';

/* The API answers { success, data } — unwrap once, tolerate both shapes. */
const un = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r);
const get = async (path) => un(await apiGet(path));
const BASE = '/course-approvals';

/* ── The reference's vocabulary ─────────────────────────────────────────── */
const G = [
  'linear-gradient(145deg,#ff6b52,#8a2c20)', 'linear-gradient(145deg,#6c3cff,#2d1b6e)',
  'linear-gradient(145deg,#14b8a0,#0b6b60)', 'linear-gradient(145deg,#4a8af0,#2652b5)',
  'linear-gradient(145deg,#ee4a73,#a11d45)', 'linear-gradient(145deg,#f0894a,#c0501a)',
];
const TY = { live: 'Live session', video: 'Video', pdf: 'PDF', audio: 'Audio', article: 'Article', link: 'Link', slides: 'Slides' };
const TI = {
  live: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  video: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" stroke="none" /></>,
  pdf: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  audio: <path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4" />,
  article: <path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  slides: <path d="M3 5h18v11H3zM8 21h8M12 16v5" />,
};

/* ── Dates and repeats — same helpers as the instructor section ─────────── */
const fmt = (w) => { const d = new Date(w); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const tm = (t) => { const d = new Date('1970-01-01T' + t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const fmtR = (w, e) => { const t = e ? new Date('1970-01-01T' + e) : null; return fmt(w) + (t && !Number.isNaN(t.getTime()) ? ' – ' + t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''); };
const exTxt = (l) => { const v = Object.values(l.ex || {}), c = v.filter((x) => x.c).length, r = v.length - c; return (c ? ' · ' + c + ' cancelled' : '') + (r ? ' · ' + r + ' rescheduled' : ''); };
const repLabel = (l) => {
  if (!l.rep) return '';
  const d = new Date(l.when), bad = Number.isNaN(d.getTime());
  const day = bad ? '' : d.toLocaleDateString([], { weekday: 'long' }), n = bad ? '' : d.getDate();
  const u = l.until ? new Date(l.until + 'T00:00') : null;
  const unTx = u && !Number.isNaN(u.getTime()) ? ' until ' + u.toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
  const b = {
    daily: 'Every day', twice: 'Twice a day' + (l.t2s ? ' (2nd at ' + tm(l.t2s) + ')' : ''),
    weekly: 'Every week on ' + day, biweekly: 'Every 2 weeks on ' + day, monthly: 'Every month on day ' + n,
  }[l.rep];
  return b + unTx + exTxt(l);
};

const nL = (c) => c.sections.reduce((n, s) => n + s.lessons.length, 0);
const statOf = (c) => (c.status === 'review' ? 'In review' : c.status === 'published' ? 'Published' : 'Draft' + (c.note ? ' · Changes requested' : ''));
const priceOf = (c) => (c.pm ? 'Free · public preview' : c.price === 'free' ? 'Free' : +c.price > 0 ? '₦' + (+c.price).toLocaleString() : 'Not set');
const checksOf = (c) => [
  ['Title and subtitle added', !!(c.title && c.sub)],
  ['Description written (50+ characters)', c.desc.length >= 50],
  ['At least one learning objective', !!c.learn.trim()],
  ['At least one section with content', c.sections.some((s) => s.lessons.length)],
  ['Pricing set', c.price === 'free' || +c.price > 0],
  ...(c.type === 'live' ? [['Every live session has a start and end time', c.sections.every((s) => s.lessons.every((l) => l.type !== 'live' || (l.when && l.end)))]] : []),
];

/* ── Section context: one courses tree + a reload handle ───────────────── */
const CaCtx = createContext({ courses: null, reload: async () => {}, toast: () => {} });
const useCa = () => useContext(CaCtx);

export default function CourseApprovalsSection() {
  const [courses, setCourses] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const toastRef = useRef(null);
  const toast = (m) => {
    setToastMsg(m);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToastMsg(null), 1800);
  };
  const reload = async () => {
    try { setCourses(await get('/api/course-builder/courses') || []); }
    catch { setCourses((c) => c || []); }
  };
  useEffect(() => { reload(); return () => clearTimeout(toastRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => ({ courses, reload, toast }), [courses]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <CaCtx.Provider value={ctx}>
      <div className="caroot">
        <CaNav />
        <Routes>
          <Route index element={<Queue />} />
          <Route path="courses" element={<AllCourses />} />
          <Route path="courses/:cid" element={<CourseView />} />
          <Route path="*" element={<Queue />} />
        </Routes>
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </CaCtx.Provider>
  );
}

function CaNav() {
  const { courses } = useCa();
  const rq = (courses || []).filter((c) => c.status === 'review').length;
  const cls = ({ isActive }) => (isActive ? 'on' : undefined);
  return (
    <nav className="ccnav" aria-label="Course Approvals">
      <NavLink to={BASE} end className={cls}><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg>Review queue{rq ? <small>{rq}</small> : null}</NavLink>
      <NavLink to={`${BASE}/courses`} className={cls}><svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6" /></svg>All courses</NavLink>
    </nav>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */
const Thumb = ({ l }) => (
  <div className="th" style={l.img ? { background: `url(${l.img}) center/cover` } : undefined}>
    {l.img && l.type !== 'video' ? null : <svg viewBox="0 0 24 24">{TI[l.type]}</svg>}
  </div>
);

const lessonLine = (l) => (
  <span>
    <em>{TY[l.type]}</em>
    {l.meta ? ' · ' + l.meta : ''}
    {l.when ? ' · ' + fmtR(l.when, l.end) : ''}
    {l.rep ? ' · ' + repLabel(l) : ''}
    {l.free ? ' · Free preview' : ''}
  </span>
);

/* The styled ask-dialog — the prototype's "Request changes" modal. */
function AskModal({ title, label, confirmLabel = 'Save', onClose, onSubmit }) {
  const [val, setVal] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (!val.trim()) return; onSubmit(val.trim()); };
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <label>{label}</label>
        <textarea ref={ref} rows={3} value={val} onChange={(e) => setVal(e.target.value)} />
        <div className="row" style={{ marginTop: 18 }}>
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" onClick={submit}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* One status move + the prototype's toasts, shared by every page. */
function useStatusActions() {
  const { reload, toast } = useCa();
  return async (id, v, note) => {
    try {
      await apiPost(`/api/course-builder/courses/${id}/status`, { status: v, ...(note !== undefined ? { note } : {}) });
      await reload();
      toast({ published: 'Published', draft: 'Moved to draft' }[v]);
    } catch { toast('Something went wrong'); }
  };
}

/* ── The review queue ───────────────────────────────────────────────────── */
function Queue() {
  const navigate = useNavigate();
  const { courses } = useCa();
  const setStatus = useStatusActions();
  const [asking, setAsking] = useState(null); // course being sent back
  if (!courses) return <PageSkeleton variant="list" rows={6} />;
  const queue = courses.filter((c) => c.status === 'review');
  const by = (s) => courses.filter((c) => c.status === s).length;
  const approve = async (c) => {
    if (!(await confirmDialog({ title: 'Approve and publish?', message: `"${c.title}" by ${c.owner || '?'} goes live for students.`, confirmLabel: 'Publish' }))) return;
    setStatus(c.id, 'published');
  };
  return (
    <>
      <h1>Review queue</h1>
      <p className="lead">Courses instructors have submitted for approval.</p>
      <div className="hgrid">
        {[['In review', queue.length], ['Published', by('published')], ['Drafts', by('draft')], ['Content items', courses.reduce((a, c) => a + nL(c), 0)]].map((x) => (
          <div className="stat" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>
        ))}
      </div>
      {queue.length ? queue.map((c) => (
        <div className="ccd" key={c.id}>
          <div className="th" style={{ background: c.cover ? `url(${c.cover}) center/cover` : G[c.color], color: '#fff' }}>
            {c.cover ? null : <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 9h8M8 13h8" /></svg>}
          </div>
          <div className="ct">
            <b>{c.title}</b>
            <span>by {c.owner || '?'} · {nL(c)} items · {c.type === 'live' ? 'Live course' : 'Video course'} · {priceOf(c)}</span>
          </div>
          <div className="mini">
            <button onClick={() => navigate(`${BASE}/courses/${c.id}`)}>Open</button>
            <button onClick={() => setAsking(c)}>Changes</button>
            <button onClick={() => approve(c)}>Approve</button>
          </div>
        </div>
      )) : <div className="empty">Nothing to review right now.</div>}
      {asking && (
        <AskModal title="Request changes" label="Tell the instructor what to fix"
          onClose={() => setAsking(null)}
          onSubmit={(t) => { const id = asking.id; setAsking(null); setStatus(id, 'draft', t); }} />
      )}
    </>
  );
}

/* ── All instructor courses ─────────────────────────────────────────────── */
function AllCourses() {
  const navigate = useNavigate();
  const { courses } = useCa();
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  if (!courses) return <PageSkeleton variant="list" rows={6} />;
  const needle = q.toLowerCase();
  const cs = courses.filter((c) => (!f || c.status === f) && (c.title + (c.owner || '') + (c.tags || '') + (c.lang || '')).toLowerCase().includes(needle));
  return (
    <>
      <h1>All courses</h1>
      <p className="lead">Every course from every instructor.</p>
      <div className="tools">
        <div className="sbox">
          <svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses" autoComplete="off" />
          {q ? <button className="sx" onClick={() => setQ('')} aria-label="Clear">✕</button> : null}
        </div>
        <select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="review">In review</option>
          <option value="published">Published</option>
        </select>
      </div>
      {cs.length ? (
        <div className="cgrid">
          {cs.map((c) => (
            <div className="ccard" key={c.id} onClick={() => navigate(`${BASE}/courses/${c.id}`)}>
              <div className="cban" style={{ background: c.cover ? `url(${c.cover}) center/cover` : G[c.color] }}>{c.cat}</div>
              <div className="cbody">
                <b>{c.title}</b>
                <span>by {c.owner || '?'} · {nL(c)} items</span>
                <span>{c.type === 'live' ? 'Live course · ' : 'Video course · '}{statOf(c)}{c.pm ? ' · Public preview' : ''}</span>
                <span>{c.lang || 'English'}{c.tags ? ' · ' + c.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ') : ''}</span>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="empty">No courses found.</div>}
    </>
  );
}

/* ── One course, inspected ──────────────────────────────────────────────── */
function CourseView() {
  const navigate = useNavigate();
  const { cid } = useParams();
  const { courses } = useCa();
  const setStatus = useStatusActions();
  const [asking, setAsking] = useState(false);
  const [preview, setPreview] = useState(false);
  if (!courses) return <PageSkeleton variant="detail" />;
  const c = courses.find((x) => x.id === cid);
  if (!c) return <Navigate to={BASE} replace />;
  const ck = checksOf(c);
  const okAll = ck.every((x) => x[1]);
  const approve = async () => {
    if (!(await confirmDialog({ title: 'Approve and publish?', message: `"${c.title}" by ${c.owner || '?'} goes live for students.`, confirmLabel: 'Publish' }))) return;
    setStatus(c.id, 'published');
  };
  const unpublish = async () => {
    if (!(await confirmDialog({ title: 'Unpublish this course?', message: 'Students lose access until it is published again.', confirmLabel: 'Unpublish', danger: true }))) return;
    setStatus(c.id, 'draft');
  };
  return (
    <>
      <button className="back" onClick={() => navigate(-1)}>‹ Back</button>
      <h1>{c.title}</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        {c.type === 'live' ? 'Live course · ' : 'Video course · '}{statOf(c)} · {c.lang || 'English'} · by {c.owner || '?'}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => setPreview(true)}>Preview</button>
        {c.status === 'review' && (
          <>
            <button className="btn p" onClick={approve}>Approve and publish</button>
            <button className="btn" onClick={() => setAsking(true)}>Request changes</button>
          </>
        )}
        {c.status === 'draft' && <button className="btn p" disabled={!okAll} onClick={approve}>Publish</button>}
        {c.status === 'published' && <button className="btn" onClick={unpublish}>Unpublish</button>}
      </div>
      {c.note && c.status === 'draft' && <div className="note"><b>Changes requested</b><br />{c.note}</div>}

      <div style={{ margin: '18px 0 6px' }}><h2>Ready to publish?</h2></div>
      {ck.map((x) => (
        <div className="chk" key={x[0]}><span className={`ck${x[1] ? ' on' : ''}`}>{x[1] ? '✓' : ''}</span>{x[0]}</div>
      ))}

      <div style={{ margin: '26px 0 6px' }}><h2>Course details</h2></div>
      <div className="facts">
        <div className="fact"><span>Subtitle</span><b>{c.sub || '—'}</b></div>
        <div className="fact"><span>Category</span><b>{c.cat} · {c.level}</b></div>
        <div className="fact"><span>Language</span><b>{c.lang || 'English'}</b></div>
        <div className="fact"><span>Tags</span><b>{c.tags || '—'}</b></div>
        {c.type === 'live' && <div className="fact"><span>Live platform</span><b>{c.platform || '—'}</b></div>}
        <div className="fact"><span>Pricing</span><b>{priceOf(c)}</b></div>
        <div className="fact"><span>Description</span><b>{c.desc || '—'}</b></div>
        <div className="fact"><span>Students learn</span><b>{c.learn.trim() || '—'}</b></div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <h2>Content</h2><span className="chip">{nL(c)}</span>
      </div>
      {c.sections.length ? c.sections.map((s, i) => (
        <div key={s.id} style={{ marginBottom: 18 }}>
          <p className="lead" style={{ margin: '0 0 8px', fontSize: 14 }}>{i + 1}. {s.title} · {s.lessons.length} {s.lessons.length === 1 ? 'item' : 'items'}</p>
          {s.lessons.map((l) => (
            <div className="ccd" key={l.id}>
              <Thumb l={l} />
              <div className="ct"><b>{l.title}</b>{lessonLine(l)}</div>
            </div>
          ))}
          {!s.lessons.length && <div className="empty">No content in this section.</div>}
        </div>
      )) : <div className="empty">No sections yet.</div>}

      {asking && (
        <AskModal title="Request changes" label="Tell the instructor what to fix"
          onClose={() => setAsking(false)}
          onSubmit={(t) => { setAsking(false); setStatus(c.id, 'draft', t); }} />
      )}
      {preview && <PreviewModal c={c} onClose={() => setPreview(false)} />}
    </>
  );
}

/* ── Student preview — the phone-style accordion modal ──────────────────── */
function PreviewModal({ c, onClose }) {
  const all = c.sections.flatMap((s) => s.lessons);
  const mins = all.reduce((a, l) => {
    const m = /(\d+(?:\.\d+)?)\s*min/i.exec(l.meta || '');
    return a + (m ? +m[1] : 0);
  }, 0);
  const dur = mins ? ' · ' + (mins >= 60 ? (mins / 60).toFixed(1).replace('.0', '') + ' total hours' : Math.round(mins) + ' total min') : '';
  const ico = {
    video: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M10 8.5l5 2.5-5 2.5zM9 21h6" /></>,
    audio: <path d="M8 5l11 7-11 7z" />,
    live: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
    link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  };
  const book = <path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6zM12 6v13" />;
  const lock = <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>;
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Preview">
        <div className="row"><h2>Preview</h2><span className="sp" /><button className="btn" onClick={onClose}>Close</button></div>
        <div className="pv">
          <div className="top">
            {all.length} {c.type === 'live' ? 'sessions' : 'lessons'}{dur} — <b>{c.pm ? 'Free for everyone' : 'Enrol to unlock all content'}</b>
          </div>
          {c.sections.length ? c.sections.map((s, i) => {
            const fr = c.pm || s.lessons.some((l) => l.free);
            return (
              <details className="ps" key={s.id} open={fr || undefined}>
                <summary>
                  <span className="pn">{i + 1}</span>
                  <div className="pt">
                    <b>{s.title}{fr ? null : <svg viewBox="0 0 24 24">{lock}</svg>}</b>
                    <span>{s.lessons.length} {s.lessons.length === 1 ? 'lesson' : 'lessons'}</span>
                  </div>
                  {fr && <span className="pf">Free preview</span>}
                  <span className="chv"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></span>
                </summary>
                {s.lessons.map((l, j) => {
                  const lk = !(c.pm || l.free);
                  return (
                    <div className={`pr${lk ? ' lk' : ''}`} key={l.id}>
                      <span className="no">{j + 1}</span>
                      <svg viewBox="0 0 24 24">{lk ? lock : (ico[l.type] || book)}</svg>
                      <span className="tt">
                        {l.title}
                        {(l.meta || l.when)
                          ? <small>{[l.when ? fmtR(l.when, l.end) : '', l.rep ? repLabel(l) : '', l.meta].filter(Boolean).join(' · ')}</small>
                          : null}
                      </span>
                      {lk ? null : (
                        <span className="pb">
                          <span className="pbc"><svg viewBox="0 0 24 24"><path d="M9 7l8 5-8 5z" /></svg></span>
                          <u>Preview</u>
                        </span>
                      )}
                    </div>
                  );
                })}
              </details>
            );
          }) : <div className="top">No sections yet.</div>}
        </div>
      </div>
    </div>
  );
}
