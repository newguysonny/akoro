import { useState, useEffect, useCallback } from 'react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, Badge, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import NoAgentModal, { isNoAgentError } from '../components/NoAgentModal.jsx';
import { GREEN, PURPLE, BLUE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { confirmDialog } from '../components/ConfirmHost.jsx';

/* datetime-local speaks local wall-clock; the API speaks ISO/UTC. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local) => (local ? new Date(local).toISOString() : null);

/* Repeat presets, expressed as the cron the scheduler already understands. */
const REPEATS = [
  { key: 'none',    label: 'Does not repeat', cron: null },
  { key: 'daily',   label: 'Every day',       cron: '0 8 * * *' },
  { key: 'weekdays',label: 'Every weekday',   cron: '0 8 * * 1-5' },
  { key: 'weekly',  label: 'Every week',      cron: '0 8 * * 1' },
  { key: 'monthly', label: 'Every month',     cron: '0 8 1 * *' },
];
const cronToRepeat = (cron) => REPEATS.find(r => r.cron === cron)?.key ?? (cron ? 'custom' : 'none');

/* What a task can actually do, in the teacher's words. The engine reads free
   text and picks a tool, so the only thing standing between a teacher and a
   scheduled podcast is knowing it's possible.

   Each carries a description as well as a title. The title is what the teacher
   scans in their task list; the description is what the agent actually works
   from — it goes into the prompt alongside the title, so the detail that makes
   a task specific (which class, which subject, what to include) belongs there.
   Filling only the title left the sample sounding complete while giving the
   agent half the brief. */
const EXAMPLES = [
  {
    title: 'Every Monday 7am, create a battle for JSS1',
    description: "Set a class battle for JSS1 on the topic we covered last week. 15 questions, medium difficulty, 200 XP. Use the question bank and top up with AI if it's short.",
  },
  {
    title: 'Assign self study on the water cycle to JSS2',
    description: 'Basic Science. Due Friday. Tell them to finish it before the practical lesson.',
  },
  {
    title: 'Make a podcast about the solar system for JSS1',
    description: 'Basic Science, 5 minutes, two hosts. Keep it lively and cover the planets in order, with one surprising fact each.',
  },
  {
    title: "Draft lesson hooks for next week's Basic Science lesson",
    description: 'JSS1, topic: photosynthesis. Five openers I can use in the first two minutes of the lesson.',
  },
  {
    title: 'Every Friday, take attendance for JSS1',
    description: 'Summarise who was present, absent and late this week, and flag anyone who missed more than two days.',
  },
];

const BLANK = { title: '', description: '', priority: 'medium', dueAt: '', repeat: 'none', customCron: '' };

/* ── New / Edit Task Modal ──────────────────────────────────────────────── */
function TaskModal({ open, onClose, onSubmit, editing }) {
  const [form, setForm]   = useState(BLANK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(editing
      ? {
          title: editing.title || '',
          description: editing.description || '',
          priority: editing.priority || 'medium',
          dueAt: toLocalInput(editing.due_at),
          repeat: editing.is_recurring ? cronToRepeat(editing.cron_expr) : 'none',
          customCron: editing.is_recurring && cronToRepeat(editing.cron_expr) === 'custom' ? editing.cron_expr : '',
        }
      : BLANK);
  }, [open, editing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Give the task a title.');
    if (form.repeat === 'custom' && !form.customCron.trim())
      return setError('Enter a cron expression, or pick a preset.');

    setLoading(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save the task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Task' : 'New Task'}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Inp label="Task Title *" value={form.title} onChange={e => setField('title', e.target.value)}
          placeholder="e.g. Every Monday, create a battle for JSS1" />

        {!editing && !form.title && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, fontFamily: C.font, marginBottom: 6 }}>
              Your agent can set battles, assign self study and run your teaching tools. Try:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EXAMPLES.map(ex => (
                <button key={ex.title} type="button"
                  title={ex.description}
                  onClick={() => setForm(f => ({ ...f, title: ex.title, description: ex.description }))}
                  style={{
                    padding: '5px 10px', borderRadius: 20, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${C.border}`, background: C.bg, color: C.muted,
                    fontSize: 11, fontWeight: 600, fontFamily: C.font,
                  }}>{ex.title}</button>
              ))}
            </div>
          </div>
        )}
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Additional details…" rows={2} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Priority" value={form.priority} onChange={e => setField('priority', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Sel>
          <Sel label="Repeat" value={form.repeat} onChange={e => setField('repeat', e.target.value)}>
            {REPEATS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value="custom">Custom (cron)…</option>
          </Sel>
        </div>

        <div>
          <Inp
            label="Run at (date & time)"
            type="datetime-local"
            value={form.dueAt}
            onChange={e => setField('dueAt', e.target.value)}
          />
          <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 4 }}>
            {form.repeat === 'none'
              ? 'Leave empty to run it straight away. A future time schedules it.'
              : 'The repeat schedule takes over after the first run.'}
          </div>
        </div>

        {form.repeat === 'custom' && (
          <Inp label="Cron expression" value={form.customCron} onChange={e => setField('customCron', e.target.value)} placeholder="0 8 * * 1-5" />
        )}

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: C.font }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading || !form.title.trim()}>
            {loading ? 'Saving…' : editing ? 'Save changes' : 'Add Task'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Badges ─────────────────────────────────────────────────────────────── */
function PriorityBadge({ priority }) {
  const map = {
    high:   { color: RED,    bg: '#FEE2E2', label: 'High' },
    medium: { color: C.brand,  bg: C.brandSoft, label: 'Medium' },
    low:    { color: C.muted,  bg: C.bg,     label: 'Low' },
  };
  const cfg = map[priority] || map.low;
  return <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>;
}

function TypeBadge({ type }) {
  const map = {
    course:  { color: C.brand,  bg: C.brandSoft },
    review:  { color: BLUE,   bg: '#EFF6FF' },
    battle:  { color: PURPLE, bg: '#EDE9FE' },
    general: { color: C.muted,  bg: C.bg },
  };
  const cfg = map[type] || map.general;
  return <Badge color={cfg.color} bg={cfg.bg}>{type || 'general'}</Badge>;
}

function StatusBadge({ status }) {
  const map = {
    done:      { color: GREEN, bg: '#DCFCE7' },
    running:   { color: BLUE,  bg: '#EFF6FF' },
    queued:    { color: C.brand, bg: C.brandSoft },
    pending:   { color: C.muted, bg: C.bg },
    failed:    { color: RED,   bg: '#FEE2E2' },
    cancelled: { color: C.muted, bg: C.bg },
  };
  const cfg = map[status] || map.pending;
  return <Badge color={cfg.color} bg={cfg.bg}>{status}</Badge>;
}

/* ── Task Row ───────────────────────────────────────────────────────────── */
function TaskRow({ task, onToggle, onEdit, onDelete, onRun }) {
  const isDone    = task.status === 'done';
  const isRunning = task.status === 'running';
  const due       = task.due_at ? new Date(task.due_at) : null;
  const isOverdue = due && due < new Date() && !isDone;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px', background: C.surface, borderRadius: 12,
      border: `1px solid ${isOverdue ? '#FECACA' : C.border}`,
      opacity: isDone ? 0.7 : 1, transition: 'opacity .2s',
    }}>
      <button
        onClick={() => onToggle(task)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0, color: isDone ? GREEN : C.muted }}
        title={isDone ? 'Mark as pending' : 'Mark as done'}
      >
        {isDone ? <Ico ti="ti-square-check" size={20} /> : <Ico ti="ti-square" size={20} />}
      </button>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: isDone ? C.muted : C.ink,
          fontFamily: C.font, textDecoration: isDone ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.description}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <TypeBadge type={task.task_type} />
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
        {task.is_recurring && (
          <span title="Repeats on a schedule" style={{ color: PURPLE, display: 'flex' }}><Ico ti="ti-repeat" size={12} /></span>
        )}
        {due && (
          <span style={{ fontSize: 11, color: isOverdue ? RED : C.muted, display: 'flex', alignItems: 'center', gap: 3, fontFamily: C.font, whiteSpace: 'nowrap' }}>
            <Ico ti="ti-clock" size={10} />
            {due.toLocaleDateString()} {due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}

        <button onClick={() => onRun(task)} disabled={isRunning} title="Run now"
          style={iconBtn(isRunning)}><Ico ti="ti-player-play" size={13} /></button>
        <button onClick={() => onEdit(task)} disabled={isRunning} title="Edit"
          style={iconBtn(isRunning)}><Ico ti="ti-pencil" size={13} /></button>
        <button onClick={() => onDelete(task)} disabled={isRunning} title="Delete"
          style={iconBtn(isRunning, RED)}><Ico ti="ti-trash" size={13} /></button>
      </div>
    </div>
  );
}

const iconBtn = (disabled, color = C.muted) => ({
  background: 'none', border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '5px 6px', cursor: disabled ? 'not-allowed' : 'pointer',
  color, display: 'flex', opacity: disabled ? 0.4 : 1,
});

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function TasksPage() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast,   setToast]   = useState(null);
  const [filter,  setFilter]  = useState('all');
  const [noAgent, setNoAgent] = useState(null);   // holds the retry, so creating one resumes the save

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/tasks');
      setTasks(res?.tasks ?? []);
    } catch (err) {
      console.warn('Tasks API error:', err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const bodyFrom = (form) => {
    const cron = form.repeat === 'custom'
      ? form.customCron.trim()
      : REPEATS.find(r => r.key === form.repeat)?.cron ?? null;
    return {
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      dueAt: toIso(form.dueAt),
      isRecurring: !!cron,
      cronExpr: cron,
    };
  };

  // A missing agent isn't a form error, it's a setup step: swap it for the
  // modal that creates one, then replay this exact save.
  const handleSubmit = async (form) => {
    try {
      return await submitTask(form);
    } catch (err) {
      if (!isNoAgentError(err)) throw err;
      setNoAgent(() => () => submitTask(form));
      return;
    }
  };

  const submitTask = async (form) => {
    if (editing) {
      await apiPatch(`/api/tasks/${editing.id}`, bodyFrom(form));
      showToast('Task updated');
    } else {
      await apiPost('/api/tasks', bodyFrom(form));
      showToast('Task created');
    }
    setEditing(null);
    load();
  };

  const handleToggle = async (task) => {
    const next = task.status === 'done' ? 'pending' : 'done';
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: next } : t));
    try {
      const res = await apiPatch(`/api/tasks/${task.id}/toggle`, {});
      if (res?.task) setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: res.task.status } : t));
    } catch (e) {
      showToast('Could not update the task', 'error');
      load();
    }
  };

  const handleDelete = async (task) => {
    if (!await confirmDialog(`Delete “${task.title}”? This also removes anything it produced.`)) return;
    const before = tasks;
    setTasks(ts => ts.filter(t => t.id !== task.id));
    try {
      await apiDelete(`/api/tasks/${task.id}`);
      showToast('Task deleted');
    } catch (e) {
      setTasks(before);
      showToast(e?.message || 'Could not delete the task', 'error');
    }
  };

  const handleRun = async (task) => {
    try {
      await apiPost(`/api/tasks/${task.id}/trigger`, {});
      showToast('Task queued — your agent is on it.');
      load();
    } catch (e) {
      showToast(e?.message || 'Could not run the task', 'error');
    }
  };

  const openNew  = () => { setEditing(null); setModal(true); };
  const openEdit = (t) => { setEditing(t); setModal(true); };

  const filtered = filter === 'all' ? tasks
    : filter === 'done' ? tasks.filter(t => t.status === 'done')
    : filter === 'scheduled' ? tasks.filter(t => t.due_at && new Date(t.due_at) > new Date() && t.status !== 'done')
    : tasks.filter(t => t.status !== 'done');

  const pending  = tasks.filter(t => t.status !== 'done').length;
  const done     = tasks.filter(t => t.status === 'done').length;
  const overdue  = tasks.filter(t => t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done').length;

  return (
    <PageLayout
      title="Tasks"
      subtitle="Schedule work for your school's agent — once, or on a repeat"
      action={<Btn size="sm" onClick={openNew}><Ico ti="ti-plus" size={14} /> New Task</Btn>}
    >
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24, maxWidth: 480 }}>
        {[
          { label: 'Pending', value: pending, color: C.brand },
          { label: 'Completed', value: done, color: GREEN },
          { label: 'Overdue', value: overdue, color: RED },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: C.font }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'all',       label: 'All' },
          { key: 'pending',   label: 'Pending' },
          { key: 'scheduled', label: 'Scheduled' },
          { key: 'done',      label: 'Done' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: filter === key ? C.brand : C.surface,
              color: filter === key ? '#fff' : C.muted,
              border: `1.5px solid ${filter === key ? C.brand : C.border}`,
              cursor: 'pointer', fontFamily: C.font,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 62, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <Ico ti="ti-square-check" size={32} color={C.muted} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: C.muted, fontFamily: C.font, margin: '0 0 16px' }}>
            {filter === 'done' ? 'No completed tasks yet' : 'No tasks here'}
          </p>
          <Btn onClick={openNew}><Ico ti="ti-plus" size={14} /> Add a task</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(t => (
            <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={openEdit} onDelete={handleDelete} onRun={handleRun} />
          ))}
        </div>
      )}

      <TaskModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null); }}
        onSubmit={handleSubmit}
        editing={editing}
      />
      <NoAgentModal open={!!noAgent} context="task" onClose={() => setNoAgent(null)} onCreated={noAgent} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
