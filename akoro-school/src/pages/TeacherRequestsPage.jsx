/**
 * TeacherRequestsPage — school admin approves/rejects teachers who requested
 * to join the school during onboarding. Backed by
 *   GET  /api/school/teacher-requests
 *   POST /api/school/teacher-requests/:teacherId { decision }
 */
import { useState, useEffect, useCallback } from 'react';

import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

export default function TeacherRequestsPage() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet('/api/school/teacher-requests').then((r) => setRows(r.data || [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (teacherId, decision) => {
    setBusyId(teacherId);
    try {
      await apiPost(`/api/school/teacher-requests/${teacherId}`, { decision });
      setRows((rs) => (rs || []).filter((r) => r.teacher_id !== teacherId));
      showToast(decision === 'approve' ? 'Teacher approved ✓' : 'Request rejected');
    } catch (e) { showToast(e.message || 'Could not update'); }
    finally { setBusyId(null); }
  };

  return (
    <PageLayout title="Teacher Requests" subtitle="Teachers who asked to join your school">
      {rows === null ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 44, textAlign: 'center', color: C.muted2, fontSize: 13.5, fontFamily: C.font, background: C.surface, border: `1.5px dashed ${C.border}`, borderRadius: 14 }}>
          <Ico ti="ti-inbox" size={26} color={C.muted2} style={{ marginBottom: 8 }} />
          <div>No pending teacher requests.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.teacher_id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 16px', fontFamily: C.font }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: tint(8), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {r.avatar_url ? <img src={r.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Ico ti="ti-user-check" size={20} color={C.brand} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{r.full_name || 'Teacher'}</div>
                <div style={{ fontSize: 12, color: C.muted2 }}>{r.email}{r.subjects?.length ? ` · ${r.subjects.slice(0, 3).join(', ')}` : ''}</div>
              </div>
              <button onClick={() => decide(r.teacher_id, 'approve')} disabled={busyId === r.teacher_id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none', background: GREEN, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                {busyId === r.teacher_id ? <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-check" size={14} />} Approve
              </button>
              <button onClick={() => decide(r.teacher_id, 'reject')} disabled={busyId === r.teacher_id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, border: `1px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                <Ico ti="ti-x" size={14} /> Reject
              </button>
            </div>
          ))}
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
