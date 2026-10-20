/**
 * useAgentOnline — the instructor agent's proactive state ("Agent online"):
 * while on, the background cycle over the instructor's classes may propose
 * work (modules/autonomy/instructorCycle.js reads learner_agent_autonomy.proactive).
 * One shared store, so the header toggle and the chat's status row agree.
 * The API stays the source of authority: GET/PATCH /api/agent/settings.
 */
import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../services/api.js';

let state = { online: false, loaded: false, saving: false, error: null };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
let loading = null;

function load() {
  if (loading) return loading;
  loading = apiGet('/api/agent/settings')
    .then((r) => set({ online: r?.data?.proactive !== false, loaded: true }))
    .catch(() => set({ loaded: true }))
    .finally(() => { loading = null; });
  return loading;
}

export async function toggleAgentOnline() {
  if (!state.loaded || state.saving) return;
  const previous = state.online;
  set({ online: !previous, saving: true, error: null });
  try {
    const r = await apiPatch('/api/agent/settings', { proactive: !previous });
    // The saved value wins; a reply without it keeps what was asked for.
    set({ online: typeof r?.data?.proactive === 'boolean' ? r.data.proactive : !previous });
  } catch (e) {
    set({ online: previous, error: e?.message || 'Could not update your agent setting' });
  } finally {
    set({ saving: false });
  }
}

export function useAgentOnline() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!state.loaded) load();
    return () => listeners.delete(setS);
  }, []);
  return { ...s, toggle: toggleAgentOnline };
}
