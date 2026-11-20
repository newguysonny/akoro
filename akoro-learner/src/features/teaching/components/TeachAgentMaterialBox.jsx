// The session's material, one tap away (the content box above the composer).
import { BRAND, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';

export default function TeachAgentMaterialBox({ reader }) {
  const { content, openReader, topic } = reader;
  const materialBox = content ? (
    <button
      type="button"
      onClick={openReader}
      disabled={content.state !== 'ready'}
      title={content.state === 'ready' ? 'Open the material' : content.state === 'loading' ? 'Opening…' : (content.err || 'Material unavailable')}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px',
        borderRadius: 14, cursor: content.state === 'ready' ? 'pointer' : 'default',
        background: 'var(--ak-surface)', border: `1.5px solid ${content.state === 'ready' ? `${BRAND}45` : 'var(--ak-border2)'}`,
        opacity: content.state === 'ready' ? 1 : 0.75, textAlign: 'left',
        fontFamily: "'Nunito',sans-serif",
      }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: content.state === 'error' ? 'rgba(239,68,68,.12)' : `${BRAND}16` }}>
        {content.state === 'loading' ? <span className="ti ti-loader-2" style={{ fontSize: 16, color: BRAND, animation: 'tam-spin 1s linear infinite' }}/>
          : <Icon name={content.state === 'error' ? 'ti-cloud-off' : (content.box?.icon || 'ti-file-text')} size={16} color={content.state === 'error' ? RED : BRAND}/>}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{content.box?.title || topic}</span>
        <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {content.state === 'loading' ? 'Opening the material…' : content.state === 'error' ? (content.err || 'Couldn’t open this material.') : (content.box?.sub || 'Tap to open')}
        </span>
        {content.state === 'ready' && content.pct != null && (
          <span style={{ display: 'block', height: 3.5, borderRadius: 99, background: 'var(--ak-tag-bg)', marginTop: 5, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, content.pct))}%`, borderRadius: 99, background: `linear-gradient(90deg,${BRAND}AA,${BRAND})`, transition: 'width .4s' }}/>
          </span>
        )}
      </span>
      {content.state === 'ready' && <span className="ti ti-chevron-right" style={{ fontSize: 15, color: 'var(--ak-text-sub)', flexShrink: 0 }}/>}
    </button>
  ) : null;
  return materialBox;
}
