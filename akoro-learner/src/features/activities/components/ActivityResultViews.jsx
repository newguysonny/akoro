import { Icon } from '../../../components/common/Icons.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import { BRAND, RED } from '../../../constants.js';
import { downloadActivityFile } from '../../../services/activityApi.js';
import { letterOf, isAnswered } from '../../../lib/paper.js';
import { qText, fmtSize } from './activityDetailModel.js';

/* The score, big: a ring, points earned and missed (the result screen after marking). */
export function ScoreCard({ grade, questions, ai, text }) {
  const earned = questions.reduce((n, m) => n + (Number(m.awarded) || 0), 0);
  const max = questions.reduce((n, m) => n + (Number(m.max) || 0), 0);
  const pct = Math.max(0, Math.min(100, Number(grade) || 0));
  const tone = pct >= 70 ? '#047857' : pct >= 40 ? '#B45309' : '#B91C1C';
  const R = 38, CIRC = 2 * Math.PI * R;
  return (
    <div data-testid="score-card" style={{ background: 'var(--ak-surface)', borderRadius: 20, padding: 18, marginBottom: 20, boxShadow: '0 4px 18px rgba(17,24,39,.08)', fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Score ${pct}%`}>
          <circle cx="48" cy="48" r={R} fill="none" stroke="var(--ak-border)" strokeWidth="9"/>
          <circle cx="48" cy="48" r={R} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`} transform="rotate(-90 48 48)"/>
          <text x="48" y="54" textAnchor="middle" fontSize="22" fontWeight="900" fill="var(--ak-text)">{pct}%</text>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)' }}>{pct >= 70 ? 'Well done!' : pct >= 40 ? 'Good effort' : 'Keep going'}</div>
          {max > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#047857', background: 'rgba(16,185,129,.12)', padding: '3px 10px', borderRadius: 999 }}>{earned} points earned</span>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#B91C1C', background: 'rgba(239,68,68,.10)', padding: '3px 10px', borderRadius: 999 }}>{Math.max(0, max - earned)} missed</span>
            </div>
          )}
        </div>
      </div>
      {text && <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', margin: '14px 0 0', lineHeight: 1.55 }}>{text}</p>}
      {ai && <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '10px 0 0' }}><Icon name="ti-sparkles" size={12}/> Marked by AI against your teacher's mark scheme. Your teacher may adjust it.</p>}
    </div>
  );
}

/* The last check before handing in — what's missing, what's attached. */
export function LastCheck({ check, total, questions, onAnswer, onSubmit, onClose, submitting, err, mid, dark }) {
  const issues = check.unanswered.length + check.blanks.length;
  return (
    <div className="ak-sheet-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,10,25,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="ak-sheet-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Hand in your assignment"
        style={{ width: '100%', maxWidth: 520, background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 18px)', boxShadow: '0 -12px 32px rgba(17,24,39,.18)', fontFamily: "'Nunito',sans-serif", maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border)', margin: '0 auto 14px' }}/>
        <h3 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{issues ? 'Before you hand it in' : 'Ready to hand it in?'}</h3>
        <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 14px' }}>
          {total - check.unanswered.length} of {total} answered · {check.files} file{check.files === 1 ? '' : 's'} attached
          {check.pending.length ? ` · ${check.pending.length} answer${check.pending.length === 1 ? '' : 's'} still saving — we'll save ${check.pending.length === 1 ? 'it' : 'them'} first` : ''}
        </p>
        {check.unanswered.map((i) => (
          <div key={`u${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.25)', marginBottom: 8 }}>
            <Icon name="ti-alert-circle" size={15} color={RED}/>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Question {i + 1} · not answered <span style={{ fontWeight: 600, color: 'var(--ak-text-muted)' }}>— {qText(questions[i]).slice(0, 60)}</span></span>
            <button type="button" onClick={() => onAnswer(i)} style={{ border: 'none', background: RED, color: '#fff', borderRadius: 9, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>Answer it</button>
          </div>
        ))}
        {check.blanks.map((b) => (
          <div key={`b${b.index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', marginBottom: 8 }}>
            <Icon name="ti-tag" size={15} color="#B45309"/>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Question {b.index + 1} · part{b.parts.length === 1 ? '' : 's'} {b.parts.join(', ')} left blank</span>
            <button type="button" onClick={() => onAnswer(b.index)} style={{ border: '1px solid rgba(245,158,11,.5)', background: 'transparent', color: '#B45309', borderRadius: 9, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>Fill in</button>
          </div>
        ))}
        {!issues && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', marginBottom: 8 }}>
            <Icon name="ti-circle-check" size={16} color="#047857"/>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#047857' }}>Every question has an answer.</span>
          </div>
        )}
        <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '10px 0 14px' }}>Once you submit, your answers go to your teacher and can't be changed.</p>
        {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, margin: '-6px 0 12px' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ flex: 1, padding: 12, borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
            Keep working
          </button>
          <button type="button" onClick={onSubmit} disabled={submitting}
            style={{ flex: 1.3, padding: 12, borderRadius: 20, border: 'none', background: `linear-gradient(135deg, ${mid}, ${dark})`, color: '#fff', fontSize: 13, fontWeight: 900, cursor: submitting ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {submitting ? <Spinner size={13}/> : <><Icon name="ti-send" size={14}/> {issues ? 'Submit anyway' : 'Submit'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* After handing in: what went in, and the paper with the answers. */
export function Receipt({ questions, submission, completedAt }) {
  const answers = submission?.answers || {};
  const files = submission?.files || [];
  const counts = {};
  files.forEach((f) => { if (f.question != null) counts[f.question] = (counts[f.question] || 0) + 1; });
  const answered = questions.filter((q, i) => isAnswered(answers[i] ?? answers[String(i)], counts[i] || 0)).length;
  const when = completedAt ? new Date(completedAt) : null;
  return (
    <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '18px 16px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 16, textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,.12)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
        <Icon name="ti-circle-check" size={24}/>
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 900, margin: '0 0 3px', color: 'var(--ak-text)' }}>Handed in</h3>
      {submission?.late && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 900, color: '#B45309', background: 'rgba(245,158,11,.14)', padding: '2px 9px', borderRadius: 999, marginBottom: 6 }}>
          <Icon name="ti-clock-exclamation" size={12}/> Late — after the due date
        </span>
      )}
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 14px' }}>
        {when && !Number.isNaN(when.getTime()) ? `${when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ` : ''}your teacher is marking it
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {[[`${answered}/${questions.length}`, 'answered'], [`${files.length}`, `file${files.length === 1 ? '' : 's'}`], ['—', 'marks · waiting']].map(([n, l]) => (
          <div key={l} style={{ flex: 1, background: 'var(--ak-bg)', borderRadius: 12, padding: '9px 6px' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)' }}>{n}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


/* The submitted work, read-only — what the learner actually handed in.
   Shown after submit and after grading; the server copy is the source. */
export function SubmittedWork({ submission, questions }) {
  if (!submission) return null;
  // Mixed sets: only MCQ questions render a chosen-option row; open
  // questions' typed answers ride in the text block below.
  const hasMcq = Array.isArray(questions) && questions.some((q) => typeof q === 'object' && Array.isArray(q.options));
  const text = (submission.text || '').trim();
  const answerKeys = Object.keys(submission.answers ?? {});
  const files = submission.files ?? [];
  if (!text && !answerKeys.length && !files.length) return null;
  return (
    <>
      <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>Your submission</p>
      {text && (
        <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '13px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 10, borderLeft: '3px solid rgba(107,59,255,.4)' }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6, fontFamily: "'Nunito',sans-serif" }}>{text}</p>
        </div>
      )}
      {hasMcq && answerKeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {questions.map((q, i) => {
            const ans = submission.answers?.[String(i)];
            if (ans === undefined || ans === null || ans === '') return null;
            const chosen = Array.isArray(q.options) ? q.options[ans] : null;
            return (
              <div key={i} style={{ background: 'var(--ak-surface)', borderRadius: 14, padding: '11px 13px', boxShadow: '0 2px 10px rgba(17,24,39,.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', marginBottom: 3, fontFamily: "'Nunito',sans-serif" }}>Q{i + 1}. {qText(q)}</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
                  {chosen != null ? `${letterOf(ans)}. ${chosen}` : String(ans)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {files.map((f) => (
            <button key={f.id} onClick={() => downloadActivityFile(f.id, f.name)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="ti-file" size={13}/>
              </span>
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{fmtSize(f.size || 0)} · tap to download</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
