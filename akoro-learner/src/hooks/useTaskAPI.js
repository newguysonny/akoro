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

  const toggleTask = useCallback(async (taskId) => {
    setTasks(prev => prev.map(t => t.id === taskId
      ? { ...t, status: t.status === 'done' ? 'pending' : 'done' }
      : t
    ));
    await apiPatch(`/api/tasks/${taskId}/toggle`).catch(() => {});
  }, []);

  const deleteTask = useCallback(async (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await apiDelete(`/api/tasks/${taskId}`).catch(() => {});
  }, []);

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

  return { tasks, loading, agentId, createTask, toggleTask, deleteTask, createChallenge, getOutputs, runTaskAndWait, refetch: fetchTasks };
}
