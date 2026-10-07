import { useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiPatch } from '../services/api.js';

/**
 * TiersPage — Tiers & Credits (plan §4.6 Phase 1)
 *
 * React + Tailwind conversion of the "Tiers & Credits" panel in
 * reference/Admin-Tiers & Credits prototype page.md. Same UI, but backed by
 * the real API instead of in-memory mock state:
 *
 *   GET   /api/admin/tiers                catalog (learner + school)
 *   POST  /api/admin/tiers                add tier
 *   PATCH /api/admin/tiers/:id            edit tier (price changes must carry
 *                                         effective_scope: new_only | all)
 *   GET/PATCH /api/admin/lifecycle-settings
 *
 * Every save is audit-logged server-side (admin_audit_log).
 */

const LEARNER_FEATURES = ['Gradebook', 'Battles', 'Rankings', 'Voice/audio'];
const SCHOOL_FEATURES  = ['Teacher seats (limited)', 'Student/classroom limits', 'Course creation & live classes', 'Analytics', 'Integrations'];
const PRORATION_OPTIONS = [
  { value: 'immediate',  label: 'Charge full new price immediately' },
  { value: 'prorate',    label: 'Prorate remaining days' },
  { value: 'next-cycle', label: 'Apply at next renewal' },
];

const fmtNaira = (n) => `₦${Number(n || 0).toLocaleString()}`;

/* ── small presentational pieces (exact prototype markup) ─────────────────── */

function AccessBadge({ access }) {
  return <span className={`ak-badge ${access === 'free' ? 'ak-badge-free' : 'ak-badge-paid'}`}>{access === 'free' ? 'Free' : 'Paid'}</span>;
}

function GatedTags({ gated }) {
  if (!gated || gated.length === 0) return (
    <div className="ak-tags"><span className="ak-tag ak-tag-none">None</span></div>
  );
  return <div className="ak-tags">{gated.map((f) => <span key={f} className="ak-tag">{f}</span>)}</div>;
}

function FeatureChecks({ features, checked, onToggle, namePrefix }) {
  return (
    <div className="ak-feature-checks">
      {features.map((f) => (
        <label key={f}>
          <input
            type="checkbox"
            name={`${namePrefix}-${f}`}
            checked={checked.includes(f)}
            onChange={() => onToggle(f)}
          /> {f}
        </label>
      ))}
    </div>
  );
}

function Modal({ onClose, children }) {
  return (
    <div className="ak-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ak-modal">{children}</div>
    </div>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default function TiersPage() {
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tiers, setTiers]       = useState({ learner: [], school: [] });
  const [platform, setPlatform] = useState('learner');

  // Inline row editing (one tier at a time, per platform).
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft]         = useState(null);

  // "Add tier" modal.
  const [addOpen, setAddOpen]     = useState(false);
  const [addForm, setAddForm]     = useState(null);

  // "Confirm price change" modal (plan §1 pricing governance).
  const [priceConfirm, setPriceConfirm] = useState(null); // { tier, patch, oldMonthly, oldAnnual }

  // Subscription lifecycle settings card.
  const [lifecycle, setLifecycle] = useState({ payment_retry_attempts: 3, grace_period_days: 5, proration_policy: 'prorate' });

  // Save toast (bottom-right, 1.4s — same as the prototype).
  const [toast, setToast]         = useState(null);
  const toastTimer                = useRef(null);
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
      const [tiersRes, lifecycleRes] = await Promise.all([
        apiGet('/api/admin/tiers'),
        apiGet('/api/admin/lifecycle-settings').catch(() => null),
      ]);
      setTiers(tiersRes.data ?? { learner: [], school: [] });
      if (lifecycleRes?.data) setLifecycle(lifecycleRes.data);
    } catch (e) {
      setLoadError(e.message || 'Could not load tiers.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ── inline edit ────────────────────────────────────────────────────────── */
  const startEdit = (t) => {
    setEditingId(t.id);
    setDraft({
      price_monthly:  t.price_monthly,
      price_annual:   t.price_annual,
      cap:            t.cap,
      student_cap:    t.student_cap,
      instructor_cap: t.instructor_cap,
      duration_days:  t.duration_days,
      gated:          t.gated_features ?? [],
    });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };
  const toggleDraftFeature = (f) => setDraft((d) => ({
    ...d,
    gated: d.gated.includes(f) ? d.gated.filter((x) => x !== f) : [...d.gated, f],
  }));

  const saveTier = async (t) => {
    const patch = {
      gated_features: draft.gated,
      duration_days:  draft.duration_days,
    };
    if (t.platform === 'learner') {
      patch.cap = draft.cap;
      if (t.access === 'paid') {
        patch.price_monthly = draft.price_monthly;
        patch.price_annual  = draft.price_annual;
      }
    } else {
      patch.student_cap    = draft.student_cap;
      patch.instructor_cap = draft.instructor_cap;
    }

    const priceChanged = t.platform === 'learner' && t.access === 'paid' &&
      (Number(draft.price_monthly) !== t.price_monthly || Number(draft.price_annual) !== t.price_annual);

    if (priceChanged) {
      // Plan §1: pricing changes are an explicit decision — ask for scope.
      setPriceConfirm({ tier: t, patch, oldMonthly: t.price_monthly, oldAnnual: t.price_annual });
      return;
    }
    await patchTier(t, patch);
  };

  const patchTier = async (t, patch, effective_scope) => {
    try {
      const body = { ...patch };
      if (effective_scope) body.effective_scope = effective_scope;
      await apiPatch(`/api/admin/tiers/${t.id}`, body);
      setEditingId(null); setDraft(null); setPriceConfirm(null);
      await load();
      showToast(
        effective_scope
          ? `${t.name} price updated — applies to ${effective_scope === 'all' ? 'everyone' : 'new subscribers only'}`
          : `${t.name} (${t.platform === 'learner' ? 'Learner' : 'School'}) updated`
      );
    } catch (e) {
      if (e.status === 400 && /effective_scope|pricing/i.test(e.message)) {
        // Server-side backstop: open the scope modal with what we have.
        setPriceConfirm({ tier: t, patch, oldMonthly: t.price_monthly, oldAnnual: t.price_annual });
        return;
      }
      showToast(e.message || 'Could not save the tier.');
    }
  };

  /* ── add tier ───────────────────────────────────────────────────────────── */
  const openAddModal = (plat) => {
    setAddOpen(true);
    setAddForm({
      platform: plat,
      name: '',
      access: 'free',
      price_monthly: 0,
      price_annual: 0,
      cap: 100,
      duration_days: '',
      student_cap: 100,
      instructor_cap: 200,
      gated: [],
    });
  };
  const toggleAddFeature = (f) => setAddForm((a) => ({
    ...a,
    gated: a.gated.includes(f) ? a.gated.filter((x) => x !== f) : [...a.gated, f],
  }));

  const submitNewTier = async () => {
    if (!addForm.name.trim()) { showToast('Give the tier a name'); return; }
    const payload = {
      platform: addForm.platform,
      name: addForm.name.trim(),
      access: addForm.access,
      duration_days: addForm.duration_days === '' ? null : Number(addForm.duration_days),
      gated_features: addForm.gated,
    };
    if (addForm.platform === 'learner') {
      payload.cap = addForm.cap;
      if (addForm.access === 'paid') {
        payload.price_monthly = addForm.price_monthly;
        payload.price_annual  = addForm.price_annual;
      }
    } else {
      payload.student_cap    = addForm.student_cap;
      payload.instructor_cap = addForm.instructor_cap;
    }
    try {
      await apiPost('/api/admin/tiers', payload);
      setAddOpen(false);
      await load();
      showToast(`${payload.name} tier added`);
    } catch (e) {
      showToast(e.message || 'Could not create the tier.');
    }
  };

  /* ── lifecycle settings ─────────────────────────────────────────────────── */
  const saveSubscriptionSettings = async () => {
    try {
      const res = await apiPatch('/api/admin/lifecycle-settings', {
        payment_retry_attempts: Number(lifecycle.payment_retry_attempts),
        grace_period_days:      Number(lifecycle.grace_period_days),
        proration_policy:       lifecycle.proration_policy,
      });
      if (res?.data) setLifecycle(res.data);
      showToast('Subscription settings saved');
    } catch (e) {
      showToast(e.message || 'Could not save settings.');
    }
  };

  /* ── render helpers ─────────────────────────────────────────────────────── */
  const isEditing = (t) => editingId === t.id;

  const learnerPriceCell = (t) => {
    if (t.access === 'free') return <span className="ak-price-cell ak-price-free">Free</span>;
    if (isEditing(t)) return (
      <div className="ak-price-row">
        <input
          className="ak-credit-input" type="number" min="0" autoFocus
          value={draft.price_monthly}
          onChange={(e) => setDraft({ ...draft, price_monthly: e.target.value === '' ? 0 : Number(e.target.value) })}
        />/mo
        <input
          className="ak-credit-input" type="number" min="0"
          value={draft.price_annual}
          onChange={(e) => setDraft({ ...draft, price_annual: e.target.value === '' ? 0 : Number(e.target.value) })}
        />/yr
      </div>
    );
    return (
      <span className="ak-price-cell">
        {fmtNaira(t.price_monthly)}/mo<br />
        <small className="text-akoro-dim font-semibold">{fmtNaira(t.price_annual)}/yr</small>
      </span>
    );
  };

  const durationCell = (t, withDefault) => {
    if (t.duration_days === null || t.duration_days === undefined) return '—';
    if (isEditing(t)) return (
      <>
        <input
          className="ak-credit-input" type="number" min="1"
          value={draft.duration_days ?? ''}
          onChange={(e) => setDraft({ ...draft, duration_days: e.target.value === '' ? null : Number(e.target.value) })}
        /> days
      </>
    );
    return `${t.duration_days} days${withDefault ? ' (default)' : ''}`;
  };

  const capCell = (t, key) => isEditing(t) ? (
    <>
      <input
        className="ak-credit-input" type="number" min="0"
        value={draft[key] ?? 0}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value === '' ? 0 : Number(e.target.value) })}
      /> / mo
    </>
  ) : `${t[key]} / mo`;

  const actionsCell = (t) => isEditing(t) ? (
    <div className="ak-detail-actions">
      <button className="ak-btn ak-btn-small" onClick={() => saveTier(t)}>Save</button>
      <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={cancelEdit}>Cancel</button>
    </div>
  ) : (
    <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => startEdit(t)}>Edit</button>
  );

  const featuresFor = (plat) => (plat === 'learner' ? LEARNER_FEATURES : SCHOOL_FEATURES);

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <PageLayout title="Tiers & Credits" subtitle="Default credit caps and feature gating per platform">
      <div className="ak-page">

        <h1 className="ak-h1">Tiers &amp; Credits</h1>
        <p className="ak-sub">
          Default credit caps and feature gating per tier, split by platform. Changes apply
          platform-wide unless a school has its own pilot override.
        </p>

        {loading && <p className="ak-sub">Loading…</p>}
        {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

        {!loading && (
          <>
            {/* ── Learner / School subtabs ── */}
            <div className="ak-subtabs">
              <button
                className={`ak-subtab ${platform === 'learner' ? 'ak-subtab-active' : ''}`}
                onClick={() => { setPlatform('learner'); cancelEdit(); }}
              >Learner</button>
              <button
                className={`ak-subtab ${platform === 'school' ? 'ak-subtab-active' : ''}`}
                onClick={() => { setPlatform('school'); cancelEdit(); }}
              >School</button>
            </div>

            {platform === 'learner' ? (
              <div>
                <table className="ak-table">
                  <thead>
                    <tr>
                      <th>Tier</th><th>Access</th><th>Price</th><th>Credit cap / mo</th>
                      <th>Duration</th><th>Gated features</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.learner.map((t) => (
                      <tr key={t.id}>
                        <td className="ak-tier-name">{t.name}</td>
                        <td><AccessBadge access={t.access} /></td>
                        <td>{learnerPriceCell(t)}</td>
                        <td>{capCell(t, 'cap')}</td>
                        <td>{durationCell(t, false)}</td>
                        <td>
                          {isEditing(t)
                            ? <FeatureChecks features={LEARNER_FEATURES} checked={draft.gated} onToggle={toggleDraftFeature} namePrefix="lf" />
                            : <GatedTags gated={t.gated_features} />}
                        </td>
                        <td>{actionsCell(t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ak-toolbar">
                  <span />
                  <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => openAddModal('learner')}>+ Add tier</button>
                </div>

                <div className="ak-section-title">Subscription lifecycle</div>
                <div className="ak-settings-card">
                  <div className="ak-field">
                    <label htmlFor="sl-retries">Failed payment retry attempts</label>
                    <input
                      className="ak-input" type="number" min="0" id="sl-retries"
                      value={lifecycle.payment_retry_attempts}
                      onChange={(e) => setLifecycle({ ...lifecycle, payment_retry_attempts: e.target.value })}
                    />
                  </div>
                  <div className="ak-field">
                    <label htmlFor="sl-grace">Grace period before auto-downgrade to Freemium (days)</label>
                    <input
                      className="ak-input" type="number" min="0" id="sl-grace"
                      value={lifecycle.grace_period_days}
                      onChange={(e) => setLifecycle({ ...lifecycle, grace_period_days: e.target.value })}
                    />
                  </div>
                  <div className="ak-field">
                    <label htmlFor="sl-proration">Proration policy for mid-cycle plan changes</label>
                    <select
                      className="ak-select" id="sl-proration"
                      value={lifecycle.proration_policy}
                      onChange={(e) => setLifecycle({ ...lifecycle, proration_policy: e.target.value })}
                    >
                      {PRORATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <button className="ak-btn ak-btn-small" onClick={saveSubscriptionSettings}>Save settings</button>
                </div>
              </div>
            ) : (
              <div>
                <table className="ak-table">
                  <thead>
                    <tr>
                      <th>Tier</th><th>Access</th><th>Student cap / mo</th><th>Instructor cap / mo</th>
                      <th>Duration</th><th>Gated features</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.school.map((t) => (
                      <tr key={t.id}>
                        <td className="ak-tier-name">{t.name}</td>
                        <td><AccessBadge access={t.access} /></td>
                        <td>{capCell(t, 'student_cap')}</td>
                        <td>{capCell(t, 'instructor_cap')}</td>
                        <td>{durationCell(t, true)}</td>
                        <td>
                          {isEditing(t)
                            ? <FeatureChecks features={SCHOOL_FEATURES} checked={draft.gated} onToggle={toggleDraftFeature} namePrefix="sf" />
                            : <GatedTags gated={t.gated_features} />}
                        </td>
                        <td>{actionsCell(t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ak-toolbar">
                  <span />
                  <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => openAddModal('school')}>+ Add tier</button>
                </div>
                <p className="ak-sub !mb-0 mt-3.5">
                  School Premium/Enterprise pricing is negotiated per-school rather than set here — see Pilot Schools for individual terms.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Add tier modal ── */}
        {addOpen && addForm && (
          <Modal onClose={() => setAddOpen(false)}>
            <h2>Add tier</h2>
            <div className="ak-field">
              <label htmlFor="nt-name">Tier name</label>
              <input
                className="ak-input" type="text" id="nt-name" placeholder="e.g. Family"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div className="ak-field">
              <label htmlFor="nt-access">Access</label>
              <select
                className="ak-select" id="nt-access"
                value={addForm.access}
                onChange={(e) => setAddForm({ ...addForm, access: e.target.value })}
              >
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {addForm.access === 'paid' && addForm.platform === 'learner' && (
              <div className="ak-field-row">
                <div className="ak-field">
                  <label htmlFor="nt-price-monthly">Price / month (₦)</label>
                  <input
                    className="ak-input" type="number" id="nt-price-monthly" min="0"
                    value={addForm.price_monthly}
                    onChange={(e) => setAddForm({ ...addForm, price_monthly: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="ak-field">
                  <label htmlFor="nt-price-annual">Price / year (₦)</label>
                  <input
                    className="ak-input" type="number" id="nt-price-annual" min="0"
                    value={addForm.price_annual}
                    onChange={(e) => setAddForm({ ...addForm, price_annual: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
            {addForm.platform === 'learner' ? (
              <div className="ak-field-row">
                <div className="ak-field">
                  <label htmlFor="nt-cap">Credit cap / mo</label>
                  <input
                    className="ak-input" type="number" id="nt-cap" min="0"
                    value={addForm.cap}
                    onChange={(e) => setAddForm({ ...addForm, cap: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="ak-field">
                  <label htmlFor="nt-duration">Duration (days, blank = standing)</label>
                  <input
                    className="ak-input" type="number" id="nt-duration" placeholder="e.g. 14"
                    value={addForm.duration_days}
                    onChange={(e) => setAddForm({ ...addForm, duration_days: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="ak-field-row">
                <div className="ak-field">
                  <label htmlFor="nt-student-cap">Student cap / mo</label>
                  <input
                    className="ak-input" type="number" id="nt-student-cap" min="0"
                    value={addForm.student_cap}
                    onChange={(e) => setAddForm({ ...addForm, student_cap: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="ak-field">
                  <label htmlFor="nt-instructor-cap">Instructor cap / mo</label>
                  <input
                    className="ak-input" type="number" id="nt-instructor-cap" min="0"
                    value={addForm.instructor_cap}
                    onChange={(e) => setAddForm({ ...addForm, instructor_cap: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
            <div className="ak-field">
              <label>Gated features</label>
              <FeatureChecks
                features={featuresFor(addForm.platform)}
                checked={addForm.gated}
                onToggle={toggleAddFeature}
                namePrefix="nt"
              />
            </div>
            <div className="ak-modal-actions">
              <button className="ak-btn ak-btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="ak-btn" onClick={submitNewTier}>Add tier</button>
            </div>
          </Modal>
        )}

        {/* ── Confirm price change modal (plan §1: pricing governance) ── */}
        {priceConfirm && (
          <Modal onClose={() => setPriceConfirm(null)}>
            <h2>Confirm price change</h2>
            <div className="mb-4">
              <p className="ak-diff-line">
                <b>{priceConfirm.tier.name} monthly:</b>{' '}
                <span className="ak-diff-old">{fmtNaira(priceConfirm.oldMonthly)}</span> →{' '}
                <span className="ak-diff-new">{fmtNaira(priceConfirm.patch.price_monthly)}</span>
              </p>
              <p className="ak-diff-line">
                <b>{priceConfirm.tier.name} annual:</b>{' '}
                <span className="ak-diff-old">{fmtNaira(priceConfirm.oldAnnual)}</span> →{' '}
                <span className="ak-diff-new">{fmtNaira(priceConfirm.patch.price_annual)}</span>
              </p>
            </div>
            <PriceScopeForm onConfirm={(scope) => patchTier(priceConfirm.tier, priceConfirm.patch, scope)} onCancel={() => setPriceConfirm(null)} />
          </Modal>
        )}

        {/* ── save toast ── */}
        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}

/* Radio group for the price-change scope decision (new_only | all). */
function PriceScopeForm({ onConfirm, onCancel }) {
  const [scope, setScope] = useState('new_only');
  return (
    <>
      <div className="ak-field">
        <label>Apply this change to</label>
        <div className="ak-feature-checks">
          <label>
            <input type="radio" name="effective-scope" value="new_only" checked={scope === 'new_only'} onChange={() => setScope('new_only')} />
            New subscribers only
          </label>
          <label>
            <input type="radio" name="effective-scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />
            All existing subscribers, effective now
          </label>
        </div>
      </div>
      <div className="ak-modal-actions">
        <button className="ak-btn ak-btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="ak-btn" onClick={() => onConfirm(scope)}>Confirm change</button>
      </div>
    </>
  );
}
