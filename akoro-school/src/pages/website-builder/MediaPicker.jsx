/**
 * Website Builder — media picker modal + insert-snippet helper.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { GREEN, BLUE, PURPLE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn } from './shared.jsx';

/* ── Media picker modal (insert media into content) ──────────────────────── */
export function MediaPicker({ open, onClose, onPick }) {
  const [media, setMedia] = useState(null);
  useEffect(() => {
    if (!open) return;
    setMedia(null);
    apiGet(`${BASE}/site-media?view=active`).then((r) => setMedia(r.data || [])).catch(() => setMedia([]));
  }, [open]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', overflowY: 'auto', background: C.surface, borderRadius: 16, padding: '20px 22px', fontFamily: C.font }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>Media Library</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted2 }}><Ico ti="ti-x" size={18} /></button>
        </div>
        {media === null ? <div style={{ textAlign: 'center', padding: 40, color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
          : media.length === 0 ? <p style={{ color: C.muted2, fontSize: 13, textAlign: 'center', padding: 30 }}>No media yet. Add some in the Media Library first.</p>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
              {media.map((m) => (
                <button key={m.id} onClick={() => onPick(m)} style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: 8, cursor: 'pointer', textAlign: 'left', fontFamily: C.font }}>
                  <div style={{ height: 84, borderRadius: 6, overflow: 'hidden', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                    {m.media_type === 'image' && m.url ? <img src={m.url} alt={m.alt_text || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 11, fontWeight: 800, color: C.muted2, textTransform: 'uppercase' }}>{m.media_type}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

// Build an HTML snippet for a media item to insert into page content.
const mediaSnippet = (m) => m.media_type === 'image'
  ? `\n<img src="${m.url}" alt="${(m.alt_text || m.title || '').replace(/"/g, '&quot;')}" style="max-width:100%" />\n`
  : m.media_type === 'video'
    ? `\n<video src="${m.url}" controls style="max-width:100%"></video>\n`
    : `\n<a href="${m.url}">${m.title || 'Download'}</a>\n`;

export { mediaSnippet };
