import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { fetchCommunity, editCommunity, deleteCommunity } from '../services/communityApi.js';
import CommunityShell, { useCommunityToast } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { confirmDialog } from '../components/common/ConfirmHost.jsx';
import { BRAND, RED } from '../constants.js';

/* Community identity avatars (same list as the create sheet). */
const EMOJIS = ['🌐', '📚', '🧪', '', '🎧', '💼', '🌱', '🔥', '', '🎯', '🤝', '🚀'];

export default function CommunitySettingsPage() {
  const navigate    = useNavigate();
  const { communityId } = useParams();
  const [community, setCommunity] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [name, setName]         = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji]       = useState(EMOJIS[0]);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showToast, toastNode] = useCommunityToast();

  const load = useCallback(async () => {
    try {
      const c = await fetchCommunity(communityId);
      setCommunity(c);
      if (c) {
        setName(c.name || '');
        setDescription(c.description || '');
        setEmoji(c.emoji && EMOJIS.includes(c.emoji) ? c.emoji : (c.emoji || EMOJIS[0]));
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

  const remove = async () => {
    const yes = await confirmDialog({
      title: 'Delete community?',
      message: `“${community.name}” and all of its activities will be removed for everyone. This can't be undone.`,
    });
    if (!yes) return;
    setDeleting(true);
    try {
      await deleteCommunity(communityId);
      navigate('/communities', { replace: true });
    } catch (e) {
      setDeleting(false);
      showToast(e?.message || 'Could not delete. Try again.');
    }
  };

  const FIELD = {
    width: '100%', boxSizing: 'border-box', borderRadius: 12, padding: '11px 13px',
    border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)',
    fontFamily: "'Nunito',sans-serif", fontSize: 13.5, outline: 'none',
  };

  return (
    <CommunityShell title="Community settings" sub={community.name} backTo={`/communities/${communityId}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Identity avatar */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)} style={{
              width: 40, height: 40, borderRadius: 11, cursor: 'pointer', fontSize: 20,
              border: emoji === e ? `1.5px solid ${BRAND}` : '1.5px solid transparent',
              background: emoji === e ? `${BRAND}14` : 'var(--ak-bg)',
            }}>{e}</button>
          ))}
        </div>

        <input value={name} onChange={e => setName(e.target.value)} placeholder="Community name" maxLength={80} style={FIELD}/>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this community for?" maxLength={500} rows={3} style={{ ...FIELD, resize: 'none' }}/>

        <button onClick={save} disabled={!name.trim() || saving}
          style={{ padding: '13px', borderRadius: 14, cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>

        {/* Danger zone */}
        <div style={{ marginTop: 10, padding: 14, borderRadius: 14, border: '1.5px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 900, color: RED, marginBottom: 10 }}>
            <Icon name="ti-alert-triangle" size={14}/>
            Danger zone
          </div>
          <button onClick={remove} disabled={deleting}
            style={{ width: '100%', padding: '11px', borderRadius: 12, cursor: deleting ? 'default' : 'pointer', border: `1.5px solid ${RED}`, background: 'transparent', color: RED, fontSize: 13, fontWeight: 800, fontFamily: "'Nunito',sans-serif" }}>
            {deleting ? 'Deleting…' : 'Delete this community'}
          </button>
        </div>
      </div>
      {toastNode}
    </CommunityShell>
  );
}
