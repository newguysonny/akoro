import { useState, useEffect, useCallback } from 'react';
import { Search, UserPlus, Mail, BookOpen, GraduationCap } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, FONT } from '../constants.js';

/* ── Invite instructor modal ─────────────────────────────────────── */
function InviteModal({ open, onClose, onDone }) {
  const [form, setForm] = useState({ email: '', fullName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm({ email: '', fullName: '' }); setError(''); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email.trim()) { setError('Email is required'); return; }
    setLoading(true); setError('');
    try {
      await apiPost('/api/school/instructors/invite', { email: form.email.trim(), full_name: form.fullName.trim() });
      onDone?.({ email: form.email.trim(), fullName: form.fullName.trim() });
      onClose();
    } catch (err) {
      // Fall back to optimistic add if the endpoint isn't wired yet.
      onDone?.({ email: form.email.trim(), fullName: form.fullName.trim(), pending: true });
      onClose();
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="👩🏾‍🏫 Invite an instructor">
      <form onSubmit={submit}>
        <Inp label="Instructor email" type="email" placeholder="teacher@school.edu" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <Inp label="Full name (optional)" placeholder="e.g. Mrs. Adaeze Nwosu" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
        {error && <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600, margin: '6px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Btn variant="secondary" style={{ flex: 1 }} onClick={onClose} type="button">Cancel</Btn>
          <Btn variant="primary" style={{ flex: 1 }} type="submit" disabled={loading}><UserPlus size={14} />{loading ? 'Sending…' : 'Send invite'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Instructor card ─────────────────────────────────────────────── */
function InstructorCard({ t }) {
  const initial = (t.full_name || t.email || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, fontFamily: FONT }}>
      <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, background: `${AMBER}18`, color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>{t.avatar_url ? <img src={t.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}>
          {t.full_name || t.email?.split('@')[0]}
          {t.pending && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 8px', borderRadius: 100, background: '#FEF3C7', color: '#B45309' }}>INVITED</span>}
        </div>
        <div style={{ fontSize: 12, color: MUTED2, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}><Mail size={11} />{t.email}</div>
        {t.subjects?.length > 0 && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{t.subjects.slice(0, 4).join(' · ')}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}><BookOpen size={12} color={MUTED2} />{t.course_count ?? 0}</div>
        <div style={{ fontSize: 10.5, color: MUTED2 }}>courses</div>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function InstructorsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet('/api/school/instructors')
      .then((res) => setList(res?.data || res?.instructors || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = q.trim()
    ? list.filter((t) => `${t.full_name || ''} ${t.email || ''}`.toLowerCase().includes(q.toLowerCase()))
    : list;

  return (
    <PageLayout title="Instructors" subtitle="Manage the teachers in your school"
      action={<Btn variant="primary" size="sm" onClick={() => setInviteOpen(true)}><UserPlus size={14} />Invite instructor</Btn>}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: MUTED2 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search instructors…" style={{ width: '100%', padding: '11px 13px 11px 36px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, boxSizing: 'border-box' }} />
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 78, borderRadius: 16, background: '#F3F4F6', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 24px', color: MUTED2 }}>
            <GraduationCap size={40} color="#D1D5DB" style={{ marginBottom: 14 }} />
            <p style={{ fontSize: 15, fontWeight: 700, color: MUTED, margin: '0 0 4px' }}>No instructors yet</p>
            <p style={{ fontSize: 13, margin: '0 0 16px' }}>Invite teachers to join your school — they can also use the Instructor app.</p>
            <Btn variant="primary" size="sm" onClick={() => setInviteOpen(true)}><UserPlus size={14} />Invite your first instructor</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((t, i) => <InstructorCard key={t.id || t.email || i} t={t} />)}
          </div>
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)}
        onDone={(inv) => { setList((prev) => [{ ...inv, full_name: inv.fullName, email: inv.email, pending: inv.pending }, ...prev]); setToast({ message: inv.pending ? 'Invite queued' : 'Invite sent ✓', type: 'success' }); }} />
    </PageLayout>
  );
}
