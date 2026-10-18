/**
 * Program Courses — the admin section ported 1:1 from
 * reference/Kpemu Admin (1).html: Home (banner carousel, stats grid, quick
 * create, updates), Programs (list → detail → sections), Courses (list →
 * detail → contents), Contents (search + filters), and the three forms
 * (program / course / content). Live against /api/programmes, which
 * connected the Pharm.D catalogue as its first programme.
 *
 * Same UI, adopted to this console: the pages render inside the admin
 * PageLayout as a centred 720px column (the reference's own width), each
 * page is its own component (a URL shell that swapped hook counts crashed
 * renders once before — never again), and the reference's drawn SVGs are
 * kept as drawn SVGs.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../services/api.js';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
import './pc.css';

/* The API answers { success, data } — unwrap once, tolerate both shapes. */
const get = async (path) => {
  const r = await apiGet(path);
  return r && typeof r === 'object' && 'data' in r ? r.data : r;
};

/* ── The reference's vocabulary ─────────────────────────────────────────── */
export const G = [
  'linear-gradient(145deg,#ff6b52,#8a2c20)', 'linear-gradient(145deg,#6c3cff,#2d1b6e)',
  'linear-gradient(145deg,#14b8a0,#0b6b60)', 'linear-gradient(145deg,#4a8af0,#2652b5)',
  'linear-gradient(145deg,#ee4a73,#a11d45)', 'linear-gradient(145deg,#f0894a,#c0501a)',
];
export const TY = { pdf: 'PDF', video: 'Video', audio: 'Audio', note: 'Note', link: 'Link', slides: 'Slides' };
const IC = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  prog: 'M12 3 2 8l10 5 10-5-10-5zM6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5',
  course: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6',
  content: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
};
const I = ({ k }) => <svg viewBox="0 0 24 24"><path d={IC[k]} /></svg>;
const TI = {
  video: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" stroke="none" /></>,
  pdf: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  audio: <path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4" />,
  note: <path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  slides: <path d="M3 5h18v11H3zM8 21h8M12 16v5" />,
};

export const Chip = ({ s }) => <span className={`chip ${s === 'published' ? 'pub' : s === 'draft' ? 'dr' : ''}`}>{s}</span>;
/* Course tile: the cover image when one is set, the colour gradient when not. */
export const Tile = ({ c }) => (c.cover_url
  ? <div className="tile" style={{ backgroundImage: `url(${c.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} role="img" aria-label={c.code} />
  : <div className="tile" style={{ background: G[c.color || 0] }}>{(c.code || '').slice(0, 7)}</div>);
const timeAgo = (iso) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return 'last week';
  return `${Math.floor(d / 7)} weeks ago`;
};

/* ── Tiny data layer: fetch-on-mount with a reload handle ───────────────── */
const useData = (fetcher, deps) => {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    fetcher().then((d) => { if (on) setData(d); }).catch(() => { if (on) setData([]); });
    return () => { on = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setTick((t) => t + 1)];
};

export default function ProgramCoursesSection() {
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);
  const showToast = (m) => {
    setToast(m);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 1800);
  };
  const ctx = useMemo(() => ({ toast: showToast }), []);
  return (
    <PcCtx.Provider value={ctx}>
      <div className="pcroot">
        <Routes>
          <Route index element={<Home />} />
          <Route path="programs" element={<ProgramsList />} />
          <Route path="programs/new" element={<ProgramForm />} />
          <Route path="programs/:pid" element={<ProgramDetail />} />
          <Route path="programs/:pid/edit" element={<ProgramForm edit />} />
          <Route path="programs/:pid/sections/:sid" element={<SectionDetail />} />
          <Route path="courses" element={<CoursesList />} />
          <Route path="courses/new" element={<CourseForm />} />
          <Route path="courses/:cid" element={<CourseDetail />} />
          <Route path="courses/:cid/edit" element={<CourseForm edit />} />
          <Route path="contents" element={<ContentsList />} />
          <Route path="contents/new" element={<ItemForm />} />
          <Route path="contents/:mid/edit" element={<ItemForm edit />} />
          <Route path="*" element={<Home />} />
        </Routes>
        {toast && <div className="toast">{toast}</div>}
      </div>
    </PcCtx.Provider>
  );
}
const PcCtx = createContext({ toast: () => {} });
const usePc = () => useContext(PcCtx);

/* ── Home ───────────────────────────────────────────────────────────────── */
function Home() {
  const navigate = useNavigate();
  const { toast } = usePc();
  const [ov, reload] = useData(() => get('/api/programmes/overview'), []);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % 3), 5000);
    return () => clearInterval(t);
  }, []);

  if (!ov) return null;
  const pubI = ov.publishedMaterials ?? 0;
  const pctM = ov.materials ? Math.round((pubI / ov.materials) * 100) : 0;
  const pctC = ov.courses ? Math.round(((ov.publishedCourses ?? 0) / ov.courses) * 100) : 0;
  // Older API deployments returned the raw Supabase query result here
  // ({ data, error, ... }). Normalize both response shapes so a bad/stale
  // payload cannot crash the whole Program Courses page.
  const updates = Array.isArray(ov.log)
    ? ov.log
    : Array.isArray(ov.log?.data) ? ov.log.data : [];

  return (
    <>
      <h1>Home</h1>
      <p className="lead">Build programs, courses and learning content for the Kpemu student app.</p>

      <div className="banner">
        <div className="track" style={{ transform: `translateX(-${slide * 100}%)` }}>
          <div className="ad a1"><h3>Create once, publish everywhere</h3><p>Programs, courses and materials you publish appear in the student app automatically.</p><button className="try" onClick={() => navigate('programs/new')}>Create a program</button></div>
          <div className="ad a2"><h3>Add content to your courses</h3><p>Upload PDFs, videos, audio lessons and notes, then arrange them in order.</p><button className="try" onClick={() => navigate('/program-courses/contents')}>Open contents</button></div>
          <div className="ad a3"><h3>Preview before you publish</h3><p>Use Preview on any program or course to see what students will see.</p><button className="try" onClick={() => navigate('/program-courses/programs')}>View programs</button></div>
        </div>
        <div className="prog"><i key={slide} /></div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', margin: '-14px 0 8px', color: 'var(--muted)', fontSize: 13 }}>{slide + 1} of 3</div>

      <div className="grid">
        <div className="cell">
          <div className="lbl go" onClick={() => navigate('/program-courses/programs')}>Programs &rsaquo;</div>
          <div className="val">{ov.programs}</div>
          <svg className="chart" viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M0 32C30 31 60 28 90 22S140 14 198 8" fill="none" stroke="#6c3cff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>
        </div>
        <div className="cell">
          <div className="lbl go" onClick={() => navigate('/program-courses/courses')}>Courses &rsaquo;</div>
          <div className="val">{ov.courses}</div>
          <svg className="chart" viewBox="0 0 200 40" fill="#6d5ae6" preserveAspectRatio="none"><rect x="0" y="26" width="20" height="14" /><rect x="26" y="20" width="22" height="20" /><rect x="54" y="22" width="22" height="18" /><rect x="82" y="12" width="22" height="28" /><rect x="110" y="16" width="22" height="24" /><rect x="138" y="8" width="22" height="32" /><rect x="166" y="4" width="22" height="36" /></svg>
        </div>
        <div className="cell">
          <div className="lbl go" onClick={() => navigate('/program-courses/contents')}>Learning materials &rsaquo;</div>
          <div className="val">{ov.materials}</div>
          <svg className="chart" viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M0 34C25 30 40 20 60 24S100 30 120 18 170 8 198 6" fill="none" stroke="#14b8a6" strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>
        </div>
        <div className="cell">
          <div className="lbl">Published items</div>
          <div className="mr"><span>Materials</span><span>{pubI} / {ov.materials}</span></div>
          <div className="meter"><i style={{ width: `${pctM}%` }} /></div>
          <div className="mr"><span>Courses</span><span>{ov.publishedCourses ?? 0} / {ov.courses}</span></div>
          <div className="meter"><i style={{ width: `${pctC}%` }} /></div>
        </div>
        <div className="cell">
          <div className="lbl">Drafts to review</div>
          <div className="val">{ov.drafts}</div>
          <button className="btn" onClick={() => navigate('/program-courses/contents?status=draft')}>Review drafts</button>
        </div>
        <div className="cell">
          <div className="lbl">Instructors</div>
          <div className="val">{ov.instructors}</div>
          <button className="btn" onClick={() => navigate('/program-courses/courses/new')}><I k="plus" />Add course</button>
        </div>
      </div>

      <section className="sec">
        <h2>Quick create</h2>
        <div className="cards">
          <button className="card dark" onClick={() => navigate('/program-courses/programs/new')}><span className="ci"><I k="prog" /></span><b>New program</b><span className="d">Start with a name, code and duration.</span></button>
          <button className="card" onClick={() => navigate('/program-courses/courses/new')}><span className="ci"><I k="course" /></span><b>New course</b><span className="d">Add a course to a program and academic year.</span></button>
          <button className="card" onClick={() => navigate('/program-courses/contents/new')}><span className="ci"><I k="content" /></span><b>New content</b><span className="d">Add a PDF, video, audio lesson or note.</span></button>
          <button className="card" onClick={() => { navigate('/program-courses/programs'); toast('Open a program to preview it as students see it'); }}><span className="ci"><I k="info" /></span><b>Student preview</b><span className="d">Open a program to preview it as students see it.</span></button>
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 18 }}>Updates</h2>
        {updates.map((l) => (
          <div className="item" key={l.id}>
            <div className="ico"><I k="info" /></div>
            <div>
              <small>{timeAgo(l.created_at)}</small>
              <b>{l.headline}</b>
              <p>{l.detail}</p>
            </div>
          </div>
        ))}
        {updates.length === 0 && <p className="lead">Nothing yet — create something and it will show up here.</p>}
      </section>
      {reload ? null : null}
    </>
  );
}

/* ── Programs list ──────────────────────────────────────────────────────── */
export function SBox({ placeholder, q, setQ }) {
  return (
    <div className="sbox">
      <I k="search" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
      {q ? <button className="sx" onClick={() => setQ('')} aria-label="Clear search">&times;</button> : null}
    </div>
  );
}

function ProgramsList() {
  const navigate = useNavigate();
  const [programs, reload] = useData(() => get('/api/programmes/programs'), []);
  const [q, setQ] = useState('');
  if (!programs) return null;
  const l = programs.filter((p) => `${p.name}${p.code || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="row">
        <div><h1>Programs</h1><p className="lead" style={{ margin: '0 0 18px' }}>Academic programs that hold your courses.</p></div>
        <span className="sp" />
        <button className="btn p" onClick={() => navigate('/program-courses/programs/new')}><I k="plus" />New program</button>
      </div>
      <div className="tools"><SBox placeholder="Search programs" q={q} setQ={setQ} /></div>
      {l.length ? (
        <div className="list">
          {l.map((p) => (
            <div className="li click" key={p.id} onClick={() => navigate(`/program-courses/programs/${p.id}`)}>
              {p.cover_url
                ? <div className="thumb" style={{ backgroundImage: `url(${p.cover_url})` }} />
                : <div className="ico"><I k="prog" /></div>}
              <div className="t"><b>{p.name}</b><span>{p.code || 'No code'} · {p.course_count} courses · {p.duration_label || '—'}</span></div>
              <Chip s={p.status} />
            </div>
          ))}
        </div>
      ) : <div className="empty">No programs yet. Create your first program.</div>}
      {reload ? null : null}
    </>
  );
}

/* ── A small styled modal — the prototype's dialog pattern ─────────────── */
function NameModal({ title, label, initial = '', confirmLabel = 'Save', placeholder = '', onClose, onSubmit }) {
  const [name, setName] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const submit = () => {
    const v = name.trim();
    if (v) onSubmit(v);
  };
  return (
    <div className="mroot" onClick={onClose} role="presentation">
      <div className="mcard" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <label>{label}</label>
        <input
          ref={ref}
          value={name}
          placeholder={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={!name.trim()} onClick={submit}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Program detail (+ sections) ────────────────────────────────────────── */
function ProgramDetail() {
  const { pid } = useParams();
  const navigate = useNavigate();
  const { toast } = usePc();
  const [p, reload] = useData(() => get(`/api/programmes/programs/${pid}`), [pid]);
  const [ro, setRo] = useState(false);
  const [dragI, setDragI] = useState(null);
  // Section add/rename runs through the styled modal, never a browser prompt.
  const [modal, setModal] = useState(null); // null | { mode: 'add' } | { mode: 'rename', section }

  if (!p) return null;
  const sections = p.sections ?? [];

  const toggle = async () => {
    await apiPost(`/api/programmes/programs/${p.id}/${p.status === 'published' ? 'unpublish' : 'publish'}`);
    toast(p.status === 'published' ? 'Program unpublished' : 'Program published');
    reload();
  };
  const del = async () => {
    if (!await confirmDialog({ message: `Delete “${p.name}”? This removes its sections, courses and content and cannot be undone.`, danger: true })) return;
    await apiDelete(`/api/programmes/programs/${p.id}`);
    toast('Program deleted');
    navigate('/program-courses/programs');
  };
  const saveModal = async (name) => {
    if (modal?.mode === 'rename') {
      if (name === modal.section.name) { setModal(null); return; }
      await apiPatch(`/api/programmes/sections/${modal.section.id}`, { name });
      toast('Section renamed');
    } else {
      await apiPost(`/api/programmes/programs/${p.id}/sections`, { name });
      toast('Section added');
    }
    setModal(null);
    reload();
  };
  const delSection = async (s) => {
    if (!await confirmDialog({ message: `Delete section “${s.name}”?${s.course_count ? ` Its ${s.course_count} course(s) go with it.` : ''}`, danger: true })) return;
    await apiDelete(`/api/programmes/sections/${s.id}`);
    reload();
  };
  const moveSection = async (i, dir) => {
    const order = sections.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await apiPost(`/api/programmes/programs/${p.id}/sections/reorder`, { order });
    reload();
  };
  const dropSection = async (i) => {
    if (dragI == null || dragI === i) return;
    const order = sections.map((s) => s.id);
    const [m] = order.splice(dragI, 1);
    order.splice(i, 0, m);
    setDragI(null);
    await apiPost(`/api/programmes/programs/${p.id}/sections/reorder`, { order });
    reload();
  };

  return (
    <>
      <button className="back" onClick={() => navigate('/program-courses/programs')}>&lsaquo; Programs</button>
      {p.cover_url && <div className="phero" style={{ backgroundImage: `url(${p.cover_url})` }} />}
      <div className="row"><h1>{p.name}</h1><Chip s={p.status} /></div>
      <p className="lead" style={{ marginBottom: 14 }}>{p.description || ''}{p.description && p.duration_label ? ' · ' : ''}{p.duration_label || ''}</p>
      <div className="row" style={{ marginBottom: 26 }}>
        <button className="btn p" onClick={() => setModal({ mode: 'add' })}><I k="plus" />Add section</button>
        <button className="btn" onClick={() => navigate(`/program-courses/programs/${p.id}/edit`)}>Edit</button>
        <button className="btn" onClick={() => toast(`${p.name} — students see ${sections.length} section(s) and ${(sections ?? []).reduce((n, s) => n + s.course_count, 0)} course(s)`)}>Preview</button>
        <button className="btn" onClick={toggle}>{p.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        <button className="btn d" onClick={del}>Delete</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2>Sections</h2><span className="chip">{sections.length}</span><span className="sp" />
        {sections.length > 1 && <button className={`btn${ro ? ' p' : ''}`} onClick={() => setRo((r) => !r)}>{ro ? 'Done' : 'Reorder'}</button>}
      </div>
      {sections.length ? (
        <div className="sgrid">
          {sections.map((s, i) => (
            <div
              className="scard"
              key={s.id}
              draggable={ro}
              onDragStart={() => setDragI(i)}
              onDragOver={(e) => ro && e.preventDefault()}
              onDrop={() => dropSection(i)}
              onClick={() => !ro && navigate(`/program-courses/programs/${p.id}/sections/${s.id}`)}
            >
              <span className="ci"><I k="course" /></span>
              <b>{s.name}</b>
              <span className="d">{s.course_count} {s.course_count === 1 ? 'course' : 'courses'}</span>
              {ro && (
                <div className="mini sarr">
                  <button disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveSection(i, -1); }} aria-label="Move up">&#8593;</button>
                  <button disabled={i === sections.length - 1} onClick={(e) => { e.stopPropagation(); moveSection(i, 1); }} aria-label="Move down">&#8595;</button>
                </div>
              )}
              {!ro && (
                <div className="mini sarr">
                  <button onClick={(e) => { e.stopPropagation(); setModal({ mode: 'rename', section: s }); }}>Rename</button>
                  <button className="d" onClick={(e) => { e.stopPropagation(); delSection(s); }} style={{ color: '#d6336c' }}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <div className="empty">No sections yet. Add a section to start adding courses.</div>}

      {modal && (
        <NameModal
          title={modal.mode === 'rename' ? 'Rename section' : 'Add section'}
          label="Section name"
          initial={modal.mode === 'rename' ? modal.section.name : ''}
          confirmLabel={modal.mode === 'rename' ? 'Save' : 'Add section'}
          placeholder="Past knowledge"
          onClose={() => setModal(null)}
          onSubmit={saveModal}
        />
      )}
    </>
  );
}

/* ── Section detail (a year inside a programme) ─────────────────────────── */
function SectionDetail() {
  const { pid, sid } = useParams();
  const navigate = useNavigate();
  const [p] = useData(() => get(`/api/programmes/programs/${pid}`), [pid]);
  const [courses] = useData(() => get('/api/programmes/courses'), []);
  const [ro, setRo] = useState(false);

  const section = p?.sections?.find((s) => s.id === sid);
  const cs = useMemo(
    () => (courses ?? []).filter((c) => c.section_id === sid),
    [courses, sid],
  );
  if (!p || !courses) return null;
  if (!section) return <div className="empty">That section no longer exists.</div>;

  return (
    <>
      <button className="back" onClick={() => navigate(`/program-courses/programs/${pid}`)}>&lsaquo; {p.name}</button>
      <h1>{section.name}</h1>
      <p className="lead" style={{ marginBottom: 14 }}>{p.name}</p>
      <div className="row" style={{ marginBottom: 26 }}>
        <button className="btn p" onClick={() => navigate(`/program-courses/courses/new?program=${p.id}&section=${section.id}`)}><I k="plus" />Add course</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2>Courses</h2><span className="chip">{cs.length}</span><span className="sp" />
        {cs.length > 1 && <button className={`btn${ro ? ' p' : ''}`} onClick={() => setRo((r) => !r)}>{ro ? 'Done' : 'Reorder'}</button>}
      </div>
      {cs.length ? (
        <div className="cgrid">
          {cs.map((c, i) => (
            <div
              className="ccard"
              key={c.id}
              draggable={ro}
              onClick={() => !ro && navigate(`/program-courses/courses/${c.id}`)}
            >
              <div
                className="cban"
                style={c.cover_url
                  ? { backgroundImage: `url(${c.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: G[c.color || 0] }}
              >{c.cover_url ? '' : c.code}</div>
              <div className="cbody">
                <b>{c.title || c.code}</b>
                <span>by {c.instructor || '—'} · {c.materials_count} topics</span>
                <div style={{ marginTop: 6 }}><Chip s={c.status} /></div>
              </div>
              {ro && (
                <div className="mini cact">
                  <button
                    disabled={i === 0}
                    onClick={async (e) => { e.stopPropagation(); await apiPost(`/api/programmes/courses/${c.id}/move`, { dir: 'up' }); window.location.reload(); }}
                    aria-label="Move up"
                  >&#8593;</button>
                  <button
                    disabled={i === cs.length - 1}
                    onClick={async (e) => { e.stopPropagation(); await apiPost(`/api/programmes/courses/${c.id}/move`, { dir: 'down' }); window.location.reload(); }}
                    aria-label="Move down"
                  >&#8595;</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <div className="empty">No courses here yet. Add a course to start.</div>}
    </>
  );
}

/* ── Courses list (all programmes) ──────────────────────────────────────── */
function CoursesList() {
  const navigate = useNavigate();
  const [courses] = useData(() => get('/api/programmes/courses'), []);
  const [programs] = useData(() => get('/api/programmes/programs'), []);
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  if (!courses || !programs) return null;
  const l = courses.filter((c) => (!f || c.programme_id === f) && `${c.code}${c.title ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="row">
        <div><h1>Courses</h1><p className="lead" style={{ margin: '0 0 18px' }}>Every course across all programs.</p></div>
        <span className="sp" />
        <button className="btn p" onClick={() => navigate('/program-courses/courses/new')}><I k="plus" />New course</button>
      </div>
      <div className="tools">
        <SBox placeholder="Search courses" q={q} setQ={setQ} />
        <select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by program">
          <option value="">All programs</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {l.length ? (
        <div className="list">
          {l.map((c) => (
            <div className="li click" key={c.id} onClick={() => navigate(`/program-courses/courses/${c.id}`)}>
              <Tile c={c} />
              <div className="t"><b>{c.code} · {c.title || c.code}</b><span>{c.programme_name} · {c.section_name} · {c.materials_count} topics</span></div>
              <Chip s={c.status} />
            </div>
          ))}
        </div>
      ) : <div className="empty">No courses match. Add a course to get started.</div>}
    </>
  );
}

/* ── Course detail (+ contents) ─────────────────────────────────────────── */
function CourseDetail() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const { toast } = usePc();
  const [c, reload] = useData(() => get(`/api/programmes/courses/${cid}`), [cid]);
  const [ro, setRo] = useState(false);
  const [menu, setMenu] = useState(null);

  if (!c) return null;
  const its = c.materials ?? [];

  const toggle = async () => {
    await apiPatch(`/api/programmes/courses/${c.id}`, { status: c.status === 'published' ? 'draft' : 'published' });
    toast(c.status === 'published' ? 'Course unpublished' : 'Course published');
    reload();
  };
  const del = async () => {
    if (!await confirmDialog({ message: `Delete “${c.code}”? Its content goes with it and cannot be undone.`, danger: true })) return;
    await apiDelete(`/api/programmes/courses/${c.id}`);
    toast('Course deleted');
    navigate('/program-courses/courses');
  };
  const delItem = async (m) => {
    if (!await confirmDialog({ message: `Delete “${m.title}”?`, danger: true })) return;
    await apiDelete(`/api/programmes/materials/${m.id}`);
    setMenu(null);
    toast('Content deleted');
    reload();
  };
  const moveItem = async (m, dir) => {
    await apiPost(`/api/programmes/materials/${m.id}/move`, { dir });
    reload();
  };

  return (
    <>
      <button className="back" onClick={() => navigate('/program-courses/courses')}>&lsaquo; Courses</button>
      <div className="row" style={{ marginBottom: 6 }}><Tile c={c} /><div><h1 style={{ margin: 0 }}>{c.code}</h1></div><Chip s={c.status} /></div>
      <p className="lead" style={{ marginBottom: 14 }}>{c.title || c.code} · {c.programme?.name} · {c.section?.name} · by {c.instructor || '—'}</p>
      <div className="row" style={{ marginBottom: 26 }}>
        <button className="btn p" onClick={() => navigate(`/program-courses/contents/new?course=${c.id}`)}><I k="plus" />Add content</button>
        <button className="btn" onClick={() => navigate(`/program-courses/courses/${c.id}/edit`)}>Edit</button>
        <button className="btn" onClick={() => toast(`${c.code} — ${its.length} item(s), ${its.filter((x) => x.status === 'published').length} published`)}>Preview</button>
        <button className="btn" onClick={toggle}>{c.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        <button className="btn d" onClick={del}>Delete</button>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2>Course contents</h2><span className="chip">{its.length} items</span><span className="sp" />
        {its.length > 1 && <button className={`btn${ro ? ' p' : ''}`} onClick={() => setRo((r) => !r)}>{ro ? 'Done' : 'Reorder'}</button>}
      </div>
      {its.length ? (
        <div className="clist">
          {its.map((m, n) => (
            <div className="ccd" key={m.id} draggable={ro}>
              <div className="cth">
                <div className="th" style={m.thumb_url ? { backgroundImage: `url(${m.thumb_url})` } : undefined}>
                  {m.thumb_url && m.type !== 'video' ? null : <svg viewBox="0 0 24 24" className="tic">{TI[m.type]}</svg>}
                </div>
                <span className="cnb">{n + 1}</span>
              </div>
              <div className="cct">
                <b>{m.title}</b>
                <span><em>{TY[m.type]}</em>{m.meta ? ` · ${m.meta}` : ''} · {m.status === 'published' ? 'Published' : 'Draft'}</span>
              </div>
              {ro ? (
                <div className="mini">
                  <button className="rb" disabled={n === 0} onClick={() => moveItem(m, 'up')} aria-label="Move up">&#8593;</button>
                  <button className="rb" disabled={n === its.length - 1} onClick={() => moveItem(m, 'down')} aria-label="Move down">&#8595;</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <button className="cm" onClick={() => setMenu(menu === m.id ? null : m.id)} aria-label="More actions">
                    <svg viewBox="0 0 24 24"><path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth="3" /></svg>
                  </button>
                  {menu === m.id && (
                    <div className="menu" style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, zIndex: 30, minWidth: 140 }}>
                      <button onClick={() => { setMenu(null); navigate(`/program-courses/contents/${m.id}/edit`); }}>Edit</button>
                      <button onClick={() => delItem(m)} className="d">Delete</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <div className="empty">No materials yet. Add a PDF, video, audio lesson or note.</div>}
    </>
  );
}

/* ── Contents list (all programmes, search + filters) ───────────────────── */
function ContentsList() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [materials] = useData(() => get('/api/programmes/materials'), []);
  const [q, setQ] = useState('');
  const [ty, setTy] = useState('');
  const [f, setF] = useState(sp.get('status') || '');
  const [menu, setMenu] = useState(null);
  const { toast } = usePc();
  if (!materials) return null;
  const l = materials
    .filter((m) => (!ty || m.type === ty) && (!f || m.status === f) && m.title.toLowerCase().includes(q.toLowerCase()));

  const del = async (m) => {
    if (!await confirmDialog({ message: `Delete “${m.title}”?`, danger: true })) return;
    await apiDelete(`/api/programmes/materials/${m.id}`);
    setMenu(null);
    toast('Content deleted');
    window.location.reload();
  };

  return (
    <>
      <div className="row">
        <div><h1>Contents</h1><p className="lead" style={{ margin: '0 0 18px' }}>Every learning material, across every course.</p></div>
        <span className="sp" />
        <button className="btn p" onClick={() => navigate('/program-courses/contents/new')}><I k="plus" />New content</button>
      </div>
      <div className="tools">
        <SBox placeholder="Search contents" q={q} setQ={setQ} />
        <select value={ty} onChange={(e) => setTy(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.keys(TY).map((k) => <option key={k} value={k}>{TY[k]}</option>)}
        </select>
        <select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by status">
          <option value="">All</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>
      {l.length ? (
        <div>
          {l.map((m) => (
            <div className="ccd" key={m.id}>
              <div className="cth">
                <div className="th" style={m.thumb_url ? { backgroundImage: `url(${m.thumb_url})` } : undefined}>
                  {m.thumb_url && m.type !== 'video' ? null : <svg viewBox="0 0 24 24" className="tic">{TI[m.type]}</svg>}
                </div>
              </div>
              <div className="cct">
                <b>{m.title}</b>
                <span><em>{TY[m.type]}</em>{m.meta ? ` · ${m.meta}` : ''} · {m.status === 'published' ? 'Published' : 'Draft'}</span>
                <span>{m.course_code ? `${m.course_code} · ${m.programme_name}` : 'No course'}</span>
              </div>
              <div style={{ position: 'relative' }}>
                <button className="cm" onClick={() => setMenu(menu === m.id ? null : m.id)} aria-label="More actions">
                  <svg viewBox="0 0 24 24"><path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth="3" /></svg>
                </button>
                {menu === m.id && (
                  <div className="menu" style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, zIndex: 30, minWidth: 140 }}>
                    <button onClick={() => { setMenu(null); navigate(`/program-courses/contents/${m.id}/edit`); }}>Edit</button>
                    <button onClick={() => del(m)} className="d">Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="empty">No contents match. Add a learning material to get started.</div>}
    </>
  );
}

/* ── Image shrinking — the reference's client-side preview pipeline ─────── */
const shrink = (file, max, cb) => {
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      const w = Math.min(max, im.width);
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round((im.height * w) / im.width);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.8));
    };
    im.onerror = () => cb(null);
    im.src = r.result;
  };
  r.readAsDataURL(file);
};

/* ── Program form ───────────────────────────────────────────────────────── */
function ProgramForm({ edit = false }) {
  const { pid } = useParams();
  const navigate = useNavigate();
  const { toast } = usePc();
  const [p] = useData(() => (edit ? get(`/api/programmes/programs/${pid}`) : Promise.resolve(null)), [edit, pid]);
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  useEffect(() => { if (edit && p) setCover(p.cover_url || null); }, [edit, p]);

  const pickCover = (files) => { if (files?.[0]) shrink(files[0], 900, (d) => { if (d) setCover(d); else toast('Choose an image file'); }); };
  const val = (k) => formRef.current?.querySelector(`[data-k=${k}]`)?.value.trim() ?? '';

  const save = async () => {
    const body = {
      name: val('name'), code: val('code'), description: val('desc'),
      duration_label: val('duration'), years: val('years'), status: val('status'), cover_url: cover,
    };
    if (!body.name) { toast('Give the program a name'); return; }
    setBusy(true);
    try {
      if (edit) await apiPatch(`/api/programmes/programs/${pid}`, body);
      else await apiPost('/api/programmes/programs', body);
      toast(edit ? 'Changes saved' : 'Program created');
      navigate(edit ? `/program-courses/programs/${pid}` : '/program-courses/programs');
    } catch (e) { toast(e.message || 'Could not save'); } finally { setBusy(false); }
  };

  return (
    <>
      <button className="back" onClick={() => navigate(edit ? `/program-courses/programs/${pid}` : '/program-courses/programs')}>&lsaquo; {edit ? 'Program' : 'Programs'}</button>
      <div className="row" style={{ marginBottom: 18 }}>
        <div><h1 style={{ margin: 0 }}>{edit ? 'Edit program' : 'New program'}</h1><p className="lead" style={{ margin: '6px 0 0' }}>{edit ? 'Update the details students see for this program.' : 'Add the details for this program. You can add courses after saving.'}</p></div>
        <span className="sp" />
        <button className="btn p" disabled={busy || (edit && !p)} onClick={save}>{edit ? 'Save changes' : 'Create program'}</button>
      </div>
      <div className="form" ref={formRef}>
        <label>Cover image</label>
        <div className="cover" onClick={() => document.getElementById('pc-cvf')?.click()}>
          {cover ? (
            <>
              <img alt="Cover preview" src={cover} />
              <div className="cvact">
                <button className="btn" onClick={(e) => { e.stopPropagation(); document.getElementById('pc-cvf')?.click(); }}>Replace</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); setCover(null); }}>Remove</button>
              </div>
            </>
          ) : (
            <div><I k="plus" />Add cover image<br /><span style={{ fontSize: 11 }}>JPG or PNG, wide images work best</span></div>
          )}
        </div>
        <input type="file" id="pc-cvf" accept="image/*" hidden onChange={(e) => pickCover(e.target.files)} />
        <label>Program name</label><input data-k="name" defaultValue={edit ? p?.name : ''} placeholder="Pharm.D" />
        <label>Program code</label><input data-k="code" defaultValue={edit ? p?.code ?? '' : ''} placeholder="PHARMD" />
        <label>Description</label><textarea rows="3" data-k="desc" defaultValue={edit ? p?.description ?? '' : ''} placeholder="Doctor of Pharmacy" />
        <label>Duration</label><input data-k="duration" defaultValue={edit ? p?.duration_label ?? '' : ''} placeholder="6 years" />
        <label>Sections (separate with commas)</label>
        <input data-k="years" defaultValue={edit ? (p?.sections ?? []).map((s) => s.name).join(', ') : 'First Year, Second Year'} />
        <label>Status</label>
        <select data-k="status" defaultValue={edit ? p?.status ?? 'draft' : 'draft'}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <div className="row">
          <button className="btn p" disabled={busy || (edit && !p)} onClick={save}>{edit ? 'Save changes' : 'Create program'}</button>
          <button className="btn" onClick={() => navigate(edit ? `/program-courses/programs/${pid}` : '/program-courses/programs')}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/* ── Course form ────────────────────────────────────────────────────────── */
function CourseForm({ edit = false }) {
  const { cid } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = usePc();
  const [programs] = useData(() => get('/api/programmes/programs'), []);
  const [c, setC] = useState(edit ? null : { color: 0 });
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    if (edit && cid) get(`/api/programmes/courses/${cid}`).then(setC).catch(() => setC(null));
  }, [edit, cid]);
  useEffect(() => { if (edit && c) setCover(c.cover_url || null); }, [edit, c]);

  const pickCover = (files) => { if (files?.[0]) shrink(files[0], 900, (d) => { if (d) setCover(d); else toast('Choose an image file'); }); };

  if (!programs || (edit && !c)) return null;
  const sections = (pid2) => programs.find((p) => p.id === pid2)?.programme_sections ?? [];
  const pid = formRef.current?.querySelector('[data-k=pid]')?.value || c?.programme_id || sp.get('program') || programs[0]?.id;
  const years = sections(pid);
  const yr = formRef.current?.querySelector('[data-k=year]')?.value || c?.section_id || sp.get('section') || years[0]?.id || '';
  const col = c?.color ?? 0;

  const save = async () => {
    const v = (k) => formRef.current?.querySelector(`[data-k=${k}]`)?.value.trim() ?? '';
    const body = { programme_id: v('pid'), section_id: v('year'), code: v('code'), title: v('title'), instructor: v('inst'), color: col, status: v('status'), cover_url: cover };
    if (!body.code) { toast('Give the course a code'); return; }
    setBusy(true);
    try {
      if (edit) await apiPatch(`/api/programmes/courses/${cid}`, body);
      else await apiPost('/api/programmes/courses', body);
      toast(edit ? 'Changes saved' : 'Course created');
      navigate(edit ? `/program-courses/courses/${cid}` : '/program-courses/courses');
    } catch (e) { toast(e.message || 'Could not save'); } finally { setBusy(false); }
  };

  return (
    <>
      <button className="back" onClick={() => navigate(edit ? `/program-courses/courses/${cid}` : '/program-courses/courses')}>&lsaquo; Back</button>
      <div className="row" style={{ marginBottom: 18 }}>
        <div><h1 style={{ margin: 0 }}>{edit ? 'Edit course' : 'New course'}</h1><p className="lead" style={{ margin: '6px 0 0' }}>{edit ? 'Update the details students see for this course.' : 'Add a course to a program and section. You can add content after saving.'}</p></div>
        <span className="sp" />
        <button className="btn p" disabled={busy} onClick={save}>{edit ? 'Save changes' : 'Create course'}</button>
      </div>
      <div className="form" ref={formRef}>
        <label>Cover image</label>
        <div className="cover" onClick={() => document.getElementById('pc-ccvf')?.click()}>
          {cover ? (
            <>
              <img alt="Cover preview" src={cover} />
              <div className="cvact">
                <button className="btn" onClick={(e) => { e.stopPropagation(); document.getElementById('pc-ccvf')?.click(); }}>Replace</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); setCover(null); }}>Remove</button>
              </div>
            </>
          ) : (
            <div><I k="plus" />Add cover image<br /><span style={{ fontSize: 11 }}>Optional — without one, students see the card colour below</span></div>
          )}
        </div>
        <input type="file" id="pc-ccvf" accept="image/*" hidden onChange={(e) => pickCover(e.target.files)} />
        <label>Program</label>
        <select data-k="pid" defaultValue={pid}>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label>Course code</label><input data-k="code" defaultValue={c?.code ?? ''} placeholder="BIO 111" />
        <label>Course title</label><input data-k="title" defaultValue={c?.title ?? ''} placeholder="General Biology" />
        <label>Section</label>
        <select data-k="year" defaultValue={yr} key={`${pid}-${years.length}`}>
          {years.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>Instructor</label><input data-k="inst" defaultValue={c?.instructor ?? ''} placeholder="Akoro" />
        <label>Card color</label>
        <div className="sw">
          {G.map((g, i) => (
            <i key={i} style={{ background: g }} className={i === col ? 'on' : ''} onClick={() => setC({ ...c, color: i })} />
          ))}
        </div>
        <label>Status</label>
        <select data-k="status" defaultValue={c?.status === 'published' ? 'published' : 'draft'}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <div className="row">
          <button className="btn p" disabled={busy} onClick={save}>{edit ? 'Save changes' : 'Create course'}</button>
          <button className="btn" onClick={() => navigate(edit ? `/program-courses/courses/${cid}` : '/program-courses/courses')}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/* ── Content (material) form ────────────────────────────────────────────── */
function ItemForm({ edit = false }) {
  const { mid } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = usePc();
  const [courses] = useData(() => get('/api/programmes/courses'), []);
  const [m, setM] = useState(edit ? null : { type: 'pdf' });
  const [thumb, setThumb] = useState(null);
  const [fileLabel, setFileLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    if (edit && mid) get('/api/programmes/materials').then((all) => {
      setM((all ?? []).find((x) => x.id === mid) ?? null);
    }).catch(() => setM(null));
  }, [edit, mid]);
  useEffect(() => { if (edit && m) setThumb(m.thumb_url || null); }, [edit, m]);

  if (!courses || (edit && !m)) return null;
  const cid = formRef.current?.querySelector('[data-k=cid]')?.value || m?.course_id || sp.get('course') || courses[0]?.id;

  const save = async () => {
    const v = (k) => formRef.current?.querySelector(`[data-k=${k}]`)?.value.trim() ?? '';
    const body = { course_id: v('cid'), title: v('title'), type: v('type'), meta: v('meta'), url: v('url'), thumb_url: thumb, status: v('status') };
    if (!body.title) { toast('Give the content a title'); return; }
    setBusy(true);
    try {
      if (edit) await apiPatch(`/api/programmes/materials/${mid}`, body);
      else await apiPost('/api/programmes/materials', body);
      toast(edit ? 'Changes saved' : 'Content added');
      navigate(sp.get('course') ? `/program-courses/courses/${sp.get('course')}` : '/program-courses/contents');
    } catch (e) { toast(e.message || 'Could not save'); } finally { setBusy(false); }
  };

  return (
    <>
      <button className="back" onClick={() => navigate(sp.get('course') ? `/program-courses/courses/${sp.get('course')}` : '/program-courses/contents')}>&lsaquo; Back</button>
      <div className="row" style={{ marginBottom: 18 }}>
        <div><h1 style={{ margin: 0 }}>{edit ? 'Edit content' : 'New content'}</h1><p className="lead" style={{ margin: '6px 0 0' }}>{edit ? 'Update this learning material.' : 'Add a PDF, video, audio lesson, note, link or presentation to a course.'}</p></div>
        <span className="sp" />
        <button className="btn p" disabled={busy} onClick={save}>{edit ? 'Save changes' : 'Add content'}</button>
      </div>
      <div className="form" ref={formRef}>
        <label>Course</label>
        <select data-k="cid" defaultValue={cid}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.programme_name}</option>)}
        </select>
        <label>Title</label><input data-k="title" defaultValue={m?.title ?? ''} placeholder="Cell Structure and Organization" />
        <label>Content type</label>
        <select data-k="type" defaultValue={m?.type ?? 'pdf'}>
          {Object.keys(TY).map((k) => <option key={k} value={k}>{TY[k]}</option>)}
        </select>
        <label>Size or duration</label><input data-k="meta" defaultValue={m?.meta ?? ''} placeholder="1.6 MB or 18 min" />
        <label>Resource URL</label>
        <input data-k="url" type="url" defaultValue={m?.url ?? ''} placeholder="https://… — students open this link" />
        <label>File</label>
        <div className="drop" onClick={() => document.getElementById('pc-ifl')?.click()}>
          {fileLabel || 'Choose a file (UI only — files are not uploaded yet; paste a resource URL above instead)'}
        </div>
        <input
          type="file" id="pc-ifl" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFileLabel(`${f.name} (${(f.size / 1048576).toFixed(1)} MB)`);
          }}
        />
        <label>Preview image (optional)</label>
        <div className="cover" onClick={() => document.getElementById('pc-tfl')?.click()}>
          {thumb ? (
            <>
              <img alt="Preview" src={thumb} />
              <div className="cvact">
                <button className="btn" onClick={(e) => { e.stopPropagation(); document.getElementById('pc-tfl')?.click(); }}>Replace</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); setThumb(null); }}>Remove</button>
              </div>
            </>
          ) : <div><I k="plus" />Add preview image</div>}
        </div>
        <input
          type="file" id="pc-tfl" accept="image/*" hidden
          onChange={(e) => { if (e.target.files?.[0]) shrink(e.target.files[0], 480, (d) => { if (d) setThumb(d); else toast('Choose an image file'); }); }}
        />
        <label>Status</label>
        <select data-k="status" defaultValue={m?.status === 'published' ? 'published' : 'draft'}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <div className="row">
          <button className="btn p" disabled={busy} onClick={save}>{edit ? 'Save changes' : 'Add content'}</button>
          <button className="btn" onClick={() => navigate(sp.get('course') ? `/program-courses/courses/${sp.get('course')}` : '/program-courses/contents')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
