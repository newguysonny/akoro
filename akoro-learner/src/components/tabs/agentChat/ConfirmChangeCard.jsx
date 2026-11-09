/*
 * ConfirmChangeCard — a tool the learner's agent built wants to CHANGE their
 * data (mark tasks done, end a study buddy). Nothing has changed yet: the card
 * lists exactly what would change, and only the learner's tap on Confirm runs
 * it (POST /api/self-tooling/confirmations/:id/confirm). The agent can't.
 *
 * kind 'permission': the agent has no ability for what the learner asked
 * (e.g. deleting their tasks) but drafted a tool for it. Approve turns that
 * ability on for this learner only; then the chat carries on (onDone): the
 * agent runs the tool in its next turn and its change card comes from there.
 * After a Confirm, the chat carries on too, so the agent checks what changed.
 */
import { useEffect, useState } from 'react';
import ApprovalButtons from './ApprovalButtons.jsx';
import { Icon } from '../../common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import { apiGet, apiPost } from '../../../services/api.js';

const NUNITO = "'Nunito',sans-serif";
const unwrap = (r) => r?.data || r;

export default function ConfirmChangeCard({ confirm, onDone = null }) {
  const [state, setState] = useState(confirm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // The card may be older than this page: show its real state (done, declined, expired).
  useEffect(() => {
    if (!confirm?.confirmationId) return;
    apiGet(`/api/self-tooling/confirmations/${confirm.confirmationId}`).then((r) => setState((s) => ({ ...s, ...unwrap(r) }))).catch(() => {});
  }, [confirm?.confirmationId]);
  if (!state?.confirmationId) return null;

  const expired = state.status === 'pending' && state.expiresAt && Date.parse(state.expiresAt) <= Date.now();
  const act = async (what) => {
    setBusy(true); setErr('');
    try {
      // The server performs the write AND posts the follow-up into the chat; the
      // card is not kept. No client-driven continuation is needed.
      const r = unwrap(await apiPost(`/api/self-tooling/confirmations/${state.confirmationId}/${what}`, {}));
      setState((s) => ({ ...s, ...r }));
      if (onDone) onDone(what === 'confirm' ? (state.kind === 'permission' ? 'approved' : 'confirmed') : 'rejected', { ...state, ...r });
    } catch (e) { setErr(e?.message || 'Could not do that.'); }
    finally { setBusy(false); }
  };

  const items = state.items || [];
  const result = state.result;
  if (state.kind === 'permission') return <PermissionCard state={state} expired={expired} busy={busy} err={err} act={act} />;
  return (
    <div style={{ marginTop: 10, padding: '12px 13px', borderRadius: 14, background: 'var(--ak-surface)', border: `1px solid ${state.status === 'pending' && !expired ? `${BRAND}55` : 'var(--ak-border)'}`, fontFamily: NUNITO }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ti-shield-check" size={16} color={BRAND} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>{state.title || 'Your tool'} wants to make a change</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{state.action}</div>
        </div>
      </div>
      <ul style={{ margin: '9px 0 0', paddingLeft: 18, fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.6 }}>
        {items.slice(0, 20).map((it, i) => <li key={i}>{it}</li>)}
        {state.more > 0 && <li style={{ color: 'var(--ak-text-muted)' }}>…and {state.more} more (not included — ask again after)</li>}
      </ul>
      {state.status === 'pending' && !expired && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 8 }}>Nothing has changed yet. Only you can allow it.</div>
          <ApprovalButtons busy={busy} onAllow={() => act('confirm')} onReject={() => act('reject')} />
        </>
      )}
      {(state.status !== 'pending' || expired) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, fontSize: 12, fontWeight: 800, color: state.status === 'consumed' ? '#10B981' : 'var(--ak-text-muted)' }}>
          <Icon name={state.status === 'consumed' ? 'ti-circle-check' : 'ti-circle-x'} size={14} />
          {state.status === 'consumed'
            ? `Done — ${result?.done ?? items.length} changed${result?.failed ? `, ${result.failed} couldn't be (${(result.errors || []).join('; ')})` : ''}.`
            : state.status === 'rejected' ? 'Not changed.' : 'Expired — nothing changed. Ask your agent again.'}
        </div>
      )}
      {err && <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function PermissionCard({ state, expired, busy, err, act }) {
  const result = state.result;
  const pending = state.status === 'pending' && !expired;
  const built = state.status === 'consumed' && result?.status === 'created';
  return (
    <div style={{ marginTop: 10, padding: '12px 13px', borderRadius: 14, background: 'var(--ak-surface)', border: `1px solid ${pending ? `${BRAND}55` : 'var(--ak-border)'}`, fontFamily: NUNITO }} data-permission-card="">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ti-key" size={16} color={BRAND} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>{state.drafted ? `Turn on “${state.title || 'your new tool'}”?` : `Build “${state.title || 'a new tool'}”?`}</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{state.drafted ? 'Your agent drafted this tool. It needs your OK to' : "Your agent can't do this yet. Allow it to"}: {state.action}</div>
        </div>
      </div>
      {pending && state.drafted ? <>
        {state.goal && <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.5 }}>{state.goal}</div>}
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)' }}>{(state.items || []).length ? 'Right now it would change:' : 'Right now nothing matches it.'}</div>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.6 }}>
          {(state.items || []).slice(0, 20).map((it, i) => <li key={i}>{it}</li>)}
          {state.more > 0 && <li style={{ color: 'var(--ak-text-muted)' }}>…and {state.more} more</li>}
        </ul>
      </> : pending && (state.items || [])[0] && <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.5 }}>{state.items[0]}</div>}
      {pending && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 8 }}>{state.drafted ? 'Only for you. Allow turns it on, and nothing changes until you confirm each change it proposes.' : 'Only for you. Nothing changes until you confirm each change it proposes.'}</div>
          <ApprovalButtons busy={busy} onAllow={() => act('confirm')} onReject={() => act('reject')} />
        </>
      )}
      {!pending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, fontSize: 12, fontWeight: 800, color: built ? '#10B981' : 'var(--ak-text-muted)' }}>
          <Icon name={built ? 'ti-circle-check' : 'ti-circle-x'} size={14} />
          {built ? `Approved — “${result.label || state.title}” is ${state.drafted ? 'on' : 'built'} and saved in your tools.`
            : state.status === 'consumed' ? `Approved, but it couldn't be built: ${result?.reason || 'try asking again'}.`
              : state.status === 'rejected' ? (state.drafted ? 'Not now — the draft was discarded.' : 'Not allowed — nothing was built.') : 'Expired — ask your agent again.'}
        </div>
      )}
      {err && <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', marginTop: 6 }}>{err}</div>}
    </div>
  );
}
