/**
 * CreateFolderSheet.jsx — "Create a folder", opened from the Library
 * page's Add-to-library modal. A bottom sheet in the AddRecordModal
 * family with the four fields the product asked for:
 *
 *   folder name  required, ≤ 100 chars (the server's cap)
 *   cover image  optional — image only, ≤ 5 MB, rides the SAME
 *                presigned-PUT pipeline as record files (R2 or the
 *                Supabase fallback); preview before upload, removable
 *   description  optional, ≤ 500 chars with a live counter
 *   visibility   private (default) | public — a segmented toggle
 *
 * Creating is a three-step flow when a cover is chosen (presign →
 * PUT → register), exactly like a record upload, just smaller. The
 * folder lands on the page's folder strip via onCreated.
 */
import { useEffect, useRef, useState } from 'react';
import { XIcon, Icon } from '../common/Icons.jsx';
import { presignFolderCoverUpload, putFileTo, createFolder } from '../../services/recordsApi.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';

const MAX_NAME_CHARS  = 100;                 // the server's cap
const MAX_DESC_CHARS  = 500;                 // the server's cap
const MAX_COVER_BYTES = 5 * 1024 * 1024;     // the server's cap

export default function CreateFolderSheet({ open, onClose, onCreated }) {
  const [name, setName]       = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility]   = useState('private');
  const [cover, setCover]     = useState(null);   // { file, previewUrl }
  const [coverPct, setCoverPct] = useState(null); // while the cover PUTs
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const fileRef = useRef(null);

  /* Fresh fields every time the sheet opens. */
  useEffect(() => {
    if (open) {
      setName(''); setDescription(''); setVisibility('private');
      setCover(null); setCoverPct(null); setErr(''); setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  /* Clean up the preview's object URL whenever the cover changes/drops. */
  useEffect(() => () => { if (cover?.previewUrl) URL.revokeObjectURL(cover.previewUrl); }, [cover]);

  if (!open) return null;

  const pickCover = (e) => {
    const file = e.target?.files?.[0];
    e.target.value = '';   // let the same file be re-picked after remove
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { setErr('Cover images must be images — pick a PNG, JPG or WebP.'); return; }
    if (file.size > MAX_COVER_BYTES) { setErr('Cover images are capped at 5 MB.'); return; }
    setErr('');
    setCover({ file, previewUrl: URL.createObjectURL(file) });
  };

  const removeCover = () => setCover(null);

  const submit = async () => {
    const cleanName = name.trim();
    if (!cleanName) { setErr('Give the folder a name first.'); return; }
    if (cleanName.length > MAX_NAME_CHARS) { setErr(`Folder names are capped at ${MAX_NAME_CHARS} characters.`); return; }
    if (description.trim().length > MAX_DESC_CHARS) { setErr(`Descriptions are capped at ${MAX_DESC_CHARS} characters.`); return; }
    setErr(''); setBusy(true);
    try {
      // Cover first — the same presign → PUT → register dance as a record
      // upload, just image-only and small.
      let coverKey = null;
      if (cover?.file) {
        setCoverPct(0);
        const signed = await presignFolderCoverUpload({ name: cover.file.name, mime: cover.file.type, size: cover.file.size });
        await putFileTo(signed.uploadUrl, cover.file, setCoverPct);
        coverKey = signed.fileKey;
      }
      const folder = await createFolder({
        name: cleanName,
        description: description.trim(),
        visibility,
        coverKey,
      });
      onCreated?.(folder);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not create the folder — try again.');
      setBusy(false);
    } finally {
      setCoverPct(null);
    }
  };

  const field = (extra) => ({
    width: '100%', boxSizing: 'border-box', fontFamily: "'Nunito',sans-serif",
    background: 'var(--ak-surface-hover)', border: '1px solid var(--ak-border)',
    borderRadius: 12, padding: '11px 13px', fontSize: 13, fontWeight: 600,
    color: 'var(--ak-text)', outline: 'none', ...extra,
  });
  const label = { display: 'block', fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', margin: '0 0 6px' };

  return (
    <>
      <div onClick={() => !busy && onClose?.()} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,6,18,.55)', backdropFilter: 'blur(5px)' }} />
      <div className="ak-bottom-sheet" role="dialog" aria-label="Create a folder"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2100, background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0', padding: '0 20px 46px', boxShadow: '0 -8px 40px rgba(0,0,0,.14)', animation: 'sheet-up .3s cubic-bezier(.32,1.2,.64,1)', fontFamily: "'Nunito',sans-serif", maxHeight: '86vh', overflowY: 'auto' }}>

        {/* Head */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px' }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Create a folder</p>
            <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '2px 0 0' }}>Organize your library shelf</p>
          </div>
          <button onClick={() => !busy && onClose?.()} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <XIcon size={17} color="var(--ak-text-muted)" />
          </button>
        </div>

        {/* Folder name */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="folder-name" style={label}>Folder name</label>
          <input id="folder-name" value={name} maxLength={MAX_NAME_CHARS} disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Second semester past questions"
            style={field()} />
        </div>

        {/* Cover image */}
        <div style={{ marginBottom: 14 }}>
          <span style={label}>Cover image <span style={{ fontWeight: 600 }}>(optional)</span></span>
          {cover ? (
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)' }}>
              <img src={cover.previewUrl} alt="Folder cover preview"
                style={{ display: 'block', width: '100%', maxHeight: 150, objectFit: 'cover' }} />
              {coverPct !== null && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(6,6,18,.35)' }}>
                  <div style={{ height: '100%', width: `${coverPct}%`, background: BRAND, transition: 'width .2s' }} />
                </div>
              )}
              <button onClick={() => !busy && removeCover()} aria-label="Remove cover image"
                style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(6,6,18,.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-trash" size={15} />
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ ...field({ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer' }), color: 'var(--ak-text-muted)' }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="ti-photo" size={18} color={BRAND} />
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Add a cover</span>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>Image, up to 5 MB</span>
              </span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pickCover} style={{ display: 'none' }} />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="folder-desc" style={label}>Description <span style={{ fontWeight: 600 }}>(optional)</span></label>
          <textarea id="folder-desc" value={description} maxLength={MAX_DESC_CHARS} disabled={busy} rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What belongs in this folder?"
            style={field({ resize: 'vertical', minHeight: 74, lineHeight: 1.5 })} />
          <div style={{ textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 4 }}>
            {description.length}/{MAX_DESC_CHARS}
          </div>
        </div>

        {/* Visibility */}
        <div style={{ marginBottom: 16 }}>
          <span style={label}>Visibility</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { key: 'private', icon: 'ti-lock', title: 'Private', sub: 'Only you' },
              { key: 'public',  icon: 'ti-world', title: 'Public',  sub: 'Shared library (coming)' },
            ].map((v) => {
              const active = visibility === v.key;
              return (
                <button key={v.key} onClick={() => setVisibility(v.key)} disabled={busy}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                    border: `1.5px solid ${active ? BRAND : 'var(--ak-border)'}`,
                    background: active ? `${BRAND}10` : 'var(--ak-surface-hover)',
                    cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito',sans-serif",
                    opacity: busy ? .7 : 1 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? BRAND : 'var(--ak-border)', color: active ? '#fff' : 'var(--ak-text-muted)' }}>
                    <Icon name={v.icon} size={16} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>{v.title}</span>
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)' }}>{v.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error + submit */}
        {err && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: RED, marginBottom: 12 }}>
            <Icon name="ti-alert-circle" size={14} color={RED}/> {err}
          </div>
        )}
        <button onClick={submit} disabled={busy || !name.trim()}
          style={{ width: '100%', padding: '13px 0', borderRadius: 100, border: 'none', cursor: busy ? 'default' : 'pointer',
            background: busy || !name.trim() ? 'var(--ak-border)' : `linear-gradient(135deg, ${BRAND}, #4C1DCC)`,
            color: busy || !name.trim() ? 'var(--ak-text-muted)' : '#fff',
            fontSize: 13.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif",
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {busy ? <><span className="ti ti-loader-2" style={{ fontSize: 14, animation: 'spin 1s linear infinite' }}/> Creating…</> : 'Create folder'}
        </button>
      </div>
    </>
  );
}
