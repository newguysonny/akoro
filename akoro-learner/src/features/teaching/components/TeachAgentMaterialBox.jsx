// The session's materials as a slim strip flush on top of the composer
// (2026-11-27, Matt — the Kilo-style strip + modal): the strip costs the
// chat one line; tapping it opens a translucent sheet listing the
// session's materials — and a material OPENS by tapping the material
// itself, no separate open button. The component takes a LIST so a
// session can carry more than one material; today's sessions pass one
// (reader.materials when a host supplies several, else the content).
import { useState } from 'react';
import { BRAND, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';

const FONT = "'Nunito',sans-serif";

export default function TeachAgentMaterialBox({ reader }) {
  const { content, openReader, topic } = reader;
  const [open, setOpen] = useState(false);
  const list = Array.isArray(reader.materials) && reader.materials.length
    ? reader.materials
    : (content ? [content] : []);
  if (!list.length) return null;

  const first = list[0];
  const ready = first.state === 'ready';

  const openMaterial = (item) => {
    setOpen(false);
    if (typeof item.onOpen === 'function') item.onOpen();
    else openReader();
  };

  const rowMeta = (item) => {
    const bits = [];
    if (Array.isArray(item.pages) && item.pages.length) bits.push(`${item.pages.length} ${item.pages.length === 1 ? 'page' : 'pages'}`);
    if (item.media?.kind) bits.push(item.media.kind === 'video' ? 'Video' : 'Audio');
    if (item.transcript) bits.push('Transcript');
    return bits.join(' · ');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { if (ready) setOpen(true); }}
        disabled={!ready}
        title={ready ? 'Session materials' : first.state === 'loading' ? 'Opening…' : (first.err || 'Material unavailable')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          borderRadius: 11, cursor: ready ? 'pointer' : 'default',
          background: 'var(--ak-surface)', border: '1px solid var(--ak-border)',
          opacity: ready ? 1 : 0.75, textAlign: 'left', fontFamily: FONT,
        }}>
        {first.state === 'loading'
          ? <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'tam-spin 1s linear infinite', flexShrink: 0 }} />
          : <Icon name={first.state === 'error' ? 'ti-cloud-off' : 'ti-list'} size={15} color={first.state === 'error' ? RED : BRAND} />}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {first.state === 'loading' ? 'Opening the material…'
            : first.state === 'error' ? (first.err || 'Couldn’t open this material.')
            : <><span style={{ fontWeight: 900, color: 'var(--ak-text)' }}>{list.length} {list.length === 1 ? 'content' : 'contents'}</span>{' in this session'}</>}
        </span>
        {ready && <span className="ti ti-chevron-up" style={{ fontSize: 14, color: 'var(--ak-text-sub)', flexShrink: 0 }} />}
      </button>

      {open && ready && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(20,16,34,.38)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} />
          <div className="ak-bottom-sheet-in" role="dialog" aria-label="Session materials"
            style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 121, maxWidth: 560, margin: '0 auto', boxSizing: 'border-box', background: 'color-mix(in srgb, var(--ak-surface) 84%, transparent)', backdropFilter: 'blur(20px) saturate(1.5)', WebkitBackdropFilter: 'blur(20px) saturate(1.5)', border: '1px solid var(--ak-border2)', borderRadius: 22, padding: '16px 14px 14px', fontFamily: FONT, animation: 'sheet-up .25s ease', boxShadow: '0 18px 50px rgba(15,8,40,.28)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '0 4px' }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 900, color: 'var(--ak-text)' }}>Session materials</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text-muted)' }}>{list.length} {list.length === 1 ? 'item' : 'items'}</span>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ border: 'none', background: 'var(--ak-tag-bg)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <span className="ti ti-x" style={{ fontSize: 16, color: 'var(--ak-text)' }} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((item, i) => {
                const itemReady = item.state === 'ready';
                const itemPct = itemReady && item.pct != null ? Math.max(0, Math.min(100, item.pct)) : null;
                const meta = rowMeta(item);
                return (
                  <button key={item.id || item.box?.title || i} type="button" disabled={!itemReady}
                    onClick={() => openMaterial(item)}
                    style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 12px', borderRadius: 16, background: 'color-mix(in srgb, var(--ak-bg) 72%, transparent)', border: '1px solid var(--ak-border2)', cursor: itemReady ? 'pointer' : 'default', opacity: itemReady ? 1 : 0.65, textAlign: 'left', fontFamily: FONT }}>
                    <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${BRAND}16` }}>
                      <Icon name={item.box?.icon || 'ti-file-text'} size={18} color={BRAND} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.box?.title || topic}</span>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[item.sourceName || item.box?.sub || '', meta].filter(Boolean).join(' · ')}
                      </span>
                      {itemPct != null && (
                        <span style={{ display: 'block', height: 4, borderRadius: 99, background: 'var(--ak-tag-bg)', marginTop: 6, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${itemPct}%`, borderRadius: 99, background: `linear-gradient(90deg,${BRAND}AA,${BRAND})` }} />
                        </span>
                      )}
                    </span>
                    {itemPct != null && (
                      <span style={{ fontSize: 11, fontWeight: 900, color: BRAND, flexShrink: 0 }}>{Math.round(itemPct)}%</span>
                    )}
                    {itemReady && <span className="ti ti-chevron-right" style={{ fontSize: 15, color: 'var(--ak-text-sub)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
