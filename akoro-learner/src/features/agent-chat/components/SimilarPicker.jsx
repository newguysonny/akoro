/**
 * SimilarPicker — "Find similar material" on a chat upload (Grand Plan §7.17,
 * D52): Akoro's own courses and blog posts on the upload's topics, each with
 * why it was offered; the learner ticks what goes into the folder.
 */
import { useState } from 'react';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { Icon } from '../../../components/common/Icons.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import { BRAND, GREEN } from '../../../constants.js';

const KIND_ICON = { course: 'ti-school', blog: 'ti-article' };

export default function SimilarPicker({ state, folderName, onAdd, onDismiss, onOpen }) {
  const { t } = useLang();
  const [picked, setPicked] = useState(() => new Set((state?.candidates || []).slice(0, 2).map((c) => c.key)));
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  if (state.loading) {
    return <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}><Spinner size={11} color={BRAND}/> {t('agent.similar_looking')}</p>;
  }
  if (state.done) {
    return (
      <div data-similar="done" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, fontWeight: 800, color: state.added?.length ? GREEN : 'var(--ak-text-muted)' }}>
        <Icon name={state.added?.length ? 'ti-folder-plus' : 'ti-circle-x'} size={13}/>
        {state.added?.length ? t('agent.similar_added').replace('{n}', String(state.added.length)).replace('{folder}', folderName || '') : t('agent.similar_none_added')}
      </div>
    );
  }
  const list = state.candidates || [];
  if (!list.length) return <p data-similar="empty" style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{t('agent.similar_empty')}</p>;
  const toggle = (key) => setPicked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const run = (fn) => async () => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div data-similar="offer" style={{ marginTop: 8 }}>
      <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5, color: 'var(--ak-text)' }}>
        {t('agent.similar_intro')} <b>{folderName}</b>:
      </p>
      <div style={{ border: '1px solid var(--ak-border2)', borderRadius: 14, overflow: 'hidden' }}>
        {list.map((c, i) => {
          const on = picked.has(c.key);
          return (
            <div key={c.key} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => toggle(c.key)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(c.key); } }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid var(--ak-border)' : 'none', cursor: 'pointer', background: 'var(--ak-surface)' }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${on ? BRAND : 'var(--ak-border2)'}`, background: on ? BRAND : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                {on && <Icon name="ti-check" size={12} color="#fff"/>}
              </span>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={KIND_ICON[c.kind] || 'ti-file-text'} size={15} color={BRAND}/>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.35 }}>{c.title}</p>
                <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)' }}>
                  {c.sub}
                  {onOpen && <> · <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(c.href); }} style={{ border: 'none', background: 'none', padding: 0, color: BRAND, fontWeight: 800, fontSize: 11, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>{t('agent.similar_view')}</button></>}
                </p>
              </div>
              {c.why && <span style={{ fontSize: 10.5, fontWeight: 800, color: GREEN, background: `${GREEN}14`, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>{c.why}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" disabled={busy || !picked.size} onClick={run(() => onAdd([...picked]))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 20, border: 'none', background: picked.size ? `linear-gradient(135deg,${BRAND},#4C1DCC)` : 'var(--ak-border)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: picked.size ? 'pointer' : 'default', fontFamily: "'Nunito',sans-serif" }}>
          {busy ? <Spinner size={11} color="#fff"/> : <Icon name="ti-folder-plus" size={13}/>} {t('agent.similar_add').replace('{n}', String(picked.size))}
        </button>
        <button type="button" disabled={busy} onClick={run(onDismiss)}
          style={{ padding: '7px 12px', borderRadius: 20, border: 'none', background: 'none', color: 'var(--ak-text-muted)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>{t('agent.similar_not_now')}</button>
      </div>
    </div>
  );
}
