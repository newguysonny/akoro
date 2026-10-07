/**
 * AddToFolderPage.jsx — "Add to Folder", ported 1:1 from
 * reference/Add to folder.md: the header with a back button, the
 * prominent New folder pill, the Find-folder search, the folder
 * rows with accent-gradient thumbs and radio multi-select, the
 * fixed Done pill and the toast. Only the chrome colours ride the
 * app's --ak-* theme tokens (light/dark follows the app), exactly
 * like the Pharm.D pages; the reference's accents are kept verbatim.
 *
 * One item goes into N folders: every content surface opens this
 * page with a snapshot { itemType, itemRef, title, sub, kind, link }
 * — a Pharm.D topic, a library record, a course lesson, a shelf
 * item. Done writes one bulk add (idempotent per folder) and toasts
 * "Added to N folder(s)".
 */
import { useEffect, useMemo, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import { listFolders, addFolderItem } from '../../services/recordsApi.js';
import CreateFolderSheet from './CreateFolderSheet.jsx';

/* The reference's four accents, verbatim. */
const ACCENTS = [
  'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
  'linear-gradient(145deg, #FF6B57, #C13F2E)',
  'linear-gradient(145deg, #2BB673, #167A4A)',
  'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
];

export default function AddToFolderPage({ item, onClose, onAdded }) {
  const [folders, setFolders]       = useState(null);   // null = loading
  const [query, setQuery]           = useState('');
  const [selected, setSelected]     = useState(() => new Set());
  const [busy, setBusy]             = useState(false);
  const [newOpen, setNewOpen]       = useState(false);
  const [toast, setToast]           = useState(null);

  /* Load the learner's folders (with counts) once per open. */
  useEffect(() => {
    let alive = true;
    listFolders()
      .then((fs) => { if (alive) setFolders(fs ?? []); })
      .catch(() => { if (alive) setFolders([]); });
    return () => { alive = false; };
  }, []);

  /* Escape returns to the previous screen, like the back button. */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy && !newOpen) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, newOpen, onClose]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    const list = folders ?? [];
    return q ? list.filter((f) => (f.name || '').toLowerCase().includes(q)) : list;
  }, [folders, query]);

  if (!item) return null;

  const toggle = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  /* New folder — the same Create sheet, created fresh → pre-selected. */
  const handleCreated = (f) => {
    setFolders((fs) => [{ ...f, itemCount: 0 }, ...(fs ?? [])]);
    setSelected((s) => new Set(s).add(f.id));
    setToast({ msg: `Folder “${f.name}” created`, color: BRAND });
  };

  /* Done — one bulk add of this item into every selected folder. */
  const finish = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const res = await addFolderItem({
        folderIds: [...selected],
        itemType: item.itemType, itemRef: item.itemRef,
        title: item.title, sub: item.sub, kind: item.kind, link: item.link,
      });
      const n = res?.added ?? selected.size;
      setToast({ msg: `Added to ${n} folder${n === 1 ? '' : 's'}`, color: BRAND });
      onAdded?.({ ...item, folderIds: [...selected] });
      setTimeout(() => onClose?.(), 650);   // let the toast land before leaving
    } catch (e) {
      setToast({ msg: e?.message || 'Could not add to the folder(s) — try again.', color: '#EF4444' });
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add to Folder" className="atf-page">
      <style>{`
        .atf-page{position:fixed;inset:0;z-index:1600;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#221D33)}
        .atf-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .atf-header{display:flex;align-items:center;gap:12px;padding:18px 16px 10px}
        .atf-header h1{flex:1;text-align:center;font-size:1.15rem;font-weight:800;margin:0;padding-right:36px;color:var(--ak-text,#221D33)}
        .atf-back{width:36px;height:36px;border-radius:50%;border:none;background:var(--ak-tag-bg,#F3F1FA);color:var(--ak-text,#221D33);font-size:1.1rem;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0}
        .atf-new{display:block;margin:18px auto 22px;padding:13px 26px;border-radius:100px;border:none;background:var(--ak-text,#221D33);color:var(--ak-bg,#FAFAFC);font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .atf-search{display:flex;align-items:center;gap:10px;background:var(--ak-surface-hover,#F3F1FA);border-radius:10px;padding:12px 14px;margin:0 20px 18px;color:var(--ak-text-sub,#6B667E)}
        .atf-search input{flex:1;background:none;border:none;color:var(--ak-text,#221D33);font-family:inherit;font-size:.92rem;outline:none}
        .atf-search input::placeholder{color:var(--ak-text-sub,#6B667E)}
        .atf-sort{display:flex;align-items:center;gap:10px;padding:0 20px 14px;color:var(--ak-text,#221D33);font-weight:800;font-size:.88rem}
        .atf-list{padding-bottom:100px}
        .atf-row{display:flex;align-items:center;gap:14px;padding:10px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .atf-row:hover{background:var(--ak-surface,#FFFFFF)}
        .atf-thumb{width:54px;height:54px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:1.3rem;overflow:hidden}
        .atf-thumb img{width:100%;height:100%;object-fit:cover;display:block}
        .atf-info{flex:1;min-width:0}
        .atf-info .f-name{font-weight:700;font-size:.98rem;color:var(--ak-text,#221D33);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .atf-info .f-count{font-size:.8rem;color:var(--ak-text-sub,#6B667E);font-weight:600;margin-top:2px}
        .atf-radio{width:24px;height:24px;border-radius:50%;border:2px solid var(--ak-text-sub,#6B667E);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.8rem;font-weight:800}
        .atf-radio.checked{border-color:${BRAND};background:${BRAND}}
        .atf-done-wrap{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;padding:18px 0 max(18px, env(safe-area-inset-bottom));pointer-events:none}
        .atf-done{pointer-events:auto;padding:14px 40px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3)}
        .atf-done:disabled{opacity:.4;cursor:default}
        .atf-state{padding:26px 20px;color:var(--ak-text-sub,#6B667E);font-weight:700;font-size:.88rem;text-align:center}
      `}</style>

      <div className="atf-phone">
        <div className="atf-header">
          <button className="atf-back" aria-label="Back" onClick={() => !busy && onClose?.()}>←</button>
          <h1>Add to Folder</h1>
        </div>

        <button className="atf-new" onClick={() => setNewOpen(true)}>New folder</button>

        <div className="atf-search">
          <span><Icon name="ti-search" size={15}/></span>
          <input type="text" placeholder="Find folder" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Find folder"/>
        </div>

        <div className="atf-sort"><Icon name="ti-align-justified" size={14}/> Most relevant</div>

        <div className="atf-list">
          {folders === null ? (
            <div className="atf-state">Loading your folders…</div>
          ) : filtered.length === 0 ? (
            <div className="atf-state">{(query || '').trim() ? 'No folders match.' : 'No folders yet — create one above.'}</div>
          ) : (
            filtered.map((f, i) => {
              const checked = selected.has(f.id);
              const count = f.itemCount ?? 0;
              return (
                <button key={f.id} className="atf-row" onClick={() => toggle(f.id)} role="checkbox" aria-checked={checked}>
                  {f.coverUrl
                    ? <span className="atf-thumb"><img src={f.coverUrl} alt=""/></span>
                    : <span className="atf-thumb" style={{ background: ACCENTS[i % ACCENTS.length] }}><Icon name="ti-folder" size={24} color="#fff"/></span>}
                  <span className="atf-info">
                    <span className="f-name" style={{ display: 'block' }}>{f.name}</span>
                    <span className="f-count" style={{ display: 'block' }}>{count} item{count === 1 ? '' : 's'}</span>
                  </span>
                  <span className={`atf-radio${checked ? ' checked' : ''}`}>{checked ? '✓' : ''}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="atf-done-wrap">
          <button className="atf-done" onClick={finish} disabled={!selected.size || busy}>
            {busy ? 'Adding…' : 'Done'}
          </button>
        </div>
      </div>

      {/* New folder — the same Create sheet from the Library page */}
      <CreateFolderSheet open={newOpen} onClose={() => setNewOpen(false)} onCreated={handleCreated}/>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)}/>}
    </div>
  );
}
