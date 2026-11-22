import { useEffect, useState } from 'react';
import { Lock, User, Shield, Megaphone, CreditCard, KeyRound, Webhook, Mail, MessageSquare, Image as ImageIcon, FileSearch, Activity, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Toast, PageSkeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiPut } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, RED, FONT } from '../constants.js';
import { SettingsCard, SettingsGroup } from '../shared/SettingsCard.jsx';

export default function SettingsPage() {
  const { user } = useAuth();

  const [pwForm,    setPwForm]    = useState({ current: '', next: '', confirm: '' });
  const [pwBusy,    setPwBusy]    = useState(false);
  const [announce,  setAnnounce]  = useState({ title: '', message: '', target_role: 'all' });
  const [annBusy,   setAnnBusy]   = useState(false);
  const [billing,   setBilling]   = useState(null);   // { settings, gateway }
  const [billDraft, setBillDraft] = useState(null);
  const [billBusy,  setBillBusy]  = useState(false);
  const [toast,     setToast]     = useState(null);
  const [pvBusy,    setPvBusy]    = useState(false);
  const [pvResult,  setPvResult]  = useState(null);
  const [exBusy,    setExBusy]    = useState(false);
  const [exResult,  setExResult]  = useState(null);   // dry-run counts
  const [exJob,     setExJob]     = useState(null);   // { status, total, processed, results }
  const [riBusy,    setRiBusy]    = useState(false);
  const [ri,        setRi]        = useState(null);   // dry-run counts
  const [riJob,     setRiJob]     = useState(null);   // reindex job
  const [retBusy,   setRetBusy]   = useState(false);
  const [ret,       setRet]       = useState(null);   // { coverageAvg, zeroQueries, rows }
  const [extract,   setExtract]   = useState(null);   // { engine, model }
  const [extractBusy, setExtractBusy] = useState(false);

  useEffect(() => {
    apiGet('/api/admin/records/extract-engine')
      .then((r) => setExtract(r?.data ?? r ?? null))
      .catch(() => {});
  }, []);

  const saveExtractEngine = async (engine) => {
    setExtractBusy(true);
    try {
      const r = await apiPut('/api/admin/records/extract-engine', { engine });
      const d = r?.data ?? r ?? {};
      setExtract(d);
      setToast({ message: `Extraction now uses ${d.engine === 'model' ? 'the vision model' : 'the RunPod worker'}`, type: 'success' });
    } catch (e) {
      setToast({ message: e?.message || 'Could not change the extraction engine', type: 'error' });
    } finally { setExtractBusy(false); }
  };

  /* Document previews: render page 1 for uploads that have none yet. Batched
     server-side (50 a call); press again until "remaining" is 0. Dry run first
     is free — it only answers how many rows are missing a preview. */
  const runPreviewBackfill = async (dryRun) => {
    setPvBusy(true);
    try {
      const r = await apiPost('/api/admin/records/previews/backfill', { limit: 50, dryRun });
      const d = r?.data ?? r ?? {};
      setPvResult(d);
      setToast({ message: dryRun ? `${d.scanned ?? 0} need a preview` : `${d.written ?? 0} preview(s) written`, type: 'success' });
    } catch (e) {
      setToast({ message: e?.message || 'Preview backfill failed', type: 'error' });
    } finally { setPvBusy(false); }
  };


  /* Extraction: the slow counterpart of previews. A dry run counts uploads
     with no saved pages; the real run is a server job (OCR is 10–60 s per
     document), so the console polls it instead of holding a request open. */
  const runExtractionBackfill = async (dryRun) => {
    setExBusy(true);
    try {
      const r = await apiPost('/api/admin/records/extractions/backfill', dryRun ? { dryRun: true } : { limit: 2 });
      const d = r?.data ?? r ?? {};
      if (dryRun) {
        setExResult(d);
        setToast({ message: `${d.total ?? 0} need extraction: ${d.text ?? 0} text, ${d.scannedPdf ?? 0} scans, ${d.image ?? 0} images`, type: 'success' });
        return;
      }
      setExJob({ status: 'running', total: d.total ?? 0, processed: 0, results: [] });
      if (!d.total) { setToast({ message: 'Nothing needs extraction', type: 'success' }); setExJob(null); return; }
      setToast({ message: `Extraction backfill started (${d.total} file${d.total === 1 ? '' : 's'})`, type: 'success' });
      for (let i = 0; i < 400; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const j = await apiGet(`/api/admin/records/extractions/backfill/${d.jobId}`);
        const job = j?.data ?? j ?? null;
        if (!job) break;
        setExJob(job);
        if (job.status !== 'running') {
          const done = (job.results || []).filter((x) => x.status === 'done').length;
          const failed = (job.results || []).filter((x) => x.status === 'failed').length;
          const skipped = (job.results || []).filter((x) => x.status === 'skipped').length;
          setToast({ message: `Extraction backfill: ${done} done, ${skipped} skipped, ${failed} failed${job.remaining != null ? `, ${job.remaining} left` : ''}`, type: failed ? 'error' : 'success' });
          break;
        }
      }
    } catch (e) {
      setToast({ message: e?.message || 'Extraction backfill failed', type: 'error' });
    } finally {
      setExBusy(false);
    }
  };


  /* H1/M2: bring stale chunks onto the current chunker (unmetered). */
  const runChunkReindex = async (dryRun) => {
    setRiBusy(true);
    try {
      const r = await apiPost('/api/admin/records/chunks/reindex', dryRun ? { dryRun: true } : { limit: 10 });
      const d = r?.data ?? r ?? {};
      if (dryRun) {
        setRi(d);
        setToast({ message: `${d.records ?? 0} record(s), ${d.chunks ?? 0} chunk(s) on the old chunker`, type: 'success' });
        return;
      }
      if (!d.total) { setToast({ message: 'No stale chunks — the index is current', type: 'success' }); return; }
      setRiJob({ status: 'running', total: d.total, processed: 0, results: [] });
      setToast({ message: `Reindex started (${d.total} record${d.total === 1 ? '' : 's'})`, type: 'success' });
      for (let i = 0; i < 400; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const j = await apiGet(`/api/admin/records/chunks/reindex/${d.jobId}`);
        const job = j?.data ?? j ?? null;
        if (!job) break;
        setRiJob(job);
        if (job.status !== 'running') {
          const done = (job.results || []).filter((x) => x.status === 'reindexed').length;
          const failed = (job.results || []).filter((x) => x.status === 'failed').length;
          setToast({ message: `Reindex: ${done} done, ${failed} failed${job.remaining != null ? `, ${job.remaining} record(s) left` : ''}`, type: failed ? 'error' : 'success' });
          break;
        }
      }
    } catch (e) {
      setToast({ message: e?.message || 'Reindex failed', type: 'error' });
    } finally {
      setRiBusy(false);
    }
  };
  /* H5: retrieval vs generation health from edu.retrieval_events. */
  const loadRetrievalTelemetry = async () => {
    setRetBusy(true);
    try {
      const r = await apiGet('/api/admin/retrieval/events?limit=200');
      const d = r?.data ?? r ?? {};
      setRet(d);
      setToast({ message: `Loaded ${d.rows?.length ?? 0} event(s)`, type: 'success' });
    } catch (e) {
      setToast({ message: e?.message || 'Could not load retrieval telemetry', type: 'error' });
    } finally {
      setRetBusy(false);
    }
  };
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    apiGet('/api/admin/billing-settings')
      .then((r) => { setBilling(r.data ?? null); setBillDraft(r.data?.settings ?? null); })
      .catch(() => {});
  }, []);

  const setBill = (k) => (e) => setBillDraft(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const saveBilling = async () => {
    setBillBusy(true);
    try {
      const res = await apiPatch('/api/admin/billing-settings', {
        email_from_name: billDraft.email_from_name,
        email_from_address: billDraft.email_from_address,
        support_email: billDraft.support_email ?? '',
        notify_payment_failed: billDraft.notify_payment_failed,
        notify_trial_ending: billDraft.notify_trial_ending,
        notify_pilot_ending: billDraft.notify_pilot_ending,
      });
      setBilling(res.data ?? null);
      setBillDraft(res.data?.settings ?? null);
      showToast('Billing settings saved');
    } catch (err) {
      showToast(err.message || 'Failed to save billing settings', 'error');
    } finally {
      setBillBusy(false);
    }
  };

  const setPw  = (k) => (e) => setPwForm(f => ({ ...f, [k]: e.target.value }));
  const setAnn = (k) => (e) => setAnnounce(f => ({ ...f, [k]: e.target.value }));

  const handleAnnouncement = async (e) => {
    e.preventDefault();
    if (!announce.title.trim() || !announce.message.trim()) {
      showToast('Title and message are required', 'error'); return;
    }
    setAnnBusy(true);
    try {
      const { sent } = await apiPost('/api/admin/announcements/send', announce).then(r => r.data ?? r);
      showToast(`Announcement sent to ${sent} user${sent !== 1 ? 's' : ''}`);
      setAnnounce({ title: '', message: '', target_role: 'all' });
    } catch (err) {
      showToast(err.message || 'Failed to send announcement', 'error');
    } finally {
      setAnnBusy(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!pwForm.current) { showToast('Current password is required', 'error'); return; }
    if (pwForm.next.length < 8) { showToast('New password must be at least 8 characters', 'error'); return; }
    if (pwForm.next !== pwForm.confirm) { showToast('New passwords do not match', 'error'); return; }
    setPwBusy(true);
    try {
      await apiPost('/api/auth/change-password', {
        currentPassword: pwForm.current,
        newPassword:     pwForm.next,
      });
      showToast('Password changed successfully');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      showToast(err.message || 'Failed to change password', 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const cardStyle = {
    background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
    padding: 24, marginBottom: 20,
  };

  const cardHeader = {
    margin: '0 0 20px', width: '100%', padding: 0, background: 'transparent',
    border: 'none', boxShadow: 'none',
  };

  return (
    <PageLayout title="Settings" subtitle="Platform settings and account management">
      <div style={{ width: '100%' }}>

        {/* Announcements */}
        <SettingsGroup title="Communication">
        <div style={cardStyle}>
          <SettingsCard
            icon={<Megaphone size={18} color={AMBER} />}
            title="Send Announcement"
            color={AMBER}
            chevron={false}
            style={cardHeader}
          />
          <form onSubmit={handleAnnouncement} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 6 }}>
                Audience
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['all','All Users'],['student','Students'],['instructor','Instructors']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAnnounce(f => ({ ...f, target_role: val }))}
                    style={{
                      padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
                      fontFamily: FONT, fontSize: 12, fontWeight: 600,
                      background: announce.target_role === val ? AMBER : LIGHT,
                      color: announce.target_role === val ? WHITE : MUTED,
                      transition: 'all .15s',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <Inp
              label="Title"
              value={announce.title}
              onChange={setAnn('title')}
              placeholder="e.g. Scheduled maintenance this Sunday"
            />
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 6 }}>
                Message
              </label>
              <textarea
                value={announce.message}
                onChange={setAnn('message')}
                placeholder="Write your announcement…"
                rows={4}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: `1.5px solid ${BORDER}`, outline: 'none', resize: 'vertical',
                  fontSize: 13, fontFamily: FONT, color: INK, background: WHITE,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn type="submit" disabled={annBusy}>
                <Megaphone size={14} /> {annBusy ? 'Sending…' : 'Send Announcement'}
              </Btn>
            </div>
          </form>
        </div>
        </SettingsGroup>

        {/* Billing: notifications & branding card (plan §4.6 #4) */}
        <SettingsGroup title="Billing">
        <div style={cardStyle}>
          <SettingsCard
            icon={<CreditCard size={18} color={AMBER} />}
            title="Billing"
            subtitle="Notifications & Branding"
            color={AMBER}
            chevron={false}
            style={cardHeader}
          />
          {billDraft ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Inp label="Sender name" value={billDraft.email_from_name} onChange={setBill('email_from_name')} placeholder="Akoro" />
                </div>
                <div style={{ flex: 1.4 }}>
                  <Inp label="From address" value={billDraft.email_from_address} onChange={setBill('email_from_address')} placeholder="noreply@akoro.app" />
                </div>
              </div>
              <Inp label="Support email (shown in billing messages)" value={billDraft.support_email ?? ''} onChange={setBill('support_email')} placeholder="support@akoro.app" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: LIGHT, borderRadius: 12 }}>
                {[
                  ['notify_payment_failed', 'Email the customer when a payment fails'],
                  ['notify_trial_ending', 'Email the customer before a trial ends'],
                  ['notify_pilot_ending', 'Email the school admin before a pilot ends'],
                ].map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(billDraft[k])}
                      onChange={setBill(k)}
                      style={{ width: 16, height: 16, accentColor: AMBER, cursor: 'pointer' }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn type="button" disabled={billBusy} onClick={saveBilling}>
                  <CreditCard size={14} /> {billBusy ? 'Saving…' : 'Save Billing Settings'}
                </Btn>
              </div>
            </div>
          ) : (
            <PageSkeleton header={false} variant="form" rows={3} />
          )}
        </div>
        </SettingsGroup>

        {/* Billing: gateway status (read-only — keys live in env) */}
        {billing?.gateway && (
          <SettingsGroup title="Billing — Gateway">
            {[
              ['Paystack mode', billing.gateway.paystack_mode === 'live' ? 'Live' : billing.gateway.paystack_mode === 'test' ? 'Test' : 'Not configured', CreditCard],
              ['Paystack keys', billing.gateway.paystack_public_key && billing.gateway.paystack_secret_key ? 'Public + secret present' : 'Missing — set PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY', KeyRound],
              ['Webhook URL', billing.gateway.webhook_url || '—', Webhook],
              ['Email provider (Resend)', billing.gateway.email_provider_configured ? 'Configured' : 'Not configured (RESEND_API_KEY)', Mail],
              ['SMS provider (Twilio)', billing.gateway.sms_provider_configured ? 'Configured' : 'Not configured (TWILIO_*)', MessageSquare],
            ].map(([k, v, Icon]) => (
              <SettingsCard
                key={k}
                icon={<Icon size={18} color={AMBER} />}
                title={k}
                subtitle={v}
                color={AMBER}
                chevron={false}
              />
            ))}
            <p style={{ fontSize: 11.5, color: MUTED, fontFamily: FONT, margin: '4px 16px 20px' }}>
              Keys are environment variables on the API service and are never editable from this dashboard.
            </p>
          </SettingsGroup>
        )}

        {/* Admin account */}
        <SettingsGroup title="Account">
        <div style={cardStyle}>
          <SettingsCard
            icon={<User size={18} color={AMBER} />}
            title="Admin Account"
            color={AMBER}
            chevron={false}
            style={cardHeader}
          />

          {/* Current user info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px', background: LIGHT, borderRadius: 12, marginBottom: 24,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: WHITE, flexShrink: 0,
            }}>
              {(user?.fullName || user?.email || 'A')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, fontFamily: FONT }}>
                {user?.fullName || user?.username || 'Admin'}
              </div>
              <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT, marginTop: 2 }}>
                {user?.email || '—'}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                marginTop: 6, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: '#FFE4E4', color: RED,
              }}>
                <Shield size={10} /> {user?.role || 'admin'}
              </div>
            </div>
          </div>

          {/* Change password form */}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Lock size={15} color={MUTED} />
              <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Change Password</span>
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Inp
                label="Current Password"
                type="password"
                value={pwForm.current}
                onChange={setPw('current')}
                placeholder="Enter your current password"
                autoComplete="current-password"
              />
              <Inp
                label="New Password"
                type="password"
                value={pwForm.next}
                onChange={setPw('next')}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
              />
              <Inp
                label="Confirm New Password"
                type="password"
                value={pwForm.confirm}
                onChange={setPw('confirm')}
                placeholder="Repeat new password"
                autoComplete="new-password"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <Btn type="submit" disabled={pwBusy}>
                  <Lock size={14} /> {pwBusy ? 'Updating…' : 'Update Password'}
                </Btn>
              </div>
            </form>
          </div>
        </div>
        </SettingsGroup>
        {/* Maintenance: host-level jobs without a shell. */}
        <SettingsGroup title="Document extraction">
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileSearch size={18} color={AMBER}/>
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK }}>Scanned-document parser</p>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                  RunPod is the fine-tuned layout worker; the vision model reads a page straight into markdown
                  (faster, weaker on dense tables); DeepSeek OCR recognises the whole document server-side with layout boxes. Currently: <strong>{extract?.engine === 'ocr' ? 'DeepSeek OCR' : extract?.engine === 'model' ? `vision model (${extract?.model || 'configured'})` : 'RunPod worker'}</strong>.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn type="button" disabled={extractBusy || extract?.engine === 'runpod'} onClick={() => saveExtractEngine('runpod')}>Use RunPod</Btn>
              <Btn type="button" disabled={extractBusy || extract?.engine === 'model'} onClick={() => saveExtractEngine('model')}>Use vision model</Btn>
              <Btn type="button" disabled={extractBusy || extract?.engine === 'ocr'} onClick={() => saveExtractEngine('ocr')}>Use DeepSeek OCR</Btn>
            </div>
          </div>
        </SettingsGroup>
        <SettingsGroup title="Maintenance">
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ImageIcon size={18} color={AMBER}/>
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK }}>Document previews</p>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                  Render page 1 for uploads that don't have a card image yet.
                  {pvResult ? ` Last run: ${pvResult.written ?? 0} written, ${pvResult.remaining ?? 0} still missing.` : ''}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn type="button" disabled={pvBusy} onClick={() => runPreviewBackfill(true)}>Dry run</Btn>
              <Btn type="button" disabled={pvBusy} onClick={() => runPreviewBackfill(false)}>
                {pvBusy ? 'Working…' : 'Backfill previews'}
              </Btn>
            </div>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileSearch size={18} color={AMBER}/>
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK }}>Document extraction</p>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                  Read uploads that have no saved pages, with the current engine. Dry run first: it only counts.
                  {exResult ? ` Missing: ${exResult.total ?? 0} (${exResult.text ?? 0} text, ${exResult.scannedPdf ?? 0} scans, ${exResult.image ?? 0} images).` : ''}
                  {exJob?.status === 'running' ? ` Working: ${exJob.processed ?? 0}/${exJob.total ?? 0}…` : ''}
                  {exJob && exJob.status !== 'running' && exJob.remaining != null ? ` ${exJob.remaining} still missing.` : ''}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn type="button" disabled={exBusy} onClick={() => runExtractionBackfill(true)}>Dry run</Btn>
              <Btn type="button" disabled={exBusy} onClick={() => runExtractionBackfill(false)}>
                {exBusy ? 'Working…' : 'Backfill extraction'}
              </Btn>
            </div>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={18} color={AMBER}/>
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK }}>Retrieval telemetry</p>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                  Search and Ask health: citation coverage, and queries that returned nothing useful.
                  {ret ? ` Coverage ${ret.coverageAvg == null ? '—' : `${Math.round(ret.coverageAvg * 100)}%`} over ${ret.coverageSamples ?? 0} answer(s).` : ''}
                </p>
              </div>
            </div>
            {ret?.zeroQueries?.length ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 800, color: INK }}>Zero-result queries</p>
                {ret.zeroQueries.slice(0, 5).map((z) => (
                  <p key={z.query} style={{ margin: 0, fontSize: 11.5, color: MUTED }}>{z.count}× {z.query}</p>
                ))}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn type="button" disabled={retBusy} onClick={loadRetrievalTelemetry}>
                {retBusy ? 'Loading…' : 'Refresh telemetry'}
              </Btn>
            </div>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw size={18} color={AMBER}/>
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: INK }}>Search index</p>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                  Re-chunk and re-embed records written by an older chunker (heading-aware chunks, cleaning, dedupe). Dry run counts first.
                  {ri ? ` Stale: ${ri.records ?? 0} record(s), ${ri.chunks ?? 0} chunk(s).` : ''}
                  {riJob?.status === 'running' ? ` Working: ${riJob.processed ?? 0}/${riJob.total ?? 0}…` : ''}
                  {riJob && riJob.status !== 'running' && riJob.remaining != null ? ` ${riJob.remaining} record(s) still stale.` : ''}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn type="button" disabled={riBusy} onClick={() => runChunkReindex(true)}>Dry run</Btn>
              <Btn type="button" disabled={riBusy} onClick={() => runChunkReindex(false)}>{riBusy ? 'Working…' : 'Reindex search'}</Btn>
            </div>
          </div>
        </SettingsGroup>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
