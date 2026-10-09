/**
 * agentChatTrace.js — the Agent Chat turn trace, as plain data.
 *
 * The server streams a turn as interleaved steps (Grand Plan §13.4):
 *   think_start / think_end   → a "Thought for Ns" row
 *   think_delta               → Think mode: the model's real reasoning summary
 *                               streaming into that row
 *   tool_start / tool_end     → a tool row ("Checking your goals ✓ 120ms")
 *   activity                  → plain text the agent wrote between steps
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
      }];
    case 'tool_end':
      return upsert(list, id, (block) => ({
        ...(block || { type: 'tool', id, category: 'research', headline: '', description: '' }),
        status: 'done', ok: data.ok !== false, result: String(data.result || ''), ms: Number(data.ms) || 0,
      }));
    case 'activity':
      return data?.text ? [...list, { type: 'activity', id, text: String(data.text) }] : list;
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
    .map((block) => ({ ...block, status: 'done' }));
}

/**
 * Display items: consecutive tool rows collapse into one group (the
 * reference's "Ran commands 3"); a lone tool row stays a single row.
 */
export function groupTraceBlocks(blocks) {
  const items = [];
  for (const block of blocks || []) {
    const prev = items[items.length - 1];
    if (block.type === 'tool' && prev?.type === 'tool') {
      items[items.length - 1] = { type: 'group', id: `group_${prev.id}`, tools: [prev, block] };
    } else if (block.type === 'tool' && prev?.type === 'group') {
      prev.tools = [...prev.tools, block];
    } else {
      items.push(block);
    }
  }
  return items;
}

/** "Checked 3 things" / "Did 2 things" / "Ran 4 steps". */
export function groupLabel(tools) {
  const count = (tools || []).length;
  const categories = new Set((tools || []).map((tool) => tool.category));
  if (categories.size === 1 && categories.has('research')) return `Checked ${count} things`;
  if (categories.size === 1 && categories.has('action')) return `Did ${count} things`;
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
