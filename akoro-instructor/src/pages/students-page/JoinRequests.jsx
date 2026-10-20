/**
 * JoinRequests — learners who requested to join this teacher during their
 * onboarding. Approve adds them to the class (and, if the teacher belongs to a
 * school, the school's roster). Backed by:
 *   GET  /api/profiles/teacher/join-requests
 *   POST /api/profiles/teacher/join-requests/:id { decision }
 */
import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Check, X, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export default function JoinRequests({ onChanged, showEmpty = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet('/api/profiles/teacher/join-requests')
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision) => {
    setBusyId(id);
    try {
      await apiPost(`/api/profiles/teacher/join-requests/${id}`, { decision });
      setRows((rs) => rs.filter((r) => r.id !== id));
      if (decision === 'approve') onChanged?.();
    } catch { /* ignore */ }
    finally { setBusyId(null); }
  };

  // Empty: as a banner (default) render nothing; as a page, show an empty state.
  if (!rows.length) {
    if (!showEmpty) return null;
    return (
      <div style={{ border: `1.5px solid ${C.border}`, background: C.surface, borderRadius: 14, padding: '48px 24px', textAlign: 'center', fontFamily: C.font }}>
        <Ico lucide={UserPlus} ti="ti-user-plus" size={30} color={C.muted} style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{loading ? 'Loading requests…' : 'No pending join requests'}</div>
        {!loading && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>When a learner asks to join your class, they’ll appear here for approval.</div>}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20, border: `1.5px solid ${tint(33)}`, background: tint(4), borderRadius: 14, padding: '12px 14px', fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12.5, fontWeight: 800, color: '#B45309' }}>
        <Ico lucide={UserPlus} ti="ti-user-plus" size={15} /> {rows.length} learner{rows.length === 1 ? '' : 's'} requested to join your class
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{r.full_name || 'Learner'}</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>{r.email}{r.classroom_name ? ` · ${r.classroom_name}` : ''}</div>
            </div>
            <button onClick={() => decide(r.id, 'approve')} disabled={busyId === r.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, border: 'none', background: GREEN, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              {busyId === r.id ? <Ico lucide={Loader2} ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico lucide={Check} ti="ti-check" size={13} />} Approve
            </button>
            <button onClick={() => decide(r.id, 'reject')} disabled={busyId === r.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: `1px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              <Ico lucide={X} ti="ti-x" size={13} /> Reject
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
