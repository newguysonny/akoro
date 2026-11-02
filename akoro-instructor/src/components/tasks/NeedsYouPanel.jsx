/*
 * NeedsYouPanel — the instructor's "Needs you" list in the chat's Tasks tab
 * (Grand Plan Phase 18 item 2): prepared drafts to check, the agent's
 * proposals to decide, change cards. Categories and links come from the
 * server (GET /api/workflows/needs-you); a count is the length of its list.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../services/api.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export const NEEDS = [
  ['answer', 'Your turn', '#7C3AED', 'ti-pencil'],
  ['review', 'To check', '#0EA5E9', 'ti-file-check'],
  ['decision', 'Yes or no', '#7C3AED', 'ti-help-circle'],
  ['blocked', 'Stopped', '#F59E0B', 'ti-player-pause'],
  ['failed', "Didn't work", '#EF4444', 'ti-alert-triangle'],
];
const META = Object.fromEntries(NEEDS.map(([k, label, color, icon]) => [k, { label, color, icon }]));

export function useNeedsYou() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => apiGet('/api/workflows/needs-you').then((r) => { setData(r); setError(''); }).catch((e) => setError(e?.message || 'Could not load'));
  useEffect(() => { load(); }, []);
  return { data, error, reload: load, count: data?.counts?.total || 0 };
}

/** onChat — open the chat (proposals and change cards are answered there). */
export default function NeedsYouPanel({ state, onChat }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(null);
  const { data, error } = state;
  if (!data && !error) return <div className="skeleton" style={{ height: 62, borderRadius: 12 }} />;
  const items = data?.items || [];
  const counts = data?.counts || {};
  const shown = category ? items.filter((it) => it.category === category) : items;
  const open = (it) => {
    const href = it?.action?.href || '';
    if (!href || href.startsWith('/chat')) { if (onChat) onChat(); else navigate('/chat'); return; }
    navigate(href);
  };

  return (
    <div data-needs-you="" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: C.font }}>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {NEEDS.filter(([k]) => counts[k]).map(([k, label, color]) => (
            <button key={k} type="button" onClick={() => setCategory(category === k ? null : k)}
              style={{ border: `1px solid ${category === k ? color : C.border}`, background: category === k ? `${color}14` : 'transparent', color, borderRadius: 20, padding: '4px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
              {label} {counts[k]}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
          <Ico ti="ti-circle-check" size={32} color={C.muted} style={{ marginBottom: 10 }} />
          <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>Nothing is waiting for you.</p>
        </div>
      ) : shown.map((it) => {
        const m = META[it.category] || META.decision;
        return (
          <div key={it.ref} data-needs-item={it.category} style={{ display: 'flex', gap: 12, alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico ti={m.icon} size={16} color={m.color} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
              <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.waitsFor?.label}</div>
            </div>
            {it.action && (
              <button type="button" onClick={() => open(it)} style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 20, border: 'none', background: m.color, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                {it.action.label}
              </button>
            )}
          </div>
        );
      })}
      {error && <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{error}</p>}
    </div>
  );
}
