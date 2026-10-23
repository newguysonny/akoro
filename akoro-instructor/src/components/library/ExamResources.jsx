/**
 * ExamResources — the exam assets the instructor has unlocked (past papers,
 * mark schemes and the like). They used to sit on the Tools & Assets page; they
 * live in the Library now. Browsing and buying stays in the App Center.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../services/api.js';
import { GREEN } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export function useExamResources() {
  const [state, setState] = useState({ items: null, error: false });
  useEffect(() => {
    apiGet('/api/instructor/tools')
      .then((res) => setState({ items: (res.assets || []).filter((a) => a.owned), error: false }))
      .catch(() => setState({ items: [], error: true }));
  }, []);
  return state;
}

export default function ExamResources({ items }) {
  const navigate = useNavigate();
  if (items === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 84, borderRadius: 14, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 2px' }}>
        <p style={{ fontSize: 11, fontWeight: 900, color: C.brand, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0 }}>Exam resources</p>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{items.length} unlocked</span>
      </div>
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: C.muted2, fontSize: 13.5, lineHeight: 1.6 }}>
          You haven’t unlocked any assets yet.<br />
          <button type="button" onClick={() => navigate('/apps')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.brand, fontWeight: 800, fontSize: 13.5, fontFamily: C.font }}>Browse the App Center →</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{ background: C.surface, border: `1px solid ${GREEN}40`, borderRadius: 14, padding: '13px 15px', display: 'flex', gap: 13, alignItems: 'flex-start', fontFamily: C.font }}>
              <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 11, background: tint(7), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21 }}>{it.emoji || '📘'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{it.name}</span>
                  {it.tag && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: tint(7), color: C.brand }}>{it.tag}</span>}
                </div>
                {it.description && <p style={{ fontSize: 12.5, color: C.muted, margin: '5px 0 0', lineHeight: 1.55 }}>{it.description}</p>}
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 10, background: `${GREEN}15`, color: GREEN, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                <Ico ti="ti-check" size={13} /> Unlocked
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
