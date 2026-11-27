/** StatCards — dashboard stat grid used by the mgmt module dashboards. */
import { useNavigate } from 'react-router-dom';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export default function StatCards({ cards, loading }) {
  const navigate = useNavigate();
  if (loading) return <div style={{ padding: '50px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
      {cards.map((c) => (
        <div key={c.label} onClick={() => c.to && navigate(c.to)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', cursor: c.to ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: tint(8, c.c), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ico lucide={c.icon} ti={c.ti} size={19} color={c.c} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{c.n ?? 0}</div>
            <div style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
