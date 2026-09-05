const KEY = 'akoro_dhub_recent';
const CAP = 8;

export function loadRecents() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter(r => r && r.q).slice(0, CAP) : [];
  } catch { return []; }
}

export function saveRecent(q, scope = 'all') {
  if (!q) return;
  const rest = loadRecents().filter(r => !(r.q === q && r.scope === scope));
  try { localStorage.setItem(KEY, JSON.stringify([{ q, scope, ts: Date.now() }, ...rest].slice(0, CAP))); } catch { /* private mode */ }
}

export function removeRecent(q, scope) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRecents().filter(r => !(r.q === q && r.scope === scope))));
  } catch { /* private mode */ }
}

export function clearRecents() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}