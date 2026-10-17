/*
 * PaperSheets — the printed-paper templates
 * (reference/question-layout-for-activity/submission-crop) as React:
 *
 *   <AssignmentSheet>   the assignment paper: header, details, the learner's
 *                       fields, instructions, Parts, case studies once, each
 *                       question with its answer space (options to circle,
 *                       lines, a working box + "Answer: ___", the blank in
 *                       the sentence, True / False boxes, labels) — and, with
 *                       teacherCopy, the marking scheme (TEACHER COPY).
 *   <SubmissionSheet>   a learner's submission (the API's submission.json
 *                       document): LEARNER SUBMISSION, answered / unanswered
 *                       / attachments, each question with the learner's
 *                       answer under it — the chosen option filled in, the
 *                       typed text, the drawing cropped to the handwriting —
 *                       a marks box beside it, and the teacher's feedback.
 *
 * A4 sheets on wide screens, one column on phones, Print / Save PDF prints
 * the sheets alone. Kept byte-identical in akoro-instructor/src/components/
 * paper and akoro-learner/src/components/activity: it needs only React and
 * lib/paper.js.
 */
import { useEffect, useState } from 'react';
import { paperBlocks, passageRange, figureSrc, mathRuns, letterOf } from '../../lib/paper.js';

const CSS = `
.aks{--ink:#111;--muted:#555;--line:#222;--hair:#bdbdbd;--font:"Times New Roman",Times,"Liberation Serif",Georgia,serif;
  background:#e6e6e6;color:var(--ink);font:11pt/1.35 var(--font);padding:1px 0;counter-reset:aks-sheet}
.aks *{box-sizing:border-box}
.aks-bar{max-width:210mm;margin:12px auto 0;text-align:right;font:14px system-ui,sans-serif}
.aks-bar button{padding:6px 14px;border:1px solid #888;border-radius:6px;background:#fff;cursor:pointer;font:inherit}
.aks-sheet{counter-increment:aks-sheet;position:relative;max-width:210mm;min-height:297mm;margin:12px auto;padding:16mm 16mm 22mm;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25)}
.aks-foot{position:absolute;left:0;right:0;bottom:9mm;text-align:center;font-size:8.5pt;color:var(--muted)}
.aks-head{text-align:center;margin-bottom:5mm}
.aks-head p{margin:1mm 0}
.aks-org{font-weight:700;font-size:12pt;text-transform:uppercase}
.aks-title{margin:1mm 0;font-size:13pt;font-weight:700;font-style:italic}
.aks-parts{display:grid;grid-template-columns:max-content max-content;column-gap:10mm;justify-content:center;margin:3mm 0 0;text-align:left;font-weight:700}
.aks-parts dt,.aks-parts dd{margin:0}
.aks-badge{display:inline-block;padding:.5mm 3mm;border:1px solid var(--line);font:700 9pt system-ui,sans-serif;letter-spacing:.08em}
.aks-details{display:grid;grid-template-columns:repeat(var(--n,4),1fr);margin:0 0 4mm;border:1px solid var(--line);font-size:10pt}
.aks-details>div{padding:1.5mm 3mm}
.aks-details>div+div{border-left:1px solid var(--line)}
.aks-details dt{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.aks-details dd{margin:0;font-weight:700}
.aks-fields{display:grid;grid-template-columns:repeat(var(--n,3),auto);gap:4mm;margin:0 0 4mm;font-size:10pt}
.aks-field{display:flex;align-items:flex-end;gap:2mm;white-space:nowrap}
.aks-field::after{content:"";flex:1;min-width:6mm;border-bottom:1px solid var(--line)}
.aks-box{border:1px solid var(--line);padding:2.5mm 4mm;margin-bottom:5mm;font-size:10pt}
.aks-box h2{margin:0 0 1mm;font-size:10pt;text-transform:uppercase;letter-spacing:.05em}
.aks-box ul{margin:0;padding-left:5mm}
.aks-part{text-align:center;margin:0 0 4mm;padding:1.5mm 0;border-top:1.5px solid var(--line);border-bottom:1px solid var(--line)}
.aks-part h2{margin:0;font-size:12pt;letter-spacing:.06em;text-transform:uppercase}
.aks-part p{margin:0;font-size:9.5pt;font-style:italic}
.aks-case{margin:0 0 5mm;padding:3mm 4mm;border:1px solid var(--line);border-left-width:2mm;break-inside:avoid}
.aks-case h3{margin:0 0 1mm;font-size:11pt}
.aks-case h3 small{font-weight:400;font-style:italic;font-size:9pt;margin-left:2mm}
.aks-case p{margin:0;white-space:pre-wrap}
.aks-qs{list-style:none;margin:0;padding:0}
.aks-qs--2{columns:2;column-gap:12mm;column-rule:1px dotted var(--hair)}
.aks-q{position:relative;padding-left:8mm;margin:0 0 5mm;break-inside:avoid}
.aks-q>.aks-n{position:absolute;left:0;top:0;font-weight:700}
.aks-q--marked{display:grid;grid-template-columns:1fr 24mm;gap:4mm;margin-bottom:6mm}
.aks-stem{margin:0;font-weight:700;white-space:pre-line}
.aks-pts{display:block;margin-top:1.5mm;text-align:right;font-size:9pt;font-style:italic}
.aks-opts{list-style:none;margin:2mm 0 0;padding:0}
.aks-opts li{display:grid;grid-template-columns:7mm 1fr;align-items:center;margin:.5mm 0}
.aks-opts .aks-l{font-weight:700}
.aks-opts--bubbles .aks-l{display:grid;place-items:center;width:5mm;height:5mm;border:1px solid var(--line);border-radius:50%;font-size:8.5pt}
.aks-opts .is-sel{font-weight:700}
.aks-opts .is-sel .aks-l{background:var(--ink);color:#fff}
.aks-opts .is-key{font-weight:700;text-decoration:underline}
.aks-lines{height:var(--h,21mm);margin-top:2mm;background:repeating-linear-gradient(to bottom,transparent 0 6.5mm,var(--hair) 6.5mm 7mm)}
.aks-work{height:22mm;margin-top:2mm;padding:1mm 2mm;border:1px solid var(--hair);font-size:8pt;color:var(--muted)}
.aks-ans{margin:2mm 0 0}
.aks-blank{display:inline-block;min-width:24mm;border-bottom:1px solid var(--line)}
.aks-tf{display:flex;gap:8mm;margin-top:2mm}
.aks-tf span::before{content:"";display:inline-block;width:3.5mm;height:3.5mm;margin-right:2mm;border:1px solid var(--line);vertical-align:-.5mm}
.aks-labels{margin-top:2mm;display:grid;gap:1.5mm}
.aks-labels div{display:flex;gap:3mm;align-items:flex-end}
.aks-labels div::after{content:"";flex:1;border-bottom:1px solid var(--hair)}
.aks-fig{margin:2mm 0;text-align:center}
.aks-fig img{max-width:100%;max-height:60mm}
.aks-fig figcaption{font-size:9pt;font-style:italic;color:var(--muted)}
.aks-slot{margin:2mm 0;padding:2mm 3mm;border:1px dashed var(--muted);font-size:9pt;color:var(--muted)}
.aks-mark{align-self:start;display:flex;flex-direction:column;justify-content:space-between;min-height:14mm;padding:1mm 2mm;border:1px solid var(--line);font-size:9pt;text-align:right}
.aks-mark span{text-align:left;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.aks-mark b{white-space:nowrap}
.aks-mark u{display:inline-block;min-width:8mm;margin-right:1mm;text-decoration:none;border-bottom:1px solid var(--line);text-align:center}
.aks-mark em{display:block;margin-top:1mm;text-align:left;font-size:8pt;color:var(--muted)}
.aks-typed{margin-top:2mm;padding:2mm 3mm;border:1px solid var(--hair);white-space:pre-wrap}
.aks-drawing{margin:2mm 0 0;padding:2mm;border:1px solid var(--hair)}
.aks-drawing figcaption{margin-bottom:1mm;font:8pt system-ui,sans-serif;color:var(--muted)}
.aks-drawing img{display:block;max-width:100%;max-height:60mm;height:auto}
.aks-file{margin-top:2mm;font:9pt system-ui,sans-serif;color:var(--muted)}
.aks-none{margin-top:2mm;padding:4mm;border:1px dashed var(--muted);text-align:center;font-style:italic;color:var(--muted)}
.aks-feedback{margin-top:6mm;padding:3mm 4mm;border:1px solid var(--line);break-inside:avoid}
.aks-feedback h2{margin:0;font-size:10pt;text-transform:uppercase;letter-spacing:.05em}
.aks-feedback p{margin:2mm 0 0;white-space:pre-wrap}
.aks-key{width:100%;margin-top:4mm;border-collapse:collapse;font-size:10pt}
.aks-key th,.aks-key td{padding:1.5mm 2.5mm;border:1px solid var(--line);text-align:left;vertical-align:top}
.aks-key th{background:#efefef}
.aks-key td:last-child,.aks-key th:last-child{text-align:center;width:18mm}
.aks-key tfoot td{font-weight:700}
@media screen and (max-width:820px){
  .aks{background:#fff}
  .aks-bar{padding:0 16px}
  .aks-sheet{min-height:0;margin:0 0 8px;padding:16px 16px 40px;box-shadow:none}
  .aks-qs--2{columns:1}
  .aks-details{grid-template-columns:1fr}
  .aks-details>div+div{border-left:0;border-top:1px solid var(--line)}
  .aks-fields{grid-template-columns:1fr 1fr}
  .aks-fields .aks-field:first-child{grid-column:1/-1}
  .aks-q--marked{grid-template-columns:1fr}
  .aks-mark{flex-direction:row;align-items:flex-end;min-height:0}
}
@media print{
  @page{size:A4;margin:0}
  body *{visibility:hidden}
  .aks,.aks *{visibility:visible}
  .aks{position:absolute;left:0;top:0;width:100%;background:#fff;padding:0}
  .aks-bar{display:none}
  .aks-sheet{max-width:none;min-height:296mm;margin:0;box-shadow:none;break-after:page}
  .aks-sheet:last-of-type{break-after:auto}
}`;

function Styles() {
  return <style>{CSS}</style>;
}

function MathText({ text }) {
  return mathRuns(text).map((r, i) =>
    r.sup ? <sup key={i}>{r.text}</sup> : r.sub ? <sub key={i}>{r.text}</sub> : <span key={i}>{r.text}</span>);
}

/** Text with its gap(s) "____" drawn as a blank to fill. */
function GapText({ text }) {
  const parts = String(text || '').split(/_{3,}/);
  return parts.map((p, i) => (
    <span key={i}><MathText text={p} />{i < parts.length - 1 && <span className="aks-blank" />}</span>
  ));
}

const ptsOf = (q) => {
  const n = Number(q && typeof q === 'object' ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const marksWord = (n) => `${n} mark${n === 1 ? '' : 's'}`;
const ESSAY = /essay/i;
const LONG = /^(theory|structured)$/i;

/** The answer space a question leaves (the stored one, else from its kind). */
export function spaceOf(q) {
  if (q?.answer_space) return q.answer_space;
  if (q?.format === 'true_false') return 'true_false';
  if (q?.format === 'label') return 'labels';
  if (Array.isArray(q?.options)) return 'options';
  if (/^fill[- ]in/i.test(q?.type || '')) return 'blank';
  if (/^calculation/i.test(q?.type || '')) return 'working';
  return 'lines';
}

function Stem({ q, space }) {
  if (q.format === 'assertion_reason' && q.assertion) {
    return <p className="aks-stem"><span>Assertion: </span><MathText text={q.assertion} /><br /><span>Reason: </span><MathText text={q.reason || ''} /></p>;
  }
  return <p className="aks-stem">{space === 'blank' ? <GapText text={q.q} /> : <MathText text={q.q || ''} />}</p>;
}

function QFigure({ q }) {
  const src = figureSrc(q.figure);
  if (src) {
    return (
      <figure className="aks-fig">
        <img src={src} alt={q.figure.alt || q.figure.caption || 'Figure'} />
        {q.figure.caption && <figcaption>{q.figure.caption}</figcaption>}
      </figure>
    );
  }
  return q.figure_note ? <div className="aks-slot">Figure: {q.figure_note}</div> : null;
}

/** The space left for the answer on the blank paper. */
function AnswerSpace({ q, space }) {
  if (space === 'options') {
    return <ol className="aks-opts" role="list">{q.options.map((o, i) => <li key={i}><span className="aks-l">{letterOf(i)}</span><span><MathText text={o} /></span></li>)}</ol>;
  }
  if (space === 'true_false') return <div className="aks-tf"><span>True</span><span>False</span></div>;
  if (space === 'labels') return <div className="aks-labels">{(q.labels || []).map((l) => <div key={l}><b>{l}</b></div>)}</div>;
  if (space === 'blank') return null;
  if (space === 'working') return <><div className="aks-work">Working</div><p className="aks-ans">Answer: <span className="aks-blank" /></p></>;
  const h = ESSAY.test(q.type || '') ? '70mm' : LONG.test(q.type || '') ? '35mm' : '21mm';
  return <div className="aks-lines" style={{ '--h': h }} aria-label="Answer lines" />;
}

/** The marking-scheme line for the teacher copy. */
function keyLine(q) {
  if (q.marking) return q.marking;
  if (Array.isArray(q.options) && q.correct != null) return `${letterOf(q.correct)} – ${q.options[q.correct] ?? ''}`;
  if (q.answer && typeof q.answer === 'object') return Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join('; ');
  return q.answer || '—';
}

const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

function PrintBar({ show }) {
  if (!show) return null;
  return <div className="aks-bar"><button type="button" onClick={() => window.print()}>Print / Save PDF</button></div>;
}

/**
 * The assignment paper. `details` is the assignment's details
 * ({ questions, sections?, passages?, instructions? }).
 */
export function AssignmentSheet({ title, subject, topic, date = null, dueAt = null, org = null, details, instructions = null, teacherCopy = false, printable = true }) {
  const blocks = paperBlocks(details);
  const qs = Array.isArray(details?.questions) ? details.questions : [];
  const sections = Array.isArray(details?.sections) ? details.sections : [];
  const total = qs.reduce((s, q) => s + (ptsOf(q) || 0), 0);
  const lines = [instructions || details?.instructions || 'Answer all questions.'];
  if (qs.some((q) => spaceOf(q) === 'options')) lines.push('For multiple-choice questions, circle the letter of the correct option.');
  if (qs.some((q) => spaceOf(q) === 'working')) lines.push('Show your working in the space provided.');
  const twoCols = qs.length > 6 && !qs.some((q) => ['working', 'labels'].includes(spaceOf(q)) || ESSAY.test(q.type || ''));
  return (
    <div className="aks">
      <Styles />
      <PrintBar show={printable} />
      <main className="aks-sheet">
        <header className="aks-head">
          <p className="aks-org">{org || '[School Name]'}</p>
          <h1 className="aks-title">{title || 'Assignment'}</h1>
          {sections.length > 0 && (
            <dl className="aks-parts">
              {sections.map((s, i) => <span key={i} style={{ display: 'contents' }}><dt>{String(s.title || '').split(/\s[–-]\s/)[0] || `Part ${letterOf(i)}`}:</dt><dd>{(String(s.title || '').split(/\s[–-]\s/)[1] || '').toUpperCase()}</dd></span>)}
            </dl>
          )}
        </header>
        <dl className="aks-details" style={{ '--n': 4 }}>
          <div><dt>Subject</dt><dd>{subject || '—'}</dd></div>
          <div><dt>Topic</dt><dd>{topic || '—'}</dd></div>
          <div><dt>Date</dt><dd>{fmtDay(date)}</dd></div>
          <div><dt>Due date</dt><dd>{fmtDay(dueAt)}</dd></div>
        </dl>
        <div className="aks-fields" style={{ '--n': 3 }}>
          <span className="aks-field">Name:</span>
          <span className="aks-field">Class:</span>
          <span className="aks-field">Score{total ? ` (/${total})` : ''}:</span>
        </div>
        <aside className="aks-box">
          <h2>Instructions</h2>
          <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </aside>
        {blocks.map((b, bi) => (
          <section key={bi}>
            {b.newSection && (
              <header className="aks-part">
                <h2>{b.section.title}</h2>
                {b.section.instructions && <p>{b.section.instructions}</p>}
              </header>
            )}
            {b.passage && (
              <aside className="aks-case">
                <h3>{b.passage.title || 'Read the passage'}<small>{passageRange(b.items)}</small></h3>
                <p>{b.passage.text}</p>
              </aside>
            )}
            <ol className={`aks-qs${twoCols ? ' aks-qs--2' : ''}`} role="list">
              {b.items.map(({ q, i }) => {
                const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
                const space = spaceOf(obj);
                const pts = ptsOf(obj);
                return (
                  <li key={i} className="aks-q" data-type={space}>
                    <span className="aks-n">{i + 1}.</span>
                    <Stem q={obj} space={space} />
                    <QFigure q={obj} />
                    <AnswerSpace q={obj} space={space} />
                    {pts && <span className="aks-pts">[{marksWord(pts)}]</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </main>
      {teacherCopy && (
        <main className="aks-sheet">
          <header className="aks-head">
            <p className="aks-org">{org || '[School Name]'} – Marking Scheme</p>
            <h1 className="aks-title">{title || 'Assignment'}</h1>
            <p><span className="aks-badge">TEACHER COPY</span></p>
          </header>
          <table className="aks-key">
            <thead><tr><th>No.</th><th>Answer / working</th><th>Marks</th></tr></thead>
            <tbody>{qs.map((q, i) => <tr key={i}><td>{i + 1}</td><td><MathText text={keyLine(q)} /></td><td>{ptsOf(q) ?? '—'}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td>{total || '—'}</td></tr></tfoot>
          </table>
        </main>
      )}
    </div>
  );
}

/** A drawing's image, loaded through the app's own authenticated fetch. */
function Drawing({ file, loadFile }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let live = true;
    if (loadFile && file?.id) {
      Promise.resolve(loadFile(file)).then((blob) => {
        if (!live || !blob) return;
        url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
        setSrc(url);
      }).catch(() => {});
    }
    return () => { live = false; if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); };
  }, [file?.id, loadFile]);
  return (
    <figure className="aks-drawing">
      <figcaption>Attached: {file.name}</figcaption>
      {src ? <img src={src} alt={`Handwritten working: ${file.name}`} /> : null}
    </figure>
  );
}

function MarkBox({ marks }) {
  if (marks?.max == null) return <div className="aks-mark"><span>Marks</span><b><u>{marks?.awarded ?? ''}</u></b></div>;
  return (
    <div className="aks-mark">
      <span>Marks</span>
      <b><u>{marks.awarded ?? ' '}</u>/ {marks.max}</b>
      {marks.comment && <em>{marks.comment}</em>}
    </div>
  );
}

function SubmittedAnswer({ item, loadFile, onOpenFile }) {
  const a = item.answer || {};
  const hasAny = a.text || a.selected || a.drawings?.length || a.files?.length;
  return (
    <>
      {item.options && (
        <ol className="aks-opts aks-opts--bubbles" role="list">
          {item.options.map((o) => (
            <li key={o.letter} className={o.selected ? 'is-sel' : undefined}><span className="aks-l">{o.letter}</span><span><MathText text={o.text} /></span></li>
          ))}
        </ol>
      )}
      {a.text && <div className="aks-typed"><MathText text={a.text} /></div>}
      {(a.drawings || []).map((f) => <Drawing key={f.id || f.name} file={f} loadFile={loadFile} />)}
      {(a.files || []).map((f) => (
        <div key={f.id || f.name} className="aks-file">
          Attached: {onOpenFile ? <a href="#open" onClick={(e) => { e.preventDefault(); onOpenFile(f); }}>{f.name}</a> : f.name}
        </div>
      ))}
      {!hasAny && <div className="aks-none">No answer submitted</div>}
    </>
  );
}

/**
 * A learner's submission as the submission template. `doc` is the API's
 * GET /api/self-study/targets/:id/submission.json document; `loadFile(file)`
 * returns the file's Blob (or a URL) for drawings; `onOpenFile` opens others.
 */
export function SubmissionSheet({ doc, loadFile = null, onOpenFile = null, printable = true }) {
  if (!doc) return null;
  const d = doc.details || {};
  const s = doc.summary || {};
  const who = [doc.learner?.name, doc.learner?.className].filter(Boolean).join(' ');
  const foot = [who, doc.header?.title].filter(Boolean).join(' · ');
  const total = doc.totalPoints;
  const scoreText = doc.feedback?.score != null ? String(doc.feedback.score) : '';
  return (
    <div className="aks">
      <Styles />
      <PrintBar show={printable} />
      <main className="aks-sheet">
        <header className="aks-head">
          <p className="aks-org">{doc.header?.org || '[School Name]'}</p>
          <h1 className="aks-title">{doc.header?.title || 'Assignment'}</h1>
          <p><span className="aks-badge">{doc.header?.badge || 'LEARNER SUBMISSION'}</span></p>
        </header>
        <dl className="aks-details" style={{ '--n': 4 }}>
          <div><dt>Subject</dt><dd>{d.subject || '—'}</dd></div>
          <div><dt>Topic</dt><dd>{d.topic || '—'}</dd></div>
          <div><dt>Submitted</dt><dd>{fmtWhen(d.submittedAt)}{d.late ? ' (late)' : ''}</dd></div>
          <div><dt>Due date</dt><dd>{d.dueAt ? fmtWhen(d.dueAt) : '—'}</dd></div>
        </dl>
        <div className="aks-fields" style={{ '--n': 4 }}>
          <span className="aks-field">Name: <b>{doc.learner?.name || ''}</b></span>
          <span className="aks-field">Class: <b>{doc.learner?.className || ''}</b></span>
          <span className="aks-field">Username: <b>{doc.learner?.username ? `@${doc.learner.username}` : ''}</b></span>
          <span className="aks-field">Score{total ? ` (/${total})` : ''}: <b>{scoreText}</b></span>
        </div>
        <dl className="aks-details" style={{ '--n': 3 }}>
          <div><dt>Answered</dt><dd>{s.answered ?? 0} of {s.total ?? 0} questions</dd></div>
          <div><dt>Unanswered</dt><dd>{(s.unanswered || []).length ? s.unanswered.map((n) => `Q${n}`).join(', ') : 'None'}</dd></div>
          <div><dt>Attachments</dt><dd>{[s.attachments?.drawings ? `${s.attachments.drawings} drawing${s.attachments.drawings === 1 ? '' : 's'}` : '', s.attachments?.files ? `${s.attachments.files} file${s.attachments.files === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') || 'None'}</dd></div>
        </dl>
        <aside className="aks-box">
          <h2>About this submission</h2>
          <ul>
            <li>The learner&rsquo;s answer and working appear directly under each question.</li>
            <li>Teachers record marks in the box beside each question.</li>
          </ul>
        </aside>
        {doc.text && <div className="aks-typed">{doc.text}</div>}
        {(doc.parts || []).map((part, pi) => (
          <section key={pi}>
            {part.title && (
              <header className="aks-part">
                <h2>{part.title}</h2>
                {part.note && <p>{part.note}</p>}
              </header>
            )}
            {(part.passages || []).map((p) => (
              <aside key={p.index} className="aks-case">
                <h3>{p.title || 'Case study'}<small>{p.questions}</small></h3>
                <p>{p.text}</p>
              </aside>
            ))}
            <ol className="aks-qs" role="list">
              {(part.questions || []).map((item) => (
                <li key={item.index} className="aks-q aks-q--marked" data-status={item.status}>
                  <span className="aks-n">{item.number}.</span>
                  <div>
                    <p className="aks-stem">
                      {item.format === 'assertion_reason' && item.assertion
                        ? <>Assertion: <MathText text={item.assertion} /><br />Reason: <MathText text={item.reason || ''} /></>
                        : item.answerSpace === 'blank' ? <GapText text={item.text} /> : <MathText text={item.text} />}
                    </p>
                    <SubmittedAnswer item={item} loadFile={loadFile} onOpenFile={onOpenFile} />
                  </div>
                  <MarkBox marks={item.marks} />
                </li>
              ))}
            </ol>
          </section>
        ))}
        {(doc.files || []).length > 0 && (
          <aside className="aks-box"><h2>Other attachments</h2><ul>{doc.files.map((f) => <li key={f.id || f.name}>{onOpenFile ? <a href="#open" onClick={(e) => { e.preventDefault(); onOpenFile(f); }}>{f.name}</a> : f.name}</li>)}</ul></aside>
        )}
        <section className="aks-feedback">
          <h2>Teacher&rsquo;s feedback</h2>
          {doc.feedback?.text ? <p>{doc.feedback.text}</p> : <div className="aks-lines" style={{ '--h': '28mm' }} />}
          <div className="aks-fields" style={{ '--n': 3, marginTop: '4mm' }}>
            <span className="aks-field">Total score{total ? ` (/${total})` : ''}: <b>{scoreText}</b></span>
            <span className="aks-field">Marked by:</span>
            <span className="aks-field">Date: <b>{doc.feedback?.gradedAt ? fmtDay(doc.feedback.gradedAt) : ''}</b></span>
          </div>
        </section>
        {foot && <div className="aks-foot">{foot}</div>}
      </main>
    </div>
  );
}
