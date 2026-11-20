import { useState, useEffect, useRef } from 'react';
import { Icon } from '../../../components/common/Icons.jsx';
import { downloadBattleQuestionsPdf } from '../../../services/activityApi.js';

export default function BattleQuestionsTab({ m }) {
  const { isCompleted, battleId, initialBattle, answered, totalQ } = m;

  return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.40)', letterSpacing: .5 }}>{isCompleted ? 'ALL QUESTIONS' : 'ANSWERED SO FAR'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isCompleted && <QuestionsMenu battleId={battleId} title={initialBattle?.title} />}
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.28)', background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: '2px 9px' }}>{answered.length}{totalQ ? `/${totalQ}` : ''}</span>
                </div>
              </div>
              {answered.length === 0 && <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(255,255,255,.25)', fontSize: 13, fontWeight: 600 }}>{isCompleted ? 'No questions recorded.' : 'Questions appear here as they’re revealed…'}</div>}
              {[...answered].sort((a, b) => b.order - a.order).map((entry) => (
                <div key={entry.order} style={{ borderRadius: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)', padding: '12px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: 'rgba(255,255,255,.40)' }}>Q{entry.order}</span>
                    {entry.topic && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: 'rgba(232,136,74,.18)', color: '#E8884A' }}>{entry.topic}</span>}
                    {entry.myPick != null && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '1px 8px', borderRadius: 20, background: entry.myCorrect ? 'rgba(16,185,129,.18)' : 'rgba(239,68,68,.18)', color: entry.myCorrect ? "#4ADE80" : "#F87171", display:"inline-flex",alignItems:"center",gap:3 }}><Icon name={entry.myCorrect ? "ti-check" : "ti-x"} size={10}/>{entry.myCorrect ? 'Correct' : 'Wrong'}</span>}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.55, margin: '0 0 10px' }}>{entry.text}</p>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#4ADE80', flexShrink: 0, marginTop: 1 }}>ANSWER</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80', lineHeight: 1.45 }}>{entry.correctIndex != null ? entry.options[entry.correctIndex] : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
  );
}

/* The Questions tab's ⋮ menu on a finished battle: Download as PDF works;
   Create activity and Agent session are coming soon. */
function QuestionsMenu({ battleId, title }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const download = () => {
    setBusy(true); setErr('');
    downloadBattleQuestionsPdf(battleId, title)
      .then(() => setOpen(false))
      .catch((e) => setErr(e?.message || 'Could not get the PDF.'))
      .finally(() => setBusy(false));
  };
  const item = { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 12px', border: 'none', background: 'none', color: '#E2E8F0', fontSize: 12.5, fontWeight: 700, textAlign: 'left', fontFamily: 'inherit', borderRadius: 8 };
  const soon = <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.45)' }}>Soon</span>;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-label="Question options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 8, border: 'none', cursor: 'pointer', background: open ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.7)' }}>
        <Icon name="ti-dots-vertical" size={15} />
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 30, zIndex: 20, minWidth: 210, padding: 5, borderRadius: 12, background: '#1B2233', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 12px 32px rgba(0,0,0,.45)' }}>
          <button type="button" role="menuitem" onClick={download} disabled={busy} style={{ ...item, cursor: busy ? 'wait' : 'pointer' }}>
            <Icon name={busy ? 'ti-loader-2' : 'ti-file-type-pdf'} size={16} color="#F87171" />{busy ? 'Preparing PDF…' : 'Download as PDF'}
          </button>
          <button type="button" role="menuitem" aria-disabled="true" disabled style={{ ...item, cursor: 'default', color: 'rgba(255,255,255,.45)' }}>
            <Icon name="ti-clipboard-plus" size={16} color="rgba(255,255,255,.4)" />Create activity{soon}
          </button>
          <button type="button" role="menuitem" aria-disabled="true" disabled style={{ ...item, cursor: 'default', color: 'rgba(255,255,255,.45)' }}>
            <Icon name="ti-robot" size={16} color="rgba(255,255,255,.4)" />Agent session{soon}
          </button>
          {err && <div style={{ padding: '6px 12px 8px', fontSize: 11, color: '#F87171', lineHeight: 1.4 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
