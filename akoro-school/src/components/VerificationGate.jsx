/**
 * VerificationGate — shown to a school owner whose account is awaiting (or was
 * refused) akoro approval. Until an admin verifies the school, the full
 * dashboard is withheld; only this screen (and sign-out) is available.
 *
 * Status is fetched once from GET /api/school (verification_status) and cached
 * for the session so navigation between protected routes doesn't refetch.
 */
import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { C } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

// Module-level cache: one fetch per page load, shared across ProtectedRoutes.
let _cache = null;          // { status }
let _inflight = null;

export function useSchoolVerification(enabled) {
  const [state, setState] = useState(() => (_cache ? { loading: false, ..._cache } : { loading: true, status: null }));

  useEffect(() => {
    if (!enabled) { setState({ loading: false, status: 'verified' }); return; }
    if (_cache) { setState({ loading: false, ..._cache }); return; }
    let alive = true;
    _inflight = _inflight || apiGet('/api/school')
      .then((r) => { _cache = { status: r?.data?.verification_status || 'verified' }; return _cache; })
      // No school row yet (e.g. mid-onboarding) or transient error → don't gate.
      .catch(() => { _cache = { status: 'verified' }; return _cache; })
      .finally(() => { _inflight = null; });
    _inflight.then((c) => { if (alive) setState({ loading: false, ...c }); });
    return () => { alive = false; };
  }, [enabled]);

  return state;
}

// Clear on sign-out so the next account re-checks.
export function resetSchoolVerification() { _cache = null; _inflight = null; }

const WRAP = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif" };
const CARD = { maxWidth: 460, width: '100%', background: '#fff', border: `1px solid ${C.borderSoft}`, borderRadius: 20, padding: '36px 32px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,.06)' };

export default function VerificationGate({ status }) {
  const { logout } = useAuth();
  const rejected = status === 'rejected';
  return (
    <div style={WRAP}>
      <div style={CARD}>
        <div style={{ width: 60, height: 60, borderRadius: 16, margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: rejected ? '#FEE2E2' : '#FEF3C7' }}>
          {rejected ? <Ico ti="ti-circle-x" size={30} color="#DC2626" /> : <Ico ti="ti-clock" size={30} color="#D97706" />}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: '0 0 8px' }}>
          {rejected ? 'Your school wasn’t approved' : 'Your school is under review'}
        </h1>
        <p style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.6, margin: '0 0 22px' }}>
          {rejected
            ? 'Our team reviewed your registration and couldn’t approve it yet. Please reply to your welcome email or contact support so we can help sort it out.'
            : 'Thanks for registering! An Akoro admin is reviewing your school account. Once it’s approved, your full dashboard unlocks automatically — you’ll get an email when it’s ready.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12.5, color: C.muted2, marginBottom: 24 }}>
          <Ico ti="ti-shield-check" size={14} /> Verification keeps the Akoro network trustworthy for learners and parents.
        </div>
        <button onClick={logout}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 10, border: `1px solid ${C.borderSoft}`, background: '#fff', color: C.ink, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Ico ti="ti-logout" size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}
