/**
 * Real-account checks — Verification Gate phase V4.
 *
 * An admin runs ONE approved check (a write scenario marked safe for real
 * accounts) on ONE real account, with a reason. The approval is single-use
 * and expires in 15 minutes; the run undoes what it creates, the account
 * owner is told (in-app, email, SMS), and everything is audit-logged.
 * Anything the run leaves behind is reported here and to the admin at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Mail, MessageSquare, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Skeleton, Toast } from '../components/Primitives.jsx';
import { confirmDialog } from '../components/ConfirmHost.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, BLUE, BORDER, FONT, GREEN, INK, LIGHT, MUTED, MUTED2, RED, WHITE } from '../constants.js';

const unwrap = (d) => d?.data ?? d;
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const pill = (text, color, bg) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: bg, color, fontFamily: FONT, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>;
const VERDICT = {
  PASS: [GREEN, '#ECFDF5'], FAIL: [RED, '#FEF2F2'], ERROR: [RED, '#FEF2F2'], BLOCKED: [AMBER, '#FFF7ED'], INCONCLUSIVE: [AMBER, '#FFF7ED'],
};
const statusPill = (r) => {
  if (r.status === 'running' || r.status === 'approved') return pill('Running…', BLUE, '#EFF6FF');
  if (r.status === 'expired') return pill('Expired', MUTED, LIGHT);
  const [c, bg] = VERDICT[r.verdict] || [MUTED, LIGHT];
  return pill(r.verdict || r.status, c, bg);
};
const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18 };
const label = { display: 'block', fontFamily: FONT, fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6 };

function Channel({ icon: Icon, name, value }) {
  const ok = value === 'sent';
  const skipped = String(value || '').startsWith('skipped');
  const color = ok ? GREEN : skipped ? MUTED2 : value ? RED : MUTED2;
  return (
    <span title={`${name}: ${value || 'not yet'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 12, color }}>
      <Icon size={13} /> {ok ? 'sent' : skipped ? 'skipped' : value ? 'failed' : '—'}
    </span>
  );
}

export default function RealAccountChecksPage() {
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [handle, setHandle] = useState('');
  const [account, setAccount] = useState(null);     // looked-up account
  const [lookupErr, setLookupErr] = useState('');
  const [scenario, setScenario] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = unwrap(await apiGet('/api/admin/verify/real-user-runs'));
      setData(d);
      setScenario((s) => s || d?.scenarios?.[0]?.name || '');
    } catch (e) { setToast({ type: 'error', message: e.message || 'Could not load checks.' }); setData((d) => d || { enabled: false, scenarios: [], runs: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // While a run is in flight, refresh every 5 s.
  const running = (data?.runs || []).some((r) => r.status === 'running');
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  const lookup = async () => {
    setAccount(null); setLookupErr('');
    if (!handle.trim()) return;
    try { setAccount(unwrap(await apiGet(`/api/admin/verify/real-user-account?handle=${encodeURIComponent(handle.trim())}`))); }
    catch (e) { setLookupErr(e.message || 'No such account.'); }
  };

  const chosen = (data?.scenarios || []).find((s) => s.name === scenario);
  const roleOk = !account || !chosen || chosen.roles.includes(account.role);
  const canRun = data?.enabled && account && !account.tester && chosen && roleOk && reason.trim().length >= 10 && !busy;

  const run = async () => {
    const ok = await confirmDialog({
      title: `Run a check on ${account.name || account.username}'s account?`,
      message: `This makes a real change on their account (${chosen.what}) and undoes it straight after. They will be told by in-app notification, email${account.hasPhone ? ' and SMS' : ''}. The approval is single-use and recorded in the audit log.`,
      confirmLabel: 'Run check',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiPost('/api/admin/verify/real-user-runs', { account: handle.trim(), scenario, reason: reason.trim() });
      setToast({ type: 'success', message: 'Check started — the result appears below.' });
      setReason('');
      await load();
    } catch (e) { setToast({ type: 'error', message: e.message || 'Could not start the check.' }); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Real-account checks" subtitle="Run one approved check on a real account — the owner is always told"
      action={<Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {data && !data.enabled && (
          <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFF7ED', borderColor: '#FED7AA' }}>
            <AlertTriangle size={18} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontFamily: FONT, fontSize: 13, color: INK, lineHeight: 1.55 }}>
              Real-account checks are off on this server. Set <code>VERIFY_REAL_USER_WRITES=true</code> on the API (Render → Environment) to allow them.
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <ShieldCheck size={18} color={AMBER} />
            <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK }}>New check</div>
          </div>

          <span style={label}>Account (username or email)</span>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <Inp value={handle} onChange={(e) => { setHandle(e.target.value); setAccount(null); setLookupErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} placeholder="@username or name@example.com"
              containerStyle={{ flex: '1 1 240px', marginBottom: 0 }} aria-label="Account" />
            <Btn variant="secondary" onClick={lookup} disabled={!handle.trim()}><Search size={14} /> Look up</Btn>
          </div>
          {lookupErr && <div style={{ fontFamily: FONT, fontSize: 12, color: RED, marginBottom: 10 }}>{lookupErr}</div>}
          {account && (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: LIGHT, border: `1px solid ${BORDER}`, marginBottom: 14, fontFamily: FONT, fontSize: 13, color: INK, lineHeight: 1.6 }}>
              <strong>{account.name}</strong> · @{account.username} · {account.role} · {account.email} · {account.hasPhone ? 'has a phone (SMS)' : 'no phone (no SMS)'}
              {account.tester && <div style={{ color: RED, fontSize: 12 }}>This is a test account — use the normal gate for test accounts.</div>}
              {!roleOk && <div style={{ color: RED, fontSize: 12 }}>This check is for {chosen.roles.join(' / ')} accounts.</div>}
            </div>
          )}

          <span style={label}>Check</span>
          {!data ? <Skeleton height={40} /> : (data.scenarios || []).length === 0 ? (
            <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, marginBottom: 14 }}>No checks are approved for real accounts yet.</div>
          ) : (
            <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Check"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 14, color: INK, background: WHITE, marginBottom: 6 }}>
              {data.scenarios.map((s) => <option key={s.name} value={s.name}>{s.what.charAt(0).toUpperCase() + s.what.slice(1)}</option>)}
            </select>
          )}
          {chosen && <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginBottom: 14, lineHeight: 1.5 }}>{chosen.description} The owner is told it {chosen.changes}.</div>}

          <span style={label}>Why (kept in the audit log)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} aria-label="Reason"
            placeholder="e.g. Support ticket 1432: the learner says tasks from the agent don't save"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 14, color: INK, resize: 'vertical', marginBottom: 12 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Btn onClick={run} disabled={!canRun}>{busy ? 'Starting…' : 'Run check'}</Btn>
            <span style={{ fontFamily: FONT, fontSize: 12, color: MUTED2 }}>
              The owner is told by in-app notification, email and SMS. At most 3 checks per account a day.
            </span>
          </div>
        </div>

        <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: MUTED2, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>History</div>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          {!data ? <div style={{ padding: 18 }}><Skeleton height={60} /></div>
            : data.runs.length === 0 ? <div style={{ padding: 18, fontFamily: FONT, fontSize: 13, color: MUTED }}>No real-account checks yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: LIGHT, textAlign: 'left', color: MUTED, fontSize: 12 }}>
                    {['When', 'Account', 'Check', 'By · why', 'Result', 'Cleaned up', 'Owner told'].map((h) => <th key={h} style={{ padding: '10px 12px', fontWeight: 700 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => {
                    const s = (data.scenarios || []).find((x) => x.name === r.scenario);
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: MUTED }}>{when(r.createdAt)}</td>
                        <td style={{ padding: '10px 12px', color: INK }}>{r.account ? <>{r.account.name || r.account.username}<div style={{ fontSize: 11, color: MUTED2 }}>@{r.account.username}</div></> : '—'}</td>
                        <td style={{ padding: '10px 12px', color: INK }}>{s ? s.what : r.scenario}</td>
                        <td style={{ padding: '10px 12px', color: MUTED, maxWidth: 260 }}>{r.adminLabel}<div style={{ fontSize: 12, color: MUTED2, overflowWrap: 'anywhere' }}>{r.reason}</div></td>
                        <td style={{ padding: '10px 12px' }}>{statusPill(r)}{r.runId && <div style={{ fontSize: 11, color: MUTED2, marginTop: 4 }} title={r.runId}>run {r.runId.slice(0, 8)}</div>}</td>
                        <td style={{ padding: '10px 12px' }}>
                          {r.cleanupOk === true ? <span style={{ color: GREEN, display: 'inline-flex', gap: 4, alignItems: 'center' }}><CheckCircle2 size={14} /> Yes</span>
                            : r.cleanupOk === false ? <span title={JSON.stringify(r.residue)} style={{ color: RED, display: 'inline-flex', gap: 4, alignItems: 'center' }}><XCircle size={14} /> Left data</span>
                            : <span style={{ color: MUTED2 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <Channel icon={Bell} name="In-app" value={r.notified?.inapp} />
                            <Channel icon={Mail} name="Email" value={r.notified?.email} />
                            <Channel icon={MessageSquare} name="SMS" value={r.notified?.sms} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </PageLayout>
  );
}
