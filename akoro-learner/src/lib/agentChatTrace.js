/**
 * agentChatTrace.js — the Agent Chat turn trace, as plain data.
 *
 * The server streams a turn as interleaved steps (Grand Plan §13.4):
 *   think_start / think_end   → a "Thought for Ns" row
 *   think_delta               → Think mode: the model's real reasoning summary
 *                               streaming into that row
 *   tool_start / tool_end     → a tool row ("Checking your goals ✓ 120ms")
 *   activity                  → plain text the agent wrote between steps
 *   activity_start/_delta/_end → the same text, streaming word by word
 *   activity_promote          → that streamed text was the answer: it moves
 *                               to the reply (promoteActivity)
 *   activity_drop             → discard streamed text (a failed call)
 *   thinking (delta)          → a reasoning-summary row that streams live (Think mode)
 * and the final reply as `delta` text, which stays on the message itself.
 *
 * This module is pure (no React, no DOM) so the contract test can drive it:
 * it folds events into an ordered list of blocks, groups consecutive tool
 * rows for display, and rebuilds the same blocks from a saved trace.
 */

/** Fold one streamed event into the block list. Returns a NEW array. */
export function applyTraceEvent(blocks, event, data = {}, now = Date.now()) {
  const list = Array.isArray(blocks) ? blocks : [];
  const id = data?.id;
  switch (event) {
    case 'think_start':
      return [...list, { type: 'thinking', id, status: 'running', startedAt: now, ms: 0, text: '' }];
    case 'think_delta':
      return upsert(list, id, (block) => ({
        ...(block || { type: 'thinking', id, status: 'running', startedAt: now, ms: 0 }),
        source: 'reasoning', text: String(block?.text || '') + String(data.text || ''),
      }));
    case 'think_end':
      return upsert(list, id, (block) => ({
        ...(block || { type: 'thinking', id, startedAt: now }),
        status: 'done', ms: Number(data.ms) || 0,
        // The server's final text wins; it falls back to what streamed.
        text: String(data.text || block?.text || ''),
        ...(data.source || block?.source ? { source: data.source || block.source } : {}),
      }));
    case 'tool_start':
      return [...list, {
        type: 'tool', id, status: 'running', startedAt: now, ms: 0,
        category: data.category || 'research', headline: data.headline || '', description: data.description || '',
        ok: null, result: '',
        ...(data.raw ? { raw: { name: data.raw.name || '', args: data.raw.args || '' } } : {}),
      }];
    case 'tool_end':
      return upsert(list, id, (block) => ({
        ...(block || { type: 'tool', id, category: 'research', headline: '', description: '' }),
        status: 'done', ok: data.ok !== false, result: String(data.result || ''), ms: Number(data.ms) || 0,
        ...(Array.isArray(data.items) && data.items.length ? { items: data.items.map(String) } : {}),
        ...(data.change ? { change: data.change } : {}),
        ...(data.raw ? { raw: { ...(block?.raw || {}), output: data.raw.output || '' } } : {}),
      }));
    case 'activity':
      return data?.text ? [...list, { type: 'activity', id, text: String(data.text) }] : list;
    case 'activity_start':
      return [...list, { type: 'activity', id, status: 'running', text: '' }];
    case 'activity_delta':
      return upsert(list, id, (block) => ({
        ...(block || { type: 'activity', id, status: 'running', text: '' }),
        text: String(block?.text || '') + String(data.text || ''),
      }));
    case 'activity_end':
      return data.text || list.find((block) => block.id === id)?.text
        ? upsert(list, id, (block) => ({ ...(block || { type: 'activity', id }), status: 'done', text: String(data.text || block?.text || '') }))
        : list.filter((block) => block.id !== id);
    case 'activity_promote':
    case 'activity_drop':
      return list.filter((block) => block.id !== id);
    case 'thinking': {
      // Reasoning summary deltas (Think mode): extend the live reasoning row,
      // or open one after whatever ran before it.
      const last = list[list.length - 1];
      if (last?.type === 'thinking' && last.source === 'reasoning' && last.status === 'running') {
        return [...list.slice(0, -1), { ...last, text: last.text + String(data.text || '') }];
      }
      return [...list, { type: 'thinking', id: `reasoning_${list.length}`, source: 'reasoning', status: 'running', startedAt: now, ms: 0, text: String(data.text || '') }];
    }
    default:
      return list;
  }
}

function upsert(list, id, update) {
  const index = list.findIndex((block) => block.id === id);
  if (index === -1) return [...list, update(null)];
  const next = list.slice();
  next[index] = update(list[index]);
  return next;
}

/**
 * activity_promote: the streamed words were the answer. Returns the blocks
 * without that activity and its text, which the caller puts on the reply.
 */
export function promoteActivity(blocks, id) {
  const block = (blocks || []).find((item) => item.id === id && item.type === 'activity');
  return { blocks: (blocks || []).filter((item) => item.id !== id), text: block?.text || '' };
}

/** The reply started streaming, the turn ended or was stopped: settle anything still running. */
export function settleRunning(blocks, now = Date.now(), { stopped = false } = {}) {
  return (blocks || []).map((block) => (block.status === 'running'
    ? { ...block, status: stopped ? 'stopped' : 'done', ms: block.ms || Math.max(0, now - (block.startedAt || now)) }
    : block));
}

/** Blocks from a reply's saved trace (reload). Everything is settled. */
export function blocksFromSavedTrace(trace) {
  if (!Array.isArray(trace)) return [];
  return trace
    .filter((block) => block && ['thinking', 'tool', 'activity'].includes(block.type))
    .map(({ raw, ...block }) => ({ ...block, status: 'done' }));
}

/**
 * Display items: consecutive tool rows collapse into one group (the
 * reference's "Ran commands 3"); a lone tool row stays a single row.
 */
export function groupTraceBlocks(blocks) {
  const items = [];
  // Change rows stand alone ("Created a task · …"), like the reference's edit
  // rows; reads and checks group separately ("Read 2 sources", "Checked 3 things").
  const groupable = (block) => block?.type === 'tool' && !block.change;
  const sameKind = (a, b) => (a.category || 'research') === (b.category || 'research');
  for (const block of blocks || []) {
    const prev = items[items.length - 1];
    // Study Prep's steps always fold into their own row, even a single one.
    if (block?.category === 'study_prep' && !(prev?.type === 'group' && prev.tools[0].category === 'study_prep')) {
      items.push({ type: 'group', id: `group_${block.id}`, tools: [block] });
      continue;
    }
    if (groupable(block) && groupable(prev) && sameKind(block, prev)) {
      items[items.length - 1] = { type: 'group', id: `group_${prev.id}`, tools: [prev, block] };
    } else if (groupable(block) && prev?.type === 'group' && sameKind(block, prev.tools[0])) {
      prev.tools = [...prev.tools, block];
    } else {
      items.push(block);
    }
  }
  return items;
}

/** "Checked 3 things" / "Read 2 sources" / "Did 2 things" / "Ran 4 steps". */
export function groupLabel(tools) {
  const count = (tools || []).length;
  const categories = new Set((tools || []).map((tool) => tool.category));
  if (categories.size === 1 && categories.has('research')) return `Checked ${count} things`;
  if (categories.size === 1 && categories.has('read')) return `Read ${count} source${count === 1 ? '' : 's'}`;
  if (categories.size === 1 && categories.has('action')) return `Did ${count} things`;
  if (categories.size === 1 && categories.has('study_prep')) return `Study Prep · ${count} step${count === 1 ? '' : 's'}`;
  return `Ran ${count} steps`;
}

/** "Thought for 3 seconds" — whole seconds, never zero. */
export function thoughtLabel(ms) {
  const seconds = Math.max(1, Math.round((Number(ms) || 0) / 1000));
  return `Thought for ${seconds} second${seconds === 1 ? '' : 's'}`;
}

/** "142ms" / "1.4s" */
export function durationLabel(ms) {
  const value = Number(ms) || 0;
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

const STUDY_PREP_STEP = {
  harness_decision: 'A Study Prep check',
  engine_result: 'The Education Engine scored it',
  human_gate: 'Your decision',
  observation: 'What I noticed',
};

/**
 * A study-prep session's steps (its event log) as trace rows, for the chat
 * turn they happened in: events at or after `from` (ms) and before `to`.
 * The card shows the session; its steps read as part of the agent's work.
 */
export function studyPrepEventBlocks(events, { from = 0, to = Infinity } = {}) {
  return (events || [])
    // What the harness narrated, and what the agent said it was doing.
    .filter((event) => event?.narrative || event?.agentIntent)
    .filter((event) => {
      const at = Date.parse(event.at || '') || 0;
      return at >= from && at < to;
    })
    .map((event) => {
      // The agent's own words: shown as "agent says:", never as a harness fact.
      const said = !event.narrative && event.agentIntent;
      return {
        type: 'tool', id: `study_prep_${event.sequence}`, status: 'done', ok: true,
        // Real recorded durations only — never a made-up one.
        ms: event.durationMs != null ? event.durationMs : null,
        category: 'study_prep',
        headline: said ? `agent says: ${event.agentIntent}` : event.narrative,
        description: said ? 'What I said I would do' : (STUDY_PREP_STEP[event.eventType] || 'A Study Prep step'),
        result: said ? event.agentIntent : event.narrative,
      };
    });
}

/**
 * A workflow's v3 events (Phase 3) as trace rows, for the chat turn they
 * happened in: the narrator's headline and detail, real durations only.
 * Lifecycle-only events (created, moved) are not rows.
 */
const QUIET_TYPES = new Set(['workflow.created', 'workflow.started', 'workflow.state_changed', 'tool.started', 'decision.accepted']);
export function workflowEventBlocks(events, { from = 0, to = Infinity } = {}) {
  return (events || [])
    .filter((event) => event?.narration?.headline && !(QUIET_TYPES.has(event.type) && !event.payload?.narrative))
    .filter((event) => {
      const at = Date.parse(event.timestamp || '') || 0;
      return at >= from && at < to;
    })
    .map((event) => ({
      type: 'tool', id: `wf_${event.workflowId}_${event.sequence}`, status: 'done', ok: event.type !== 'tool.failed' && event.type !== 'decision.rejected',
      ms: event.payload?.durationMs != null ? event.payload.durationMs : null,
      category: 'study_prep',
      headline: event.narration.headline,
      description: event.narration.description || '',
      result: event.narration.result || '',
    }));
}

/**
 * The workflow card's step list (Phase 3, the card streams the workflow's
 * state; the chat's own steps stay outside it). A tool step shows running
 * from its start until its result; a decision, check or result is a done
 * step; a rejection or failed tool is failed. Lifecycle moves aren't steps.
 * `running` false settles any step left open (the workflow isn't working now).
 */
const CARD_SKIP = new Set(['workflow.created', 'workflow.started', 'workflow.state_changed', 'decision.proposed', 'decision.fallback', 'operation.started', 'context.loaded']);
export const AI_DRAFTED_TAG = "AI-drafted — not your school's official syllabus";
export function workflowCardSteps(events, { running = true } = {}) {
  const steps = [];
  for (const event of events || []) {
    if (!event?.narration?.headline || CARD_SKIP.has(event.type)) continue;
    const p = event.payload || {};
    const base = {
      id: `wf_${event.sequence}`, headline: event.narration.headline, description: event.narration.description || '',
      result: event.narration.result || '', ms: p.durationMs ?? null,
      ...(p.decisionNode === 'syllabus_generated' ? { tag: AI_DRAFTED_TAG } : {}),
      // Why the agent took this step (its stated intent) — sanitised and capped server-side.
      ...(p.intent ? { why: String(p.intent) } : {}),
    };
    if (event.type === 'tool.started') { steps.push({ ...base, tool: p.tool || null, status: 'running', result: '' }); continue; }
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const open = [...steps].reverse().find((s) => s.status === 'running' && s.tool === (p.tool || null));
      const status = event.type === 'tool.failed' ? 'failed' : 'done';
      if (open) Object.assign(open, { status, ms: base.ms ?? open.ms, result: base.result, ...(base.tag ? { tag: base.tag } : {}), ...(base.why && !open.why ? { why: base.why } : {}) });
      else steps.push({ ...base, tool: p.tool || null, status });
      continue;
    }
    steps.push({ ...base, status: event.type === 'decision.rejected' ? 'failed' : 'done' });
  }
  if (!running) for (const s of steps) if (s.status === 'running') s.status = 'done';
  return steps;
}

/** The card's header for a Study Prep session state. */
export function studyPrepCardHead(status, activeTopicLabel = null) {
  switch (status) {
    case 'planning': case 'replanning': return { title: 'Building your study plan', badge: 'Planning', tone: 'live' };
    case 'awaiting_confirmation': return { title: 'Your study plan', badge: 'Waiting for you', tone: 'wait' };
    case 'topic_active': return { title: activeTopicLabel ? `Studying: ${activeTopicLabel}` : 'Studying', badge: 'In progress', tone: 'live' };
    case 'paused': return { title: 'Study plan paused', badge: 'Paused', tone: 'wait' };
    case 'completed': return { title: 'Study plan done', badge: 'Done', tone: 'done' };
    default: return { title: 'Study plan stopped', badge: 'Stopped', tone: 'done' };
  }
}
