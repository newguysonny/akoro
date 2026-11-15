import { useState } from 'react';
import { apiPost } from '../../services/api.js';
import { BRAND, GREEN, RED } from '../../constants.js';

const clean = (value, maximum) => String(value || '').replace(/[\r\n\x00]+/g, ' ').trim().slice(0, maximum);

/**
 * Learner-owned generated-practice loop. This component deliberately knows no
 * answer key and never manufactures a score: all scoring/state changes come
 * from the protected API route.
 */
export default function ExamPrepConfidenceModal({ onClose, onStartTeach, initialConfig = {} }) {
  const [form, setForm] = useState({
    topic: clean(initialConfig.topic, 180), subject: clean(initialConfig.subject, 180) || 'General',
    examBoard: clean(initialConfig.examBoard, 80) || 'WAEC', questionCount: Number(initialConfig.questionCount) || 5,
  });
  const [run, setRun] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const select = (questionId, answerIndex) => setAnswers(previous => ({ ...previous, [questionId]: answerIndex }));

  const start = async (event) => {
    event.preventDefault();
    const topic = clean(form.topic, 180);
    const subject = clean(form.subject, 180);
    if (topic.length < 3 || !subject) { setError('Enter a topic and subject first.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await apiPost('/api/adaptive/exam-prep/confidence-runs', { ...form, topic, subject, questionCount: Number(form.questionCount) });
      setRun(response.run); setAttempt(response.attempt); setAnswers({});
    } catch (err) { setError(err?.message || 'Practice could not be prepared.'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!attempt || !run) return;
    if (Object.keys(answers).length !== attempt.questions.length) { setError('Choose one answer for every question before submitting.'); return; }
    setBusy(true); setError('');
    try {
      const response = await apiPost(`/api/adaptive/exam-prep/confidence-runs/${run.id}/submit`, {
        answers: attempt.questions.map(question => ({ questionId: question.id, answerIndex: answers[question.id] })),
      });
      setRun(response.run); setResult(response);
    } catch (err) { setError(err?.message || 'Your result could not be recorded.'); }
    finally { setBusy(false); }
  };

  const retest = async () => {
    if (!run) return;
    setBusy(true); setError('');
    try {
      const response = await apiPost(`/api/adaptive/exam-prep/confidence-runs/${run.id}/retest`, { learnerConfirmedReady: true });
      setRun(response.run); setAttempt(response.attempt); setAnswers({}); setResult(null);
    } catch (err) { setError(err?.message || 'A fresh retest could not be prepared.'); }
    finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose?.(); };
  return (
    <div className="ak-sheet-overlay" role="dialog" aria-modal="true" aria-label="Exam-prep confidence check" style={overlay}>
      <div className="ak-sheet-panel" style={sheet}>
        <div style={header}>
          <div><div style={{ fontSize:16, fontWeight:900, color:'var(--ak-text)' }}>Exam-prep confidence check</div><div style={caption}>Generated exam-style practice · not a historical past paper</div></div>
          <button type="button" onClick={close} aria-label="Close" style={closeButton}>×</button>
        </div>
        {error && <div role="alert" style={errorBox}>{error}</div>}
        {!attempt && (
          <form onSubmit={start} style={{ display:'grid', gap:12 }}>
            <p style={body}>Use a short diagnostic to decide whether to continue or teach the topic back before a fresh retest.</p>
            <label style={label}>Topic<input required minLength={3} maxLength={180} value={form.topic} onChange={e=>update('topic', e.target.value)} placeholder="e.g. Quadratic equations" style={input}/></label>
            <label style={label}>Subject<input required maxLength={180} value={form.subject} onChange={e=>update('subject', e.target.value)} placeholder="e.g. Mathematics" style={input}/></label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label style={label}>Exam board<input required maxLength={80} value={form.examBoard} onChange={e=>update('examBoard', e.target.value)} style={input}/></label>
              <label style={label}>Questions<select value={form.questionCount} onChange={e=>update('questionCount', Number(e.target.value))} style={input}>{[3,4,5,6,7,8,9,10].map(number=><option key={number} value={number}>{number}</option>)}</select></label>
            </div>
            <button disabled={busy} style={primary}>{busy ? 'Preparing…' : 'Start generated practice'}</button>
          </form>
        )}
        {attempt && !result && (
          <div>
            <div style={{ ...caption, marginBottom:12 }}>Attempt {attempt.attemptNumber} of {run.maxAttempts} · pass threshold {Math.round(run.passThreshold * 100)}%</div>
            <div style={{ display:'grid', gap:14 }}>{attempt.questions.map((question, questionIndex) => <section key={question.id} style={questionBox}>
              <div style={{ fontSize:13.5, fontWeight:800, color:'var(--ak-text)', lineHeight:1.45 }}>{questionIndex + 1}. {question.question}</div>
              {question.objective && <div style={{ ...caption, marginTop:4 }}>Objective: {question.objective}</div>}
              <div style={{ display:'grid', gap:7, marginTop:10 }}>{question.options.map((option, optionIndex) => <label key={optionIndex} style={{ ...optionStyle, borderColor: answers[question.id] === optionIndex ? BRAND : 'var(--ak-border2)', background: answers[question.id] === optionIndex ? `${BRAND}12` : 'var(--ak-surface)' }}>
                <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={()=>select(question.id, optionIndex)} /> <span>{option}</span>
              </label>)}</div>
            </section>)}</div>
            <button type="button" disabled={busy} onClick={submit} style={{ ...primary, marginTop:16 }}>{busy ? 'Recording…' : 'Submit answers'}</button>
          </div>
        )}
        {result && <div style={{ display:'grid', gap:13 }}>
          <div style={{ ...resultBox, borderColor: result.passed ? `${GREEN}70` : `${RED}50` }}>
            <div style={{ fontSize:26, fontWeight:900, color:result.passed ? GREEN : RED }}>{Math.round(result.score * 100)}%</div>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--ak-text)' }}>{result.correct} of {result.total} correct</div>
            <div style={caption}>{result.passed ? 'Threshold reached.' : result.run.status === 'change_approach' ? 'Attempt cap reached.' : 'A teach-back is available before a fresh retest.'}</div>
          </div>
          {result.teachBack?.available && <button type="button" onClick={()=>{ onStartTeach?.(result.teachBack.config); close(); }} style={primary}>Teach this topic back</button>}
          {result.teachBack?.available && <button type="button" disabled={busy} onClick={retest} style={secondary}>I have taught it back — prepare a fresh retest</button>}
          {result.changeApproach?.required && <p style={body}>{result.changeApproach.reason}</p>}
          <button type="button" onClick={close} style={secondary}>Done</button>
        </div>}
      </div>
    </div>
  );
}
const overlay={position:'fixed',inset:0,zIndex:1600,background:'rgba(15,23,42,.64)',display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'20px 12px',backdropFilter:'blur(3px)'};
const sheet={width:'min(680px,100%)',maxHeight:'calc(100vh - 30px)',overflowY:'auto',background:'var(--ak-surface)',border:'1px solid var(--ak-border2)',borderRadius:20,padding:18,boxShadow:'0 24px 80px rgba(0,0,0,.35)'};
const header={display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:15}; const caption={fontSize:11,color:'var(--ak-text-muted)',fontWeight:650,lineHeight:1.4}; const body={fontSize:12.5,lineHeight:1.55,color:'var(--ak-text-sub)',margin:0}; const label={display:'grid',gap:5,fontSize:11,fontWeight:800,color:'var(--ak-text-sub)'}; const input={width:'100%',boxSizing:'border-box',padding:'10px 11px',borderRadius:10,border:'1px solid var(--ak-border2)',background:'var(--ak-surface-hover)',color:'var(--ak-text)',font:'inherit'}; const primary={border:0,borderRadius:11,padding:'11px 14px',background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:'#fff',fontWeight:850,fontSize:12.5,cursor:'pointer'}; const secondary={border:'1px solid var(--ak-border2)',borderRadius:11,padding:'10px 14px',background:'var(--ak-surface-hover)',color:'var(--ak-text-sub)',fontWeight:800,fontSize:12.5,cursor:'pointer'}; const closeButton={border:0,background:'var(--ak-surface-hover)',color:'var(--ak-text-sub)',borderRadius:9,width:30,height:30,fontWeight:900,fontSize:20,cursor:'pointer'}; const errorBox={padding:'9px 11px',marginBottom:12,borderRadius:10,background:`${RED}12`,color:RED,border:`1px solid ${RED}35`,fontSize:12,fontWeight:700}; const questionBox={border:'1px solid var(--ak-border)',borderRadius:13,padding:12}; const optionStyle={display:'flex',gap:8,alignItems:'flex-start',padding:'8px 9px',border:'1px solid',borderRadius:9,fontSize:12.5,color:'var(--ak-text-sub)',cursor:'pointer'}; const resultBox={border:'1px solid',borderRadius:13,padding:15,display:'grid',gap:3,background:'var(--ak-surface-hover)'};
