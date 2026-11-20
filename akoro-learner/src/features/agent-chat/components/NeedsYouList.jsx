/*
 * NeedsYouList — the Agent Chat Tasks tab's "Needs you" list (Grand Plan
 * Phase 18 item 2, Phase 11 descriptors). One list over everything that waits
 * for the learner: workflows, suggestions, failed proposals, change and
 * permission cards, uploads. Categories, labels and routes come from the
 * server (GET /api/workflows/dashboard), worked out from state — never from
 * reply text; a count is always the length of the list it links to.
 * Healthy running work shows as one small "Working on" line.
 */
import { useEffect, useState } from 'react';
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { apiGet } from '../../../services/api.js';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { WorkflowStateBadge } from './StreamCards.jsx';

const NUNITO = "'Nunito',sans-serif";
export const NEEDS_CATEGORIES = [
  ['answer', 'agent.needs_answer', BRAND, 'ti-pencil'],
  ['review', 'agent.needs_review', '#0EA5E9', 'ti-file-check'],
  ['decision', 'agent.needs_decision', '#7C3AED', 'ti-help-circle'],
  ['blocked', 'agent.needs_blocked', '#F59E0B', 'ti-player-pause'],
  ['failed', 'agent.needs_failed', '#EF4444', 'ti-alert-triangle'],
];
const META = Object.fromEntries(NEEDS_CATEGORIES.map(([k, label, color, icon]) => [k, { label, color, icon }]));

/** Loads the list; the Tasks tab uses `count` for its badge. */
export function useNeedsYou() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => apiGet('/api/workflows/dashboard', { cache: false })
    .then((r) => { setData(r?.data || r || null); setError(''); })
    .catch((e) => setError(e?.message || 'error'));
  useEffect(() => { load(); }, []);
  return { data, error, reload: load, count: data?.needsYou?.counts?.total || 0 };
}

/**
 * onOpen(item) — the Tasks tab follows the item's link: inbox items open the
 * Suggestions list, chat items the chat, workflow items their screen.
 */
export default function NeedsYouList({ state, onOpen }) {
  const { t } = useLang();
  const [category, setCategory] = useState(null);
  const { data, error } = state;
  const items = data?.needsYou?.items || [];
  const counts = data?.needsYou?.counts || {};
  const working = (data?.workflows || []).filter((w) => !w.needsYou && w.action);
  const shown = category ? items.filter((it) => it.category === category) : items;

  if (!data && !error) return <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ak-text-muted)', fontSize: 12.5, fontWeight: 700, fontFamily: NUNITO }}>{t('common.loading')}</div>;
  return (
    <div data-needs-you="" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: NUNITO }}>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {NEEDS_CATEGORIES.filter(([k]) => counts[k]).map(([k, label, color]) => (
            <button key={k} type="button" onClick={() => setCategory(category === k ? null : k)}
              style={{ border: `1px solid ${category === k ? color : 'var(--ak-border2)'}`, background: category === k ? `${color}14` : 'transparent', color, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>
              {t(label)} {counts[k]}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--ak-text-muted)' }}>
          <Icon name="ti-circle-check" size={40} color="var(--ak-text-muted)" style={{ opacity: 0.3 }} />
          <p style={{ fontSize: 13, fontWeight: 700, marginTop: 8, maxWidth: 260, marginInline: 'auto', lineHeight: 1.5 }}>{t('agent.needs_empty')}</p>
        </div>
      ) : shown.map((it) => {
        const m = META[it.category] || META.decision;
        return (
          <div key={it.ref} data-needs-item={it.category} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 12px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={m.icon} size={16} color={m.color} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</p>
              <p style={{ fontSize: 11.5, color: 'var(--ak-text-sub)', margin: '2px 0 0', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[it.waitsFor?.label, it.progress?.label].filter(Boolean).join(' · ')}
              </p>
              {it.badge && <WorkflowStateBadge badge={it.badge} style={{ marginTop: 4 }}/>}
            </div>
            {it.action && (
              <button type="button" onClick={() => onOpen(it)}
                style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 20, border: 'none', background: m.color, color: '#fff', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.action.label}
              </button>
            )}
          </div>
        );
      })}
      {working.length > 0 && (
        <div data-working-on="" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
          <Icon name="ti-loader-2" size={13} />{t('agent.working_on')}
          {working.map((w) => (
            <button key={w.workflowId} type="button" onClick={() => onOpen({ action: { href: w.action.route?.href }, workflowId: w.workflowId })}
              style={{ border: '1px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>
              {w.title}{w.progress?.label ? ` · ${w.progress.label}` : ''}
            </button>
          ))}
        </div>
      )}
      {(data?.unavailable || []).length > 0 && <p style={{ fontSize: 11, color: 'var(--ak-text-muted)', margin: '2px 2px 0' }}>{t('agent.needs_partial')}</p>}
      {error && <p style={{ fontSize: 11.5, color: '#EF4444', fontWeight: 700, margin: 0 }}>{error}</p>}
    </div>
  );
}
