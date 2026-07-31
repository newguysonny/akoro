import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Plus, Check } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, ACCENT, FONT } from '../constants.js';

export default function ManageBusinessesPage() {
  const { startups, current, currentId, setCurrentId, refresh } = useStartup();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.name}"? This can't be undone — only possible because it has no voucher history yet.`)) return;
    setBusyId(s.id); setErr('');
    try {
      await apiDelete(`/api/vouchers/startups/${s.id}`);
      await refresh();
    } catch (e) {
      setErr(e.message || 'Could not delete this business');
    } finally { setBusyId(null); }
  };

  if (!startups) return null;

  return (
    <PageLayout title="Manage businesses" subtitle="Every business you own — switch, review, or remove one"
      action={<button onClick={() => navigate('/create-startup')} style={primaryBtn}><Plus size={14} /> Create business</button>}>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 700, marginBottom: 16 }}>{err}</div>}

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        {startups.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No businesses yet.</div>
        ) : startups.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setCurrentId(s.id)} title="Set as current" style={{
                width: 20, height: 20, borderRadius: '50%', border: `2px solid ${s.id === currentId ? GREEN : BORDER}`,
                background: s.id === currentId ? GREEN : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
              }}>
                {s.id === currentId && <Check size={12} color="#fff" />}
              </button>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 2 }}>
                  ${Number(s.credit_rate_usd).toFixed(2)} / credit · {s.slug}
                  {s.id === currentId && <span style={{ color: GREEN, fontWeight: 800 }}> · current</span>}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, color: s.status === 'active' ? GREEN : MUTED2, background: s.status === 'active' ? `${GREEN}14` : `${MUTED2}14` }}>{s.status}</span>
              <button onClick={() => remove(s)} disabled={busyId === s.id} title="Delete (only if it has no voucher history)"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, opacity: busyId === s.id ? 0.5 : 1 }}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}

const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
