/**
 * The learner's discipline, cached for the first paint (like akoro_study_tier).
 *
 * The Discover hub decides its programme card from the discipline, which comes
 * from /profiles/me. Until that response lands the hub used to fall back to
 * "More programmes" and then swap cards — a visible glitch on every load. The
 * cache makes the card render immediately from the last known value and the
 * API response only corrects it when it differs.
 */
const KEY = 'akoro_discipline';

export function cachedDiscipline() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function rememberDiscipline(discipline) {
  try {
    const next = String(discipline || '');
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}
