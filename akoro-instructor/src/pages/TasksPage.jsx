import { useState, useEffect } from 'react';
import { Plus, CheckSquare, Square, Trash2, Circle, Clock, Tag } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, Badge, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';

/* ── Mock data ─────────────────────────────────────────────────────── */
const MOCK_TASKS = [
  { id: 1, title: 'Prepare React Hooks slides', status: 'pending', task_type: 'course', priority: 'high', dueDate: new Date(Date.now() + 86400000).toISOString() },
  { id: 2, title: 'Review student submissions for JS course', status: 'done', task_type: 'review', priority: 'medium', dueDate: null },
  { id: 3, title: 'Update course curriculum for Q3', status: 'pending', task_type: 'general', priority: 'low', dueDate: new Date(Date.now() + 604800000).toISOString() },
  { id: 4, title: 'Schedule office hours for next week', status: 'pending', task_type: 'general', priority: 'medium', dueDate: new Date(Date.now() + 259200000).toISOString() },
  { id: 5, title: 'Create quiz for Algorithm challenge battle', status: 'done', task_type: 'battle', priority: 'high', dueDate: null },
];

/* ── New Task Modal ─────────────────────────────────────────────────── */
function NewTaskModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', description: '', task_type: 'general', priority: 'medium', dueDate: '' });
  const [loading, setLoading] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); onClose(); setForm({ title: '', description: '', task_type: 'general', priority: 'medium', dueDate: '' }); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Task">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Inp label="Task Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="What needs to be done?" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Additional details…" rows={2} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Type" value={form.task_type} onChange={e => setField('task_type', e.target.value)}>
            <option value="general">General</option>
            <option value="course">Course</option>
            <option value="review">Review</option>
            <option value="battle">Battle</option>
          </Sel>
          <Sel label="Priority" value={form.priority} onChange={e => setField('priority', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Sel>
        </div>
        <Inp label="Due Date (optional)" type="date" value={form.dueDate} onChange={e => setField('dueDate', e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading || !form.title.trim()}>
            {loading ? 'Adding…' : 'Add Task'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Priority badge ─────────────────────────────────────────────────── */
function PriorityBadge({ priority }) {
  const map = {
    high:   { color: RED,    bg: '#FEE2E2', label: 'High' },
    medium: { color: AMBER,  bg: '#FFF7ED', label: 'Medium' },
    low:    { color: MUTED,  bg: LIGHT,     label: 'Low' },
  };
  const cfg = map[priority] || map.low;
  return <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>;
}

/* ── Type badge ─────────────────────────────────────────────────────── */
function TypeBadge({ type }) {
  const map = {
    course:  { color: AMBER,  bg: '#FFF7ED' },
    review:  { color: BLUE,   bg: '#EFF6FF' },
    battle:  { color: PURPLE, bg: '#EDE9FE' },
    general: { color: MUTED,  bg: LIGHT },
  };
  const cfg = map[type] || map.general;
  return <Badge color={cfg.color} bg={cfg.bg}>{type}</Badge>;
}

/* ── Task Row ───────────────────────────────────────────────────────── */
function TaskRow({ task, onToggle }) {
  const isDone = task.status === 'done';
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px', background: WHITE, borderRadius: 12,
      border: `1px solid ${isOverdue ? '#FECACA' : BORDER}`,
      opacity: isDone ? 0.65 : 1, transition: 'opacity .2s',
    }}>
      <button
        onClick={() => onToggle(task.id, isDone ? 'pending' : 'done')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0, color: isDone ? GREEN : MUTED }}
      >
        {isDone ? <CheckSquare size={20} /> : <Square size={20} />}
      </button>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: isDone ? MUTED : INK,
          fontFamily: FONT, textDecoration: isDone ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginTop: 2 }}>{task.description}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <TypeBadge type={task.task_type} />
        <PriorityBadge priority={task.priority} />
        {task.dueDate && (
          <span style={{ fontSize: 11, color: isOverdue ? RED : MUTED, display: 'flex', alignItems: 'center', gap: 3, fontFamily: FONT }}>
            <Clock size={10} />
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function TasksPage() {
  const [tasks,   setTasks]   = useState([]);
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
      const res = await apiGet('/api/tasks');
      setTasks(res?.data || MOCK_TASKS);
    } catch (err) {
      console.warn('Tasks API error, using mock:', err);
      setTasks(MOCK_TASKS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (form) => {
    await apiPost('/api/tasks', form).catch(console.warn);
    showToast('Task added!');
    load();
  };

  const handleToggle = async (id, status) => {
    // Optimistic update; backend /toggle flips done <-> pending and persists.
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t));
    try {
      const res = await apiPatch(`/api/tasks/${id}/toggle`, {});
      if (res?.task) setTasks(ts => ts.map(t => t.id === id ? { ...t, status: res.task.status } : t));
    } catch (e) {
      console.warn('toggle failed', e);
    }
  };

  const filtered = filter === 'all' ? tasks
    : filter === 'done' ? tasks.filter(t => t.status === 'done')
    : tasks.filter(t => t.status !== 'done');

  const pending  = tasks.filter(t => t.status !== 'done').length;
  const done     = tasks.filter(t => t.status === 'done').length;
  const overdue  = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length;

  return (
    <PageLayout
      title="Tasks"
      subtitle="Manage your to-dos and action items"
      action={
        <Btn size="sm" onClick={() => setModal(true)}>
          <Plus size={14} /> New Task
        </Btn>
      }
    >
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24, maxWidth: 480 }}>
        {[
          { label: 'Pending', value: pending, color: AMBER },
          { label: 'Completed', value: done, color: GREEN },
          { label: 'Overdue', value: overdue, color: RED },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: FONT }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'all',     label: 'All' },
          { key: 'pending', label: 'Pending' },
          { key: 'done',    label: 'Done' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: filter === key ? AMBER : WHITE,
              color: filter === key ? WHITE : MUTED,
              border: `1.5px solid ${filter === key ? AMBER : BORDER}`,
              cursor: 'pointer', fontFamily: FONT,
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
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <CheckSquare size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {filter === 'done' ? 'No completed tasks yet' : 'No tasks here'}
          </p>
          <Btn onClick={() => setModal(true)}><Plus size={14} /> Add a task</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(t => <TaskRow key={t.id} task={t} onToggle={handleToggle} />)}
        </div>
      )}

      <NewTaskModal open={modal} onClose={() => setModal(false)} onSubmit={handleCreate} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
