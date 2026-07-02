/** StatCards — dashboard stat grid used by the mgmt module dashboards. */
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { INK, MUTED2, BORDER, WHITE, FONT } from '../../constants.js';

export default function StatCards({ cards, loading }) {
  const navigate = useNavigate();
  if (loading) return <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
      {cards.map((c) => (
        <div key={c.label} onClick={() => c.to && navigate(c.to)} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', cursor: c.to ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: `${c.c}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <c.icon size={19} color={c.c} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: INK, fontFamily: FONT }}>{c.n ?? 0}</div>
            <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
