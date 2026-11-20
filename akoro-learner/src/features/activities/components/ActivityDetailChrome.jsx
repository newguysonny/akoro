import Spinner from '../../../components/common/Spinner.jsx';
import { Icon } from '../../../components/common/Icons.jsx';

/* ── Glass chip (hero meta) ─────────────────────────────────────────────── */
function Chip({ children, dot }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 20,
      background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.22)',
      fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: "'Nunito',sans-serif",
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

export function ActivityHeader({ navigate, t, row, due, st }) {
  return (
    <div style={{ flexShrink: 0, padding: 'calc(10px + env(safe-area-inset-top)) 14px 0' }}>
      <div style={{
        position: 'relative', maxWidth: 760, margin: '0 auto', padding: '14px 18px 16px', color: '#fff', overflow: 'hidden', borderRadius: 18,
        background: `linear-gradient(135deg, ${t.mid}, ${t.dark})`,
      }}>
        <div aria-hidden style={{ position: 'absolute', right: -34, top: -46, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,.12)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <button onClick={() => navigate('/activities')} aria-label="Back"
            style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.26)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', flexShrink: 0, padding: 0 }}>
            <Icon name="ti-chevron-left" size={15}/>
          </button>
          <Icon name={t.icon} size={14} color="#fff"/>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.92 }}>{t.label}</span>
        </div>
        <h2 style={{ position: 'relative', fontSize: 19, fontWeight: 900, margin: '0 0 10px', letterSpacing: '-0.01em', lineHeight: 1.3 }}>{row.title}</h2>
        <div style={{ position: 'relative', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {due && <Chip dot="#F59E0B">Due {due}</Chip>}
          <Chip dot={st.color}>{st.label}</Chip>
          {row.subject && <Chip>{row.subject}</Chip>}
          {row.assignedBy && <Chip>Set by {row.assignedBy}</Chip>}
        </div>
      </div>
    </div>
  );
}

export function ActivityFooter({ navigate, row, isDone, t, submitting, uploading, onSubmit }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: 'var(--ak-surface)', boxShadow: '0 -8px 20px rgba(17,24,39,.07)' }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>
        {row.graded ? `Graded · ${row.grade}%` : isDone ? 'Submitted' : row.subject || row.topic || t.label}
      </span>
      {!isDone && !row.graded ? (
        <button onClick={onSubmit} disabled={submitting || uploading}
          style={{ marginLeft: 'auto', padding: '12px 22px', borderRadius: 20, border: 'none', cursor: submitting ? 'default' : 'pointer', background: `linear-gradient(135deg, ${t.mid}, ${t.dark})`, color: '#fff', fontSize: 13.5, fontWeight: 800, boxShadow: '0 10px 20px -8px rgba(17,24,39,.4)', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {submitting ? <Spinner size={13}/> : <><Icon name="ti-send" size={14}/> Submit work</>}
        </button>
      ) : (
        <button onClick={() => navigate('/activities')}
          style={{ marginLeft: 'auto', padding: '12px 22px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
          Back to activities
        </button>
      )}
    </div>
  );
}
