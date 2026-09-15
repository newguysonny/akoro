/*
 * NowGrading — the instructor's answer to the learner app's NowStudying bar.
 *
 * Grading autosaves locally until publish, so a closed tab or a dead network
 * never loses a half-marked submission. This strip surfaces those drafts:
 * who, what, and one tap to resume exactly where it stopped.
 */
import { useState, useEffect } from 'react';
import { X, Play } from 'lucide-react';
import { listDrafts, clearDraft } from './gradingDrafts.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, FONT } from '../../constants.js';

const fmtAgo = (ts) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export default function NowGrading({ onResume }) {
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    const load = () => setDrafts(listDrafts().slice(0, 3));
    load();
    const t = setInterval(load, 4000);   // drafts save as the teacher works
    return () => clearInterval(t);
  }, []);

  if (!drafts.length) return null;

  const dismiss = (d, e) => {
    e.stopPropagation();
    clearDraft(d.assignmentId, d.studentId);
    setDrafts(ds => ds.filter(x => !(x.assignmentId === d.assignmentId && x.studentId === d.studentId)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, fontFamily: FONT }}>
      {drafts.map(d => (
        <div key={`${d.assignmentId}:${d.studentId}`} onClick={() => onResume?.(d)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, background: `linear-gradient(135deg, ${WHITE}, #FFF9F0)`,
            border: `1px solid ${AMBER}44`, borderRadius: 14, padding: '11px 14px', cursor: 'pointer',
            boxShadow: '0 1px 6px rgba(33,31,53,.05)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = AMBER; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = `${AMBER}44`; }}>
          <span style={{ fontSize: 20 }}>{d.emoji || '🧑‍🎓'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>
              Now grading — {d.studentName}
            </div>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.assignmentTitle}{d.subject ? ` · ${d.subject}` : ''} · draft from {fmtAgo(d.savedAt || 0)}
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 9, background: AMBER, color: WHITE, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
            <Play size={11} /> Continue
          </span>
          <button onClick={(e) => dismiss(d, e)} title="Discard this draft"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, display: 'flex', padding: 3, flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
