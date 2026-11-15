/**
 * AddToTargetSheet.jsx — the "file this away" chooser behind the ⋯ on a
 * shelf row / course lesson: the Pharm.D action-sheet language (overlay,
 * handle, item head, action rows). Targets: Add to folder, Add to community,
 * and — for the learner's OWN uploaded files — Rename and Delete. Picking one
 * hands the stored snapshot to that page and closes; Rename/Delete ask in place.
 */
import { useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';

/* kind → line icon, for the sheet's item head. */
const KIND_ICONS = {
  pdf: 'ti-file-text', audio: 'ti-headphones', video: 'ti-video', image: 'ti-photo',
  text: 'ti-file-text', link: 'ti-link', paste: 'ti-clipboard', blog: 'ti-news',
  course: 'ti-school', topic: 'ti-book',
};
const DANGER = '#EF4444';

export default function AddToTargetSheet({ item, onClose, onPickFolder, onPickCommunity, onRename, onDelete, onAgentSession }) {
  const [mode, setMode] = useState('actions');   // actions | rename | delete
  const [draft, setDraft] = useState(item?.title || '');
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const icon = KIND_ICONS[item.kind] || 'ti-file-text';
  // Rename/Delete only make sense for the learner's OWN uploaded files.
  const canAgentSession = item.itemType === 'record' && typeof onAgentSession === 'function';
  const canRename = item.itemType === 'record' && typeof onRename === 'function';
  const canDelete = item.itemType === 'record' && typeof onDelete === 'function';

  const doRename = async () => {
    const name = String(draft || '').trim();
    if (!name || busy) return;
    setBusy(true);
    try { await onRename(item, name); onClose?.(); } catch { setBusy(false); }
  };
  const doDelete = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(item); onClose?.(); } catch { setBusy(false); }
  };

  return (
    <div className="ats-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <style>{`
        .ats-overlay{position:fixed;inset:0;background:rgba(6,6,18,.55);display:flex;align-items:flex-end;justify-content:center;z-index:2600;font-family:'Nunito',system-ui,sans-serif}
        .ats-sheet{width:100%;max-width:430px;background:var(--ak-surface,#fff);border-radius:20px 20px 0 0;padding:10px 0 max(18px, env(safe-area-inset-bottom));animation:ats-up .22s cubic-bezier(.32,1,.64,1)}
        @keyframes ats-up{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
        .ats-handle{width:36px;height:4px;border-radius:100px;background:var(--ak-border2,#E5E7EB);margin:6px auto 14px}
        .ats-head{display:flex;align-items:center;gap:12px;padding:0 20px 16px;border-bottom:1px solid var(--ak-border,#F3F4F6)}
        .ats-art{width:48px;height:48px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${BRAND}14;color:${BRAND}}
        .ats-title{font-weight:800;font-size:.95rem;color:var(--ak-text,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ats-sub{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ats-actions{padding:8px 0}
        .ats-action{display:flex;align-items:center;gap:16px;padding:13px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .ats-action:hover{background:var(--ak-surface-hover,#F9FAFB)}
        .ats-action:disabled{opacity:.55;cursor:default}
        .ats-icon{width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
        .ats-label{font-weight:800;font-size:.92rem;color:var(--ak-text,#111827)}
        .ats-hint{font-size:.76rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:1px}
        .ats-btn{border:1px solid var(--ak-border2,#E5E7EB);border-radius:10px;padding:9px 16px;font-weight:800;font-size:.85rem;font-family:inherit;background:var(--ak-surface,#fff);color:var(--ak-text,#111827);cursor:pointer}
        .ats-btn:disabled{opacity:.55;cursor:default}
      `}</style>
      <div className="ats-sheet" role="dialog" aria-modal="true" aria-label={mode === 'rename' ? 'Rename' : mode === 'delete' ? 'Delete' : 'Add to…'}>
        <div className="ats-handle" />
        <div className="ats-head">
          <div className="ats-art"><Icon name={icon} size={22}/></div>
          <div style={{ minWidth: 0 }}>
            <div className="ats-title">{item.title}</div>
            {item.sub && <div className="ats-sub">{item.sub}</div>}
          </div>
        </div>

        {mode === 'actions' && (
          <div className="ats-actions">
            {canAgentSession && (
              <button className="ats-action" onClick={() => { onAgentSession?.(item); onClose?.(); }}>
                <span className="ats-icon" style={{ background: `${BRAND}14`, color: BRAND }}><Icon name="ti-robot" size={18}/></span>
                <span>
                  <span className="ats-label" style={{ display: 'block' }}>Agent session</span>
                  <span className="ats-hint" style={{ display: 'block' }}>Teach your agent from this document</span>
                </span>
              </button>
            )}
            <button className="ats-action" onClick={() => { onPickFolder?.(item); onClose?.(); }}>
              <span className="ats-icon" style={{ background: '#F59E0B14', color: '#F59E0B' }}><Icon name="ti-folder-plus" size={18}/></span>
              <span>
                <span className="ats-label" style={{ display: 'block' }}>Add to folder</span>
                <span className="ats-hint" style={{ display: 'block' }}>File it in one of your library folders</span>
              </span>
            </button>
            <button className="ats-action" onClick={() => { onPickCommunity?.(item); onClose?.(); }}>
              <span className="ats-icon" style={{ background: `${BRAND}14`, color: BRAND }}><Icon name="ti-users" size={18}/></span>
              <span>
                <span className="ats-label" style={{ display: 'block' }}>Add to community</span>
                <span className="ats-hint" style={{ display: 'block' }}>Share it with a community you've joined</span>
              </span>
            </button>
            {canRename && (
              <button className="ats-action" onClick={() => { setDraft(item.title || ''); setMode('rename'); }}>
                <span className="ats-icon" style={{ background: 'rgba(108,59,255,.10)', color: 'var(--ak-accent)' }}><Icon name="ti-pencil" size={18}/></span>
                <span>
                  <span className="ats-label" style={{ display: 'block' }}>Rename</span>
                  <span className="ats-hint" style={{ display: 'block' }}>Give this file a new name</span>
                </span>
              </button>
            )}
            {canDelete && (
              <button className="ats-action" onClick={() => setMode('delete')}>
                <span className="ats-icon" style={{ background: `${DANGER}14`, color: DANGER }}><Icon name="ti-trash" size={18}/></span>
                <span>
                  <span className="ats-label" style={{ display: 'block', color: DANGER }}>Delete</span>
                  <span className="ats-hint" style={{ display: 'block' }}>Remove it from your library</span>
                </span>
              </button>
            )}
          </div>
        )}

        {mode === 'rename' && (
          <div style={{ padding: '10px 20px 16px' }}>
            <label className="ats-hint" style={{ display: 'block', marginBottom: 6 }}>New name</label>
            <input
              autoFocus
              value={draft}
              maxLength={255}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setMode('actions'); }}
              className="folio-form-field w-full border rounded-lg p-2 text-sm focus:outline-none"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="ats-btn" onClick={() => setMode('actions')} disabled={busy}>Cancel</button>
              <button className="ats-btn" style={{ borderColor: BRAND, background: BRAND, color: '#fff' }} onClick={doRename} disabled={busy || !String(draft).trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {mode === 'delete' && (
          <div style={{ padding: '10px 20px 16px' }}>
            <div className="ats-hint" style={{ display: 'block', marginBottom: 12, fontSize: '.86rem' }}>
              Remove “{item.title}” from your library? This can’t be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="ats-btn" onClick={() => setMode('actions')} disabled={busy}>Cancel</button>
              <button className="ats-btn" style={{ borderColor: DANGER, background: DANGER, color: '#fff' }} onClick={doDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
