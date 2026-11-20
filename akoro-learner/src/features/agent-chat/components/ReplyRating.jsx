/*
 * ReplyRating — thumbs up / down under an Agent Chat reply (Grand Plan
 * Phase 18 item 4). Only for saved replies (a real message id). A thumbs-down
 * opens an optional reason; tapping the same thumb again clears it. Ratings
 * never reach the agent: the server keeps them apart from the chat's context.
 * The screen updates first and rolls back on an error.
 */
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { apiDelete, apiGet, apiPut } from '../../../services/api.js';
import { useLang } from '../../../contexts/LanguageContext.jsx';

const NUNITO = "'Nunito',sans-serif";
const RED = '#EF4444';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['agent.rate_reason_wrong', 'agent.rate_reason_not_asked', 'agent.rate_reason_long', 'agent.rate_reason_hard'];
export const ratableId = (msg) => {
  const id = msg?.serverId || msg?.id;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
};

/** The learner's ratings for the replies on screen: { [messageId]: 'up' | 'down' }, loaded once per id. */
export function useReplyRatings(messages) {
  const [ratings, setRatings] = useState({});
  const asked = useRef(new Set());
  const ids = (messages || []).filter((m) => m.from !== 'me').map(ratableId).filter(Boolean);
  const fresh = ids.filter((id) => !asked.current.has(id));
  const key = fresh.join(',');
  useEffect(() => {
    if (!key) return;
    const batch = key.split(',').slice(0, 100);
    batch.forEach((id) => asked.current.add(id));
    apiGet(`/api/adaptive/ratings?surface=agent_chat&ids=${batch.join(',')}`, { cache: false })
      .then((r) => {
        const rows = r?.ratings || [];
        if (rows.length) setRatings((prev) => ({ ...prev, ...Object.fromEntries(rows.map((x) => [String(x.message_id || x.messageId).toLowerCase(), x.rating])) }));
      })
      .catch(() => {});
  }, [key]);
  return [ratings, (id, value) => setRatings((prev) => ({ ...prev, [id]: value }))];
}

export default function ReplyRating({ messageId, value, onChange }) {
  const { t } = useLang();
  const [panel, setPanel] = useState(false);
  const [chips, setChips] = useState([]);
  const [text, setText] = useState('');
  const [thanks, setThanks] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/adaptive/ratings/agent_chat/${messageId}`;

  const rate = async (next) => {
    const before = value || null;
    const clearing = before === next;
    onChange(clearing ? null : next);
    setPanel(!clearing && next === 'down');
    setThanks(false);
    try {
      if (clearing) await apiDelete(url);
      else await apiPut(url, { rating: next });
    } catch { onChange(before); setPanel(false); }
  };
  const send = async () => {
    const reason = [...chips.map((k) => t(k)), text.trim()].filter(Boolean).join('. ').slice(0, 280);
    setBusy(true);
    try { if (reason) await apiPut(url, { rating: 'down', reason }); setPanel(false); setThanks(true); setChips([]); setText(''); }
    catch { /* the rating itself is saved; the reason can be tried again */ }
    finally { setBusy(false); }
  };
  const thumb = (dir) => {
    const on = value === dir;
    const color = dir === 'up' ? BRAND : RED;
    return (
      <button type="button" data-rate={dir} aria-pressed={on} onClick={() => rate(dir)}
        title={t(dir === 'up' ? 'agent.rate_up' : 'agent.rate_down')} aria-label={t(dir === 'up' ? 'agent.rate_up' : 'agent.rate_down')}
        style={{ background: on ? `${color}18` : 'none', border: 'none', borderRadius: 6, cursor: 'pointer', padding: 3, display: 'inline-flex', alignItems: 'center', color: on ? color : 'var(--ak-text-muted)' }}>
        <Icon name={dir === 'up' ? 'ti-thumb-up' : 'ti-thumb-down'} size={13} />
      </button>
    );
  };

  return (
    <>
      {thumb('up')}{thumb('down')}
      {thanks && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{t('agent.rate_thanks')}</span>}
      {panel && (
        <div data-reason-panel="" style={{ flexBasis: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', fontFamily: NUNITO }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>{t('agent.rate_what_wrong')} <span style={{ color: 'var(--ak-text-muted)', fontWeight: 600 }}>{t('agent.rate_optional')}</span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {REASONS.map((k) => {
              const on = chips.includes(k);
              return (
                <button key={k} type="button" onClick={() => setChips((c) => (on ? c.filter((x) => x !== k) : [...c, k]))}
                  style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${on ? BRAND : `${BRAND}40`}`, background: on ? `${BRAND}12` : 'transparent', color: BRAND, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: NUNITO }}>{t(k)}</button>
              );
            })}
          </div>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} placeholder={t('agent.rate_more')}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 12, fontFamily: NUNITO }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => { setPanel(false); setThanks(true); }} style={{ border: 'none', background: 'none', color: 'var(--ak-text-muted)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>{t('agent.rate_skip')}</button>
            <button type="button" disabled={busy} onClick={send} style={{ border: 'none', borderRadius: 20, padding: '6px 14px', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: NUNITO }}>{t('agent.rate_send')}</button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ak-text-muted)', marginTop: 6 }}>{t('agent.rate_private')}</div>
        </div>
      )}
    </>
  );
}
