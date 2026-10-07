import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyCommunities, createCommunity } from '../services/communityApi.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, GREEN } from '../constants.js';
import Spinner from '../components/common/Spinner.jsx';
import { useInFlight } from '../hooks/useInFlight.js';
import { AppShell } from '../components/AppShell.jsx';

/* Community identity avatars (same identity-emoji pattern as agents/guides). */
const EMOJIS = ['🌐', '📚', '🧪', '', '🎧', '💼', '🌱', '🔥', '', '🎯', '🤝', '🚀'];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* Initials fallback when a community has no emoji. */
function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function CommunityCard({ c, onOpen }) {
  const isOwner = c.role === 'owner';
  return (
    <button onClick={() => onOpen(c.id)} style={{
      display: 'flex', gap: 12, padding: '13px 15px', width: '100%', textAlign: 'left',
      background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)',
      alignItems: 'center', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0, overflow: 'hidden',
        background: `linear-gradient(135deg, ${BRAND}18, ${BRAND}08)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
      }}>
        {c.emoji || (
          <span style={{ fontSize: 14, fontWeight: 900, color: BRAND }}>{initials(c.name)}</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.name}
          </span>
          {isOwner && (
            <span style={{ fontSize: 8.5, fontWeight: 900, color: BRAND, background: 'rgba(108,59,255,.12)', padding: '1px 5px', borderRadius: 5, flexShrink: 0 }}>
              OWNER
            </span>
          )}
        </div>
        {c.description && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.description}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: GREEN, background: 'rgba(16,185,129,.10)', borderRadius: 100, padding: '2px 9px' }}>
            <Icon name="ti-users" size={11}/>
            {c.member_count || 1} member{(c.member_count || 1) === 1 ? '' : 's'}
          </span>
          {c.joined_at && (
            <span style={{ fontSize: 11, color: 'var(--ak-text-muted)' }}>joined {timeAgo(c.joined_at)}</span>
          )}
        </div>
      </div>
      <Icon name="ti-chevron-right" size={18} color="var(--ak-text-muted)" style={{ flexShrink: 0 }}/>
    </button>
  );
}

function CreateCommunitySheet({ onClose, onCreated }) {
  const [name, setName]       = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji]     = useState(EMOJIS[0]);
  // One request at a time — repeated taps on a bad connection once fired
  // repeated POSTs and created duplicate communities.
  const { busy: saving, run: runSave } = useInFlight();
  const [err, setErr]         = useState('');

  const create = () => runSave(async () => {
    if (!name.trim()) return;
    setErr('');
    try {
      const c = await createCommunity({ name: name.trim(), description: description.trim() || undefined, emoji });
      onCreated(c);
    } catch (e) {
      setErr(e?.message || 'Something went wrong. Try again.');
    }
  });

  const FIELD = {
    width: '100%', boxSizing: 'border-box', borderRadius: 12, padding: '11px 13px',
    border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)',
    fontFamily: "'Nunito',sans-serif", fontSize: 13.5, outline: 'none',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 540, maxHeight: '85vh', overflowY: 'auto', borderRadius: '22px 22px 0 0', fontFamily: "'Nunito',sans-serif", animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{'@keyframes sheet-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}'}</style>
        <div style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center', position: 'sticky', top: 0, background: 'var(--ak-surface)', zIndex: 1 }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: 'var(--ak-border2, #E5E0F5)' }} />
        </div>
        <div style={{ padding: '6px 18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 14px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>New community</h2>
            <button onClick={onClose} style={{ background: '#F0EBFF', border: 'none', borderRadius: 100, width: 30, height: 30, cursor: 'pointer', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ti-x" size={16}/>
            </button>
          </div>

          {/* Identity avatar picker */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setEmoji(e)} style={{
                width: 40, height: 40, borderRadius: 11, cursor: 'pointer', fontSize: 20,
                border: emoji === e ? `1.5px solid ${BRAND}` : '1.5px solid transparent',
                background: emoji === e ? `${BRAND}14` : 'var(--ak-bg)',
              }}>{e}</button>
            ))}
          </div>

          <input
            value={name}
            onChange={e => { setName(e.target.value); setErr(''); }}
            placeholder="Community name"
            maxLength={80}
            autoFocus
            style={{ ...FIELD, marginBottom: 10 }}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What is this community for? (optional)"
            maxLength={500}
            rows={3}
            style={{ ...FIELD, resize: 'none', marginBottom: 10 }}
          />
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 10 }}>{err}</div>}

          <button
            onClick={create}
            disabled={!name.trim() || saving}
            style={{
              width: '100%', padding: '13px', borderRadius: 14, cursor: (!name.trim() || saving) ? 'default' : 'pointer',
              border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff',
              fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif",
            }}>
            {saving ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Spinner size={13}/> Creating…</span> : 'Create community'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast]   = useState(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyCommunities());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/app')}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Communities</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {items.length > 0 ? `${items.length} joined` : 'Find your people'}
              </p>
            </div>
          </div>
          {/* Plus — create a new community */}
          <button onClick={() => setSheetOpen(true)} aria-label="Create community"
            style={{ background: BRAND, border: 'none', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ti-plus" size={18}/>
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}>
              <Icon name="ti-users" size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>No communities yet</p>
            <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4 }}>Tap + to start your first one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {items.map(c => <CommunityCard key={c.id} c={c} onOpen={(id) => navigate(`/communities/${id}`)} />)}
          </div>
        )}
      </div>

      {/* Bottom toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}

      {/* Create sheet */}
      {sheetOpen && (
        <CreateCommunitySheet
          onClose={() => setSheetOpen(false)}
          onCreated={(c) => {
            setSheetOpen(false);
            setItems(prev => [c, ...prev]);
            showToast('Community created');
          }}
        />
      )}
    </div>
    </AppShell>
  );
}
