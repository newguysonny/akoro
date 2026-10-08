/**
 * AddToCommunityPage.jsx — "Add to Community", a 1:1 port of the
 * Add-to-folder page (reference/Add to folder.md UI): the header with a
 * back button, the prominent New community pill, the Find-community
 * search, the community rows with accent-gradient emoji tiles and radio
 * multi-select, the fixed Done pill and the toast. Only the chrome
 * colours ride the app's --ak-* theme tokens (light/dark follows the
 * app), exactly like the Add-to-folder page.
 *
 * One item goes into N communities: every content surface opens this
 * page with a snapshot { itemType, itemRef, title, sub, kind, link } —
 * a Pharm.D topic, a library record, a course lesson, a shelf item.
 * Done writes one bulk add (idempotent per community) and toasts
 * "Added to N community/communities".
 *
 * Only communities the learner has JOINED are listed — you can't share
 * into a community you're not in (the API enforces the same rule).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import { fetchMyCommunities, addCommunityItem } from '../../services/communityApi.js';

/* The reference's four accents, verbatim (same as the Add-to-folder page). */
const ACCENTS = [
  'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
  'linear-gradient(145deg, #FF6B57, #C13F2E)',
  'linear-gradient(145deg, #2BB673, #167A4A)',
  'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
];

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

export default function AddToCommunityPage({ item, onClose, onAdded }) {
  const navigate                    = useNavigate();
  const [communities, setCommunities] = useState(null);   // null = loading
  const [query, setQuery]           = useState('');
  const [selected, setSelected]     = useState(() => new Set());
  const [busy, setBusy]             = useState(false);
  const [toast, setToast]           = useState(null);

  /* Load the learner's joined communities once per open. */
  useEffect(() => {
    let alive = true;
    fetchMyCommunities()
      .then((cs) => { if (alive) setCommunities(cs ?? []); })
      .catch(() => { if (alive) setCommunities([]); });
    return () => { alive = false; };
  }, []);

  /* Escape returns to the previous screen, like the back button. */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    const list = communities ?? [];
    return q ? list.filter((c) => (c.name || '').toLowerCase().includes(q)) : list;
  }, [communities, query]);

  if (!item) return null;

  const toggle = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  /* Done — one bulk add of this item into every selected community. */
  const finish = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const res = await addCommunityItem({
        communityIds: [...selected],
        itemType: item.itemType, itemRef: item.itemRef,
        title: item.title, sub: item.sub, kind: item.kind, link: item.link,
      });
      const n = res?.added ?? selected.size;
      setToast({ msg: `Added to ${n} communit${n === 1 ? 'y' : 'ies'}`, color: BRAND });
      onAdded?.({ ...item, communityIds: [...selected] });
      setTimeout(() => onClose?.(), 650);   // let the toast land before leaving
    } catch (e) {
      setToast({ msg: e?.message || 'Could not add to the community/communities — try again.', color: '#EF4444' });
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add to Community" className="atc-page">
      <style>{`
        .atc-page{position:fixed;inset:0;z-index:1600;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#221D33)}
        .atc-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .atc-header{display:flex;align-items:center;gap:12px;padding:18px 16px 10px}
        .atc-header h1{flex:1;text-align:center;font-size:1.15rem;font-weight:800;margin:0;padding-right:36px;color:var(--ak-text,#221D33)}
        .atc-back{width:36px;height:36px;border-radius:50%;border:none;background:var(--ak-tag-bg,#F3F1FA);color:var(--ak-text,#221D33);font-size:1.1rem;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0}
        .atc-new{display:block;margin:18px auto 22px;padding:13px 26px;border-radius:100px;border:none;background:var(--ak-text,#221D33);color:var(--ak-bg,#FAFAFC);font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .atc-search{display:flex;align-items:center;gap:10px;background:var(--ak-surface-hover,#F3F1FA);border-radius:10px;padding:12px 14px;margin:0 20px 18px;color:var(--ak-text-sub,#6B667E)}
        .atc-search input{flex:1;background:none;border:none;color:var(--ak-text,#221D33);font-family:inherit;font-size:.92rem;outline:none}
        .atc-search input::placeholder{color:var(--ak-text-sub,#6B667E)}
        .atc-sort{display:flex;align-items:center;gap:10px;padding:0 20px 14px;color:var(--ak-text,#221D33);font-weight:800;font-size:.88rem}
        .atc-list{padding-bottom:100px}
        .atc-row{display:flex;align-items:center;gap:14px;padding:10px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .atc-row:hover{background:var(--ak-surface,#FFFFFF)}
        .atc-thumb{width:54px;height:54px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:1.3rem;overflow:hidden}
        .atc-info{flex:1;min-width:0}
        .atc-info .c-name{font-weight:700;font-size:.98rem;color:var(--ak-text,#221D33);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .atc-info .c-count{font-size:.8rem;color:var(--ak-text-sub,#6B667E);font-weight:600;margin-top:2px}
        .atc-radio{width:24px;height:24px;border-radius:50%;border:2px solid var(--ak-text-sub,#6B667E);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.8rem;font-weight:800}
        .atc-radio.checked{border-color:${BRAND};background:${BRAND}}
        .atc-done-wrap{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;padding:18px 0 max(18px, env(safe-area-inset-bottom));pointer-events:none}
        .atc-done{pointer-events:auto;padding:14px 40px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3)}
        .atc-done:disabled{opacity:.4;cursor:default}
        .atc-state{padding:26px 20px;color:var(--ak-text-sub,#6B667E);font-weight:700;font-size:.88rem;text-align:center}
      `}</style>

      <div className="atc-phone">
        <div className="atc-header">
          <button className="atc-back" aria-label="Back" onClick={() => !busy && onClose?.()}>←</button>
          <h1>Add to Community</h1>
        </div>

        <button className="atc-new" onClick={() => { onClose?.(); navigate('/communities'); }}>New community</button>

        <div className="atc-search">
          <span><Icon name="ti-search" size={15}/></span>
          <input type="text" placeholder="Find community" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Find community"/>
        </div>

        <div className="atc-sort"><Icon name="ti-align-justified" size={14}/> Most relevant</div>

        <div className="atc-list">
          {communities === null ? (
            <div className="atc-state">Loading your communities…</div>
          ) : filtered.length === 0 ? (
            <div className="atc-state">{(query || '').trim() ? 'No communities match.' : 'No communities yet — create one above.'}</div>
          ) : (
            filtered.map((c, i) => {
              const checked = selected.has(c.id);
              const count = c.member_count ?? 0;
              return (
                <button key={c.id} className="atc-row" onClick={() => toggle(c.id)} role="checkbox" aria-checked={checked}>
                  <span className="atc-thumb" style={{ background: ACCENTS[i % ACCENTS.length] }}>
                    {c.emoji || initials(c.name)}
                  </span>
                  <span className="atc-info">
                    <span className="c-name" style={{ display: 'block' }}>{c.name}</span>
                    <span className="c-count" style={{ display: 'block' }}>{count} member{count === 1 ? '' : 's'}</span>
                  </span>
                  <span className={`atc-radio${checked ? ' checked' : ''}`}>{checked ? '✓' : ''}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="atc-done-wrap">
          <button className="atc-done" onClick={finish} disabled={!selected.size || busy}>
            {busy ? 'Adding…' : 'Done'}
          </button>
        </div>
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)}/>}
    </div>
  );
}
