import { useState, useEffect, useCallback } from 'react';
import { Plus, Swords, Users, Clock, Trophy, Play, Zap, Target, Search, Trash2, Pencil } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, StatusPill, Badge, Toast } from '../components/Primitives.jsx';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import QuestionBankModal from '../components/QuestionBankModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import NoAgentModal, { isNoAgentError } from '../components/NoAgentModal.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

/* ── Opponent picker ─────────────────────────────────────────────────────
   Two ways to say who you're challenging, because teachers know their class
   two different ways: by scrolling the roster, and by typing the handful of
   usernames they already have in mind. Both feed the same list. */
function OpponentPicker({ roster, loading, selected, onToggle, typed, onTyped }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term
    ? roster.filter(r =>
        (r.full_name || '').toLowerCase().includes(term) ||
        (r.username  || '').toLowerCase().includes(term))
    : roster;

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
        <Search size={13} color={MUTED} />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search learners by name or username…"
          style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, fontFamily: FONT, color: INK }}
        />
      </div>

      <div style={{ maxHeight: 190, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 14, fontSize: 12, color: MUTED, fontFamily: FONT }}>Loading roster…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: MUTED, fontFamily: FONT }}>
            {roster.length === 0 ? 'No learners enrolled in this course yet.' : 'No match.'}
          </div>
        ) : shown.map(r => {
          const on = selected.includes(r.id);
          return (
            <button
              key={r.id} type="button"
              onClick={() => r.has_agent && onToggle(r.id)}
              disabled={!r.has_agent}
              title={r.has_agent ? '' : 'This learner has no agent yet, so they cannot battle'}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px', border: 'none', borderBottom: `1px solid ${BORDER}`,
                background: on ? `${AMBER}12` : WHITE, textAlign: 'left',
                cursor: r.has_agent ? 'pointer' : 'not-allowed', opacity: r.has_agent ? 1 : 0.45,
                fontFamily: FONT,
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `1.5px solid ${on ? AMBER : BORDER}`, background: on ? AMBER : WHITE,
                color: WHITE, fontSize: 11, fontWeight: 900, lineHeight: '16px', textAlign: 'center',
              }}>{on ? '✓' : ''}</span>
              <span style={{ fontSize: 15 }}>{r.emoji || '🧑‍🎓'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: INK }}>{r.full_name}</span>
                <span style={{ display: 'block', fontSize: 11, color: MUTED }}>@{r.username}</span>
              </span>
              {!r.has_agent && <Badge color={MUTED} bg={LIGHT}>no agent</Badge>}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '9px 10px', borderTop: `1px solid ${BORDER}`, background: LIGHT }}>
        <Inp
          label="…or type usernames"
          value={typed} onChange={e => onTyped(e.target.value)}
          placeholder="priya, amaka, jss1_mate3"
        />
        <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT, marginTop: 4 }}>
          Comma-separated usernames or emails. Unknown names are reported before anything is created.
        </div>
      </div>
    </div>
  );
}

/* ── New / Edit Battle Modal ────────────────────────────────────────────── */
const BLANK = {
  courseId: '', title: '', topic: '', description: '',
  targetMode: 'class', selected: [], typed: '',
  totalQuestions: '15', duration: '15', xpPrize: '200',
  difficulty: 'intermediate', scheduledAt: '', expiresInMinutes: '60',
};

function BattleModal({ open, onClose, onSubmit, courses, getRoster, editing }) {
  const [form, setForm]     = useState(BLANK);
  const [roster, setRoster] = useState([]);
  const [rLoading, setRLoading] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Reset each time the modal opens, seeded from the battle being edited.
  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setForm({
        ...BLANK,
        courseId: editing.courseId || '',
        title: editing.title || '',
        topic: editing.topic || '',
        description: editing.description || '',
        totalQuestions: String(editing.totalQuestions || 15),
        duration: String(editing.durationMin || 15),
        xpPrize: String(editing.xpPool || 200),
        difficulty: editing.difficulty || 'intermediate',
        scheduledAt: editing.scheduledAt ? toLocalInput(editing.scheduledAt) : '',
      });
    } else {
      setForm({ ...BLANK, courseId: courses[0]?.id || '' });
    }
  }, [open, editing, courses]);

  // Roster follows the chosen course.
  useEffect(() => {
    if (!open || editing || !form.courseId) { setRoster([]); return; }
    let dead = false;
    setRLoading(true);
    getRoster(form.courseId)
      .then(res => { if (!dead) setRoster(res?.data ?? []); })
      .catch(() => { if (!dead) setRoster([]); })
      .finally(() => { if (!dead) setRLoading(false); });
    return () => { dead = true; };
  }, [open, editing, form.courseId, getRoster]);

  const toggle = (id) => setForm(f => ({
    ...f, selected: f.selected.includes(id) ? f.selected.filter(x => x !== id) : [...f.selected, id],
  }));

  const typedNames = form.typed.split(',').map(s => s.trim()).filter(Boolean);
  const targetCount = form.targetMode === 'class'
    ? roster.filter(r => r.has_agent).length
    : form.selected.length + typedNames.length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.courseId) return setError('Pick a course.');
    if (!form.title.trim()) return setError('Give the battle a title.');
    if (!editing && form.targetMode === 'picked' && targetCount === 0)
      return setError('Choose at least one learner, or switch to “Whole class”.');

    setLoading(true);
    try {
      await onSubmit(form, typedNames);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save the battle.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Battle' : 'Create Battle'} width={540}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Sel label="Course *" value={form.courseId} onChange={e => setField('courseId', e.target.value)} disabled={!!editing}>
          <option value="">Select a course…</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
        </Sel>

        <Inp label="Battle Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Photosynthesis Showdown" />
        <Inp label="Topic" value={form.topic} onChange={e => setField('topic', e.target.value)} placeholder="e.g. Photosynthesis" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="What will learners be tested on?" rows={2} />

        {!editing && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 7 }}>
              Who are you challenging? *
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[
                { key: 'class',  label: 'Whole class', hint: 'Everyone enrolled' },
                { key: 'picked', label: 'Specific learners', hint: 'One or more' },
              ].map(o => (
                <button
                  key={o.key} type="button" onClick={() => setField('targetMode', o.key)}
                  style={{
                    flex: 1, padding: '9px 8px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT,
                    textAlign: 'left',
                    border: `1.5px solid ${form.targetMode === o.key ? AMBER : BORDER}`,
                    background: form.targetMode === o.key ? `${AMBER}12` : WHITE,
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: form.targetMode === o.key ? AMBER : INK }}>{o.label}</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>{o.hint}</div>
                </button>
              ))}
            </div>

            {form.targetMode === 'picked' && (
              <OpponentPicker
                roster={roster} loading={rLoading}
                selected={form.selected} onToggle={toggle}
                typed={form.typed} onTyped={v => setField('typed', v)}
              />
            )}

            <div style={{ fontSize: 11, color: targetCount ? GREEN : MUTED, fontFamily: FONT, marginTop: 7, fontWeight: 700 }}>
              {form.targetMode === 'class'
                ? `${targetCount} learner${targetCount === 1 ? '' : 's'} in this course will be entered`
                : targetCount === 1
                  ? '1 learner — this becomes a 1-v-1 challenge they can accept or decline'
                  : `${targetCount} learners — this becomes a group battle`}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Inp label="Questions" type="number" min="1" value={form.totalQuestions} onChange={e => setField('totalQuestions', e.target.value)} />
          <Inp label="Duration (min)" type="number" min="1" value={form.duration} onChange={e => setField('duration', e.target.value)} />
          <Inp label="XP prize" type="number" min="0" value={form.xpPrize} onChange={e => setField('xpPrize', e.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="intermediate">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
          <Inp label="Schedule for (optional)" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading || !form.title.trim() || !form.courseId}>
            {loading ? 'Saving…' : editing ? 'Save changes' : 'Create Battle'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* datetime-local wants local wall-clock, not the ISO Z string. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── Difficulty badge ───────────────────────────────────────────────────── */
function DiffBadge({ difficulty }) {
  const map = {
    easy:         { color: GREEN, bg: '#DCFCE7', label: 'easy' },
    medium:       { color: AMBER, bg: '#FFF7ED', label: 'medium' },
    intermediate: { color: AMBER, bg: '#FFF7ED', label: 'medium' },
    hard:         { color: RED,   bg: '#FEE2E2', label: 'hard' },
  };
  const cfg = map[difficulty] || map.intermediate;
  return <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>;
}

/* ── Battle Card ────────────────────────────────────────────────────────── */
function BattleCard({ battle, onStart, onEdit, onDelete }) {
  const isLive     = battle.status === 'live';
  const isFinished = ['completed', 'cancelled', 'expired'].includes(battle.status);
  const editable   = !['live', 'completed'].includes(battle.status) && battle.mine;
  const deletable  = battle.status !== 'live' && battle.mine;
  const scheduled  = battle.scheduledAt ? new Date(battle.scheduledAt) : null;

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
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: isLive ? `linear-gradient(135deg, ${AMBER}, #D4651E)` : `${PURPLE}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Swords size={20} color={isLive ? WHITE : PURPLE} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, fontFamily: FONT }}>{battle.title}</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{battle.topic || battle.subject}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusPill status={battle.status} />
        <DiffBadge difficulty={battle.difficulty} />
        <Badge color={BLUE} bg="#EFF6FF"><Users size={10} style={{ marginRight: 2 }} />{battle.participantCount}</Badge>
        <Badge color={MUTED} bg={LIGHT}><Clock size={10} style={{ marginRight: 2 }} />{battle.durationMin}min</Badge>
        <Badge color={AMBER} bg="#FFF7ED"><Zap size={10} style={{ marginRight: 2 }} />{battle.xpPool} XP</Badge>
      </div>

      {scheduled && (
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginBottom: 14 }}>
          {isFinished ? 'Ended' : 'Starts'}: {scheduled.toLocaleDateString()} at {scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {!isFinished && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn
            size="sm"
            variant={isLive ? 'secondary' : 'primary'}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => !isLive && onStart(battle.id)}
          >
            {isLive ? <><Target size={14} /> In Progress</> : <><Play size={14} /> Start Now</>}
          </Btn>
          {editable && (
            <>
              <Btn size="sm" variant="secondary" onClick={() => onEdit(battle)} title="Edit"><Pencil size={13} /></Btn>
              <Btn size="sm" variant="secondary" onClick={() => onDelete(battle)} title="Cancel battle"><Trash2 size={13} /></Btn>
            </>
          )}
        </div>
      )}

      {isFinished && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, fontFamily: FONT }}>
            <Trophy size={14} color={AMBER} />
            {battle.participantCount} participants
          </div>
          {editable && <Btn size="sm" variant="secondary" onClick={() => onEdit(battle)} title="Edit"><Pencil size={13} /></Btn>}
          {deletable && <Btn size="sm" variant="secondary" onClick={() => onDelete(battle)} title="Delete"><Trash2 size={13} /></Btn>}
        </div>
      )}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function BattlesPage() {
  const { getBattles, getRoster, createBattle, updateBattle, startBattle, deleteBattle } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();
  const { user } = useAuth();
  const socket = useInstructorSocket(user?.id);

  const [battles, setBattles] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [toast,   setToast]   = useState(null);
  const [filter,  setFilter]  = useState('all');
  const [noAgent, setNoAgent] = useState(null);   // holds the retry, so creating one resumes the battle

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const res = await getBattles();
      setBattles(res?.data ?? []);
    } catch (err) {
      console.warn('Battles API error:', err);
      setBattles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getCourses()
      .then(res => setCourses(res?.data ?? res?.courses ?? []))
      .catch(() => setCourses([]));
  }, []);

  // Real-time battle updates
  useEffect(() => {
    const refresh = () => load();
    socket.on('battle.created', refresh);
    socket.on('battle.updated', refresh);
    return () => {
      socket.off('battle.created', refresh);
      socket.off('battle.updated', refresh);
    };
  }, [load]);

  // The modal's submit awaits this, so a thrown error surfaces in the form.
  // A missing agent is not a form error though — it's a setup step, so we swap
  // it for the modal that creates one and then replays this exact submit.
  const handleSubmit = async (form, typedNames) => {
    try {
      return await submitBattle(form, typedNames);
    } catch (err) {
      if (!isNoAgentError(err)) throw err;
      setNoAgent(() => () => submitBattle(form, typedNames));
      return;   // the battle modal closes; the agent modal takes over
    }
  };

  const submitBattle = async (form, typedNames) => {
    const scheduledIso = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;

    if (editing) {
      await updateBattle(editing.id, {
        title: form.title.trim(),
        description: form.description || null,
        topic: form.topic || null,
        difficulty: form.difficulty,
        total_questions: parseInt(form.totalQuestions, 10) || 15,
        time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
        xp_prize: parseInt(form.xpPrize, 10) || 0,
        xp_pool:  parseInt(form.xpPrize, 10) || 0,
        scheduled_start: scheduledIso,
      });
      showToast('Battle updated');
    } else {
      const res = await createBattle(form.courseId, {
        title: form.title.trim(),
        description: form.description || null,
        topic: form.topic || null,
        difficulty: form.difficulty,
        total_questions: parseInt(form.totalQuestions, 10) || 15,
        time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
        xp_prize: parseInt(form.xpPrize, 10) || 200,
        expires_in_minutes: parseInt(form.expiresInMinutes, 10) || 60,
        scheduled_for: scheduledIso,
        whole_class: form.targetMode === 'class',
        user_ids: form.targetMode === 'class' ? [] : form.selected,
        usernames: form.targetMode === 'class' ? [] : typedNames,
      });
      const d = res?.data ?? {};
      const skipped = (d.skipped?.no_agent?.length ?? 0) + (d.skipped?.not_enrolled?.length ?? 0);
      showToast(`Battle created — ${d.invited} challenged${skipped ? `, ${skipped} skipped (no agent / not enrolled)` : ''}`);
    }
    setEditing(null);
    load();
  };

  const handleStart = async (id) => {
    try {
      await startBattle(id);
      setBattles(bs => bs.map(b => b.id === id ? { ...b, status: 'live' } : b));
      showToast('Battle is starting — it goes live in a moment.');
    } catch (e) {
      showToast(e?.message || 'Could not start the battle', 'error');
    }
  };

  const handleDelete = async (battle) => {
    if (!await confirmDialog(`Delete “${battle.title}”? This removes it for everyone invited, along with its questions and results.`)) return;
    const before = battles;
    setBattles(bs => bs.filter(b => b.id !== battle.id));
    try {
      await deleteBattle(battle.id);
      showToast('Battle deleted');
    } catch (e) {
      setBattles(before);   // it's still there — don't pretend otherwise
      showToast(e?.message || 'Could not delete the battle', 'error');
    }
  };

  const openNew  = () => { setEditing(null); setModal(true); };
  const openEdit = (b) => { setEditing(b); setModal(true); };

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
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={() => setBankOpen(true)}>
            <Target size={14} /> Question Bank
          </Btn>
          <Btn size="sm" onClick={openNew}>
            <Plus size={14} /> New Battle
          </Btn>
        </div>
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
        {['all', 'live', 'scheduled', 'lobby', 'completed'].map(f => (
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
          {filter === 'all' && <Btn onClick={openNew}><Plus size={14} /> Create your first battle</Btn>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(b => (
            <BattleCard key={b.id} battle={b} onStart={handleStart} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <BattleModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null); }}
        onSubmit={handleSubmit}
        courses={courses}
        getRoster={getRoster}
        editing={editing}
      />
      <QuestionBankModal open={bankOpen} onClose={() => setBankOpen(false)} />
      <NoAgentModal open={!!noAgent} context="battle" onClose={() => setNoAgent(null)} onCreated={noAgent} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
