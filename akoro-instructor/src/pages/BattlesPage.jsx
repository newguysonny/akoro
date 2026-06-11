import { useState, useEffect } from 'react';
import { Plus, Swords, Users, Clock, Trophy, Play, ChevronRight, Zap, Target } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, StatusPill, Badge, Toast, Skeleton } from '../components/Primitives.jsx';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';

/* ── Mock data ─────────────────────────────────────────────────────── */
const MOCK_BATTLES = [
  { id: 1, title: 'React Hooks Quiz', topic: 'React', status: 'scheduled', participantCount: 0, maxParticipants: 20, scheduledAt: new Date(Date.now() + 3600000).toISOString(), duration: 15, difficulty: 'medium' },
  { id: 2, title: 'JS Fundamentals Battle', topic: 'JavaScript', status: 'live', participantCount: 12, maxParticipants: 20, scheduledAt: new Date().toISOString(), duration: 10, difficulty: 'easy' },
  { id: 3, title: 'Algorithm Challenge', topic: 'CS Fundamentals', status: 'completed', participantCount: 18, maxParticipants: 20, scheduledAt: new Date(Date.now() - 86400000).toISOString(), duration: 20, difficulty: 'hard' },
];

/* ── New Battle Modal ───────────────────────────────────────────────── */
function NewBattleModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({
    title: '', topic: '', description: '',
    maxParticipants: '20', duration: '10',
    difficulty: 'medium', scheduledAt: '',
  });
  const [loading, setLoading] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.topic) return;
    setLoading(true);
    try { await onSubmit(form); onClose(); setForm({ title: '', topic: '', description: '', maxParticipants: '20', duration: '10', difficulty: 'medium', scheduledAt: '' }); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Battle" width={500}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Inp label="Battle Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. React Hooks Quiz" />
        <Inp label="Topic *" value={form.topic} onChange={e => setField('topic', e.target.value)} placeholder="e.g. JavaScript, React, Python…" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="What will students be tested on?" rows={2} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Inp label="Max Participants" type="number" value={form.maxParticipants} onChange={e => setField('maxParticipants', e.target.value)} />
          <Inp label="Duration (min)" type="number" value={form.duration} onChange={e => setField('duration', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
          <Inp label="Schedule (optional)" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading || !form.title || !form.topic}>
            {loading ? 'Creating…' : 'Create Battle'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Difficulty badge ───────────────────────────────────────────────── */
function DiffBadge({ difficulty }) {
  const map = { easy: { color: GREEN, bg: '#DCFCE7' }, medium: { color: AMBER, bg: '#FFF7ED' }, hard: { color: RED, bg: '#FEE2E2' } };
  const cfg = map[difficulty] || map.medium;
  return <Badge color={cfg.color} bg={cfg.bg}>{difficulty}</Badge>;
}

/* ── Battle Card ────────────────────────────────────────────────────── */
function BattleCard({ battle, onStart }) {
  const isLive = battle.status === 'live';
  const scheduled = battle.scheduledAt ? new Date(battle.scheduledAt) : null;

  return (
    <div style={{
      background: WHITE, border: `1px solid ${isLive ? AMBER : BORDER}`,
      borderRadius: 16, padding: '20px',
      boxShadow: isLive ? `0 4px 20px ${AMBER}22` : 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {isLive && (
        <div style={{
          position: 'absolute', top: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 4,
          background: '#DCFCE7', color: GREEN, fontSize: 10, fontWeight: 800,
          padding: '3px 8px', borderRadius: 20,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: GREEN, display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
          LIVE
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: isLive ? `linear-gradient(135deg, ${AMBER}, #D4651E)` : `${PURPLE}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Swords size={20} color={isLive ? WHITE : PURPLE} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, fontFamily: FONT }}>{battle.title}</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{battle.topic}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusPill status={battle.status} />
        <DiffBadge difficulty={battle.difficulty} />
        <Badge color={BLUE} bg="#EFF6FF"><Users size={10} style={{ marginRight: 2 }} />{battle.participantCount}/{battle.maxParticipants}</Badge>
        <Badge color={MUTED} bg={LIGHT}><Clock size={10} style={{ marginRight: 2 }} />{battle.duration}min</Badge>
      </div>

      {scheduled && (
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginBottom: 14 }}>
          {battle.status === 'completed' ? 'Ended' : 'Starts'}: {scheduled.toLocaleDateString()} at {scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {battle.status !== 'completed' && (
        <Btn
          size="sm"
          variant={isLive ? 'secondary' : 'primary'}
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => !isLive && onStart(battle.id)}
        >
          {isLive ? <><Target size={14} /> Battle in Progress</> : <><Play size={14} /> Start Now</>}
        </Btn>
      )}

      {battle.status === 'completed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, fontFamily: FONT }}>
          <Trophy size={14} color={AMBER} />
          {battle.participantCount} participants completed
        </div>
      )}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function BattlesPage() {
  const { getBattles, createBattle, updateBattle } = useBattlesAPI();
  const { user } = useAuth();
  const socket = useInstructorSocket(user?.id);

  const [battles, setBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [toast,   setToast]   = useState(null);
  const [filter,  setFilter]  = useState('all');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const res = await getBattles();
      setBattles(res?.data || MOCK_BATTLES);
    } catch (err) {
      console.warn('Battles API error, using mock:', err);
      setBattles(MOCK_BATTLES);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Listen for real-time battle updates
  useEffect(() => {
    socket.on('battle.created', () => load());
    socket.on('battle.updated', () => load());
    return () => {
      socket.off('battle.created', () => load());
      socket.off('battle.updated', () => load());
    };
  }, []);

  const handleCreate = async (form) => {
    await createBattle({
      ...form,
      maxParticipants: parseInt(form.maxParticipants),
      duration: parseInt(form.duration),
      status: form.scheduledAt ? 'scheduled' : 'draft',
    }).catch(console.warn);
    showToast('Battle created!');
    load();
  };

  const handleStart = async (id) => {
    await updateBattle(id, { status: 'live' }).catch(console.warn);
    setBattles(bs => bs.map(b => b.id === id ? { ...b, status: 'live' } : b));
    showToast('Battle is now live!');
  };

  const filtered = filter === 'all' ? battles : battles.filter(b => b.status === filter);

  const stats = {
    live:      battles.filter(b => b.status === 'live').length,
    scheduled: battles.filter(b => b.status === 'scheduled').length,
    completed: battles.filter(b => b.status === 'completed').length,
    total:     battles.length,
  };

  return (
    <PageLayout
      title="Battles"
      subtitle="Create and manage quiz battles for your students"
      action={
        <Btn size="sm" onClick={() => setModal(true)}>
          <Plus size={14} /> New Battle
        </Btn>
      }
    >
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total', value: stats.total, color: AMBER },
          { label: 'Live Now', value: stats.live, color: GREEN },
          { label: 'Scheduled', value: stats.scheduled, color: BLUE },
          { label: 'Completed', value: stats.completed, color: PURPLE },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: FONT }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'live', 'scheduled', 'completed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: filter === f ? AMBER : WHITE,
              color: filter === f ? WHITE : MUTED,
              border: `1.5px solid ${filter === f ? AMBER : BORDER}`,
              cursor: 'pointer', fontFamily: FONT, textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Battles grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <Swords size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {filter === 'all' ? 'No battles yet' : `No ${filter} battles`}
          </p>
          {filter === 'all' && <Btn onClick={() => setModal(true)}><Plus size={14} /> Create your first battle</Btn>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(b => <BattleCard key={b.id} battle={b} onStart={handleStart} />)}
        </div>
      )}

      <NewBattleModal open={modal} onClose={() => setModal(false)} onSubmit={handleCreate} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
