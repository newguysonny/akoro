/**
 * streamReducer.js — v3 event envelopes → what the stream renders (Grand Plan
 * §13.2, Phase 11). Pure (no React, no DOM), shared by every surface that
 * shows a workflow's or the Agent Chat's stream.
 *
 *   streamReducer(state, envelope, opts) → a NEW state   (fold one event)
 *   reduceStream(envelopes, opts)        → state          (fold a list)
 *   initialStreamState()
 *
 * state = {
 *   items:    ordered render items, the same block shapes TraceBlocks draws
 *             (thinking / tool / activity) plus the cards the stream needs:
 *               score    assessment.completed           → ScoreCard
 *               plan     decision.proposed with a plan  → PlanCard (+ its gate)
 *               handoff  workflow.handoff_created/_completed → TeachingHandoffCard
 *               gate     learner.action_required / _received → GateButton
 *             decision.rejected is a red verification row (a tool block, ok:false).
 *   reply:    the final answer's text (reply.delta / reply)
 *   workflow: { id, type, status, state, subState } for WorkflowStateBadge
 *   lastSequence per workflow (dedupe: a replayed or reconnect event is ignored)
 * }
 *
 * Any subset of THINKING → TOOL → ACTIVITY in any order is valid. Events not
 * meant for the learner (visibility ≠ learner) are skipped unless
 * opts.developer, which also attaches a `dev` line to each item (§13.3: type,
 * state/sub-state, operation, tool, event id, sequence, context set, codes).
 * Nothing here reads answer keys or raw reasoning: the envelope never has them.
 */

const ACTIVE_STATUSES = new Set(['created', 'active', 'waiting_learner', 'waiting_child', 'paused']);
const STATUS_OF = {
  'workflow.paused': 'paused', 'workflow.resumed': 'active', 'workflow.completed': 'completed',
  'workflow.abandoned': 'abandoned', 'workflow.cancelled': 'cancelled', 'learner.action_required': 'waiting_learner',
  'learner.action_received': 'active', 'workflow.handoff_created': 'waiting_child', 'workflow.handoff_completed': 'active',
  'workflow.started': 'active', 'workflow.created': 'created',
};
const QUIET = new Set(['workflow.created', 'workflow.started', 'workflow.state_changed', 'workflow.resumed', 'decision.accepted',
  'context.loaded', 'operation.started', 'operation.completed', 'evidence.recorded', 'wallet.updated', 'topic.state_changed',
  'teaching.phase_changed', 'strategy.selected', 'workflow.outcome_emitted', 'assessment.started', 'decision.fallback']);

export function initialStreamState() {
  return { items: [], reply: '', replyDone: false, workflow: null, lastSequence: {} };
}

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const txt = (v) => (v == null ? '' : String(v));
const keyOf = (env) => `${env.workflowId || env.turnId || 'chat'}`;
const itemId = (env, suffix = '') => `${env.workflowId ? `wf_${env.workflowId}` : `t_${env.turnId || 'chat'}`}_${env.sequence ?? 'x'}${suffix}`;

function devLine(env) {
  const p = env.payload || {};
  return {
    type: env.type, sequence: env.sequence ?? null, eventId: env.id || null, workflowType: env.workflowType || null,
    state: env.workflowState || null, subState: env.subState || null, operation: env.operation || null,
    tool: p.tool || null, contextSet: env.contextSet || null, latencyMs: n(p.durationMs), code: p.code || null,
    fallbackReason: p.fallbackReason || null,
  };
}

const withDev = (item, env, developer) => (developer ? { ...item, dev: devLine(env) } : item);
const replaceItem = (items, pred, fn) => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (pred(items[i])) { const next = items.slice(); next[i] = fn(items[i]); return next; }
  }
  return null;
};

/** Fold one envelope into the state. Returns a NEW state (or the same one when nothing changes). */
export function streamReducer(state, env, { developer = false, now = Date.now() } = {}) {
  const s = state || initialStreamState();
  if (!env || typeof env !== 'object' || !env.type) return s;
  if (env.visibility && env.visibility !== 'learner' && !developer) return s;
  const key = keyOf(env);
  const seq = n(env.sequence);
  const stored = !env.type.endsWith('.delta') && !env.type.endsWith('.start') && env.type !== 'reply';
  if (stored && seq != null && env.workflowId && seq <= (s.lastSequence[key] ?? -1)) return s;   // replayed
  const p = env.payload || {};
  const nar = env.narration || {};
  let items = s.items;
  let { reply, replyDone, workflow } = s;
  const lastSequence = stored && seq != null && env.workflowId ? { ...s.lastSequence, [key]: seq } : s.lastSequence;

  if (env.workflowId) {
    const status = STATUS_OF[env.type] || workflow?.status || 'active';
    workflow = {
      id: env.workflowId, type: env.workflowType || workflow?.type || null,
      status: ACTIVE_STATUSES.has(workflow?.status) || !workflow ? status : workflow.status,
      state: env.workflowState || workflow?.state || null, subState: env.subState || workflow?.subState || null,
    };
  }
  const push = (item) => { items = [...items, withDev(item, env, developer)]; };
  const id = p.id || itemId(env);

  switch (env.type) {
    case 'agent.narration.start':
      push({ type: 'thinking', id, status: 'running', startedAt: now, ms: 0, text: '', contextSet: env.contextSet || null });
      break;
    case 'agent.narration.delta': {
      const next = replaceItem(items, (b) => b.type === 'thinking' && b.status === 'running', (b) => ({ ...b, text: b.text + txt(p.text) }));
      if (next) items = next; else push({ type: 'thinking', id, status: 'running', startedAt: now, ms: 0, text: txt(p.text), contextSet: env.contextSet || null });
      break;
    }
    case 'agent.narration': {
      const settle = (b) => ({ ...b, status: 'done', ms: n(p.durationMs) ?? n(p.ms) ?? Math.max(0, now - (b.startedAt || now)), text: txt(p.text || p.narration || b.text) });
      const next = replaceItem(items, (b) => b.type === 'thinking' && b.status === 'running', settle);
      if (next) items = next;
      else push({ type: 'thinking', id, status: 'done', ms: n(p.durationMs) ?? 0, text: txt(p.text || p.narration || nar.narration), contextSet: env.contextSet || null });
      break;
    }
    case 'tool.started':
      push({ type: 'tool', id, tool: p.tool || null, status: 'running', ok: null, startedAt: now, ms: null,
        category: p.category || env.pill || 'research', headline: txt(nar.headline || p.headline), description: txt(nar.description || p.description), result: '' });
      break;
    case 'tool.completed':
    case 'tool.failed': {
      const ok = env.type === 'tool.completed' && p.ok !== false;
      const result = txt(env.type === 'tool.failed' ? (nar.result || "Couldn't finish") : (p.resultLine || nar.result || ''));
      const done = (b) => ({ ...b, status: 'done', ok, ms: n(p.durationMs) ?? b.ms, result,
        ...(Array.isArray(p.items) && p.items.length ? { items: p.items.map(String).slice(0, 12) } : {}), ...(developer ? { dev: devLine(env) } : {}) });
      const next = replaceItem(items, (b) => b.type === 'tool' && b.status === 'running' && (b.id === p.id || b.tool === (p.tool || null)), done);
      if (next) items = next;
      else push({ type: 'tool', id, tool: p.tool || null, status: 'done', ok, ms: n(p.durationMs), category: p.category || env.pill || 'research',
        headline: txt(nar.headline || p.headline), description: txt(nar.description), result });
      break;
    }
    case 'decision.rejected':
      // The red verification row: what the harness refused, and why.
      push({ type: 'tool', id, status: 'done', ok: false, ms: null, category: 'verification', verification: true,
        headline: txt(nar.headline || 'Not allowed'), description: txt(nar.description), result: txt(p.reason || nar.result || nar.description) });
      break;
    case 'activity.start':
      push({ type: 'activity', id, status: 'running', text: '' });
      break;
    case 'activity.delta': {
      const next = replaceItem(items, (b) => b.type === 'activity' && b.status === 'running', (b) => ({ ...b, text: b.text + txt(p.text) }));
      items = next || [...items, withDev({ type: 'activity', id, status: 'running', text: txt(p.text) }, env, developer)];
      break;
    }
    case 'activity': {
      const text = txt(p.message || p.text);
      const next = replaceItem(items, (b) => b.type === 'activity' && b.status === 'running', (b) => ({ ...b, status: 'done', text: text || b.text }));
      if (next) items = next; else if (text) push({ type: 'activity', id, text });
      break;
    }
    case 'activity.promote': {
      // That streamed text was the answer: it moves to the reply.
      const idx = items.map((b) => b.type === 'activity' && b.status === 'running').lastIndexOf(true);
      if (idx >= 0) { reply += items[idx].text; items = items.filter((_, i) => i !== idx); }
      break;
    }
    case 'activity.drop':
      items = items.filter((b) => !(b.type === 'activity' && b.status === 'running'));
      break;
    case 'reply.delta':
      reply += txt(p.text);
      break;
    case 'reply':
      reply = txt(p.text) || reply; replyDone = true;
      items = settle(items, now);
      break;
    case 'assessment.completed':
      push({ type: 'score', id, title: txt(p.topicLabel || p.topic || nar.description), score: n(p.score), total: n(p.total),
        percentage: n(p.percentage) ?? (n(p.score) != null && n(p.total) ? Math.round((100 * n(p.score)) / n(p.total)) : null),
        passed: typeof p.passed === 'boolean' ? p.passed : null, kind: p.kind || p.mode || null });
      break;
    case 'decision.proposed':
      if (Array.isArray(p.plan?.topics) || Array.isArray(p.topics)) {
        const topics = (p.plan?.topics || p.topics).slice(0, 20).map((t) => (typeof t === 'string' ? { label: t } : { label: txt(t.label || t.title), minutes: n(t.minutes) }));
        push({ type: 'plan', id, title: txt(p.plan?.title || p.title || 'Your study plan'), topics, coins: n(p.plan?.coins ?? p.coins), status: 'proposed' });
      }
      break;
    case 'learner.action_required':
      push({ type: 'gate', id, action: p.action || null, label: txt(p.label || nar.description || 'Your turn'),
        options: Array.isArray(p.options) ? p.options.slice(0, 4).map((o) => (typeof o === 'string' ? { id: o, label: o } : { id: o.id, label: txt(o.label || o.id) })) : null,
        status: 'waiting' });
      break;
    case 'learner.action_received': {
      const answered = (b) => ({ ...b, status: 'answered', answer: p.choice || p.action || null });
      items = replaceItem(items, (b) => b.type === 'gate' && b.status === 'waiting' && (!p.action || !b.action || b.action === p.action), answered) || items;
      if (p.action === 'approve_plan' || p.action === 'confirm_plan') items = replaceItem(items, (b) => b.type === 'plan' && b.status === 'proposed', (b) => ({ ...b, status: 'approved' })) || items;
      break;
    }
    case 'workflow.handoff_created':
      push({ type: 'handoff', id, childWorkflowId: p.childWorkflowId || p.workflowId || null, childType: p.childType || p.to || 'teaching',
        title: txt(p.topicLabel || p.title || nar.description), status: 'open' });
      break;
    case 'workflow.handoff_completed': {
      const child = p.childWorkflowId || p.workflowId || null;
      items = replaceItem(items, (b) => b.type === 'handoff' && b.status === 'open' && (!child || !b.childWorkflowId || b.childWorkflowId === child),
        (b) => ({ ...b, status: 'completed', outcome: p.outcome || null })) || items;
      break;
    }
    default:
      if (developer && !QUIET.has(env.type)) push({ type: 'tool', id, status: 'done', ok: true, ms: n(p.durationMs), category: 'research', headline: txt(nar.headline || env.type), description: txt(nar.description), result: txt(nar.result) });
      break;
  }
  if (items === s.items && reply === s.reply && replyDone === s.replyDone && workflow === s.workflow && lastSequence === s.lastSequence) return s;
  return { items, reply, replyDone, workflow, lastSequence };
}

/** The turn ended (or stopped): settle anything still running. */
export function settle(items, now = Date.now(), { stopped = false } = {}) {
  return (items || []).map((b) => (b.status === 'running'
    ? { ...b, status: stopped ? 'stopped' : 'done', ...(b.type === 'tool' ? { ok: b.ok ?? !stopped } : {}), ms: b.ms || Math.max(0, now - (b.startedAt || now)) }
    : b));
}

/** Fold a list of envelopes (sorted by sequence within each workflow; live deltas keep arrival order). */
export function reduceStream(envelopes, opts = {}) {
  let state = initialStreamState();
  for (const env of envelopes || []) state = streamReducer(state, env, opts);
  return state;
}
