/**
 * RecentlyDeletedPage — the Library's Recently deleted (Grand Plan §7.17,
 * D55): chat uploads the learner undid wait here for 30 days, private.
 * Each shows where it came from and the days left, with Restore (back where
 * it was) and Delete forever (asks first; it can't be undone).
 *
 * Opened like a folder: full-screen on a phone, the page body in the shell
 * (shellMode) on tablet and desktop.
 */
import { useEffect, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Spinner from '../common/Spinner.jsx';
import { listDeleted, purgeIngest, restoreIngest } from '../../lib/chatUploads.js';

const RED = '#DC2626';
const DAY = 86_400_000;
const shortName = (n) => String(n || '').replace(/\.(pdf|docx?|pptx?|txt|md|csv|jpe?g|png|webp|heic)$/i, '');
const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, fontFamily: "'Nunito',sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' };

function ago(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso || 0)) / DAY);
  return !iso ? '' : days <= 0 ? 'deleted today' : days === 1 ? 'deleted yesterday' : `deleted ${days} days ago`;
}
const daysLeft = (until) => Math.max(0, Math.ceil((Date.parse(until || 0) - Date.now()) / DAY));

export default function RecentlyDeletedPage({ onClose, onChanged, onToast, shellMode = false }) {
  const [items, setItems] = useState(null);   // null = loading
  const [busy, setBusy] = useState(null);     // `${id}:restore|purge`
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let alive = true;
    listDeleted().then((x) => { if (alive) setItems(x); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const drop = (id) => setItems((xs) => {
    const next = (xs || []).filter((x) => x.id !== id);
    onChanged?.(next.length);
    return next;
  });
  const restore = async (it) => {
    setBusy(`${it.id}:restore`);
    const r = await restoreIngest(it.id).catch(() => null);
    setBusy(null);
    if (r && r.state !== 'undone') { drop(it.id); onToast?.(r.folder?.name ? `Restored to ${r.folder.name}` : 'Restored to your Library'); }
    else onToast?.("Couldn't restore it — try again");
  };
  const purge = async (it) => {
    setBusy(`${it.id}:purge`);
    const r = await purgeIngest(it.id).catch(() => null);
    setBusy(null); setConfirm(null);
    if (r?.purged) { drop(it.id); onToast?.('Deleted for good'); }
    else onToast?.("Couldn't delete it — try again");
  };

  const title = (it) => {
    const names = (it.names || []).map(shortName);
    return names.length <= 1 ? names[0] || 'File' : `${names.length} files · ${names.join(', ')}`;
  };

  const body = (
    <div data-recently-deleted="" style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '14px 18px 80px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button type="button" onClick={onClose} aria-label="Back"
          style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text-sub)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="ti-arrow-left" size={16}/>
        </button>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--ak-text)' }}>Recently deleted</h1>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: 'var(--ak-text-muted)', lineHeight: 1.5 }}>
        Files you undo in Agent Chat wait here for 30 days, then they're deleted for good. Only you can see them.
      </p>

      {items === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner size={18} color={BRAND}/></div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--ak-text-muted)' }}>
          <Icon name="ti-trash-off" size={34} color="var(--ak-border2)"/>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 0' }}>Nothing here. Files you undo in Agent Chat stay here for 30 days.</p>
        </div>
      ) : items.map((it) => (
        confirm === it.id ? (
          <div key={it.id} data-confirm-purge={it.id} style={{ border: `1px solid ${RED}40`, background: `${RED}0A`, borderRadius: 14, padding: '12px 13px', marginBottom: 9 }}>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sub)', lineHeight: 1.5 }}>
              Delete <b>{title(it)}</b> for good? The file and everything read from it go now — this can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => purge(it)} disabled={!!busy} style={{ ...btn, border: 'none', background: RED, color: '#fff' }}>
                {busy === `${it.id}:purge` ? <Spinner size={11} color="#fff"/> : <Icon name="ti-trash" size={13}/>} Delete forever
              </button>
              <button type="button" onClick={() => setConfirm(null)} disabled={!!busy} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={it.id} data-deleted-item={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', marginBottom: 9 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--ak-surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ak-text-muted)', flexShrink: 0 }}>
              <Icon name={(it.names || []).length > 1 ? 'ti-files' : 'ti-file-text'} size={18}/>
            </span>
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(it)}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                {it.folderName ? <>From <b style={{ color: 'var(--ak-text-sub)' }}>{it.folderName}</b> ·</> : null} {ago(it.deletedAt)}
                <span style={{ fontSize: 10, fontWeight: 800, color: '#B45309', background: '#F59E0B1A', borderRadius: 20, padding: '2px 8px' }}>
                  {daysLeft(it.restorableUntil)} {daysLeft(it.restorableUntil) === 1 ? 'day' : 'days'} left
                </span>
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button type="button" data-action="restore" onClick={() => restore(it)} disabled={!!busy}
                style={{ ...btn, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff' }}>
                {busy === `${it.id}:restore` ? <Spinner size={11} color="#fff"/> : <Icon name="ti-arrow-back-up" size={13}/>} Restore
              </button>
              <button type="button" data-action="purge" onClick={() => setConfirm(it.id)} disabled={!!busy}
                style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>Delete forever</button>
            </div>
          </div>
        )
      ))}
    </div>
  );

  if (shellMode) return <div style={{ width: '100%', height: '100%', overflowY: 'auto', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif" }}>{body}</div>;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, overflowY: 'auto', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif" }}>{body}</div>
  );
}
