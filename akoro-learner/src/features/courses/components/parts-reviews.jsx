/**
 * Course details — course reviews and the review form.
 */
import { useState } from 'react';
import { Star, Check } from 'lucide-react';
import { API } from '../../../services/api.js';
import { Avatar, Btn } from './parts-ui.jsx';
import { card, INK, MUTED2, BORDER, GOLD, FONT, RV_BG, initialsOf } from './parts-rules.js';

// Post a course review (enrolled learners only). Returns the saved review.
async function submitCourseReview(courseId, rating, comment) {
  const r = await fetch(`${API}/api/courses/${courseId}/reviews`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Please sign in to review');
  if (r.status === 403) throw new Error('Enrol in this course to leave a review');
  if (!r.ok) throw new Error(d.message || 'Could not post review');
  return d.data || d;
}

function ReviewForm({ courseId }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!rating || busy) return;
    setBusy(true); setErr('');
    try { await submitCourseReview(courseId, rating, text.trim()); setPosted(true); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (posted) return (
    <div style={{ ...card, padding: 16, marginBottom: 14, fontSize: 13.5, fontWeight: 700, color: '#2AA76E' }}><Check size={13} style={{ display: "inline-block", verticalAlign: "-2px" }} /> Thanks for your review!</div>
  );
  return (
    <div style={{ ...card, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, marginBottom: 8 }}>Rate this course</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1 }}>
            <Star size={24} fill={i <= rating ? GOLD : 'none'} color={i <= rating ? GOLD : '#CFC8BC'} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Share what you thought… (optional)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 13, color: INK, background: '#fff', outline: 'none', resize: 'vertical' }} />
      {err && <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginTop: 6 }}>{err}</div>}
      <Btn variant="primary" onClick={submit} style={{ marginTop: 10, opacity: (!rating || busy) ? .6 : 1 }}>{busy ? 'Posting…' : 'Submit review'}</Btn>
    </div>
  );
}

function Reviews({ reviews, courseId, canReview }) {
  const data = reviews?.length
    ? reviews.map((r, i) => ({ initials: initialsOf(r.name), bg: RV_BG[i % RV_BG.length], name: r.name, rating: r.rating, date: r.date, text: r.text }))
    : [
        { initials: 'CO', bg: '#D4EAD8', name: 'Chukwuemeka O.', rating: 5, date: '2 days ago', text: 'The lessons finally made calculus click for me. Loved the worked examples.' },
        { initials: 'NA', bg: '#E4D4F0', name: 'Ngozi A.', rating: 5, date: '1 week ago', text: 'Clear, well-paced and the quizzes really help retention.' },
        { initials: 'BF', bg: '#C8D8E8', name: 'Babatunde F.', rating: 4, date: '2 weeks ago', text: 'Solid course. Would love even more practice questions.' },
      ];
  return (
    <div>
      {canReview && courseId && <ReviewForm courseId={courseId} />}
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
      {data.map((r, i) => (
        <div key={i} style={{ ...card, padding: 18, flex: '0 0 min(320px,82vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar initials={r.initials} bg={r.bg} size={40} />
            <div><div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{r.name}</div><div style={{ fontSize: 11, color: MUTED2 }}>Student</div></div>
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: '#E8F8EE', color: '#2AA76E' }}>Verified</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex' }}>{[...Array(r.rating)].map((_, j) => <Star key={j} size={12} fill={GOLD} strokeWidth={0} />)}</div>
            <span style={{ fontSize: 11, color: MUTED2 }}>{r.date}</span>
          </div>
          <p style={{ fontSize: 13.5, color: '#3A3A52', lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>"{r.text}"</p>
        </div>
      ))}
      </div>
    </div>
  );
}

export { Reviews };
