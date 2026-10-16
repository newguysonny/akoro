/**
 * Course Creator — the instructor section ported 1:1 from
 * reference/Kpemu Course Builder.html: Home (stats, needs-attention),
 * My courses (search + status filter + cards), New course, the Builder
 * (Sections / Details / Pricing / Publish tabs), section detail with
 * reorder (arrows + drag), the lesson form with the full live-session
 * vocabulary (repeats, second daily session, per-date cancel/reschedule
 * exceptions, expand-into-sessions), the Content library, the phone-style
 * student preview and the admin Review queue. Live against
 * /api/course-builder.
 *
 * Same UI, adopted to this dashboard: the pages render inside the
 * instructor PageLayout as a centred 760px column (the reference's own
 * width), the prototype's sidebar becomes the .ccnav pill row, the
 * "Viewing as" selector is gone — the signed-in user IS the instructor
 * (admins get the reference's admin view: every course + the review
 * queue) — and each page is its own component with its hooks ahead of any
 * early return. The reference's drawn SVGs are kept as drawn SVGs.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../services/api.js';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { PageLayout } from '../../components/Layout.jsx';
import './cc.css';

/* The API answers { success, data } — unwrap once, tolerate both shapes. */
const un = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r);
const get = async (path) => un(await apiGet(path));
const BASE = '/course-creator';

/* ── The reference's vocabulary ─────────────────────────────────────────── */
export const G = [
  'linear-gradient(145deg,#ff6b52,#8a2c20)', 'linear-gradient(145deg,#6c3cff,#2d1b6e)',
  'linear-gradient(145deg,#14b8a0,#0b6b60)', 'linear-gradient(145deg,#4a8af0,#2652b5)',
  'linear-gradient(145deg,#ee4a73,#a11d45)', 'linear-gradient(145deg,#f0894a,#c0501a)',
];
export const TY = { live: 'Live session', video: 'Video', pdf: 'PDF', audio: 'Audio', article: 'Article', link: 'Link', slides: 'Slides' };
const CATS   = ['Pharmacy', 'Biology', 'Computing', 'Chemistry', 'Health', 'Other'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'All levels'];
const PLATS  = ['Google Meet', 'Zoom', 'YouTube Live', 'Other'];
const LANGS  = ['English', 'French', 'Yoruba', 'Hausa', 'Igbo', 'Nigerian Pidgin', 'Arabic', 'Other'];
const REPS   = [['', 'Does not repeat'], ['daily', 'Every day'], ['twice', 'Twice a day'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']];

/* Content-type icons — the reference's drawn SVG paths. */
const TI = {
  live: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  video: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" stroke="none" /></>,
  pdf: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  audio: <path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4" />,
  article: <path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  slides: <path d="M3 5h18v11H3zM8 21h8M12 16v5" />,
};

/* ── Dates, repeats and the exception map — ported verbatim ─────────────── */
const fmt = (w) => { const d = new Date(w); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const tm = (t) => { const d = new Date('1970-01-01T' + t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const fmtR = (w, e) => { const t = e ? new Date('1970-01-01T' + e) : null; return fmt(w) + (t && !Number.isNaN(t.getTime()) ? ' – ' + t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''); };
const ymd = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
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
/* Occurrences of a repeating live lesson, capped at max (400 steps max). */
const occ = (l, max) => {
  if (!l.when || !l.rep) return [];
  const d0 = l.when.slice(0, 10), s1 = l.when.slice(11, 16);
  const st = new Date(d0 + 'T00:00'), unD = l.until ? new Date(l.until + 'T00:00') : null;
  const out = []; let i = 0;
  while (out.length < max && i < 400) {
    const d = l.rep === 'monthly'
      ? new Date(st.getFullYear(), st.getMonth() + i, st.getDate())
      : new Date(st.getFullYear(), st.getMonth(), st.getDate() + i * ({ weekly: 7, biweekly: 14 }[l.rep] || 1));
    if (unD && d > unD) break;
    const k = ymd(d);
    out.push({ key: k + '|1', d: k, s: s1, e: l.end || '' });
    if (l.rep === 'twice' && l.t2s) out.push({ key: k + '|2', d: k, s: l.t2s, e: l.t2e || '' });
    i += 1;
  }
  return out.slice(0, max);
};
/* The effective date of one occurrence, after exceptions. */
const eff = (l, o) => { const x = l.ex && l.ex[o.key]; return x ? (x.c ? { cancel: 1 } : { d: x.d, s: x.s, e: x.e, moved: 1 }) : { d: o.d, s: o.s, e: o.e }; };
const dl = (d, s, e) => new Date(d + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + (s ? ', ' + tm(s) : '') + (e ? ' – ' + tm(e) : '');

const nL = (c) => c.sections.reduce((n, s) => n + s.lessons.length, 0);
const statOf = (c) => (c.status === 'review' ? 'In review' : c.status === 'published' ? 'Published' : 'Draft' + (c.note ? ' · Changes requested' : ''));
const checksOf = (c) => [
  ['Title and subtitle added', !!(c.title && c.sub)],
  ['Description written (50+ characters)', c.desc.length >= 50],
  ['At least one learning objective', !!c.learn.trim()],
  ['At least one section with content', c.sections.some((s) => s.lessons.length)],
  ['Pricing set', c.price === 'free' || +c.price > 0],
  ...(c.type === 'live' ? [['Every live session has a start and end time', c.sections.every((s) => s.lessons.every((l) => l.type !== 'live' || (l.when && l.end)))]] : []),
];

/* Canvas shrink → JPEG data URL, exactly the prototype's cover pipeline. */
const shrink = (file, max) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => {
    const i = new Image();
    i.onload = () => {
      const w = Math.min(max, i.width), c = document.createElement('canvas');
      c.width = w; c.height = Math.round((i.height * w) / i.width);
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    i.onerror = () => reject(new Error('not an image'));
    i.src = r.result;
  };
  r.readAsDataURL(file);
});

/* ── Section context: one courses tree + a reload handle ────────────────── */
const CcCtx = createContext({ courses: null, reload: async () => {}, toast: () => {}, adm: false, meName: '' });
const useCc = () => useContext(CcCtx);

export default function CourseCreatorPage() {
  return (
    <PageLayout title="Course Creator" subtitle="Build video and live courses, section by section">
      <CourseCreatorSection />
    </PageLayout>
  );
}

export function CourseCreatorSection() {
  const { user } = useAuth();
  const adm = user?.role === 'admin';
  const meName = user?.fullName || user?.name || user?.username || 'there';
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

  const ctx = useMemo(() => ({ courses, reload, toast, adm, meName }), [courses, adm, meName]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <CcCtx.Provider value={ctx}>
      <div className="ccroot">
        <CcNav />
        <Routes>
          <Route index element={<Home />} />
          <Route path="courses" element={<CoursesList />} />
          <Route path="courses/new" element={<NewCourse />} />
          <Route path="courses/:cid" element={<Builder />} />
          <Route path="courses/:cid/sections/:sid" element={<SectionPage />} />
          <Route path="courses/:cid/sections/:sid/lessons/new" element={<LessonForm />} />
          <Route path="courses/:cid/sections/:sid/lessons/:lid" element={<LessonForm edit />} />
          <Route path="library" element={<Library />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="*" element={<Home />} />
        </Routes>
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </CcCtx.Provider>
  );
}

/* The prototype's sidebar, as a pill row under the instructor header. */
function CcNav() {
  const { courses, adm } = useCc();
  const rq = (courses || []).filter((c) => c.status === 'review').length;
  const cls = ({ isActive }) => (isActive ? 'on' : undefined);
  return (
    <nav className="ccnav" aria-label="Course Creator">
      <NavLink to={BASE} end className={cls}><svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg>Home</NavLink>
      <NavLink to={`${BASE}/courses`} className={cls}><svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6" /></svg>{adm ? 'All courses' : 'My courses'}</NavLink>
      <NavLink to={`${BASE}/library`} className={cls}><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /></svg>Content library</NavLink>
      {adm && <NavLink to={`${BASE}/review`} className={cls}><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg>Review queue{rq ? <small>{rq}</small> : null}</NavLink>}
    </nav>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */
export function SBox({ placeholder = 'Search courses', q, setQ }) {
  return (
    <div className="sbox">
      <svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" /></svg>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
      {q ? <button className="sx" onClick={() => setQ('')} aria-label="Clear">✕</button> : null}
    </div>
  );
}

const Thumb = ({ l }) => (
  <div className="th" style={l.img ? { background: `url(${l.img}) center/cover` } : undefined}>
    {l.img && l.type !== 'video' ? null : <svg viewBox="0 0 24 24">{TI[l.type]}</svg>}
  </div>
);

/* One line of lesson facts — type · meta · when · repeat · free. */
const lessonLine = (l, freeLabel = 'Free preview') => (
  <span>
    <em>{TY[l.type]}</em>
    {l.meta ? ' · ' + l.meta : ''}
    {l.when ? ' · ' + fmtR(l.when, l.end) : ''}
    {l.rep ? ' · ' + repLabel(l) : ''}
    {l.free ? ' · ' + freeLabel : ''}
  </span>
);

function Card({ c }) {
  const navigate = useNavigate();
  const { adm } = useCc();
  return (
    <div className="ccard" onClick={() => navigate(`${BASE}/courses/${c.id}`)}>
      <div className="cban" style={{ background: c.cover ? `url(${c.cover}) center/cover` : G[c.color] }}>{c.cat}</div>
      <div className="cbody">
        <b>{c.title}</b>
        <span>{adm ? `by ${c.owner || '?'} · ` : ''}{nL(c)} items</span>
        <span>{c.type === 'live' ? 'Live course · ' : 'Video course · '}{statOf(c)}{c.pm ? ' · Public preview' : ''}</span>
        <span>{c.lang || 'English'}{c.tags ? ' · ' + c.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ') : ''}</span>
      </div>
    </div>
  );
}

const Arrows = ({ i, n, onMove }) => (
  <div className="mini">
    <button onClick={() => onMove(-1)} disabled={i === 0} aria-label="Move up">↑</button>
    <button onClick={() => onMove(1)} disabled={i === n - 1} aria-label="Move down">↓</button>
  </div>
);

/* ── A small styled modal — the prototype's dialog pattern ──────────────── */
function AskModal({ title, label, initial = '', textarea = false, confirmLabel = 'Save', placeholder = '', onClose, onSubmit }) {
  const [val, setVal] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (!val.trim()) return; onSubmit(val.trim()); };
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <label>{label}</label>
        {textarea
          ? <textarea ref={ref} rows={3} value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder} />
          : <input ref={ref} value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && submit()} />}
        <div className="row" style={{ marginTop: 18 }}>
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" onClick={submit}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* Reschedule one date in a series. */
function RescheduleModal({ initial, onClose, onSubmit }) {
  const { toast } = useCc();
  const [d, setD] = useState(initial.d || '');
  const [s, setS] = useState(initial.s || '');
  const [e, setE] = useState(initial.e || '');
  const submit = () => {
    if (!d || !s) { toast('Set a date and start time'); return; }
    if (e && e <= s) { toast('End must be after start'); return; }
    onSubmit({ d, s, e });
  };
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reschedule this date">
        <h2>Reschedule this date</h2>
        <label>Date</label><input type="date" value={d} onChange={(ev) => setD(ev.target.value)} />
        <label>Starts</label><input type="time" value={s} onChange={(ev) => setS(ev.target.value)} />
        <label>Ends</label><input type="time" value={e} onChange={(ev) => setE(ev.target.value)} />
        <div className="row" style={{ marginTop: 18 }}>
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ── Home ───────────────────────────────────────────────────────────────── */
function Home() {
  const navigate = useNavigate();
  const { courses, adm, meName } = useCc();
  if (!courses) return null;
  const n = courses.reduce((a, c) => a + nL(c), 0);
  const by = (s) => courses.filter((c) => c.status === s).length;
  const todo = adm ? courses.filter((c) => c.status === 'review') : courses.filter((c) => c.status === 'draft');
  return (
    <>
      <h1>Hi, {meName}</h1>
      <p className="lead">{adm ? "Here's what's happening across the marketplace." : "Here's how your courses are doing."}</p>
      <div className="hgrid">
        {[['Courses', courses.length], ['Content items', n], ['Published', by('published')], ['In review', by('review')]].map((x) => (
          <div className="stat" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>
        ))}
      </div>
      <div className="row" style={{ margin: '22px 0' }}>
        <button className="btn p" onClick={() => navigate(`${BASE}/courses/new`)}>+ New course</button>
        <button className="btn" onClick={() => navigate(`${BASE}/library`)}>Content library</button>
      </div>
      <h2 style={{ marginBottom: 12 }}>{adm ? 'Waiting for review' : 'Needs your attention'}</h2>
      {todo.length
        ? <div className="cgrid">{todo.map((c) => <Card key={c.id} c={c} />)}</div>
        : <div className="empty">All caught up.</div>}
    </>
  );
}

/* ── My courses ─────────────────────────────────────────────────────────── */
function CoursesList() {
  const navigate = useNavigate();
  const { courses, adm } = useCc();
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  if (!courses) return null;
  const needle = q.toLowerCase();
  const cs = courses.filter((c) => (!f || c.status === f) && (c.title + (c.owner || '') + (c.tags || '') + (c.lang || '')).toLowerCase().includes(needle));
  return (
    <>
      <div className="row">
        <div>
          <h1>{adm ? 'All courses' : 'My courses'}</h1>
          <p className="lead">{adm ? 'Every course from every instructor.' : 'Courses you are building.'}</p>
        </div>
        <span className="sp" />
        <button className="btn p" onClick={() => navigate(`${BASE}/courses/new`)}>+ New course</button>
      </div>
      <div className="tools">
        <SBox q={q} setQ={setQ} />
        <select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="review">In review</option>
          <option value="published">Published</option>
        </select>
      </div>
      {cs.length
        ? <div className="cgrid">{cs.map((c) => <Card key={c.id} c={c} />)}</div>
        : <div className="empty">No courses yet. Create your first course.</div>}
    </>
  );
}

/* ── New course ─────────────────────────────────────────────────────────── */
function NewCourse() {
  const navigate = useNavigate();
  const { reload, toast } = useCc();
  const [v, setV] = useState({ type: 'video', platform: 'Google Meet', title: '', cat: 'Biology', level: 'Beginner', lang: 'English', tags: '' });
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const create = async () => {
    if (!v.title.trim()) { toast('Enter a course title'); return; }
    try {
      const c = un(await apiPost('/api/course-builder/courses', { ...v, title: v.title.trim() }));
      await reload();
      navigate(`${BASE}/courses/${c.id}`);
      toast('Course created');
    } catch { toast('Something went wrong'); }
  };
  return (
    <>
      <button className="back" onClick={() => navigate(`${BASE}/courses`)}>‹ Courses</button>
      <h1>New course</h1>
      <p className="lead">Start with the basics. You'll add sections and lessons next.</p>
      <div className="form">
        <label>Course type</label>
        <select value={v.type} onChange={set('type')}>
          <option value="video">Video course · recorded lessons</option>
          <option value="live">Live course · scheduled live sessions</option>
        </select>
        {v.type === 'live' && (
          <>
            <label>Live platform</label>
            <select value={v.platform} onChange={set('platform')}>{PLATS.map((p) => <option key={p}>{p}</option>)}</select>
          </>
        )}
        <label>Course title</label><input value={v.title} onChange={set('title')} placeholder="Introduction to Biology" />
        <label>Category</label><select value={v.cat} onChange={set('cat')}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
        <label>Level</label><select value={v.level} onChange={set('level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        <label>Language</label><select value={v.lang} onChange={set('lang')}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
        <label>Tags (separate with commas, optional)</label><input value={v.tags} onChange={set('tags')} placeholder="biology, cells, revision" />
        <div className="row" style={{ marginTop: 22 }}>
          <button className="btn p" onClick={create}>Create course</button>
          <button className="btn" onClick={() => navigate(`${BASE}/courses`)}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/* ── Builder: Sections / Details / Pricing / Publish ────────────────────── */
function Builder() {
  const navigate = useNavigate();
  const { cid } = useParams();
  const [params, setParams] = useSearchParams();
  const { courses, adm } = useCc();
  const [preview, setPreview] = useState(false);
  if (!courses) return null;
  const c = courses.find((x) => x.id === cid);
  if (!c) return <Navigate to={`${BASE}/courses`} replace />;
  const tab = params.get('tab') || 'cur';
  return (
    <>
      <button className="back" onClick={() => navigate(`${BASE}/courses`)}>‹ Courses</button>
      <h1>{c.title}</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        {c.type === 'live' ? 'Live course · ' : 'Video course · '}{statOf(c)} · {c.lang || 'English'}{adm ? ` · by ${c.owner || '?'}` : ''}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => setPreview(true)}>Preview</button>
      </div>
      <div className="tabs">
        {[['cur', 'Sections'], ['det', 'Details'], ['price', 'Pricing'], ['pub', 'Publish']].map((t) => (
          <button key={t[0]} className={tab === t[0] ? 'on' : undefined} onClick={() => setParams({ tab: t[0] })}>{t[1]}</button>
        ))}
      </div>
      {tab === 'cur' && <TabSections c={c} />}
      {tab === 'det' && <TabDetails c={c} />}
      {tab === 'price' && <TabPricing c={c} />}
      {tab === 'pub' && <TabPublish c={c} />}
      {preview && <PreviewModal c={c} onClose={() => setPreview(false)} />}
    </>
  );
}

function TabSections({ c }) {
  const navigate = useNavigate();
  const { reload, toast } = useCc();
  const [ro, setRo] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const n = c.sections.length;

  const reorder = async (order) => {
    try { await apiPost(`/api/course-builder/courses/${c.id}/sections/reorder`, { order }); await reload(); }
    catch { toast('Something went wrong'); }
  };
  const move = (id, d) => {
    const ids = c.sections.map((s) => s.id), i = ids.indexOf(id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };
  const drop = (targetId) => {
    setOver(null);
    if (!drag || drag === targetId) return;
    const ids = c.sections.map((s) => s.id), i = ids.indexOf(drag), j0 = ids.indexOf(targetId);
    ids.splice(i, 1);
    const j = ids.indexOf(targetId);
    ids.splice(j + (i < j0 ? 1 : 0), 0, drag);
    reorder(ids);
  };
  const addSection = async (title) => {
    try { await apiPost(`/api/course-builder/courses/${c.id}/sections`, { title }); await reload(); setAdding(false); }
    catch { toast('Something went wrong'); }
  };

  return (
    <>
      <div className="row" style={{ margin: '18px 0 14px' }}>
        <button className="btn p" onClick={() => setAdding(true)}>+ Add section</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2>Sections</h2><span className="chip">{n}</span><span className="sp" />
        {n > 1 && <button className={`btn${ro ? ' p' : ''}`} onClick={() => setRo((r) => !r)}>{ro ? 'Done' : 'Reorder'}</button>}
      </div>
      {n ? (
        <div className="sgrid">
          {c.sections.map((s, i) => (
            <div
              key={s.id}
              className={`scard${over === s.id ? ' dover' : ''}`}
              draggable={ro || undefined}
              onDragStart={ro ? () => setDrag(s.id) : undefined}
              onDragEnd={ro ? () => { setDrag(null); setOver(null); } : undefined}
              onDragOver={ro ? (e) => { e.preventDefault(); setOver(s.id); } : undefined}
              onDragLeave={ro ? () => setOver((o) => (o === s.id ? null : o)) : undefined}
              onDrop={ro ? (e) => { e.preventDefault(); drop(s.id); } : undefined}
              onClick={ro ? undefined : () => navigate(`${BASE}/courses/${c.id}/sections/${s.id}`)}
            >
              <div className="ci"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg></div>
              <b>{s.title}</b>
              <span className="d">{s.lessons.length} {s.lessons.length === 1 ? 'item' : 'items'}</span>
              {ro && <div className="sarr"><Arrows i={i} n={n} onMove={(d) => move(s.id, d)} /></div>}
            </div>
          ))}
        </div>
      ) : <div className="empty">No sections yet. Add a section to start adding content.</div>}
      {adding && <AskModal title="Add section" label="Section title" onClose={() => setAdding(false)} onSubmit={addSection} />}
    </>
  );
}

function TabDetails({ c }) {
  const { reload, toast } = useCc();
  const [v, setV] = useState({ title: c.title, sub: c.sub, cat: c.cat, level: c.level, lang: c.lang || 'English', tags: c.tags, desc: c.desc, learn: c.learn, platform: c.platform || 'Google Meet' });
  const [col, setCol] = useState(c.color);
  const [cover, setCover] = useState(c.cover || '');
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const onCover = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { setCover(await shrink(f, 900)); toast('Cover image set'); }
    catch { toast('Choose an image file'); }
  };
  const save = async () => {
    if (!v.title.trim()) { toast('Enter a title'); return; }
    try {
      await apiPatch(`/api/course-builder/courses/${c.id}`, {
        ...v, title: v.title.trim(), color: col, cover,
        ...(c.type === 'live' ? {} : { platform: undefined }),
      });
      await reload();
      toast('Details saved');
    } catch { toast('Something went wrong'); }
  };
  return (
    <div className="form">
      <label>Course title</label><input value={v.title} onChange={set('title')} />
      <label>Subtitle</label><input value={v.sub} onChange={set('sub')} placeholder="One line that sells the course" />
      <label>Category</label><select value={v.cat} onChange={set('cat')}>{CATS.map((x) => <option key={x}>{x}</option>)}</select>
      <label>Level</label><select value={v.level} onChange={set('level')}>{LEVELS.map((x) => <option key={x}>{x}</option>)}</select>
      <label>Language</label><select value={v.lang} onChange={set('lang')}>{LANGS.map((x) => <option key={x}>{x}</option>)}</select>
      <label>Tags (separate with commas)</label><input value={v.tags} onChange={set('tags')} placeholder="biology, cells, revision" />
      <label>Description</label><textarea rows={5} value={v.desc} onChange={set('desc')} />
      <label>What students will learn (one per line)</label><textarea rows={4} value={v.learn} onChange={set('learn')} />
      {c.type === 'live' && (
        <>
          <label>Default live platform</label>
          <select value={v.platform} onChange={set('platform')}>{PLATS.map((p) => <option key={p}>{p}</option>)}</select>
        </>
      )}
      <label>Cover image</label>
      {cover ? <img src={cover} alt="Cover" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, marginBottom: 6 }} /> : null}
      <input type="file" accept="image/*" onChange={onCover} />
      <label>Card color (used when there is no cover)</label>
      <div className="sw">
        {G.map((g, i) => (
          <i key={g} style={{ background: g }} className={i === col ? 'on' : undefined}
            onClick={() => setCol(i)} role="button" tabIndex={0} aria-label={`Card color ${i + 1}`}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setCol(i)} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn p" onClick={save}>Save details</button>
      </div>
    </div>
  );
}

function TabPricing({ c }) {
  const { reload, toast } = useCc();
  const m0 = c.price === '' ? '' : c.price === 'free' ? 'free' : 'paid';
  const [pm, setPm] = useState(c.pm ? '1' : '');
  const [mode, setMode] = useState(m0);
  const [price, setPrice] = useState(m0 === 'paid' ? c.price : '');
  const save = async () => {
    try {
      if (pm) {
        await apiPatch(`/api/course-builder/courses/${c.id}`, { pm: true, price: 'free' });
        await reload();
        toast('Preview mode on: free and public');
        return;
      }
      if (!mode) { toast('Choose free or paid'); return; }
      if (mode === 'paid' && !(+price > 0)) { toast('Enter a price above 0'); return; }
      await apiPatch(`/api/course-builder/courses/${c.id}`, { pm: false, price: mode === 'free' ? 'free' : String(price) });
      await reload();
      toast('Pricing saved');
    } catch { toast('Something went wrong'); }
  };
  return (
    <div className="form">
      <label>Preview mode</label>
      <select value={pm} onChange={(e) => setPm(e.target.value)}>
        <option value="">Off · normal course</option>
        <option value="1">On · free and public, no enrollment needed</option>
      </select>
      <label>Pricing</label>
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="">Choose…</option>
        <option value="free">Free</option>
        <option value="paid">Paid</option>
      </select>
      <label>Price (₦, for paid courses)</label>
      <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15000" />
      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn p" onClick={save}>Save pricing</button>
      </div>
    </div>
  );
}

function TabPublish({ c }) {
  const { reload, toast, adm } = useCc();
  const [asking, setAsking] = useState(false);
  const ck = checksOf(c);
  const okAll = ck.every((x) => x[1]);
  const setStatus = async (v, note) => {
    try {
      await apiPost(`/api/course-builder/courses/${c.id}/status`, { status: v, ...(note !== undefined ? { note } : {}) });
      await reload();
      toast({ review: 'Submitted for review', published: 'Published', draft: 'Moved to draft' }[v]);
    } catch { toast('Something went wrong'); }
  };
  return (
    <>
      <div style={{ margin: '18px 0 6px' }}><h2>Ready to publish?</h2></div>
      {ck.map((x) => (
        <div className="chk" key={x[0]}><span className={`ck${x[1] ? ' on' : ''}`}>{x[1] ? '✓' : ''}</span>{x[0]}</div>
      ))}
      {c.note && c.status === 'draft' && <div className="note"><b>Changes requested</b><br />{c.note}</div>}
      <p className="lead" style={{ marginTop: 14 }}>Status: <b style={{ color: 'var(--text)' }}>{statOf(c)}</b></p>
      <div className="row">
        {c.status === 'draft' && (adm
          ? <button className="btn p" disabled={!okAll} onClick={() => setStatus('published')}>Publish</button>
          : <button className="btn p" disabled={!okAll} onClick={() => setStatus('review')}>Submit for review</button>)}
        {c.status === 'review' && (adm
          ? <>
              <button className="btn p" onClick={() => setStatus('published')}>Approve and publish</button>
              <button className="btn" onClick={() => setAsking(true)}>Request changes</button>
            </>
          : <button className="btn" onClick={() => setStatus('draft')}>Withdraw submission</button>)}
        {c.status === 'published' && <button className="btn" onClick={() => setStatus('draft')}>Unpublish</button>}
      </div>
      {!okAll && c.status === 'draft' && <p className="lead" style={{ marginTop: 12, fontSize: 14 }}>Finish the checklist to continue.</p>}
      {!adm && c.status === 'draft' && <p className="lead" style={{ fontSize: 14 }}>An admin reviews your course before students can see it.</p>}
      {asking && (
        <AskModal title="Request changes" label="Tell the instructor what to fix" textarea
          onClose={() => setAsking(false)}
          onSubmit={(t) => { setAsking(false); setStatus('draft', t); }} />
      )}
    </>
  );
}

/* ── Section detail: the content list ───────────────────────────────────── */
function SectionPage() {
  const navigate = useNavigate();
  const { cid, sid } = useParams();
  const { courses, reload, toast } = useCc();
  const [ro, setRo] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  if (!courses) return null;
  const c = courses.find((x) => x.id === cid);
  const s = c && c.sections.find((x) => x.id === sid);
  if (!c) return <Navigate to={`${BASE}/courses`} replace />;
  if (!s) return <Navigate to={`${BASE}/courses/${c.id}`} replace />;
  const n = s.lessons.length;

  const reorder = async (order) => {
    try { await apiPost(`/api/course-builder/sections/${s.id}/lessons/reorder`, { order }); await reload(); }
    catch { toast('Something went wrong'); }
  };
  const move = (id, d) => {
    const ids = s.lessons.map((l) => l.id), i = ids.indexOf(id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };
  const drop = (targetId) => {
    setOver(null);
    if (!drag || drag === targetId) return;
    const ids = s.lessons.map((l) => l.id), i = ids.indexOf(drag), j0 = ids.indexOf(targetId);
    ids.splice(i, 1);
    const j = ids.indexOf(targetId);
    ids.splice(j + (i < j0 ? 1 : 0), 0, drag);
    reorder(ids);
  };
  const rename = async (title) => {
    try { await apiPatch(`/api/course-builder/sections/${s.id}`, { title }); await reload(); setRenaming(false); }
    catch { toast('Something went wrong'); }
  };
  const removeSection = async () => {
    if (!(await confirmDialog({ title: 'Are you sure?', message: `Delete "${s.title}" and its ${n} items?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await apiDelete(`/api/course-builder/sections/${s.id}`); await reload(); navigate(`${BASE}/courses/${c.id}`); toast('Deleted'); }
    catch { toast('Something went wrong'); }
  };
  const removeLesson = async (l) => {
    if (!(await confirmDialog({ title: 'Are you sure?', message: 'Remove this content item?', confirmLabel: 'Delete', danger: true }))) return;
    try { await apiDelete(`/api/course-builder/lessons/${l.id}`); await reload(); }
    catch { toast('Something went wrong'); }
  };

  return (
    <>
      <button className="back" onClick={() => navigate(`${BASE}/courses/${c.id}`)}>‹ {c.title}</button>
      <h1>{s.title}</h1>
      <p className="lead" style={{ marginBottom: 14 }}>{c.title}</p>
      <div className="row" style={{ marginBottom: 26 }}>
        <button className="btn p" onClick={() => navigate(`${BASE}/courses/${c.id}/sections/${s.id}/lessons/new`)}>+ Add content</button>
        <button className="btn" onClick={() => setRenaming(true)}>Rename</button>
        <button className="btn d" onClick={removeSection}>Delete</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2>Content</h2><span className="chip">{n}</span><span className="sp" />
        {n > 1 && <button className={`btn${ro ? ' p' : ''}`} onClick={() => setRo((r) => !r)}>{ro ? 'Done' : 'Reorder'}</button>}
      </div>
      {n ? s.lessons.map((l, i) => (
        <div
          key={l.id}
          className={`ccd${over === l.id ? ' dover' : ''}`}
          draggable={ro || undefined}
          onDragStart={ro ? () => setDrag(l.id) : undefined}
          onDragEnd={ro ? () => { setDrag(null); setOver(null); } : undefined}
          onDragOver={ro ? (e) => { e.preventDefault(); setOver(l.id); } : undefined}
          onDragLeave={ro ? () => setOver((o) => (o === l.id ? null : o)) : undefined}
          onDrop={ro ? (e) => { e.preventDefault(); drop(l.id); } : undefined}
        >
          <Thumb l={l} />
          <div className="ct"><b>{l.title}</b>{lessonLine(l)}</div>
          {ro ? <Arrows i={i} n={n} onMove={(d) => move(l.id, d)} /> : (
            <div className="mini">
              <button onClick={() => navigate(`${BASE}/courses/${c.id}/sections/${s.id}/lessons/${l.id}`)}>Edit</button>
              <button onClick={() => removeLesson(l)} aria-label="Delete content">✕</button>
            </div>
          )}
        </div>
      )) : <div className="empty">No content in this section yet. Add a video, PDF, audio or article.</div>}
      {renaming && <AskModal title="Rename section" label="Section title" initial={s.title} onClose={() => setRenaming(false)} onSubmit={rename} />}
    </>
  );
}

/* ── Lesson form (new content / edit content) ───────────────────────────── */
function LessonForm({ edit = false }) {
  const navigate = useNavigate();
  const { cid, sid, lid } = useParams();
  const [params] = useSearchParams();
  const { courses, reload, toast } = useCc();
  const ret = params.get('ret');
  const c = courses && courses.find((x) => x.id === cid);
  const s = c && c.sections.find((x) => x.id === sid);
  const l0 = edit && s ? s.lessons.find((x) => x.id === lid) : null;
  const [v, setV] = useState(null);
  const [img, setImg] = useState('');
  const fileRef = useRef(null);
  const [resched, setResched] = useState(null); // occurrence being rescheduled

  // Seed the form once the tree is here (and reseed if the lesson changes).
  useEffect(() => {
    if (!s || (edit && !l0)) return;
    const l = l0 || { type: c.type === 'live' ? 'live' : 'video' };
    setV({
      title: l.title || '', type: l.type, when: l.when || '', end: l.end || '',
      rep: l.rep || '', until: l.until || '', t2s: l.t2s || '', t2e: l.t2e || '',
      plat: l.plat || c.platform || 'Google Meet', src: l.src || '', meta: l.meta || '',
      desc: l.desc || '', free: l.free ? '1' : '',
    });
    setImg(l.img || '');
  }, [l0?.id, !!s]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!courses) return null;
  if (!c) return <Navigate to={`${BASE}/courses`} replace />;
  if (!s) return <Navigate to={`${BASE}/courses/${c.id}`} replace />;
  if (edit && !l0) return <Navigate to={`${BASE}/courses/${c.id}/sections/${s.id}`} replace />;
  if (!v) return null;

  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const back = () => (ret === 'library' ? navigate(`${BASE}/library`) : navigate(`${BASE}/courses/${c.id}/sections/${s.id}`));

  const onImg = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { setImg(await shrink(f, 480)); toast('Preview image set'); }
    catch { toast('Choose an image file'); }
  };

  const save = async () => {
    const title = v.title.trim();
    if (!title) { toast('Enter a lesson title'); return; }
    if (v.rep) {
      if (!v.when) { toast('Set a start date and time first'); return; }
      if (v.rep === 'twice' && (!v.t2s || (v.t2e && v.t2e <= v.t2s))) { toast('Set a valid second session time'); return; }
      if (v.until && v.until < v.when.slice(0, 10)) { toast('Repeat end date must be after the first session'); return; }
    }
    let meta = v.meta.trim();
    if (v.when && v.end) {
      const a = v.when.slice(11, 16);
      if (v.end <= a) { toast('End time must be after the start time'); return; }
      if (!meta) {
        const b = v.end.split(':');
        meta = ((+b[0] * 60 + +b[1]) - (+a.slice(0, 2) * 60 + +a.slice(3))) + ' min';
      }
    }
    const f = fileRef.current && fileRef.current.files[0];
    meta = meta || (f ? (f.size / 1048576).toFixed(1) + ' MB' : '');
    const body = { ...v, title, meta, free: !!v.free, img };
    try {
      if (edit) await apiPatch(`/api/course-builder/lessons/${l0.id}`, body);
      else await apiPost(`/api/course-builder/sections/${s.id}/lessons`, body);
      await reload();
      back();
      toast('Content saved');
    } catch { toast('Something went wrong'); }
  };

  /* Exception edits land straight on the saved lesson (the reference says
     "Save the form above before changing individual dates"). */
  const setEx = async (key, val) => {
    const ex = { ...(l0.ex || {}) };
    if (val) ex[key] = val; else delete ex[key];
    try { await apiPatch(`/api/course-builder/lessons/${l0.id}`, { ex }); await reload(); }
    catch { toast('Something went wrong'); }
  };

  const expand = async () => {
    const os = occ(l0, l0.until ? 60 : 12).map((o) => eff(l0, o)).filter((x) => !x.cancel);
    if (!os.length) { toast('No dates to expand'); return; }
    const okGo = await confirmDialog({
      title: `Expand into ${os.length} sessions?`,
      message: 'This replaces the repeating item with one separate session for each date. Cancelled dates are skipped.'
        + (l0.until ? '' : ' Because there is no end date, only the next 12 dates are created.'),
      confirmLabel: 'Expand',
    });
    if (!okGo) return;
    try {
      const newIds = [];
      for (const x of os) {
        const made = un(await apiPost(`/api/course-builder/sections/${s.id}/lessons`, {
          ...l0, id: undefined,
          title: l0.title + ' · ' + dl(x.d, l0.rep === 'twice' ? x.s : ''),
          when: x.d + 'T' + x.s, end: x.e || '', rep: '', until: '', t2s: '', t2e: '', ex: {},
        }));
        newIds.push(made.id);
      }
      await apiDelete(`/api/course-builder/lessons/${l0.id}`);
      // Splice the new sessions in at the old lesson's slot.
      const ids = s.lessons.map((x) => x.id);
      const at = ids.indexOf(l0.id);
      ids.splice(at, 1, ...newIds);
      await apiPost(`/api/course-builder/sections/${s.id}/lessons/reorder`, { order: ids });
      await reload();
      navigate(`${BASE}/courses/${c.id}/sections/${s.id}`);
      toast(newIds.length + ' sessions created');
    } catch { toast('Something went wrong'); }
  };

  const showDates = c.type === 'live' && edit && l0 && l0.rep && l0.when;
  const os = showDates ? occ(l0, l0.until ? 60 : 12) : [];

  return (
    <>
      <button className="back" onClick={back}>‹ {s.title}</button>
      <h1>{edit ? 'Edit content' : 'New content'}</h1>
      <p className="lead">
        In <button className="lnk" onClick={() => navigate(`${BASE}/courses/${c.id}`)}>{c.title}</button>
        {' › '}
        <button className="lnk" onClick={() => navigate(`${BASE}/courses/${c.id}/sections/${s.id}`)}>{s.title}</button>
      </p>
      <div className="form">
        <label>Title</label><input value={v.title} onChange={set('title')} />
        <label>Content type</label>
        <select value={v.type} onChange={set('type')}>
          {Object.keys(TY).filter((k) => c.type === 'live' || k !== 'live').map((k) => <option key={k} value={k}>{TY[k]}</option>)}
        </select>
        {c.type === 'live' && (
          <>
            <label>Starts (date and time)</label><input type="datetime-local" value={v.when} onChange={set('when')} />
            <label>Ends (time)</label><input type="time" value={v.end} onChange={set('end')} />
            <label>Repeats (optional)</label>
            <select value={v.rep} onChange={set('rep')}>{REPS.map((r) => <option key={r[0]} value={r[0]}>{r[1]}</option>)}</select>
            {v.rep && (
              <>
                {v.rep === 'twice' && (
                  <>
                    <label>Second session starts (time)</label><input type="time" value={v.t2s} onChange={set('t2s')} />
                    <label>Second session ends (time)</label><input type="time" value={v.t2e} onChange={set('t2e')} />
                  </>
                )}
                <label>Repeat until (optional)</label><input type="date" value={v.until} onChange={set('until')} />
              </>
            )}
            <label>Live platform</label>
            <select value={v.plat} onChange={set('plat')}>{PLATS.map((p) => <option key={p}>{p}</option>)}</select>
          </>
        )}
        <label>File (UI only, not uploaded)</label><input type="file" ref={fileRef} />
        <label>{c.type === 'live' ? 'Meeting link (Meet, Zoom or YouTube)' : 'Link, optional'}</label>
        <input value={v.src} onChange={set('src')} placeholder="https://" />
        <label>Size or duration</label><input value={v.meta} onChange={set('meta')} placeholder="1.6 MB or 18 min" />
        <label>Description</label><textarea rows={3} value={v.desc} onChange={set('desc')} />
        <label>Preview mode</label>
        <select value={v.free} onChange={set('free')}>
          <option value="">Off · enrolled students only</option>
          <option value="1">On · free preview for everyone</option>
        </select>
        <label>Preview image (optional)</label>
        {img ? <img src={img} alt="Preview" style={{ width: 120, borderRadius: 8, display: 'block', marginBottom: 6 }} /> : null}
        <input type="file" accept="image/*" onChange={onImg} />
        <div className="row" style={{ marginTop: 22 }}>
          <button className="btn p" onClick={save}>Save content</button>
          <button className="btn" onClick={back}>Cancel</button>
        </div>
      </div>

      {showDates ? (
        <div className="form" style={{ marginTop: 34 }}>
          <h2>Dates in this series</h2>
          <p className="lead" style={{ fontSize: 14 }}>
            {os.length} dates{l0.until ? '' : ' (no end date, showing the next 12)'}. Save the form above before changing individual dates.
          </p>
          {os.map((o) => {
            const x = eff(l0, o);
            return (
              <div className="ccd" key={o.key}>
                <div className="ct">
                  <b style={x.cancel ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                    {x.cancel ? dl(o.d, o.s, o.e) : dl(x.d, x.s, x.e)}
                  </b>
                  <span>{x.cancel ? 'Cancelled' : x.moved ? 'Rescheduled from ' + dl(o.d, o.s) : 'Scheduled'}</span>
                </div>
                <div className="mini">
                  {x.cancel ? (
                    <button onClick={() => setEx(o.key, null)}>Restore</button>
                  ) : (
                    <>
                      <button onClick={() => setResched({ key: o.key, d: x.d || o.d, s: x.s || o.s, e: x.e || '' })}>Reschedule</button>
                      <button onClick={() => setEx(o.key, { c: 1 })}>Cancel</button>
                    </>
                  )}
                  {x.moved && <button onClick={() => setEx(o.key, null)}>Reset</button>}
                </div>
              </div>
            );
          })}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={expand}>Expand into separate sessions</button>
          </div>
        </div>
      ) : null}
      {resched && (
        <RescheduleModal initial={resched} onClose={() => setResched(null)}
          onSubmit={(x) => { setResched(null); setEx(resched.key, x); }} />
      )}
    </>
  );
}

/* ── Content library ────────────────────────────────────────────────────── */
function Library() {
  const navigate = useNavigate();
  const { courses } = useCc();
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  if (!courses) return null;
  const rows = [];
  courses.forEach((c) => c.sections.forEach((s) => s.lessons.forEach((l) => rows.push({ c, s, l }))));
  const needle = q.toLowerCase();
  const r = rows.filter((x) => (!f || x.l.type === f) && (x.l.title + x.c.title).toLowerCase().includes(needle));
  return (
    <>
      <h1>Content library</h1>
      <p className="lead">Every content item across your courses.</p>
      <div className="tools">
        <SBox placeholder="Search content" q={q} setQ={setQ} />
        <select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.keys(TY).map((k) => <option key={k} value={k}>{TY[k]}</option>)}
        </select>
      </div>
      {r.length ? r.map((x) => (
        <div className="ccd" key={x.l.id}>
          <Thumb l={x.l} />
          <div className="ct">
            <b>{x.l.title}</b>
            {lessonLine(x.l, 'Preview')}
            <span style={{ display: 'block' }}>
              <button className="lnk" onClick={() => navigate(`${BASE}/courses/${x.c.id}`)}>{x.c.title}</button>
              {' › '}
              <button className="lnk" onClick={() => navigate(`${BASE}/courses/${x.c.id}/sections/${x.s.id}`)}>{x.s.title}</button>
            </span>
          </div>
          <div className="mini">
            <button onClick={() => navigate(`${BASE}/courses/${x.c.id}/sections/${x.s.id}/lessons/${x.l.id}?ret=library`)}>Edit</button>
          </div>
        </div>
      )) : <div className="empty">No content found.</div>}
    </>
  );
}

/* ── Review queue (admins only) ─────────────────────────────────────────── */
function ReviewQueue() {
  const navigate = useNavigate();
  const { courses, reload, toast, adm } = useCc();
  const [asking, setAsking] = useState(null); // course being sent back
  if (!courses) return null;
  if (!adm) return <Navigate to={`${BASE}/courses`} replace />;
  const queue = courses.filter((c) => c.status === 'review');
  const setStatus = async (id, v, note) => {
    try {
      await apiPost(`/api/course-builder/courses/${id}/status`, { status: v, ...(note !== undefined ? { note } : {}) });
      await reload();
      toast({ published: 'Published', draft: 'Moved to draft' }[v]);
    } catch { toast('Something went wrong'); }
  };
  return (
    <>
      <h1>Review queue</h1>
      <p className="lead">Courses instructors have submitted for approval.</p>
      {queue.length ? queue.map((c) => (
        <div className="ccd" key={c.id}>
          <div className="th" style={{ background: G[c.color], color: '#fff' }}>
            <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 9h8M8 13h8" /></svg>
          </div>
          <div className="ct"><b>{c.title}</b><span>by {c.owner || '?'} · {nL(c)} items</span></div>
          <div className="mini">
            <button onClick={() => navigate(`${BASE}/courses/${c.id}?tab=pub`)}>Open</button>
            <button onClick={() => setAsking(c)}>Changes</button>
            <button onClick={() => setStatus(c.id, 'published')}>Approve</button>
          </div>
        </div>
      )) : <div className="empty">Nothing to review right now.</div>}
      {asking && (
        <AskModal title="Request changes" label="Tell the instructor what to fix" textarea
          onClose={() => setAsking(null)}
          onSubmit={(t) => { const id = asking.id; setAsking(null); setStatus(id, 'draft', t); }} />
      )}
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
