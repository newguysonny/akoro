// The session's material as a slim strip flush on top of the composer
// (2026-11-27, Matt — the Kilo-style strip + modal, same component as the
// session overview): the strip costs the chat one line; the material's
// details and files show only when the strip opens its modal sheet.
import { useState } from 'react';
import { BRAND, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';

const FONT = "'Nunito',sans-serif";

export default function TeachAgentMaterialBox({ reader }) {
  const { content, openReader, topic } = reader;
  const [open, setOpen] = useState(false);
  if (!content) return null;

  const ready = content.state === 'ready';
  const title = content.box?.title || topic;
  const pct = ready && content.pct != null ? Math.max(0, Math.min(100, content.pct)) : null;
  const pageCount = Array.isArray(content.pages) && content.pages.length ? content.pages.length : null;
  const mediaKind = content.media?.kind || null;

  const openMaterial = () => { setOpen(false); openReader(); };

  return (
    <>
      <button
        type="button"
        onClick={() => { if (ready) setOpen(true); }}
        disabled={!ready}
        title={ready ? 'Session material' : content.state === 'loading' ? 'Opening…' : (content.err || 'Material unavailable')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          borderRadius: 14, cursor: ready ? 'pointer' : 'default',
          background: 'var(--ak-surface)', border: `1.5px solid ${ready ? `${BRAND}45` : 'var(--ak-border2)'}`,
          opacity: ready ? 1 : 0.75, textAlign: 'left', fontFamily: FONT,
        }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: content.state === 'error' ? 'rgba(239,68,68,.12)' : `${BRAND}16` }}>
          {content.state === 'loading'
            ? <span className="ti ti-loader-2" style={{ fontSize: 15, color: BRAND, animation: 'tam-spin 1s linear infinite' }} />
            : <Icon name={content.state === 'error' ? 'ti-cloud-off' : (content.box?.icon || 'ti-file-text')} size={15} color={content.state === 'error' ? RED : BRAND} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {content.state === 'loading' ? 'Opening the material…' : content.state === 'error' ? (content.err || 'Couldn’t open this material.') : title}
        </span>
        {pct != null && (
          <span style={{ fontSize: 11, fontWeight: 900, color: BRAND, flexShrink: 0 }}>{Math.round(pct)}%</span>
        )}
        {ready && <span className="ti ti-chevron-up" style={{ fontSize: 15, color: 'var(--ak-text-sub)', flexShrink: 0 }} />}
      </button>

      {open && ready && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)' }} />
          <div className="ak-bottom-sheet-in" role="dialog" aria-label="Session material"
            style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 121, background: 'var(--ak-surface)', borderRadius: '20px 20px 0 0', padding: '14px 18px 30px', fontFamily: FONT, animation: 'sheet-up .25s ease', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--ak-tag-bg)', margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 900, color: 'var(--ak-text)' }}>Session material</span>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ border: 'none', background: 'var(--ak-tag-bg)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <span className="ti ti-x" style={{ fontSize: 16, color: 'var(--ak-text)' }} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 14, background: 'var(--ak-bg)', border: '1px solid var(--ak-border2)' }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${BRAND}16` }}>
                <Icon name={content.box?.icon || 'ti-file-text'} size={18} color={BRAND} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {content.sourceName || content.box?.sub || ''}
                </span>
              </span>
            </div>

            {(pageCount || mediaKind || content.transcript) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
                {pageCount ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, background: 'var(--ak-tag-bg)', fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)' }}>
                    <Icon name="ti-file-text" size={12} color={BRAND} /> {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                  </span>
                ) : null}
                {mediaKind ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, background: 'var(--ak-tag-bg)', fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)' }}>
                    <Icon name={mediaKind === 'video' ? 'ti-player-play' : 'ti-headphones'} size={12} color={BRAND} /> {mediaKind === 'video' ? 'Video' : 'Audio'}
                  </span>
                ) : null}
                {content.transcript ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, background: 'var(--ak-tag-bg)', fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)' }}>
                    <Icon name="ti-align-left" size={12} color={BRAND} /> Transcript attached
                  </span>
                ) : null}
              </div>
            )}

            {pct != null && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)', marginBottom: 6 }}>
                  <span>{mediaKind === 'video' ? 'Watched' : 'Read'}</span><span>{Math.round(pct)}%</span>
                </div>
                <span style={{ display: 'block', height: 6, borderRadius: 99, background: 'var(--ak-tag-bg)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: `linear-gradient(90deg,${BRAND}AA,${BRAND})` }} />
                </span>
              </div>
            )}

            <button onClick={openMaterial}
              style={{ display: 'block', width: '100%', marginTop: 18, background: BRAND, color: '#fff', border: 'none', fontFamily: FONT, fontWeight: 900, fontSize: 14, padding: 13, borderRadius: 14, cursor: 'pointer' }}>
              {mediaKind === 'video' ? 'Watch the lesson' : 'Open the material'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
