import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export function useTaskAPI() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState(null);

  // Fetch agent ID once (needed for task creation)
  useEffect(() => {
    apiGet('/api/user/agent').then(res => {
      const d = res?.data ?? res;
      if (d.agent?.id || d.id) setAgentId(d.agent?.id ?? d.id);
    }).catch(() => {});
  }, []);

  const fetchTasks = useCallback((status) => {
    setLoading(true);
    const url = status ? `/api/tasks?status=${status}` : '/api/tasks';
    return apiGet(url)
      .then(d => { setTasks(d.tasks ?? []); return d.tasks ?? []; })
      .catch(() => { setTasks([]); return []; })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const createTask = useCallback(async ({ title, description, priority = 'medium', dueAt, isRecurring, cronExpr, courseId }) => {
    const body = { title, description, priority, agentId, courseId, dueAt, isRecurring, cronExpr };
    const d = await apiPost('/api/tasks', body);
    if (d.task) setTasks(prev => [d.task, ...prev]);
    return d.task;
  }, [agentId]);

  // Edit a task that hasn't started. Sending dueAt/isRecurring re-queues it on
  // the backend, so the new time is the one that actually fires.
  const updateTask = useCallback(async ({ id, title, description, priority, dueAt, isRecurring, cronExpr }) => {
    const d = await apiPatch(`/api/tasks/${id}`, { title, description, priority, dueAt, isRecurring, cronExpr });
    if (d?.task) setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...d.task } : t)));
    return d?.task;
  }, []);

  const toggleTask = useCallback(async (taskId) => {
    // Optimistic, then reconciled. Swallowing the failure left the checkbox
    // ticked for a task the server still has as pending — the UI stating
    // something that isn't true, which is worse than a slow tick.
    let previous;
    setTasks(prev => {
      previous = prev;
      return prev.map(t => t.id === taskId
        ? { ...t, status: t.status === 'done' ? 'pending' : 'done' }
        : t);
    });
    try {
      const d = await apiPatch(`/api/tasks/${taskId}/toggle`);
      if (d?.task) setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: d.task.status } : t)));
    } catch (e) {
      if (previous) setTasks(previous);   // put it back rather than lie
      throw e;
    }
  }, []);

  const deleteTask = useCallback(async (taskId) => {
    const before = tasks;
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await apiDelete(`/api/tasks/${taskId}`);
    } catch (e) {
      setTasks(before);   // the row is still there — don't lie about it
      throw e;            // ...and let the caller say so
    }
  }, [tasks]);

  const createChallenge = useCallback(async (taskId, opponentId, xpPrize = 100) => {
    return apiPost(`/api/tasks/${taskId}/create-challenge`, { opponentId, xpPrize });
  }, []);

  // Fetch the outputs a task's agent run produced (quiz, explanation, plan, etc.)
  const getOutputs = useCallback(async (taskId) => {
    const d = await apiGet(`/api/tasks/${taskId}/outputs`).catch(() => ({ outputs: [] }));
    return d.outputs ?? [];
  }, []);

  // Create a task, then poll until its agent run produces outputs (or timeout).
  // Calls onUpdate(status) as it progresses. Returns { task, outputs, failed?, timedOut? }.
  const runTaskAndWait = useCallback(async (
    { title, description, priority = 'medium' },
    { onUpdate, intervalMs = 2500, timeoutMs = 60000 } = {}
  ) => {
    const task = await createTask({ title, description, priority });
    if (!task?.id) throw new Error('Task could not be created');
    onUpdate?.('queued');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      const outputs = await getOutputs(task.id);
      if (outputs.length) return { task, outputs };
      const fresh = await apiGet(`/api/tasks/${task.id}`).catch(() => null);
      const status = fresh?.task?.status;
      if (status === 'failed') return { task, outputs: [], failed: true };
      if (status) onUpdate?.(status);
    }
    return { task, outputs: [], timedOut: true };
  }, [createTask, getOutputs]);

  return { tasks, loading, agentId, createTask, updateTask, toggleTask, deleteTask, createChallenge, getOutputs, runTaskAndWait, refetch: fetchTasks };
}
