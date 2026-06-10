import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export function useTaskAPI() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState(null);

  // Fetch agent ID once (needed for task creation)
  useEffect(() => {
    apiGet('/api/user/agent').then(d => {
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

  return { tasks, loading, agentId, createTask, toggleTask, deleteTask, createChallenge, refetch: fetchTasks };
}
