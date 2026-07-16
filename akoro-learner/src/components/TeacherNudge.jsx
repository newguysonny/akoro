/**
 * TeacherNudge — prompts an already-onboarded learner with no teacher to pick
 * one. Hidden once approved; dismissible while pending/none.
 *   GET  /api/profiles/me/teacher-link
 *   GET  /api/profiles/directory/teachers
 *   POST /api/profiles/me/teacher-request
 */
import { useState, useEffect } from 'react';
import { GraduationCap, X, Loader2, Check } from 'lucide-react';
import { apiGet, apiPost } from '../services/api.js';

const BRAND = '#6C3BFF';
const DISMISS_KEY = 'akoro_teacher_nudge_dismissed';

export default function TeacherNudge() {
  const [link, setLink] = useState(undefined);
  const [teachers, setTeachers] = useState([]);
  const [teacherId, setTeacherId] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => { try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; } });

  useEffect(() => {
    apiGet('/api/profiles/me/teacher-link').then((r) => setLink(r.data)).catch(() => setLink(null));
    apiGet('/api/profiles/directory/teachers').then((r) => setTeachers(r.data || [])).catch(() => {});
  }, []);

  if (link === undefined) return null;
  if (link?.status === 'active') return null;
  if (dismissed && link?.status !== 'pending') return null;

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} setDismissed(true); };
  const request = async () => {
    if (!teacherId) return;
    setBusy(true);
    try { await apiPost('/api/profiles/me/teacher-request', { teacher_id: teacherId }); setLink({ status: 'pending', teacher_name: teachers.find((t) => t.id === teacherId)?.full_name }); }
    catch { /* ignore */ } finally { setBusy(false); }
  };

  const pending = link?.status === 'pending';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: `${BRAND}10`, border: `1.5px solid ${BRAND}44`, borderRadius: 14, padding: '11px 14px', margin: '12px 14px 0', fontFamily: "'Nunito',sans-serif" }}>
      <GraduationCap size={19} color={BRAND} />
      {pending ? (
        <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: BRAND }}>Your request to join <strong>{link?.teacher_name || 'your teacher'}</strong> is awaiting approval.</div>
      ) : (
        <>
          <div style={{ flex: '1 1 180px', fontSize: 13, fontWeight: 800, color: BRAND }}>Pick your teacher to learn together.</div>
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid var(--ak-border2)', fontSize: 13, fontFamily: 'inherit', background: 'var(--ak-input-bg)', color: 'var(--ak-text)', cursor: 'pointer' }}>
            <option value="">Select teacher…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.school_name ? ` · ${t.school_name}` : ''}</option>)}
          </select>
          <button onClick={request} disabled={!teacherId || busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9, border: 'none', background: teacherId ? BRAND : '#E5E7EB', color: teacherId ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 800, cursor: teacherId ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Check size={14} />} Request
          </button>
        </>
      )}
      <button onClick={dismiss} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND, display: 'flex' }}><X size={16} /></button>
    </div>
  );
}
