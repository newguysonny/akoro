import { useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiPatch } from '../services/api.js';

/**
 * PilotSchoolsPage — Pilot Schools + Applications queue (plan §4.6 Phase 1)
 *
 * React + Tailwind conversion of the "Pilot Schools" panel in
 * reference/Admin-Tiers & Credits prototype page.md, backed by the real API:
 *
 *   GET   /api/admin/pilot-schools                     roster (cohorts + contacts)
 *   POST  /api/admin/pilot-schools                     "+ Add pilot school"
 *   PATCH /api/admin/pilot-schools/:id                 window / caps / contact /
 *                                                     rename / end / archive
 *   GET   /api/admin/pilot-applications?status=pending the queue (+counts)
 *   POST  /api/admin/pilot-applications/:id/approve    approve & create the pilot
 *   POST  /api/admin/pilot-applications/:id/reject     reject (two-click confirm)
 *
 * The pilot-expiry-check cron ends cohorts past their end date daily; an
 * active cohort saved with a past end date also ends itself immediately.
 *
 * The prototype's per-school Usage and Messages sections (and the "Message
 * school" action) land with the usage/messaging phases — the data behind them
 * doesn't exist yet, so they are not rendered as dead UI.
 */

const PAGE_SIZE = 4;
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysUntil = (dateStr) => Math.round((new Date(`${dateStr}T00:00:00Z`) - new Date(`${todayStr()}T00:00:00Z`)) / 86400000);

export default function PilotSchoolsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cohorts, setCohorts]       = useState([]);
  const [pendingApps, setPendingApps] = useState([]);
  const [pilotTier, setPilotTier]   = useState(null); // school "Pilot" tier → review-modal defaults

  const [subtab, setSubtab]         = useState('list'); // 'list' | 'apps'
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]             = useState(1);

  const [selected, setSelected]     = useState(null);  // cohort object → detail view
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [settingsDraft, setSettingsDraft]     = useState(null);
  const [renaming, setRenaming]     = useState(false);
  const [nameDraft, setNameDraft]   = useState('');

  const [addOpen, setAddOpen]       = useState(false);
  const [addForm, setAddForm]       = useState(null);
  const [reviewApp, setReviewApp]   = useState(null);
  const [reviewForm, setReviewForm] = useState(null);
  const [rejectArmed, setRejectArmed] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /* ── load ───────────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setLoadError('');
      const [rosterRes, appsRes, tiersRes] = await Promise.all([
        apiGet('/api/admin/pilot-schools'),
        apiGet('/api/admin/pilot-applications?status=pending'),
        apiGet('/api/admin/tiers').catch(() => null),
      ]);
      setCohorts(rosterRes.data ?? []);
      setPendingApps(appsRes.data ?? []);
      if (tiersRes?.data?.school) setPilotTier(tiersRes.data.school.find((t) => t.name === 'Pilot') ?? null);
    } catch (e) {
      setLoadError(e.message || 'Could not load pilot schools.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ── list filtering (exact prototype semantics) ─────────────────────────── */
  const q = search.toLowerCase();
  const filtered = cohorts
    .filter((s) => s.name.toLowerCase().includes(q))
    .filter((s) => statusFilter === 'all' ? !s.archived
      : statusFilter === 'archived' ? s.archived
      : (!s.archived && s.status === statusFilter));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── alerts: pilots ending within 7 days ────────────────────────────────── */
  const alerts = [];
  cohorts.forEach((s) => {
    if (s.archived || s.status !== 'active') return;
    const d = daysUntil(s.end_date);
    if (d >= 0 && d <= 7) alerts.push({ s, d });
  });

  /* ── detail actions ─────────────────────────────────────────────────────── */
  const openDetail = (s) => { setSelected(s); setSettingsEditing(false); setRenaming(false); };

  const startSettingsEdit = () => {
    setSettingsDraft({
      start_date: selected.start_date, end_date: selected.end_date,
      student_cap: selected.student_cap, instructor_cap: selected.instructor_cap,
    });
    setSettingsEditing(true);
  };

  const saveSettings = async () => {
    const { start_date, end_date } = settingsDraft;
    if (!start_date || !end_date || end_date < start_date) { showToast('End date must be after start date'); return; }
    try {
      const res = await apiPatch(`/api/admin/pilot-schools/${selected.id}`, {
        start_date, end_date,
        student_cap: Number(settingsDraft.student_cap) || 0,
        instructor_cap: Number(settingsDraft.instructor_cap) || 0,
      });
      setSettingsEditing(false);
      await load();
      if (res?.data) setSelected(res.data);
      showToast(`${selected.name} updated`);
    } catch (e) {
      showToast(e.message || 'Could not save settings.');
    }
  };

  const endPilotNow = async () => {
    try {
      const res = await apiPatch(`/api/admin/pilot-schools/${selected.id}`, { end_date: todayStr(), status: 'ended' });
      await load();
      if (res?.data) setSelected(res.data);
      showToast(`${selected.name}'s pilot ended`);
    } catch (e) {
      showToast(e.message || 'Could not end the pilot.');
    }
  };

  const archiveSchool = async () => {
    try {
      await apiPatch(`/api/admin/pilot-schools/${selected.id}`, { archived: true });
      setSelected(null);
      await load();
      showToast(`${selected.name} archived`);
    } catch (e) {
      showToast(e.message || 'Could not archive.');
    }
  };

  const saveContact = async () => {
    const email = selected.contact.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Enter a valid contact email address'); return; }
    try {
      const res = await apiPatch(`/api/admin/pilot-schools/${selected.id}`, {
        contact_name: selected.contact.name.trim(),
        contact_email: email,
        contact_phone: selected.contact.phone.trim(),
      });
      await load();
      if (res?.data) setSelected(res.data);
      showToast('Contact saved');
    } catch (e) {
      showToast(e.message || 'Could not save contact.');
    }
  };

  const saveRename = async () => {
    const val = nameDraft.trim();
    if (!val) { showToast('Name cannot be empty'); return; }
    try {
      const res = await apiPatch(`/api/admin/pilot-schools/${selected.id}`, { name: val });
      setRenaming(false);
      await load();
      if (res?.data) setSelected(res.data);
      showToast('School renamed');
    } catch (e) {
      showToast(e.message || 'Could not rename.');
    }
  };

  /* ── add pilot school ───────────────────────────────────────────────────── */
  const openAddModal = () => setAddForm({
    name: '', start_date: todayStr(), end_date: '', student_cap: 200, instructor_cap: 400,
    contact_name: '', contact_email: '', contact_phone: '',
  });

  const submitSchool = async () => {
    const f = addForm;
    if (!f.name.trim() || !f.start_date || !f.end_date) { showToast('Fill in name, start, and end date'); return; }
    if (f.end_date < f.start_date) { showToast('End date must be after start date'); return; }
    if (f.contact_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact_email.trim())) { showToast('Enter a valid contact email'); return; }
    try {
      await apiPost('/api/admin/pilot-schools', {
        name: f.name.trim(), start_date: f.start_date, end_date: f.end_date,
        student_cap: Number(f.student_cap) || 0, instructor_cap: Number(f.instructor_cap) || 0,
        contact_name: f.contact_name.trim() || null,
        contact_email: f.contact_email.trim() || null,
        contact_phone: f.contact_phone.trim() || null,
      });
      setAddOpen(false);
      setPage(1);
      await load();
      showToast(`${f.name.trim()} added as a pilot school`);
    } catch (e) {
      showToast(e.message || 'Could not add the school.');
    }
  };

  /* ── application review ─────────────────────────────────────────────────── */
  const openReview = (a) => {
    const duration = pilotTier?.duration_days || 30;
    setReviewForm({
      start_date: todayStr(),
      end_date: addDays(todayStr(), duration),
      student_cap: pilotTier?.student_cap ?? 200,
      instructor_cap: pilotTier?.instructor_cap ?? 400,
      reason: '',
    });
    setRejectArmed(false);
    setReviewApp(a);
  };

  const approveApplication = async () => {
    const f = reviewForm;
    if (!f.start_date || !f.end_date || f.end_date < f.start_date) { showToast('Check the start and end dates'); return; }
    try {
      await apiPost(`/api/admin/pilot-applications/${reviewApp.id}/approve`, {
        start_date: f.start_date, end_date: f.end_date,
        student_cap: Number(f.student_cap) || 0, instructor_cap: Number(f.instructor_cap) || 0,
      });
      setReviewApp(null);
      await load();
      showToast(`${reviewApp.school_name} approved and added as a pilot school`);
    } catch (e) {
      showToast(e.message || 'Could not approve.');
    }
  };

  const rejectApplication = async () => {
    if (!rejectArmed) { setRejectArmed(true); return; }
    try {
      await apiPost(`/api/admin/pilot-applications/${reviewApp.id}/reject`, { reason: reviewForm.reason.trim() });
      setReviewApp(null);
      await load();
      showToast(`${reviewApp.school_name} rejected`);
    } catch (e) {
      showToast(e.message || 'Could not reject.');
    }
  };

  /* ── render helpers ─────────────────────────────────────────────────────── */
  const statusLine = (s) => s.archived ? '● Archived' : (s.status === 'active' ? '● Pilot active' : '● Pilot ended');
  const detailStatusText = (s) => s.archived ? 'Archived' : (s.status === 'active' ? 'Pilot active' : 'Pilot ended');
  const daysLeft = (s) => {
    if (s.status !== 'active') return null;
    const d = daysUntil(s.end_date);
    return d < 0 ? 'Ended' : `${d} day${d === 1 ? '' : 's'}`;
  };

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <PageLayout title="Pilot Schools" subtitle="Pilot programme roster and applications">
      <div className="ak-page">

        {selected ? (
          /* ══════════ SCHOOL DETAIL ══════════ */
          <>
            <button className="ak-back-link" onClick={() => { setSelected(null); setSettingsEditing(false); setRenaming(false); }}>← Back to Pilot Schools</button>
            <div className="ak-detail-head">
              <div>
                {renaming ? (
                  <div className="ak-name-edit">
                    <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                    <button className="ak-btn ak-btn-small" onClick={saveRename}>Save</button>
                  </div>
                ) : (
                  <h1 className="ak-h1">{selected.name}</h1>
                )}
                <p className="ak-sub !mt-1.5 !mb-0">{detailStatusText(selected)}</p>
              </div>
              <div className="ak-detail-actions">
                <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => { setRenaming(true); setNameDraft(selected.name); }}>Rename</button>
                <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={endPilotNow}>End pilot now</button>
                <button className="ak-btn ak-btn-danger ak-btn-small" onClick={archiveSchool}>Archive</button>
              </div>
            </div>

            <div className="ak-stat-row">
              <div className="ak-stat">
                <div className="ak-stat-label">Est. students</div>
                <div className="ak-stat-value">{selected.est_students ?? '—'}</div>
              </div>
              <div className="ak-stat">
                <div className="ak-stat-label">Pilot window</div>
                <div className="ak-stat-value">{selected.start_date} → {selected.end_date}</div>
              </div>
              <div className="ak-stat">
                <div className="ak-stat-label">Days left</div>
                <div className="ak-stat-value">{daysLeft(selected) ?? '—'}</div>
              </div>
            </div>

            <div className="ak-section-title">Pilot settings</div>
            <table className="ak-table">
              <thead><tr><th>Start date</th><th>End date</th><th>Student cap / mo</th><th>Instructor cap / mo</th><th>Actions</th></tr></thead>
              <tbody>
                <tr>
                  <td>{settingsEditing
                    ? <input className="ak-date-input w-[130px]" type="date" value={settingsDraft.start_date} onChange={(e) => setSettingsDraft({ ...settingsDraft, start_date: e.target.value })} />
                    : selected.start_date}</td>
                  <td>{settingsEditing
                    ? <input className="ak-date-input w-[130px]" type="date" value={settingsDraft.end_date} onChange={(e) => setSettingsDraft({ ...settingsDraft, end_date: e.target.value })} />
                    : selected.end_date}</td>
                  <td>{settingsEditing
                    ? <input className="ak-credit-input" type="number" min="0" value={settingsDraft.student_cap} onChange={(e) => setSettingsDraft({ ...settingsDraft, student_cap: e.target.value })} /> / mo
                    : `${selected.student_cap} / mo`}</td>
                  <td>{settingsEditing
                    ? <input className="ak-credit-input" type="number" min="0" value={settingsDraft.instructor_cap} onChange={(e) => setSettingsDraft({ ...settingsDraft, instructor_cap: e.target.value })} /> / mo
                    : `${selected.instructor_cap} / mo`}</td>
                  <td>{settingsEditing ? (
                    <div className="ak-detail-actions">
                      <button className="ak-btn ak-btn-small" onClick={saveSettings}>Save</button>
                      <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => setSettingsEditing(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={startSettingsEdit}>Edit</button>
                  )}</td>
                </tr>
              </tbody>
            </table>

            <div className="ak-section-title">Admin contact</div>
            <div className="ak-settings-card !max-w-[520px]">
              <div className="ak-field">
                <label htmlFor="sc-name">Name</label>
                <input className="ak-input" type="text" id="sc-name" value={selected.contact.name}
                  onChange={(e) => setSelected({ ...selected, contact: { ...selected.contact, name: e.target.value } })} />
              </div>
              <div className="ak-field-row">
                <div className="ak-field">
                  <label htmlFor="sc-email">Email</label>
                  <input className="ak-input" type="text" id="sc-email" value={selected.contact.email}
                    onChange={(e) => setSelected({ ...selected, contact: { ...selected.contact, email: e.target.value } })} />
                </div>
                <div className="ak-field">
                  <label htmlFor="sc-phone">Phone</label>
                  <input className="ak-input" type="text" id="sc-phone" value={selected.contact.phone}
                    onChange={(e) => setSelected({ ...selected, contact: { ...selected.contact, phone: e.target.value } })} />
                </div>
              </div>
              <button className="ak-btn ak-btn-small" onClick={saveContact}>Save contact</button>
            </div>
          </>
        ) : (
          /* ══════════ SCHOOLS LIST + APPLICATIONS ══════════ */
          <>
            <h1 className="ak-h1">Pilot Schools</h1>
            <p className="ak-sub">Each pilot partner has its own start date, end date, and credit caps. Click a school to see its details.</p>

            {loading && <p className="ak-sub">Loading…</p>}
            {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

            {!loading && (
              <>
                <div className="ak-subtabs">
                  <button className={`ak-subtab ${subtab === 'list' ? 'ak-subtab-active' : ''}`} onClick={() => setSubtab('list')}>Schools</button>
                  <button className={`ak-subtab ${subtab === 'apps' ? 'ak-subtab-active' : ''}`} onClick={() => setSubtab('apps')}>
                    Applications {pendingApps.length > 0 && <span>({pendingApps.length})</span>}
                  </button>
                </div>

                {subtab === 'list' ? (
                  <div>
                    {alerts.length > 0 && (
                      <div className="ak-alert-banner">
                        {alerts.map(({ s, d }) => (
                          <div key={s.id} className="ak-alert-item ak-alert-item-info">
                            {s.name}'s pilot ends in {d} day{d === 1 ? '' : 's'}
                            <button onClick={() => openDetail(s)}>View</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ak-filters">
                      <input type="text" placeholder="Search schools…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                        <option value="all">All statuses</option>
                        <option value="active">Active</option>
                        <option value="ended">Ended</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>

                    <div className="ak-toolbar">
                      <span />
                      <button className="ak-btn" onClick={() => { openAddModal(); setAddOpen(true); }}>+ Add pilot school</button>
                    </div>

                    {pageItems.length ? (
                      <div className="ak-cards">
                        {pageItems.map((s) => (
                          <div key={s.id} className="ak-card ak-card-clickable" onClick={() => openDetail(s)}>
                            <h3>{s.name}</h3>
                            <div className={`ak-card-status ${s.archived ? 'ak-card-status-ended' : (s.status === 'active' ? 'ak-card-status-active' : 'ak-card-status-ended')}`}>{statusLine(s)}</div>
                            <div className="ak-card-row"><span>Start</span><span>{s.start_date}</span></div>
                            <div className="ak-card-row"><span>End</span><span>{s.end_date}</span></div>
                            <div className="ak-card-row"><span>Student cap</span><span>{s.student_cap}/mo</span></div>
                            <div className="ak-card-row"><span>Instructor cap</span><span>{s.instructor_cap}/mo</span></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-akoro-dim">No schools match your search.</p>
                    )}

                    {totalPages > 1 && (
                      <div className="ak-pagination">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} className={p === safePage ? 'ak-page-active' : ''} onClick={() => setPage(p)}>{p}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <table className="ak-table">
                      <thead><tr><th>School</th><th>Contact</th><th>Requested</th><th>Est. students</th><th>Message</th><th></th></tr></thead>
                      <tbody>
                        {pendingApps.map((a) => (
                          <tr key={a.id}>
                            <td><b>{a.school_name}</b></td>
                            <td>{a.contact_name}<br /><small className="text-akoro-dim">{a.contact_email} · {a.contact_phone}</small></td>
                            <td>{(a.created_at ?? '').slice(0, 10)}</td>
                            <td>{a.est_students}</td>
                            <td className="max-w-[260px]">{a.message}</td>
                            <td><button className="ak-btn ak-btn-small" onClick={() => openReview(a)}>Review</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pendingApps.length === 0 && <p className="ak-sub !mb-0">No pending applications.</p>}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Add pilot school modal ── */}
        {addOpen && addForm && (
          <Modal onClose={() => setAddOpen(false)}>
            <h2>Add pilot school</h2>
            <div className="ak-field">
              <label htmlFor="m-name">School name</label>
              <input className="ak-input" type="text" id="m-name" placeholder="e.g. Greenfield Academy" autoFocus
                value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="m-start">Start date</label>
                <input className="ak-input" type="date" id="m-start" value={addForm.start_date}
                  onChange={(e) => setAddForm({ ...addForm, start_date: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="m-end">End date</label>
                <input className="ak-input" type="date" id="m-end" value={addForm.end_date}
                  onChange={(e) => setAddForm({ ...addForm, end_date: e.target.value })} />
              </div>
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="m-student-cap">Student credit cap / mo</label>
                <input className="ak-input" type="number" id="m-student-cap" min="0" value={addForm.student_cap}
                  onChange={(e) => setAddForm({ ...addForm, student_cap: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="m-instructor-cap">Instructor credit cap / mo</label>
                <input className="ak-input" type="number" id="m-instructor-cap" min="0" value={addForm.instructor_cap}
                  onChange={(e) => setAddForm({ ...addForm, instructor_cap: e.target.value })} />
              </div>
            </div>
            <div className="ak-field">
              <label htmlFor="m-contact-name">Admin contact name (optional)</label>
              <input className="ak-input" type="text" id="m-contact-name" placeholder="e.g. Mrs. Adeyemi"
                value={addForm.contact_name} onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })} />
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="m-contact-email">Contact email</label>
                <input className="ak-input" type="text" id="m-contact-email"
                  value={addForm.contact_email} onChange={(e) => setAddForm({ ...addForm, contact_email: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="m-contact-phone">Contact phone</label>
                <input className="ak-input" type="text" id="m-contact-phone"
                  value={addForm.contact_phone} onChange={(e) => setAddForm({ ...addForm, contact_phone: e.target.value })} />
              </div>
            </div>
            <div className="ak-modal-actions">
              <button className="ak-btn ak-btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="ak-btn" onClick={submitSchool}>Add school</button>
            </div>
          </Modal>
        )}

        {/* ── Application review modal ── */}
        {reviewApp && reviewForm && (
          <Modal onClose={() => setReviewApp(null)}>
            <h2>Review application</h2>
            <p className="ak-sub !mb-4">
              <b className="text-akoro-ink">{reviewApp.school_name}</b> · applied {(reviewApp.created_at ?? '').slice(0, 10)} · ~{reviewApp.est_students} students
              {reviewApp.state_city ? ` · ${reviewApp.state_city}` : ''}<br />
              {reviewApp.message}
            </p>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="app-start">Pilot start date</label>
                <input className="ak-input" type="date" id="app-start" value={reviewForm.start_date}
                  onChange={(e) => setReviewForm({ ...reviewForm, start_date: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="app-end">Pilot end date</label>
                <input className="ak-input" type="date" id="app-end" value={reviewForm.end_date}
                  onChange={(e) => setReviewForm({ ...reviewForm, end_date: e.target.value })} />
              </div>
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="app-student-cap">Student cap / mo</label>
                <input className="ak-input" type="number" min="0" id="app-student-cap" value={reviewForm.student_cap}
                  onChange={(e) => setReviewForm({ ...reviewForm, student_cap: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="app-instructor-cap">Instructor cap / mo</label>
                <input className="ak-input" type="number" min="0" id="app-instructor-cap" value={reviewForm.instructor_cap}
                  onChange={(e) => setReviewForm({ ...reviewForm, instructor_cap: e.target.value })} />
              </div>
            </div>
            <div className="ak-field">
              <label htmlFor="app-reject-reason">Rejection reason (only needed if rejecting)</label>
              <input className="ak-input" type="text" id="app-reject-reason" placeholder="e.g. outside target region"
                value={reviewForm.reason} onChange={(e) => setReviewForm({ ...reviewForm, reason: e.target.value })} />
            </div>
            <div className="ak-modal-actions">
              <button className="ak-btn ak-btn-ghost" onClick={() => setReviewApp(null)}>Cancel</button>
              <button className="ak-btn ak-btn-danger" onClick={rejectApplication}>{rejectArmed ? 'Click again to confirm' : 'Reject'}</button>
              <button className="ak-btn" onClick={approveApplication}>Approve &amp; create pilot</button>
            </div>
          </Modal>
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}

function Modal({ onClose, children }) {
  return (
    <div className="ak-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ak-modal">{children}</div>
    </div>
  );
}
