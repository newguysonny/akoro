/**
 * AddToTargetSheet.jsx — the "file this away" chooser behind the ⋯ on a
 * shelf row / course lesson: the Pharm.D action-sheet language (overlay,
 * handle, item head, action rows) with the two targets the app supports —
 * Add to folder and Add to community. Picking one hands the stored
 * snapshot to that page and closes.
 */
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';

/* kind → line icon, for the sheet's item head. */
const KIND_ICONS = {
  pdf: 'ti-file-text', audio: 'ti-headphones', video: 'ti-video', image: 'ti-photo',
  text: 'ti-file-text', link: 'ti-link', paste: 'ti-clipboard', blog: 'ti-news',
  course: 'ti-school', topic: 'ti-book',
};

export default function AddToTargetSheet({ item, onClose, onPickFolder, onPickCommunity }) {
  if (!item) return null;
  const icon = KIND_ICONS[item.kind] || 'ti-file-text';
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
        .ats-icon{width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
        .ats-label{font-weight:800;font-size:.92rem;color:var(--ak-text,#111827)}
        .ats-hint{font-size:.76rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:1px}
      `}</style>
      <div className="ats-sheet" role="dialog" aria-modal="true" aria-label="Add to…">
        <div className="ats-handle" />
        <div className="ats-head">
          <div className="ats-art"><Icon name={icon} size={22}/></div>
          <div style={{ minWidth: 0 }}>
            <div className="ats-title">{item.title}</div>
            {item.sub && <div className="ats-sub">{item.sub}</div>}
          </div>
        </div>
        <div className="ats-actions">
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
        </div>
      </div>
    </div>
  );
}
