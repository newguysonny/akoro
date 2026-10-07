/**
 * ContentCreationPage — dedicated view for one generated creation (blog / post /
 * activity), opened from the past-creations row. Shows the full content, when it
 * was created, an AI-post pill (post directly / shows "Posted"), and copy.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Copy, Check, Clock, Loader2, ImagePlus, Trash2, Film } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiDelete, API } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, PURPLE, RED, FONT } from '../constants.js';
import { AiPostPill, BLOG_LABEL, fmtDateTime } from './content/parts.jsx';
import ContentView, { contentViewStyles } from '../components/ContentView.jsx';

const KIND_TITLE = { blog: 'Blog Post', social: 'Social Post', activity: 'Activity' };

export default function ContentCreationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);      // null = loading
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`/api/school/content/creations/${id}`)
      .then((r) => setC(r?.data || null))
      .catch(() => setNotFound(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(c?.content || ''); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };

  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const onPickMedia = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${API}/api/school/content/creations/${id}/media`, {
        method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd,
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Upload failed');
      setC(j.data); showToast('Media attached ✓');
    } catch (err) { showToast(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };
  const removeMedia = async () => {
    try { const r = await apiDelete(`/api/school/content/creations/${id}/media`); setC(r?.data || { ...c, media_url: null, media_type: null }); showToast('Media removed'); }
    catch (err) { showToast(err.message || 'Could not remove'); }
  };

  const subtypeBadge = () => {
    if (!c?.subtype) return null;
    const isBlog = c.kind === 'blog';
    const color = isBlog ? BLUE : PURPLE;
    const label = isBlog ? (BLOG_LABEL[c.subtype] || c.subtype) : c.subtype;
    return <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .4, color, background: `${color}12`, borderRadius: 20, padding: '3px 10px' }}>{label}</span>;
  };

  return (
    <PageLayout title={KIND_TITLE[c?.kind] || 'Creation'} subtitle="View and publish your generated content">
      <div style={{ maxWidth: 760 }}>
        <BackButton onClick={() => navigate(-1)} label="Back" />

        {notFound ? (
          <div style={{ fontFamily: FONT, color: MUTED }}>This creation was not found.</div>
        ) : c === null ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : (
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {subtypeBadge()}
                <AiPostPill creation={c} onUpdated={(u) => setC(u)} onToast={showToast} />
                <button onClick={copy} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: copied ? GREEN : MUTED, fontSize: 12.5, fontWeight: 700, fontFamily: FONT }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: INK, fontFamily: FONT }}>{c.topic || 'Untitled'}</div>
              <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT }}>
                <Clock size={11} /> {fmtDateTime(c.created_at)}
                {c.posted_at && <span style={{ color: GREEN, fontWeight: 700, marginLeft: 8 }}>· Posted {(c.posted_channels || []).length ? `to ${c.posted_channels.join(', ')}` : ''}</span>}
              </div>
            </div>
            {/* Media attachment */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 10, fontFamily: FONT }}>Media {c.media_url ? '' : '(needed for Instagram / TikTok)'}</div>
              {c.media_url ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  {c.media_type === 'video'
                    ? <video src={c.media_url} controls style={{ width: 200, borderRadius: 10, border: `1px solid ${BORDER}` }} />
                    : <img src={c.media_url} alt="attachment" style={{ width: 160, borderRadius: 10, border: `1px solid ${BORDER}` }} />}
                  <button onClick={removeMedia} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><Trash2 size={14} /> Remove</button>
                </div>
              ) : (
                <>
                  <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onPickMedia} style={{ display: 'none' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 800, cursor: uploading ? 'default' : 'pointer', fontFamily: FONT }}>
                    {uploading ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <ImagePlus size={15} />}{uploading ? 'Uploading…' : 'Attach image or video'}
                  </button>
                </>
              )}
            </div>

            <div style={{ background: LIGHT }}>
              <ContentView content={c.content} kind={c.kind} />
            </div>
          </div>
        )}
      </div>

      <style>{contentViewStyles}</style>
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
