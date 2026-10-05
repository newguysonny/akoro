/**
 * PharmDProgram.jsx
 * ─────────────────────────────────────────────────────────────
 * The PHARM.D discovery experience, ported 1:1 from
 * reference/pharm D discovery and course page.md. Three views —
 * the programme browse (hero + year rows of course cards), the
 * course folder (art, author, action row, topic list) and the
 * topic content reader (breadcrumb, body, prev/next) — plus the
 * course/topic action sheet.
 *
 * Layout and visuals are the reference's, unchanged; only the chrome
 * colours moved onto the app's --ak-* theme tokens so the pages
 * follow the app's light/dark theme, and the reference's 430px phone
 * column centres itself on tablet/desktop (mobile is full-bleed).
 *
 * Mounted full-screen by DiscoverHub when the Pharm D card opens;
 * the browse view's back button closes back to the Discover hub.
 * Content is the reference's placeholder syllabus (pharmdData.js).
 */
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../constants.js';
import Toast from '../common/Toast.jsx';
import { Icon } from '../common/Icons.jsx';
import { PROGRAM, AUTHOR, topicsFor, accentFor, readsFor } from './pharmdData.js';

/* The reference's done-green — a content colour, theme-independent. */
const GREEN = '#2BB673';

/* Sheet menus (reference sheetActionsFor). */
const SHEET_ACTIONS = {
  topic: [
    ['ti-share', 'Share'], ['ti-bookmark-plus', 'Add to Library'], ['ti-download', 'Download'],
    ['ti-check', 'Mark as complete'], ['ti-book-2', 'Go to course'],
  ],
  course: [
    ['ti-share', 'Share'], ['ti-bookmark-plus', 'Add to Library'], ['ti-download', 'Download all topics'],
    ['ti-user', 'Go to creator'], ['ti-school', 'Go to program'],
  ],
};

export default function PharmDProgram({ onClose }) {
  const [view, setView] = useState('browse');     // browse | folder | topic
  const [code, setCode] = useState(null);         // the open course code
  const [topicIdx, setTopicIdx] = useState(0);
  const [sheet, setSheet] = useState(null);       // { kind:'course' } | { kind:'topic', idx }
  const [toast, setToast] = useState(null);
  /* Topic completion: the reference default is topic 1 done per course;
     flips override that from the sheet's "Mark as complete". */
  const [flips, setFlips] = useState({});         // { [`${code}:${i}`]: done }
  const scrollRef = useRef(null);

  const topics = code ? topicsFor(code) : [];
  const isDone = (i) => flips[`${code}:${i}`] ?? i === 0;

  /* Every view change starts at the top (reference window.scrollTo). */
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [view, code, topicIdx]);

  /* Escape closes the sheet (reference keydown). */
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e) => { if (e.key === 'Escape') setSheet(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  const soon = (label) => setToast({ msg: `${label} — coming soon`, color: BRAND });

  const openCourse = (c) => { setCode(c); setView('folder'); };
  const openTopic = (i) => { setTopicIdx(i); setView('topic'); };
  const gotoAdjacent = (dir) => {
    const next = topicIdx + dir;
    if (next < 0) return;
    if (next >= topics.length) { setView('folder'); return; }
    openTopic(next);
  };

  const runSheetAction = (kind, label, idx) => {
    setSheet(null);
    if (kind === 'topic' && label === 'Mark as complete') {
      setFlips((f) => ({ ...f, [`${code}:${idx}`]: !isDone(idx) }));
      return;
    }
    if (label === 'Go to course') { setView('folder'); return; }
    if (label === 'Go to program') { setView('browse'); return; }
    soon(label);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${PROGRAM.name} — ${PROGRAM.sub}`} className="pd-page">
      <style>{`
        .pd-page{position:fixed;inset:0;z-index:1500;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        .pd-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .pd-back{width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.14);color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer;margin-bottom:20px;font-family:inherit}
        /* Browse */
        .pd-hero{background:linear-gradient(160deg, ${BRAND} 0%, #2E1A6E 75%);padding:20px 22px 28px}
        .pd-hero h1{font-size:2.1rem;font-weight:900;margin:0;color:#fff}
        .pd-hero .pd-sub{color:rgba(255,255,255,0.75);font-weight:700;font-size:.85rem;margin-top:6px}
        .pd-section{padding:22px 0 4px}
        .pd-section h2{font-size:1.15rem;font-weight:800;margin:0 0 14px;padding:0 22px;color:var(--ak-text,#111827)}
        .pd-row{display:flex;gap:14px;overflow-x:auto;padding:0 22px 10px;scrollbar-width:none}
        .pd-row::-webkit-scrollbar{display:none}
        .pd-card{flex:0 0 132px;cursor:pointer;background:none;border:none;padding:0;text-align:left;font-family:inherit;color:inherit}
        .pd-card .pd-art{width:132px;height:132px;border-radius:14px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;position:relative;overflow:hidden}
        .pd-card .pd-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.35) 100%)}
        .pd-card .pd-code{position:relative;z-index:1;font-weight:900;font-size:1.05rem;color:#fff}
        .pd-card .pd-name{font-size:.85rem;font-weight:700;margin-top:8px;color:var(--ak-text,#111827)}
        .pd-card .pd-meta{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-card .pd-reads{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:1px}
        .pd-empty{padding:18px 22px;flex:0 0 auto;width:100%}
        .pd-empty-card{border:1.5px dashed var(--ak-border2,#E5E7EB);border-radius:14px;padding:18px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
        /* Folder */
        .pd-folder-hero{padding:20px 22px 24px;position:relative}
        .pd-folder-art{width:100%;aspect-ratio:1.6;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:18px 0 20px;position:relative;overflow:hidden}
        .pd-code-big{font-size:2.6rem;font-weight:900;color:rgba(255,255,255,0.92);letter-spacing:.02em}
        .pd-folder-title{font-size:1.5rem;font-weight:900;margin:0 0 4px;color:var(--ak-text,#111827)}
        .pd-author-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .pd-author-avatar{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:#fff}
        .pd-author-name{font-size:.86rem;font-weight:800;color:var(--ak-text,#111827)}
        .pd-folder-meta{color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem;margin:0 0 20px}
        .pd-action-row{display:flex;align-items:center;gap:14px;margin-bottom:8px}
        .pd-start{flex:1;padding:13px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .pd-icon-btn{width:44px;height:44px;border-radius:50%;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-size:1.1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-family:inherit}
        .pd-topic-list{padding:18px 10px 30px}
        .pd-topic-row{display:flex;align-items:center;gap:14px;padding:13px 12px;border-radius:12px;cursor:pointer}
        .pd-topic-row:hover{background:var(--ak-surface,#fff)}
        .pd-topic-num{width:30px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:800;font-size:.9rem;flex-shrink:0}
        .pd-t-name{font-weight:700;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-t-meta{font-size:.76rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-check{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--ak-border2,#E5E7EB);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:${GREEN}}
        .pd-check.done{background:${GREEN};border-color:${GREEN};color:#fff}
        .pd-more{background:none;border:none;color:var(--ak-text-sub,#6B7280);padding:6px 4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit}
        .pd-upload{position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.5);border:1.5px solid rgba(255,255,255,0.5);color:#fff;font-size:.85rem;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;font-family:inherit}
        .pd-card .pd-upload{width:24px;height:24px;font-size:.7rem;top:6px;right:6px}
        .pd-folder-art .pd-upload{bottom:10px;right:10px}
        /* Topic content */
        .pd-topic-header{padding:20px 22px 0}
        .pd-breadcrumb{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:700;margin:16px 0 8px}
        .pd-topic-title{font-size:1.4rem;font-weight:900;margin:0 0 18px;color:var(--ak-text,#111827)}
        .pd-content{padding:0 22px 100px;font-size:.95rem;line-height:1.7;color:var(--ak-text-sub,#6B7280)}
        .pd-content p{margin:0 0 16px}
        .pd-content h3{color:var(--ak-text,#111827);font-size:1rem;font-weight:800;margin:22px 0 8px}
        .pd-topic-footer{position:sticky;bottom:0;background:var(--ak-bg,#FAFAFC);border-top:1px solid var(--ak-border,#F3F4F6);padding:14px 22px;display:flex;gap:10px}
        .pd-nav{flex:1;padding:13px;border-radius:100px;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-family:inherit;font-weight:800;font-size:.88rem;cursor:pointer}
        .pd-nav.primary{background:${BRAND};border:none;color:#fff}
        .pd-nav:disabled{opacity:.4;cursor:default}
        /* Action sheet */
        .pd-sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;z-index:40}
        .pd-sheet{width:100%;max-width:430px;background:var(--ak-surface,#fff);border-radius:20px 20px 0 0;padding:10px 0 max(18px, env(safe-area-inset-bottom));max-height:80vh;overflow-y:auto}
        .pd-sheet-handle{width:36px;height:4px;border-radius:100px;background:var(--ak-border2,#E5E7EB);margin:6px auto 14px}
        .pd-sheet-head{display:flex;align-items:center;gap:12px;padding:0 20px 16px;border-bottom:1px solid var(--ak-border,#F3F4F6)}
        .pd-sheet-art{width:48px;height:48px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.85rem;color:#fff}
        .pd-sheet-title{font-weight:800;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-sheet-sub{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-sheet-actions{padding:8px 0}
        .pd-sheet-action{display:flex;align-items:center;gap:16px;padding:13px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .pd-sheet-action:hover{background:var(--ak-surface-hover,#F9FAFB)}
        .pd-s-icon{width:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .pd-s-label{font-size:.92rem;font-weight:700;color:var(--ak-text,#111827)}
      `}</style>

      <div className="pd-phone" ref={scrollRef}>

        {/* ── View 1: Browse ── */}
        {view === 'browse' && (
          <div>
            <div className="pd-hero">
              <button className="pd-back" aria-label="Back to Discover" onClick={onClose}>←</button>
              <h1>{PROGRAM.name}</h1>
              <div className="pd-sub">{PROGRAM.sub}</div>
            </div>
            {PROGRAM.years.map((year) => (
              <div className="pd-section" key={year.label}>
                <h2>{year.label}</h2>
                {year.courses.length ? (
                  <div className="pd-row">
                    {year.courses.map((c) => (
                      <div key={c} className="pd-card" role="button" tabIndex={0}
                        onClick={() => openCourse(c)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCourse(c); } }}>
                        <span className="pd-art" style={{ background: accentFor(c) }}>
                          <span className="pd-upload" role="button" aria-label={`Set cover photo for ${c}`}
                            onClick={(e) => { e.stopPropagation(); soon('Custom covers'); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); soon('Custom covers'); } }}><Icon name="ti-camera" size={12}/></span>
                          <span className="pd-code">{c}</span>
                        </span>
                        <div className="pd-name">{c}</div>
                        <div className="pd-meta">Course. by {AUTHOR}</div>
                        <div className="pd-reads">{readsFor(c)} reads</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pd-empty"><div className="pd-empty-card">Courses for {year.label} are coming soon.</div></div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── View 2: Folder (course) ── */}
        {view === 'folder' && code && (
          <div>
            <div className="pd-folder-hero">
              <button className="pd-back" aria-label="Back to programme" onClick={() => setView('browse')}>←</button>
              <div className="pd-folder-art" style={{ background: accentFor(code) }}>
                <span className="pd-upload" role="button" aria-label="Set cover photo"
                  onClick={() => soon('Custom covers')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') soon('Custom covers'); }}><Icon name="ti-camera" size={14}/></span>
                <span className="pd-code-big">{code}</span>
              </div>
              <h2 className="pd-folder-title">{code}</h2>
              <div className="pd-author-row">
                <span className="pd-author-avatar" style={{ background: accentFor(code) }}>{AUTHOR.charAt(0)}</span>
                <span className="pd-author-name">{AUTHOR}</span>
              </div>
              <p className="pd-folder-meta">{topics.length} topics · {PROGRAM.name}</p>
              <div className="pd-action-row">
                <button className="pd-start" onClick={() => openTopic(0)}>Start learning</button>
                <button className="pd-icon-btn" aria-label="Download all topics" onClick={() => soon('Offline downloads')}><Icon name="ti-download" size={18}/></button>
                <button className="pd-icon-btn" aria-label="More" onClick={() => setSheet({ kind: 'course' })}><Icon name="ti-dots-vertical" size={20}/></button>
              </div>
            </div>
            <div className="pd-topic-list">
              {topics.map((t, i) => (
                <div key={i} className="pd-topic-row" role="button" tabIndex={0}
                  onClick={() => openTopic(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTopic(i); } }}>
                  <div className="pd-topic-num">{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pd-t-name">{t.name}</div>
                    <div className="pd-t-meta">{t.meta}</div>
                  </div>
                  <div className={`pd-check${isDone(i) ? ' done' : ''}`}>{isDone(i) ? '✓' : ''}</div>
                  <button className="pd-more" aria-label={`More for ${t.name}`}
                    onClick={(e) => { e.stopPropagation(); setSheet({ kind: 'topic', idx: i }); }}><Icon name="ti-dots-vertical" size={16}/></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── View 3: Topic content ── */}
        {view === 'topic' && code && topics[topicIdx] && (
          <div>
            <div className="pd-topic-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="pd-back" aria-label="Back to course" onClick={() => setView('folder')}>←</button>
                <button className="pd-more" style={{ fontSize: '1.4rem' }} aria-label="More"
                  onClick={() => setSheet({ kind: 'topic', idx: topicIdx })}><Icon name="ti-dots-vertical" size={20}/></button>
              </div>
              <div className="pd-breadcrumb">{code} · Topic {topicIdx + 1} of {topics.length}</div>
              <h2 className="pd-topic-title">{topics[topicIdx].name}</h2>
            </div>
            <div className="pd-content" dangerouslySetInnerHTML={{ __html: topics[topicIdx].body }} />
            <div className="pd-topic-footer">
              <button className="pd-nav" disabled={topicIdx === 0} onClick={() => gotoAdjacent(-1)}>← Previous</button>
              <button className="pd-nav primary" onClick={() => gotoAdjacent(1)}>
                {topicIdx === topics.length - 1 ? 'Finish' : 'Next →'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Action sheet (course or topic) ── */}
      {sheet && code && (
        <div className="pd-sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="pd-sheet">
            <div className="pd-sheet-handle" />
            <div className="pd-sheet-head">
              <div className="pd-sheet-art" style={{ background: accentFor(code) }}>
                {sheet.kind === 'topic' ? sheet.idx + 1 : code.slice(0, 2)}
              </div>
              <div>
                <div className="pd-sheet-title">{sheet.kind === 'topic' ? topics[sheet.idx].name : code}</div>
                <div className="pd-sheet-sub">
                  {sheet.kind === 'topic' ? `${code} · ${topics[sheet.idx].meta}` : `Course · by ${AUTHOR}`}
                </div>
              </div>
            </div>
            <div className="pd-sheet-actions">
              {SHEET_ACTIONS[sheet.kind].map(([icon, label]) => (
                <button key={label} className="pd-sheet-action" onClick={() => runSheetAction(sheet.kind, label, sheet.idx)}>
                  <span className="pd-s-icon"><Icon name={icon} size={18}/></span>
                  <span className="pd-s-label">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
