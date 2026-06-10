import { apiGet, apiPatch, apiPost } from './api.js';

export const getMyProfile = () => apiGet('/api/profiles/me');

export const patchMyProfile = (patch) => apiPatch('/api/profiles/me', patch);

export const patchNotifications = (notif) =>
  apiPatch('/api/profiles/me/notifications', notif);

export const putAgent = (agentPatch) => {
  // Maps camelCase settings keys → snake_case API keys
  const body = {};
  if (agentPatch.name        != null) body.agent_name   = agentPatch.name;
  if (agentPatch.emoji       != null) body.agent_emoji  = agentPatch.emoji;
  if (agentPatch.color       != null) body.agent_color  = agentPatch.color;
  if (agentPatch.bg          != null) body.agent_bg     = agentPatch.bg;
  if (agentPatch.photoUrl    != null) body.photo_url    = agentPatch.photoUrl;
  if (agentPatch.personality != null) body.personality  = agentPatch.personality;
  if (agentPatch.studyLevel  != null) body.study_level  = agentPatch.studyLevel;
  if (agentPatch.yearGroup   != null) body.year_group   = agentPatch.yearGroup;
  if (agentPatch.examBoard   != null) body.exam_board   = agentPatch.examBoard;
  if (agentPatch.subjects    != null) body.subjects     = agentPatch.subjects;
  if (agentPatch.goal        != null) body.goal         = agentPatch.goal;
  return fetch(`${import.meta.env.VITE_API_URL || 'https://akoro.app'}/api/user/agent`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
};

export const getTeachingGuides = () => apiGet('/api/profiles/teaching-guides');

export const deactivateAccount = () => {
  const API = import.meta.env.VITE_API_URL || 'https://akoro.app';
  return fetch(`${API}/api/profiles/me/deactivate`, { method: 'POST', credentials: 'include' }).then(r => r.json());
};

export const deleteAccount = () => {
  const API = import.meta.env.VITE_API_URL || 'https://akoro.app';
  return fetch(`${API}/api/profiles/me`, { method: 'DELETE', credentials: 'include' }).then(r => r.json());
};

// Upload avatar to backend as multipart/form-data
// Returns { url } on success
export async function uploadAvatar(dataUrl, type = 'user') {
  const blob = await fetch(dataUrl).then(r => r.blob());
  const form = new FormData();
  form.append('file', blob, `avatar.${blob.type.split('/')[1] || 'jpg'}`);
  form.append('type', type);
  const API = import.meta.env.VITE_API_URL || 'https://akoro.app';
  const r = await fetch(`${API}/api/profiles/me/avatar`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  return r.json();
}
