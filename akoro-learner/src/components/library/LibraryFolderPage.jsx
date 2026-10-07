/**
 * LibraryFolderPage.jsx — a folder opened from the Library shelf.
 *
 * The UI is 1:1 the Pharm.D course folder view (PharmDProgram's
 * folder screen): hero art, author row, meta, action row and the
 * sheet family — same layout, same visuals, same phone column —
 * with folder actions instead of course ones. The more sheet (⋯)
 * carries Rename folder and Delete folder (plus Share, coming
 * soon); an empty folder shows the same dashed empty card the
 * Pharm.D browse view uses for empty years.
 *
 * Items-in-folders has landed: every piece of content filed via ⋯ →
 * Add to folder (records, Pharm.D topics, course lessons, library
 * posts) is listed here from its add-time snapshot, and tapping a
 * row hands it back to the parent to open on its home surface.
 */
import { useEffect, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import NowStudyingBar from '../dashboard/NowStudyingBar.jsx';
import { renameFolder, deleteFolder, listFolderItems } from '../../services/recordsApi.js';

/* The reference's folder gradient — same family as Pharm.D's accent art. */
const ART_BG = `linear-gradient(160deg, ${BRAND} 0%, #2E1A6E 75%)`;

/* Icon + tint per stored kind — the snapshot's kind drives the glyph. */
const KIND_META = {
  pdf:    ['ti-file-text',     '#EF4444'],
  audio:  ['ti-headphones',    '#10B981'],
  video:  ['ti-video',         '#3B82F6'],
  image:  ['ti-photo',         '#F59E0B'],
  text:   ['ti-file-text',     '#6B7280'],
  link:   ['ti-link',          BRAND],
  paste:  ['ti-clipboard-text', '#8B5CF6'],
  blog:   ['ti-news',          '#EC4899'],
  course: ['ti-book-2',        BRAND],
  topic:  ['ti-book-2',        '#8B5CF6'],
};
const kindMeta = (k) => KIND_META[k] || ['ti-box', '#6B7280'];

export default function LibraryFolderPage({ folder, onClose, onOpenItem, onRenamed, onDeleted, nowItem, onNowOpen, onNowDismiss }) {
  const [sheet, setSheet] = useState(null);        // null | 'more' | 'rename' | 'delete'
  const [name, setName]       = useState(folder?.name || '');
  const [busy, setBusy]       = useState(false);
  const [toast, setToast]     = useState(null);
  const [items, setItems]     = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);

  const soon = (label) => setToast({ msg: `${label} — coming soon`, color: BRAND });

  /* Items come from their own endpoint — newest first, snapshots only. */
  useEffect(() => {
    if (!folder?.id) return;
    let alive = true;
    setItemsLoaded(false);
    listFolderItems(folder.id)
      .then((rows) => { if (alive) { setItems(rows); setItemsLoaded(true); } })
      .catch(() => { if (alive) { setItems([]); setItemsLoaded(true); } });
    return () => { alive = false; };
  }, [folder?.id]);

  /* Escape closes the sheet (the Pharm.D pattern). */
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e) => { if (e.key === 'Escape') setSheet(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  if (!folder) return null;

  const visibilityLabel = folder.visibility === 'public' ? 'Public' : 'Private';
  /* The API count holds the seat until the real list lands, so the
     header never flashes 0 on open. */
  const itemCount = itemsLoaded ? items.length : (folder.itemCount || items.length);

  /* Rename — optimistic close, rolled back on failure. */
  const submitRename = async () => {
    const clean = name.trim();
    if (!clean || clean === folder.name) { setSheet(null); return; }
    setBusy(true);
    try {
      const updated = await renameFolder(folder.id, { name: clean });
      onRenamed?.(updated);
      setToast({ msg: 'Folder renamed', color: BRAND });
      setSheet(null);
    } catch (e) {
      setToast({ msg: e?.message || 'Could not rename the folder — try again.', color: '#EF4444' });
    } finally {
      setBusy(false);
    }
  };

  /* Delete — destructive, so the sheet asks once. */
  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteFolder(folder.id);
      onDeleted?.(folder.id);   // the parent closes the page and drops the card
    } catch (e) {
      setToast({ msg: e?.message || 'Could not delete the folder — try again.', color: '#EF4444' });
      setBusy(false);
    }
  };

  const openRename = () => { setName(folder.name || ''); setSheet('rename'); };

  return (
    <div role="dialog" aria-modal="true" aria-label={folder.name} className="lf-page">
      <style>{`
        .lf-page{position:fixed;inset:0;z-index:1500;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        .lf-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .lf-back{width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.14);color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer;margin-bottom:20px;font-family:inherit}
        /* Folder hero — the Pharm.D folder screen, same exact */
        .lf-folder-hero{padding:20px 22px 24px;position:relative}
        .lf-folder-art{width:100%;aspect-ratio:1.6;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:18px 0 20px;position:relative;overflow:hidden}
        .lf-folder-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .lf-folder-title{font-size:1.5rem;font-weight:900;margin:0 0 4px;color:var(--ak-text,#111827)}
        .lf-author-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .lf-author-avatar{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:#fff}
        .lf-author-name{font-size:.86rem;font-weight:800;color:var(--ak-text,#111827)}
        .lf-folder-meta{color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem;margin:0}
        .lf-folder-desc{color:var(--ak-text-sub,#6B7280);font-weight:600;font-size:.8rem;margin:8px 0 0;line-height:1.5}
        .lf-action-row{display:flex;align-items:center;gap:14px;margin:20px 0 8px}
        .lf-start{flex:1;padding:13px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .lf-start:disabled{opacity:.4;cursor:default}
        .lf-icon-btn{width:44px;height:44px;border-radius:50%;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-size:1.1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-family:inherit}
        .lf-upload{position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.5);border:1.5px solid rgba(255,255,255,0.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;font-family:inherit}
        .lf-folder-art .lf-upload{bottom:10px;right:10px}
        /* The list — everything filed into this folder */
        .lf-topic-list{padding:18px 10px 30px;display:flex;flex-direction:column;gap:9px}
        .lf-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:14px;background:var(--ak-surface,#fff);border:1px solid var(--ak-border,#F3F4F6);width:100%;text-align:left;cursor:pointer;font-family:inherit}
        .lf-item:active{background:var(--ak-surface-hover,#F9FAFB)}
        .lf-item-icon{width:44px;height:44px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
        .lf-item-body{flex:1;min-width:0}
        .lf-item-title{font-size:.92rem;font-weight:800;color:var(--ak-text,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lf-item-sub{font-size:.74rem;font-weight:600;color:var(--ak-text-sub,#6B7280);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lf-item-go{color:var(--ak-text-sub,#9CA3AF);flex-shrink:0;display:flex;align-items:center}
        .lf-empty{padding:18px 22px;flex:0 0 auto;width:100%}
        .lf-empty-card{border:1.5px dashed var(--ak-border2,#E5E7EB);border-radius:14px;padding:18px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
        /* Sheets — the Pharm.D action-sheet family */
        .lf-sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;z-index:40}
        .lf-sheet{width:100%;max-width:430px;background:var(--ak-surface,#fff);border-radius:20px 20px 0 0;padding:10px 0 max(18px, env(safe-area-inset-bottom));max-height:80vh;overflow-y:auto}
        .lf-sheet-handle{width:36px;height:4px;border-radius:100px;background:var(--ak-border2,#E5E7EB);margin:6px auto 14px}
        .lf-sheet-head{display:flex;align-items:center;gap:12px;padding:0 20px 16px;border-bottom:1px solid var(--ak-border,#F3F4F6)}
        .lf-sheet-art{width:48px;height:48px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.85rem;color:#fff}
        .lf-sheet-title{font-weight:800;font-size:.95rem;color:var(--ak-text,#111827)}
        .lf-sheet-sub{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .lf-sheet-actions{padding:8px 0}
        .lf-sheet-action{display:flex;align-items:center;gap:16px;padding:13px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .lf-sheet-action:hover{background:var(--ak-surface-hover,#F9FAFB)}
        .lf-s-icon{width:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .lf-s-label{font-size:.92rem;font-weight:700;color:var(--ak-text,#111827)}
        .lf-field{width:100%;box-sizing:border-box;font-family:'Nunito',sans-serif;background:var(--ak-surface-hover,#F9FAFB);border:1px solid var(--ak-border2,#E5E7EB);border-radius:12px;padding:11px 13px;font-size:13px;font-weight:600;color:var(--ak-text,#111827);outline:none}
        .lf-btn{padding:12px 0;border-radius:100px;border:none;font-family:inherit;font-weight:800;font-size:.9rem;cursor:pointer}
      `}</style>

      <div className="lf-phone">
        <div className="lf-folder-hero">
          <button className="lf-back" aria-label="Back to library" onClick={onClose}>←</button>
          <div className="lf-folder-art" style={{ background: folder.coverUrl ? 'var(--ak-border,#E5E7EB)' : ART_BG }}>
            {folder.coverUrl
              ? <img src={folder.coverUrl} alt=""/>
              : <Icon name="ti-folder" size={54} color="rgba(255,255,255,0.92)"/>}
            <span className="lf-upload" role="button" aria-label="Change cover photo"
              onClick={() => soon('Custom covers')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); soon('Custom covers'); } }}><Icon name="ti-camera" size={14}/></span>
          </div>
          <h2 className="lf-folder-title">{folder.name}</h2>
          <div className="lf-author-row">
            <span className="lf-author-avatar" style={{ background: ART_BG }}>Y</span>
            <span className="lf-author-name">You</span>
          </div>
          <p className="lf-folder-meta">{itemCount} item{itemCount === 1 ? '' : 's'} · {visibilityLabel}</p>
          {folder.description && <p className="lf-folder-desc">{folder.description}</p>}
          <div className="lf-action-row">
            <button className="lf-start" onClick={() => setToast({ msg: 'Tap ⋯ on any content — a record, a topic, a video — to add it here', color: BRAND })}>Add items</button>
            <button className="lf-icon-btn" aria-label="More" onClick={() => setSheet('more')}><Icon name="ti-dots-vertical" size={20}/></button>
          </div>
        </div>
        <div className="lf-topic-list">
          {itemsLoaded && items.length === 0 && (
            <div className="lf-empty"><div className="lf-empty-card">This folder is empty — items you add will appear here.</div></div>
          )}
          {items.map((it) => {
            const [icon, tint] = kindMeta(it.kind);
            return (
              <button key={it.id} className="lf-item"
                onClick={() => (onOpenItem ? onOpenItem(it) : setToast({ msg: 'Open this from its own page', color: BRAND }))}
                aria-label={it.title}>
                <span className="lf-item-icon" style={{ background: `${tint}14` }}>
                  <Icon name={icon} size={20} color={tint}/>
                </span>
                <span className="lf-item-body">
                  <span className="lf-item-title" style={{ display: 'block' }}>{it.title}</span>
                  {it.sub && <span className="lf-item-sub" style={{ display: 'block' }}>{it.sub}</span>}
                </span>
                <span className="lf-item-go"><Icon name="ti-chevron-right" size={16}/></span>
              </button>
            );
          })}
        </div>

        {/* The Now-Studying bar, pinned to the column's bottom edge —
            the folder keeps the learner's parked item in view, under
            the sheets (sticky z 30 < sheet z 40). */}
        {nowItem && !sheet && (
          <NowStudyingBar sticky item={nowItem} onOpen={onNowOpen} onDismiss={onNowDismiss}/>
        )}
      </div>

      {/* ── More sheet — Rename / Delete / Share ── */}
      {sheet === 'more' && (
        <div className="lf-sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="lf-sheet">
            <div className="lf-sheet-handle" />
            <div className="lf-sheet-head">
              <div className="lf-sheet-art" style={{ background: ART_BG }}><Icon name="ti-folder" size={22} color="#fff"/></div>
              <div>
                <div className="lf-sheet-title">{folder.name}</div>
                <div className="lf-sheet-sub">Folder · {visibilityLabel} · by You</div>
              </div>
            </div>
            <div className="lf-sheet-actions">
              {[
                ['ti-share', 'Share', () => soon('Folder sharing')],
                ['ti-edit', 'Rename folder', openRename],
                ['ti-trash', 'Delete folder', () => setSheet('delete')],
              ].map(([icon, label, fn]) => (
                <button key={label} className="lf-sheet-action" onClick={fn}>
                  <span className="lf-s-icon"><Icon name={icon} size={18}/></span>
                  <span className="lf-s-label" style={label === 'Delete folder' ? { color: '#EF4444' } : undefined}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Rename sheet ── */}
      {sheet === 'rename' && (
        <div className="lf-sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setSheet(null); }}>
          <div className="lf-sheet">
            <div className="lf-sheet-handle" />
            <div style={{ padding: '4px 20px 6px' }}>
              <div className="lf-sheet-title" style={{ marginBottom: 12 }}>Rename folder</div>
              <input className="lf-field" value={name} maxLength={100} disabled={busy} autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
                placeholder="Folder name"/>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="lf-btn" style={{ flex: 1, background: 'var(--ak-tag-bg,#F3F4F6)', color: 'var(--ak-text-sub,#6B7280)' }}
                  onClick={() => !busy && setSheet(null)} disabled={busy}>Cancel</button>
                <button className="lf-btn" style={{ flex: 1, background: BRAND, color: '#fff' }}
                  onClick={submitRename} disabled={busy || !name.trim()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete sheet — one confirm, destructive ── */}
      {sheet === 'delete' && (
        <div className="lf-sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setSheet(null); }}>
          <div className="lf-sheet">
            <div className="lf-sheet-handle" />
            <div style={{ padding: '4px 20px 10px' }}>
              <div className="lf-sheet-title" style={{ marginBottom: 6 }}>Delete “{folder.name}”?</div>
              <div className="lf-sheet-sub" style={{ margin: '0 0 16px', fontSize: '.84rem', lineHeight: 1.5 }}>
                The folder will be removed from your library. This can’t be undone.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="lf-btn" style={{ flex: 1, background: 'var(--ak-tag-bg,#F3F4F6)', color: 'var(--ak-text-sub,#6B7280)' }}
                  onClick={() => !busy && setSheet(null)} disabled={busy}>Cancel</button>
                <button className="lf-btn" style={{ flex: 1, background: '#EF4444', color: '#fff' }}
                  onClick={confirmDelete} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete folder'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
