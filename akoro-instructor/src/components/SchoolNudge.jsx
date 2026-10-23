/**
 * SchoolNudge — prompts an already-onboarded instructor who hasn't joined a
 * school to request one. Hidden once approved, dismissible while pending/none.
 *   GET  /api/profiles/me/school-link
 *   GET  /api/profiles/directory/schools
 *   POST /api/profiles/me/school-request
 */
import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../services/api.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const DISMISS_KEY = 'akoro_school_nudge_dismissed';

export default function SchoolNudge() {
  const [link, setLink] = useState(undefined);   // undefined=loading, null=none
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => { try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; } });

  useEffect(() => {
    apiGet('/api/profiles/me/school-link').then((r) => setLink(r.data)).catch(() => setLink(null));
    apiGet('/api/profiles/directory/schools').then((r) => setSchools(r.data || [])).catch(() => {});
  }, []);

  if (link === undefined) return null;
  if (link?.status === 'approved') return null;          // already linked
  if (dismissed && link?.status !== 'pending') return null;

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} setDismissed(true); };

  const request = async () => {
    if (!schoolId) return;
    setBusy(true);
    try { await apiPost('/api/profiles/me/school-request', { school_id: schoolId }); setLink({ status: 'pending', name: schools.find((s) => s.id === schoolId)?.name }); }
    catch { /* ignore */ } finally { setBusy(false); }
  };

  const pending = link?.status === 'pending';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: tint(5), border: `1.5px solid ${tint(33)}`, borderRadius: 14, padding: '12px 16px', marginBottom: 20, fontFamily: C.font }}>
      <Ico ti="ti-school" size={20} color={C.brand} />
      {pending ? (
        <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#B45309' }}>
          Your request to join <strong>{link?.name || 'your school'}</strong> is awaiting approval.
        </div>
      ) : (
        <>
          <div style={{ flex: '1 1 220px', fontSize: 13.5, fontWeight: 700, color: '#B45309' }}>Join your school so your classes and students are linked to it.</div>
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} style={{ padding: '8px 12px', borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit', background: C.surface, cursor: 'pointer' }}>
            <option value="">Select school…</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={request} disabled={!schoolId || busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9, border: 'none', background: schoolId ? C.brand : '#E5E7EB', color: schoolId ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 800, cursor: schoolId ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {busy ? <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-check" size={14} />} Request to join
          </button>
        </>
      )}
      <button onClick={dismiss} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45309', display: 'flex' }}><Ico ti="ti-x" size={16} /></button>
    </div>
  );
}
