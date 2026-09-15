/**
 * useStudyTier.js — the ONE seam where React meets the learner-app tier.
 *
 * Which UI a learner gets (school vs higher-ed) is decided by
 * /api/profiles/me — async. The old pattern (each page fetching it and
 * defaulting to the school UI while in flight) made every navigation
 * FLASH the lower-ed layout at higher-ed learners for a beat. This hook
 * fixes that:
 *
 *   · the LAST resolved tier is cached synchronously (studyLevel.js:
 *     localStorage + module memo), so the FIRST render of any page is
 *     already on the right tier — the fetch only silently revalidates;
 *   · concurrent consumers share one request per burst (single-flight);
 *   · when the tier resolves or changes, a CustomEvent updates every
 *     mounted consumer in the same tick — sidebar, library, dashboard
 *     all flip together, never one after the other;
 *   · a study-level change in settings publishes through the same cache
 *     (userTab), so live surfaces update without a reload.
 *
 * Unknown (never resolved, request failed, private mode) → school UI,
 * the documented default — never the other way round.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../services/api.js';
import { getCachedTier, setCachedTier, isHigherEdUI, TIER_EVENT } from '../utils/studyLevel.js';

let inFlight = null;   // single-flight: concurrent mounts share one request

/** Fetch /api/profiles/me and publish the tier (cached for next time). */
export function resolveStudyTier() {
  if (inFlight) return inFlight;
  inFlight = apiGet('/api/profiles/me')
    .then((d) => {
      const tier = isHigherEdUI(d?.data ?? d ?? {}) ? 'higher' : 'school';
      setCachedTier(tier);
      return tier;
    })
    .catch(() => getCachedTier())   // offline → keep the last known tier
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** React binding: does this learner get the higher-ed UI? The FIRST render
 *  already honours the cached tier — no school-UI flash while the
 *  background revalidation is in flight. */
export function useHigherEd() {
  const [tier, setTier] = useState(() => getCachedTier());
  useEffect(() => {
    let alive = true;
    const apply = (t) => { if (t && alive) setTier((cur) => (cur === t ? cur : t)); };
    apply(getCachedTier());
    const onTier = (e) => apply(e.detail?.tier);
    try { window.addEventListener(TIER_EVENT, onTier); } catch { /* ssr */ }
    resolveStudyTier().then(apply).catch(() => {});
    return () => {
      alive = false;
      try { window.removeEventListener(TIER_EVENT, onTier); } catch { /* ssr */ }
    };
  }, []);
  return tier === 'higher';
}
