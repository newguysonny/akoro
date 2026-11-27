/**
 * ContentCreationPage — dedicated view for one generated creation (blog / post /
 * activity), opened from the past-creations row. Shows the full content, when it
 * was created, an AI-post pill (post directly / shows "Posted"), and copy.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiDelete, API } from '../services/api.js';
import { GREEN, BLUE, PURPLE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
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
    return <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .4, color, background: tint(7, color), borderRadius: 20, padding: '3px 10px' }}>{label}</span>;
  };

  return (
    <PageLayout title={KIND_TITLE[c?.kind] || 'Creation'} subtitle="View and publish your generated content">
      <div style={{ maxWidth: 760 }}>
        <BackButton onClick={() => navigate(-1)} label="Back" />

        {notFound ? (
          <div style={{ fontFamily: C.font, color: C.muted }}>This creation was not found.</div>
        ) : c === null ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted2, fontFamily: C.font }}><Ico ti="ti-loader-2" size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {subtypeBadge()}
                <AiPostPill creation={c} onUpdated={(u) => setC(u)} onToast={showToast} />
                <button onClick={copy} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: copied ? GREEN : C.muted, fontSize: 12.5, fontWeight: 700, fontFamily: C.font }}>
                  {copied ? <Ico ti="ti-check" size={14} /> : <Ico ti="ti-copy" size={14} />}{copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{c.topic || 'Untitled'}</div>
              <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: C.font }}>
                <Ico ti="ti-clock" size={11} /> {fmtDateTime(c.created_at)}
                {c.posted_at && <span style={{ color: GREEN, fontWeight: 700, marginLeft: 8 }}>· Posted {(c.posted_channels || []).length ? `to ${c.posted_channels.join(', ')}` : ''}</span>}
              </div>
            </div>
            {/* Media attachment */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 10, fontFamily: C.font }}>Media {c.media_url ? '' : '(needed for Instagram / TikTok)'}</div>
              {c.media_url ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  {c.media_type === 'video'
                    ? <video src={c.media_url} controls style={{ width: 200, borderRadius: 10, border: `1px solid ${C.border}` }} />
                    : <img src={c.media_url} alt="attachment" style={{ width: 160, borderRadius: 10, border: `1px solid ${C.border}` }} />}
                  <button onClick={removeMedia} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}><Ico ti="ti-trash" size={14} /> Remove</button>
                </div>
              ) : (
                <>
                  <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onPickMedia} style={{ display: 'none' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: 800, cursor: uploading ? 'default' : 'pointer', fontFamily: C.font }}>
                    {uploading ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-photo-plus" size={15} />}{uploading ? 'Uploading…' : 'Attach image or video'}
                  </button>
                </>
              )}
            </div>

            <div style={{ background: C.bg }}>
              <ContentView content={c.content} kind={c.kind} />
            </div>
          </div>
        )}
      </div>

      <style>{contentViewStyles}</style>
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
