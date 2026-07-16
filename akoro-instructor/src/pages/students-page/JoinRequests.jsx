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
import { AMBER, INK, MUTED, BORDER, WHITE, GREEN, RED, FONT } from '../../constants.js';

export default function JoinRequests({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    apiGet('/api/profiles/teacher/join-requests').then((r) => setRows(r.data || [])).catch(() => setRows([]));
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

  if (!rows.length) return null;

  return (
    <div style={{ marginBottom: 20, border: `1.5px solid ${AMBER}55`, background: `${AMBER}0A`, borderRadius: 14, padding: '12px 14px', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12.5, fontWeight: 800, color: '#B45309' }}>
        <UserPlus size={15} /> {rows.length} learner{rows.length === 1 ? '' : 's'} requested to join your class
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 11, padding: '9px 12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{r.full_name || 'Learner'}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>{r.email}{r.classroom_name ? ` · ${r.classroom_name}` : ''}</div>
            </div>
            <button onClick={() => decide(r.id, 'approve')} disabled={busyId === r.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, border: 'none', background: GREEN, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              {busyId === r.id ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Check size={13} />} Approve
            </button>
            <button onClick={() => decide(r.id, 'reject')} disabled={busyId === r.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: `1px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              <X size={13} /> Reject
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
