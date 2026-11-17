/**
 * AgentPromptsPage — admin-editable prompt parts (Grand Plan Phase 18 item 7).
 *
 * The parts are the akoro-agent/ files the agent loads (persona, channel and
 * runtime prompts). An edit is stored as an override of one part and records
 * the default it was based on; when a deploy changes that default the part
 * reads "Default updated" with the difference, and the admin keeps their text
 * or takes the new one. Code-enforced rules (gates, policies, verdicts, tool
 * checks) are code, not prompt text, and are not here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, RotateCcw, Save, History, AlertTriangle, Layers } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Toast, PageSkeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPut } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, FONT } from '../constants.js';

const STATUS = {
  default: { label: 'Default', color: MUTED2 },
  overridden: { label: 'Edited', color: PURPLE },
  default_updated: { label: 'Default updated', color: AMBER },
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** A line diff (LCS) — enough for a prompt file of a few hundred lines. */
function lineDiff(a, b) {
  const x = String(a ?? '').split('\n');
  const y = String(b ?? '').split('\n');
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out;
}

function Diff({ from, to }) {
  const rows = useMemo(() => lineDiff(from, to), [from, to]);
  return (
    <pre style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.5, margin: 0, padding: 10, background: LIGHT, borderRadius: 8, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
      {rows.filter((r) => r.op !== ' ').length === 0 && <span style={{ color: MUTED }}>No difference</span>}
      {rows.map((r, k) => r.op === ' ' ? null : (
        <div key={k} style={{ background: r.op === '+' ? '#ECFDF5' : '#FEF2F2', color: r.op === '+' ? '#065F46' : '#991B1B' }}>{r.op} {r.text}</div>
      ))}
    </pre>
  );
}

const btn = (bg, color = WHITE) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: bg === WHITE ? `1px solid ${BORDER}` : 'none', background: bg, color, cursor: 'pointer' });

export default function AgentPromptsPage() {
  const [parts, setParts] = useState([]);
  const [sets, setSets] = useState([]);
  const [filter, setFilter] = useState('');
  const [file, setFile] = useState(null);
  const [part, setPart] = useState(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [hist, setHist] = useState(null);
  const [assembled, setAssembled] = useState(null);
  const [setName, setSetName] = useState('');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([apiGet('/api/admin/agent-prompts'), apiGet('/api/admin/agent-prompts/sets')]);
      setParts(p.parts ?? []); setSets(s.sets ?? []); setError(null);
    } catch (e) { setError(e.message || 'Could not load the prompt parts'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  async function open(f) {
    setFile(f); setHist(null); setAssembled(null);
    try {
      const r = await apiGet(`/api/admin/agent-prompts/part?file=${encodeURIComponent(f)}`);
      setPart(r.part); setDraft(r.part.override?.text ?? r.part.default.text); setNote('');
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  async function act(fn, okMessage) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.part) { setPart(r.part); setDraft(r.part.override?.text ?? r.part.default.text); }
      setToast({ type: 'success', message: okMessage });
      loadList();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setBusy(false); }
  }

  const save = () => act(() => apiPut('/api/admin/agent-prompts/part', { file, text: draft, note: note || null }), 'Saved — the agent uses it from the next call');
  const reset = () => act(() => apiPost('/api/admin/agent-prompts/part/reset', { file }), 'Back to the default');
  const keepMine = () => act(() => apiPost('/api/admin/agent-prompts/part/keep-mine', { file }), 'Kept your text');
  const useNew = () => act(() => apiPost('/api/admin/agent-prompts/part/use-new-default', { file }), 'Using the new default');
  async function showHistory() {
    try { setHist((await apiGet(`/api/admin/agent-prompts/history?file=${encodeURIComponent(file)}`)).history ?? []); }
    catch (e) { setToast({ type: 'error', message: e.message }); }
  }
  async function showAssembled(name, source = 'effective') {
    setSetName(name);
    if (!name) { setAssembled(null); return; }
    try { setAssembled((await apiGet(`/api/admin/agent-prompts/assembled?set=${encodeURIComponent(name)}&source=${source}`)).prompt); }
    catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  const shown = parts.filter((p) => !filter || p.file.toLowerCase().includes(filter.toLowerCase()) || p.sets.some((s) => s.includes(filter.toLowerCase())));
  const flagged = parts.filter((p) => p.status === 'default_updated').length;
  const dirty = part && draft !== (part.override?.text ?? part.default.text);

  return (
    <PageLayout title="Agent prompts" subtitle="Persona and runtime prompt text — edit, compare, reset">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, fontFamily: FONT, fontSize: 13, color: INK, lineHeight: 1.5 }}>
        <AlertTriangle size={16} color={AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          An edit changes what every learner's agent is told, from the next model call. Gates, policies, verdicts and
          tool checks are enforced in code and are not editable here. Placeholders like <code>{'{{agentName}}'}</code> must stay — the code fills them.
          {flagged > 0 && <div style={{ marginTop: 4, color: AMBER, fontWeight: 700 }}>{flagged} part{flagged > 1 ? 's have' : ' has'} a new default since it was edited.</div>}
        </div>
      </div>
      {error && <div style={{ color: RED, fontFamily: FONT, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by file or set"
                 style={{ width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 8 }} />
          <div style={{ maxHeight: 560, overflow: 'auto' }}>
            {loading && parts.length === 0 && <PageSkeleton header={false} rows={5} />}
            {shown.map((p) => (
              <button key={p.file} onClick={() => open(p.file)}
                      style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 8, alignItems: 'center', padding: '7px 8px', borderRadius: 8, border: 'none', cursor: 'pointer', background: p.file === file ? LIGHT : 'transparent' }}>
                <FileText size={14} color={MUTED2} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file}</span>
                {p.status !== 'default' && <span style={{ fontFamily: FONT, fontSize: 10.5, fontWeight: 700, color: STATUS[p.status].color, whiteSpace: 'nowrap' }}>{STATUS[p.status].label}</span>}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: '3 1 420px', minWidth: 0, display: 'grid', gap: 14 }}>
          {!part && <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, padding: 20 }}>Pick a part to read or edit it.</div>}
          {part && (
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: INK, flex: 1 }}>{part.file}</span>
                <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: STATUS[part.status].color }}>{STATUS[part.status].label}</span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginTop: 4 }}>
                Loaded by: {part.sets.join(', ')}{part.tokens.length > 0 && <> · placeholders: {part.tokens.map((t) => `{{${t}}}`).join(' ')}</>}
                {part.override?.updated_at && <> · edited {when(part.override.updated_at)}</>}
              </div>

              {part.status === 'default_updated' && (
                <div style={{ marginTop: 12, padding: 12, border: `1px solid ${AMBER}55`, background: '#FFFBEB', borderRadius: 10, display: 'grid', gap: 8 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK }}>Default updated — a deploy changed the text your edit was based on. Your text is still in use.</div>
                  <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED }}>What changed in the default:</div>
                  <Diff from={part.based_on?.text} to={part.default.text} />
                  <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED }}>Your text against the new default:</div>
                  <Diff from={part.default.text} to={part.override?.text} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button disabled={busy} onClick={keepMine} style={btn(PURPLE)}>Keep mine</button>
                    <button disabled={busy} onClick={useNew} style={btn(WHITE, INK)}>Use the new default</button>
                  </div>
                </div>
              )}

              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
                        style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, minHeight: 320, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5, padding: 10, borderRadius: 8, border: `1px solid ${BORDER}`, color: INK, resize: 'vertical' }} />
              <div style={{ fontFamily: FONT, fontSize: 11, color: MUTED2, marginTop: 4 }}>{new TextEncoder().encode(draft).length} / 8192 bytes</div>
              {dirty && (
                <>
                  <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, margin: '10px 0 4px' }}>Your change against the default:</div>
                  <Diff from={part.default.text} to={draft} />
                </>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (kept in the history)"
                       style={{ flex: '1 1 200px', fontFamily: FONT, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}` }} />
                <button disabled={busy || !dirty} onClick={save} style={{ ...btn(dirty ? GREEN : LIGHT, dirty ? WHITE : MUTED2), cursor: dirty ? 'pointer' : 'not-allowed' }}><Save size={14} /> Save</button>
                <button disabled={busy || !part.override} onClick={reset} style={{ ...btn(WHITE, part.override ? INK : MUTED2), cursor: part.override ? 'pointer' : 'not-allowed' }}><RotateCcw size={14} /> Reset to default</button>
                <button onClick={showHistory} style={btn(WHITE, INK)}><History size={14} /> History</button>
              </div>
              {hist && (
                <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                  {hist.length === 0 && <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED }}>No changes yet.</div>}
                  {hist.map((h) => (
                    <div key={h.id} style={{ fontFamily: FONT, fontSize: 12, color: INK, padding: '6px 10px', background: LIGHT, borderRadius: 8 }}>
                      <b>{h.action.replace(/_/g, ' ')}</b> · {when(h.created_at)}{h.note ? ` · ${h.note}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Layers size={16} color={MUTED} />
              <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: INK, flex: 1 }}>Full assembled prompt</span>
              <select value={setName} onChange={(e) => showAssembled(e.target.value)}
                      style={{ fontFamily: FONT, fontSize: 13, padding: '7px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE }}>
                <option value="">Choose a persona or chat role…</option>
                {sets.map((s) => <option key={s.set} value={s.set}>{s.set}</option>)}
              </select>
            </div>
            {assembled && (
              <>
                <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginTop: 6 }}>
                  {assembled.consumer} · {assembled.files.filter((f) => f.overridden).length} edited part(s). Placeholders are filled per call; the chat adds time, memory and grounding.
                </div>
                <pre style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.5, marginTop: 8, padding: 10, background: LIGHT, borderRadius: 8, maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{assembled.text}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
