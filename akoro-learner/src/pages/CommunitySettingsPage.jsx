import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { fetchCommunity, editCommunity, deleteCommunity } from '../services/communityApi.js';
import CommunityShell, { useCommunityToast } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND } from '../constants.js';

/**
 * CommunitySettingsPage — the reference UI (reference/communities pages.md,
 * view "SETTINGS"): the icon grid (the reference's ten line icons as
 * selectable chips), the name + description fields, the purple Save pill,
 * and the danger zone whose delete button arms on the first tap and
 * deletes on the second ("Tap again to confirm deletion").
 *
 * The community's stored identity is an emoji (the API's data model), so
 * each line icon maps 1:1 onto the app's emoji set — the picker shows the
 * reference's line icons, the save persists the mapped emoji, and the
 * header tile on the main page renders it as before.
 */

/* The reference's iconOptions, mapped onto the stored emoji identity. */
const ICON_OPTIONS = [
  { icon: 'ti-globe',      emoji: '🌐' },
  { icon: 'ti-book',       emoji: '📚' },
  { icon: 'ti-flask',      emoji: '🧪' },
  { icon: 'ti-headphones', emoji: '🎧' },
  { icon: 'ti-briefcase',  emoji: '💼' },
  { icon: 'ti-sprout',     emoji: '🌱' },
  { icon: 'ti-flame',      emoji: '🔥' },
  { icon: 'ti-target',     emoji: '🎯' },
  { icon: 'ti-handshake',  emoji: '🤝' },
  { icon: 'ti-rocket',     emoji: '🚀' },
];

/* The reference's .field style. */
const FIELD = {
  width: '100%', boxSizing: 'border-box', borderRadius: 'var(--r-md)', padding: '12px 14px',
  border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)',
  fontFamily: "'Nunito',sans-serif", fontSize: 14, outline: 'none',
};
const LABEL = { display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', marginBottom: 6 };

export default function CommunitySettingsPage() {
  const navigate    = useNavigate();
  const { communityId } = useParams();
  const [community, setCommunity] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [name, setName]         = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji]       = useState(ICON_OPTIONS[0].emoji);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [armed, setArmed]       = useState(false);
  const [showToast, toastNode] = useCommunityToast();

  const load = useCallback(async () => {
    try {
      const c = await fetchCommunity(communityId);
      setCommunity(c);
      if (c) {
        setName(c.name || '');
        setDescription(c.description || '');
        setEmoji(ICON_OPTIONS.some((o) => o.emoji === c.emoji) ? c.emoji : ICON_OPTIONS[0].emoji);
      }
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <CommunityShell title="Settings" backTo={`/communities/${communityId}`} loading/>;
  if (!community) {
    return (
      <CommunityShell title="Settings" backTo="/communities"
        empty={<div style={{ textAlign: 'center', padding: '60px 20px' }}><p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p></div>} />
    );
  }
  /* Creator-only page — non-creators land on the community profile. */
  if (community.my_role !== 'owner') return <Navigate to={`/communities/${communityId}/profile`} replace/>;

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await editCommunity(communityId, { name: name.trim(), description: description.trim(), emoji });
      showToast('Saved');
    } catch (e) {
      showToast(e?.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  };

  /* The reference's arm-confirm: the first tap arms the button, the second
     deletes. Leaving the button disarms it again. */
  const remove = async () => {
    if (!armed) { setArmed(true); return; }
    setDeleting(true);
    try {
      await deleteCommunity(communityId);
      navigate('/communities', { replace: true });
    } catch (e) {
      setDeleting(false);
      setArmed(false);
      showToast(e?.message || 'Could not delete. Try again.');
    }
  };

  return (
    <CommunityShell title="Community settings" sub={community.name} backTo={`/communities/${communityId}`}>
      <style>{`
        .ak-cm-field:focus{outline:2px solid ${BRAND};outline-offset:1px}
        .ak-cm-icons{display:grid;grid-template-columns:repeat(6,1fr);gap:var(--s-2);margin-bottom:var(--s-6)}
        .ak-cm-iconchip{aspect-ratio:1;border-radius:var(--r-md);border:1.5px solid var(--ak-border2);background:var(--ak-surface);color:var(--ak-text-sub);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s var(--ease-spring)}
        .ak-cm-iconchip.selected{border-color:${BRAND};background:${BRAND}14;color:${BRAND};transform:scale(1.04)}
      `}</style>

      {/* Icon grid — the reference's .icon-grid. */}
      <div className="ak-cm-icons">
        {ICON_OPTIONS.map((o) => (
          <button key={o.emoji} type="button" aria-label={`Community icon ${o.emoji}`}
            className={`ak-cm-iconchip${emoji === o.emoji ? ' selected' : ''}`}
            onClick={() => setEmoji(o.emoji)}>
            <Icon name={o.icon} size={19}/>
          </button>
        ))}
      </div>

      {/* Fields — the reference's .field. */}
      <div style={{ marginBottom: 'var(--s-4)' }}>
        <label style={LABEL}>Community name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Community name" maxLength={80} className="ak-cm-field" style={FIELD}/>
      </div>
      <div style={{ marginBottom: 'var(--s-4)' }}>
        <label style={LABEL}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this community for?" maxLength={500} rows={3} className="ak-cm-field" style={{ ...FIELD, resize: 'vertical', minHeight: 76 }}/>
      </div>

      {/* Save — the reference's .save-btn pill. */}
      <button onClick={save} disabled={!name.trim() || saving}
        style={{ width: '100%', padding: '14px', borderRadius: 'var(--r-full)', cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif", margin: '4px 0 var(--s-6)', transition: 'transform .15s var(--ease-spring)' }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      {/* Danger zone — the reference's .danger-zone, with its arm-confirm. */}
      <div style={{ border: '1px solid rgba(239,68,68,.25)', background: 'rgba(239,68,68,.06)', borderRadius: 'var(--r-lg)', padding: 'var(--s-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', color: 'var(--ak-danger-text)', fontWeight: 800, fontSize: 13.5, marginBottom: 'var(--s-3)' }}>
          <Icon name="ti-alert-triangle" size={16}/>
          Danger zone
        </div>
        <button onClick={remove} disabled={deleting} onMouseLeave={() => setArmed(false)}
          style={{
            width: '100%', padding: '11px', borderRadius: 'var(--r-full)', cursor: deleting ? 'default' : 'pointer',
            border: '1.5px solid var(--ak-danger)',
            background: armed ? 'var(--ak-danger)' : 'var(--ak-surface)',
            color: armed ? '#fff' : 'var(--ak-danger-text)',
            fontSize: 13.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif", transition: 'all .15s',
          }}>
          {deleting ? 'Deleting…' : armed ? 'Tap again to confirm deletion' : 'Delete this community'}
        </button>
      </div>

      {toastNode}
    </CommunityShell>
  );
}
