/**
 * AddRecordModal — "Add a record" for every learner. Three ways in: upload a
 * file, add a link, or paste the text straight in. Lives on the Library page
 * header (the + next to the title), reachable from any tier.
 *
 * SERVER-BACKED since the record viewer shipped: the shelf lives at
 * /api/records and follows the learner across devices. Uploads stream the
 * file's bytes straight to Cloudflare R2 via a presigned PUT (the API never
 * proxies them) with real progress, then register the row. The old
 * localStorage shelf is migrated once — link/paste records carry over
 * intact; upload records from before the viewer existed never stored their
 * bytes, so they migrate as details-only rows the viewer is honest about.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { XIcon, Icon } from '../common/Icons.jsx';
import {
  listRecords, presignRecordUpload, putFileTo, createRecord,
  setRecordProgress, deleteRecord,
} from '../../services/recordsApi.js';
import { autoExtractUpload } from '../library/extractPages.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';
const GREEN = '#10B981';

const MAX_FILES      = 4;
// Audio/video are big, but the bytes now go straight to R2 — this is a
// sanity guard mirroring the server's cap, not a storage budget.
const MAX_FILE_BYTES = 500 * 1024 * 1024;  // 500 MB per file
const MAX_TEXT_CHARS = 20_000;

// Any image, PDF, text file or audio/video: voice notes, recorded lessons,
// downloaded tutorials. MIME wildcards first; explicit extensions so every
// OS picker also matches by name.
const ACCEPT = 'image/*,application/pdf,audio/*,video/*,.txt,.md,.csv,.mp3,.m4a,.aac,.wav,.ogg,.flac,.mp4,.m4v,.mov,.webm,.mkv';
const isSupported = (f) =>
  /^(image|audio|video)\//.test(f.type) || f.type === 'application/pdf' ||
  /\.(txt|md|csv|mp3|m4a|aac|wav|ogg|flac|mp4|m4v|mov|webm|mkv)$/i.test(f.name);

/* ── Media records (audio/video) ── */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const mediaKindOf = (f) =>
  (/^audio\//.test(f?.type || '') || AUDIO_EXT.test(f?.name || '')) ? 'audio'
  : (/^video\//.test(f?.type || '') || VIDEO_EXT.test(f?.name || '')) ? 'video'
  : null;

/* 42 → "0:42", 3675 → "1:01:15" — record lengths worth reading at a glance. */
const fmtDur = (sec) => {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
};

/* KB under a meg, MB under a gig, GB beyond — "314572 KB" helps nobody. */
const fmtSize = (b) => {
  if (!b || b <= 0) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/* Best-effort duration probe: load a detached <audio>/<video> element's
   metadata via an object URL, take its duration, always clean the URL up.
   Unreadable formats just resolve null — never blocks saving. */
const probeDuration = (file) => new Promise((resolve) => {
  const kind = mediaKindOf(file);
  if (!kind || typeof document === 'undefined') { resolve(null); return; }
  let url = null, done = false;
  const finish = (v) => {
    if (done) return; done = true;
    try { if (url) URL.revokeObjectURL(url); } catch { /* ignore */ }
    resolve(v);
  };
  try {
    url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => finish(null);
    setTimeout(() => finish(Number.isFinite(el.duration) ? el.duration : null), 4000);
    el.src = url;
  } catch { finish(null); }
});

/* ── The old device-local shelf — read ONCE more, only to migrate it ── */
const legacyKey = (uid) => `akoro_records_${uid || 'me'}`;
const loadLegacy = (uid) => {
  try { const raw = JSON.parse(localStorage.getItem(legacyKey(uid)) || '[]'); return Array.isArray(raw) ? raw : []; }
  catch { return []; }
};
const saveLegacy = (uid, list) => {
  try { localStorage.setItem(legacyKey(uid), JSON.stringify(list)); } catch { /* private mode */ }
};

const KIND_ICON = { upload: 'ti-paperclip', link: 'ti-link', paste: 'ti-clipboard' };
const MEDIA_ICON = { audio: 'ti-music', video: 'ti-video' };
/* Upload rows show what they are: 🎵 audio, 🎬 video, paperclip for the rest
   (old records without a stored type simply keep the paperclip). */
const recordIcon = (r) => (r.kind === 'upload'
  ? MEDIA_ICON[mediaKindOf(r)] || 'ti-paperclip'
  : KIND_ICON[r.kind] || 'ti-file-text');

export default function AddRecordModal({ open, onClose, user, onOpenRecord, onRecordsChanged }) {
  const { t } = useLang();
  const [tab, setTab]           = useState('upload');
  const [records, setRecords]   = useState([]);
  const [listErr, setListErr]   = useState('');
  const [file, setFile]         = useState(null);   // chosen, not yet saved
  const [dur,  setDur]          = useState(null);   // its length, if audio/video
  const [link, setLink]         = useState('');
  const [text, setText]         = useState('');
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);  // a save/upload is in flight
  const [pct,  setPct]          = useState(0);      // upload progress 0-100
  const fileInputRef            = useRef(null);
  const uid = user?.id;

  const reload = useCallback(async () => {
    setListErr('');
    try {
      const list = await listRecords();
      setRecords(list);
      onRecordsChanged?.(list);
    } catch {
      setListErr(t('records.load_failed'));
    }
  }, [onRecordsChanged, t]);

  useEffect(() => {
    if (!open) return;
    setTab('upload'); setFile(null); setDur(null); setLink(''); setText(''); setErr(''); setPct(0); setBusy(false);
    reload();
    // One-time migration of the old device shelf — each record migrates
    // individually so a partial failure resumes cleanly next open.
    (async () => {
      const local = loadLegacy(uid);
      if (local.length === 0) return;
      const remaining = [];
      for (const r of local) {
        try {
          if (r.kind === 'upload') {
            await createRecord({ kind: 'upload', legacy: true, name: r.name, mime: r.type || '', size: r.size || 0, duration: r.duration });
          } else if (r.kind === 'link' && r.url) {
            await createRecord({ kind: 'link', url: r.url, name: r.name });
          } else if (r.kind === 'paste' && r.name) {
            await createRecord({ kind: 'paste', content: r.name, name: undefined });
          } else {
            continue;  // unrecognized — drop it rather than wedge the migration
          }
        } catch { remaining.push(r); }
      }
      saveLegacy(uid, remaining);
      if (remaining.length < local.length) reload();
    })();
  }, [open, uid, reload]);

  if (!open) return null;

  const persistDone = async (r, p) => {
    // Optimistic in the list; the server write is the truth.
    setRecords((rs) => rs.map(x => x.id === r.id ? { ...x, progress: p, lastOpenedAt: new Date().toISOString() } : x));
    try {
      await setRecordProgress(r.id, p);
      await reload();          // fresh list → parent's copy stays in step
    } catch { /* keep the optimistic row — next open re-syncs */ }
  };

  const saveUpload = async () => {
    if (!file) { setErr(t('records.no_file')); return; }
    if (!isSupported(file) || file.size > MAX_FILE_BYTES) { setErr(t('records.too_big')); return; }
    setBusy(true); setErr(''); setPct(0);
    try {
      // 1. presign → 2. PUT the bytes straight to R2 (progress!) → 3. register
      const { uploadUrl, fileKey } = await presignRecordUpload({ name: file.name, mime: file.type || '', size: file.size });
      await putFileTo(uploadUrl, file, setPct);
      const created = await createRecord({ kind: 'upload', fileKey, name: file.name, mime: file.type || '', size: file.size, duration: dur || undefined });
      // "Always extract" — parse it NOW, in this tab, so the text (and the
      // search index) is ready before anyone opens it. Silent, cancellable
      // by simply closing the tab; the reader's offer covers the rest.
      void autoExtractUpload(created);
      setFile(null); setDur(null); setPct(0);
      await reload();
    } catch (e) {
      setErr(e?.message || t('records.upload_failed'));
    } finally { setBusy(false); }
  };

  const saveLink = async () => {
    const url = link.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) { setErr(t('records.bad_link')); return; }
    setBusy(true); setErr('');
    try {
      await createRecord({ kind: 'link', url });
      setLink(''); await reload();
    } catch (e) {
      setErr(e?.message || t('records.bad_link'));
    } finally { setBusy(false); }
  };

  const savePaste = async () => {
    const body = text.trim();
    if (!body) { setErr(t('records.nothing_to_paste')); return; }
    setBusy(true); setErr('');
    try {
      await createRecord({ kind: 'paste', content: body });
      setText(''); await reload();
    } catch (e) {
      setErr(e?.message || t('records.nothing_to_paste'));
    } finally { setBusy(false); }
  };

  const save = tab === 'upload' ? saveUpload : tab === 'link' ? saveLink : savePaste;

  const removeRecord = async (id) => {
    const before = records;
    setRecords((rs) => rs.filter(r => r.id !== id));   // optimistic
    try { await deleteRecord(id); onRecordsChanged?.(before.filter(r => r.id !== id)); }
    catch { setRecords(before); }                       // roll back on failure
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(6,6,18,.55)', backdropFilter:'blur(5px)' }}/>
      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:2100, background:'var(--ak-surface)', borderRadius:'22px 22px 0 0', padding:'0 20px 46px', boxShadow:'0 -8px 40px rgba(0,0,0,.14)', animation:'sheet-up .3s cubic-bezier(.32,1.2,.64,1)', fontFamily:"'Nunito',sans-serif", maxHeight:'82vh', overflowY:'auto' }}>
        <div style={{ width:38, height:4, borderRadius:2, background:'var(--ak-border3)', margin:'14px auto 16px' }}/>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
          <div>
            <p style={{ fontSize:16, fontWeight:900, color:'var(--ak-text)', margin:'0 0 4px' }}>{t('records.title')}</p>
            <p style={{ fontSize:12, color:'var(--ak-text-muted)', margin:'0 0 14px', lineHeight:1.5 }}>{t('records.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.cancel')} style={{ background:'var(--ak-surface-hover)', border:'1px solid var(--ak-border2)', borderRadius:'50%', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <XIcon size={14} color="var(--ak-text-sub)"/>
          </button>
        </div>

        {/* Tabs — Upload / Link / Paste */}
        <div style={{ display:'flex', gap:6, background:'var(--ak-surface-hover)', borderRadius:14, padding:4, marginBottom:14 }}>
          {[['upload', 'ti-paperclip', t('records.tab_upload')], ['link', 'ti-link', t('records.tab_link')], ['paste', 'ti-clipboard', t('records.tab_paste')]].map(([key, icon, label]) => (
            <button key={key} onClick={() => { if (!busy) { setTab(key); setErr(''); } }} style={{ flex:1, padding:'9px 4px', borderRadius:11, border:'none', cursor:'pointer', fontSize:12, fontWeight:800, fontFamily:"'Nunito',sans-serif", background:tab===key?'var(--ak-surface)':'transparent', color:tab===key?BRAND:'var(--ak-text-muted)', boxShadow:tab===key?'0 1px 4px rgba(0,0,0,.08)':'none', transition:'all .15s', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}><Icon name={icon} size={12}/> {label}</button>
          ))}
        </div>

        {tab==='upload' && (
          <div>
            <button onClick={() => !busy && fileInputRef.current?.click()} style={{ width:'100%', padding:'22px 16px', borderRadius:14, border:`1.5px dashed ${BRAND}55`, background:`${BRAND}08`, cursor:busy?'default':'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:7, fontFamily:"'Nunito',sans-serif" }}>
              <Icon name={file ? (MEDIA_ICON[mediaKindOf(file)] || 'ti-paperclip') : 'ti-paperclip'} size={26} color={BRAND}/>
              <span style={{ fontSize:13, fontWeight:800, color:BRAND }}>{file ? file.name : t('records.choose_file')}</span>
              <span style={{ fontSize:10.5, fontWeight:600, color:'var(--ak-text-muted)' }}>{file ? `${fmtSize(file.size)}${fmtDur(dur) ? ` · ${fmtDur(dur)}` : ''}` : t('records.upload_hint')}</span>
            </button>
            <input ref={fileInputRef} type="file" accept={ACCEPT} style={{ display:'none' }} onChange={e => { const f = e.target.files?.[0] || null; setErr(''); setFile(f); setDur(null); if (f) probeDuration(f).then(setDur); e.target.value=''; }}/>
            {/* Upload progress — the bytes go straight to R2; this is real. */}
            {busy && tab==='upload' && pct > 0 && (
              <div style={{ marginTop:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, fontWeight:800, color:'var(--ak-text-muted)', marginBottom:5 }}>
                  <span>{t('records.uploading')}</span><span>{pct}%</span>
                </div>
                <div style={{ height:6, background:'var(--ak-border)', borderRadius:3, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${BRAND},#4C1DCC)`, borderRadius:3, transition:'width .2s' }}/>
                </div>
              </div>
            )}
          </div>
        )}

        {tab==='link' && (
          <div>
            <input value={link} onChange={e => { setLink(e.target.value); setErr(''); }} placeholder={t('records.link_ph')} style={{ width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid var(--ak-border2)', background:'var(--ak-surface-hover)', fontSize:13.5, fontWeight:600, color:'var(--ak-text)', fontFamily:"'Nunito',sans-serif", outline:'none', boxSizing:'border-box' }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor='var(--ak-border2)'}/>
            <p style={{ fontSize:10.5, color:'var(--ak-text-muted)', margin:'7px 2px 0', lineHeight:1.45 }}>{t('records.link_hint')}</p>
          </div>
        )}

        {tab==='paste' && (
          <div>
            <textarea value={text} onChange={e => { setText(e.target.value.slice(0, MAX_TEXT_CHARS)); setErr(''); }} placeholder={t('records.paste_ph')} rows={5} style={{ width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid var(--ak-border2)', background:'var(--ak-surface-hover)', fontSize:13, color:'var(--ak-text)', fontFamily:"'Nunito',sans-serif", outline:'none', resize:'vertical', lineHeight:1.55, boxSizing:'border-box' }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor='var(--ak-border2)'}/>
            <p style={{ fontSize:10.5, color:'var(--ak-text-muted)', margin:'6px 2px 0', textAlign:'right' }}>{text.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}</p>
          </div>
        )}

        {err && <p style={{ fontSize:12, fontWeight:800, color:RED, margin:'10px 2px 0' }}>{err}</p>}

        <button onClick={save} disabled={busy} style={{ width:'100%', marginTop:14, padding:'13px', borderRadius:14, border:'none', background:busy?'var(--ak-border)':`linear-gradient(135deg,${BRAND},#4C1DCC)`, color:'#fff', fontSize:13.5, fontWeight:800, cursor:busy?'default':'pointer', fontFamily:"'Nunito',sans-serif", boxShadow:busy?'none':`0 4px 14px ${BRAND}44`, display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
          {busy && tab==='upload' ? <><span className="ti ti-loader-2" style={{ fontSize:14, animation:'spin 1s linear infinite' }}/>{t('records.uploading')} {pct}%</> : t('records.save')}
        </button>

        {/* Synced to the account — the shelf follows the learner now. */}
        <p style={{ fontSize:10.5, fontWeight:700, color:'var(--ak-text-muted)', margin:'12px 2px 0', display:'flex', alignItems:'center', gap:5 }}>
          <Icon name="ti-cloud-up" size={12} color="var(--ak-text-muted)"/>{t('records.saved_cloud')}
        </p>

        <div style={{ marginTop:12, borderTop:'1px solid var(--ak-border)', paddingTop:12 }}>
          <p style={{ fontSize:12, fontWeight:900, color:'var(--ak-text)', margin:'0 0 8px' }}>{t('records.mine')}{records.length > 0 && <span style={{ color:BRAND }}> · {records.length}</span>}</p>
          {listErr && <p style={{ fontSize:12, color:RED, textAlign:'center', padding:'10px 0', margin:0 }}>{listErr}</p>}
          {!listErr && records.length === 0 ? (
            <p style={{ fontSize:12, color:'var(--ak-text-muted)', textAlign:'center', padding:'14px 0 4px' }}>{t('records.empty')}</p>
          ) : records.map(r => {
            const done = (r.progress || 0) >= 100;
            const missing = r.kind === 'upload' && r.fileMissing;
            return (
            <div key={r.id} onClick={() => !missing && onOpenRecord?.(r)}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 10px', borderRadius:11, background:'var(--ak-surface-hover)', border:'1px solid var(--ak-border)', marginBottom:6, cursor:(onOpenRecord && !missing) ? 'pointer':'default', opacity: missing ? .7 : 1 }}>
              <span style={{ flexShrink:0 }}><Icon name={missing ? 'ti-cloud-off' : recordIcon(r)} size={15}/></span>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12.5, fontWeight:800, color:done?'var(--ak-text-muted)':'var(--ak-text)', margin:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textDecoration:done?'line-through':'none' }}>{r.name}</p>
                <p style={{ fontSize:10, color:'var(--ak-text-muted)', margin:'1px 0 0' }}>
                  {missing ? `${t('records.file_missing_short')} · ` : ''}{done ? `${t('records.done_label')} · ` : ''}{r.duration ? `${fmtDur(r.duration)} · ` : ''}{r.size ? `${fmtSize(r.size)} · ` : ''}{new Date(r.createdAt || Date.now()).toLocaleDateString([], { month:'short', day:'numeric' })}
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); persistDone(r, (r.progress || 0) >= 100 ? 10 : 100); }} title={t('records.mark_done')} aria-label={t('records.mark_done')}
                style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, border:done?'none':'1.5px solid var(--ak-border2)', background:done?GREEN:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {done && <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </button>
              <button onClick={(e) => { e.stopPropagation(); removeRecord(r.id); }} aria-label={t('records.remove')} style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0, opacity:.55 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="2.4" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
