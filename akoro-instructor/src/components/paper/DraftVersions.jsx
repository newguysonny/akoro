/*
 * DraftVersions — an assignment draft's questions, one tab per version.
 *
 *   V1 · edited | V2 | V3 ⋯        a tab per AI round; ⋯ while drafting
 *   ✨ Version 2 — Q4 made harder…   what that round changed (and any miss
 *                                     against the request, as a warning)
 *   [Edit | Paper preview]           the paper as learners' reads, the new
 *                                     and changed questions highlighted
 *
 * Changes are asked for in the chat (each one becomes the next version);
 * the teacher's own edits here change the version on screen and mark it
 * "edited". Assign (in the panel's footer) sends the version on screen.
 */
import { useEffect, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { GREEN, PURPLE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import PaperFrame from './PaperFrame.jsx';
import { apiBlob } from '../../services/api.js';

import PaperBuilder from './PaperBuilder.jsx';
import { rowsFromQuestions, cleanPaper } from '../activities/ActivityForm.jsx';

export const versionsOf = (draft) => (Array.isArray(draft?.payload?.versions) ? draft.payload.versions : []);

function Tab({ v, on, onClick }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick}
      style={{ padding: '7px 13px', borderRadius: '9px 9px 0 0', position: 'relative', top: 1,
        borderTop: `1px solid ${on ? C.border : 'transparent'}`, borderLeft: `1px solid ${on ? C.border : 'transparent'}`, borderRight: `1px solid ${on ? C.border : 'transparent'}`, borderBottom: 'none',
        background: on ? C.surface : 'transparent', color: on ? PURPLE : v.status === 'failed' ? RED : C.muted, cursor: 'pointer', fontFamily: C.font, fontSize: 12.5, fontWeight: 800,
        display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      V{v.n}
      {v.status === 'drafting' && <Ico ti="ti-loader-2" size={11} style={{ animation: 'spin .8s linear infinite' }} />}
      {v.status === 'failed' && <Ico ti="ti-alert-triangle" size={11} />}
      {v.edited && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.brand }}>· edited</span>}
    </button>
  );
}

/** A ready version as the server's paper (the template), with or without the key. */
function VersionPaper({ draftId, v, showKey }) {
  const [html, setHtml] = useState(null);
  const [err, setErr] = useState(false);
  const stamp = v.editedAt || v.readyAt || '';
  useEffect(() => {
    let live = true;
    setErr(false);
    apiBlob(`/api/self-study/drafts/${draftId}/paper.html?version=${v.n}&embed=1${showKey ? '&key=1' : ''}`)
      .then((b) => b.text()).then((t) => { if (live) setHtml(t); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [draftId, v.n, showKey, stamp]);
  if (err) return <div style={{ fontSize: 12, color: C.muted, padding: 12 }}>Couldn't load the paper — try again.</div>;
  return <PaperFrame html={html} title={`Version ${v.n}`} />;
}

export default function DraftVersions({ draft, selected, onSelect, onSave, onRetry, busy = false, editing, setEditing }) {
  const versions = versionsOf(draft);
  const v = versions.find((x) => x.n === selected) || versions.at(-1);
  const [showKey, setShowKey] = useState(true);
  const [rows, setRows] = useState(null);       // the builder's state while editing
  const [saveErr, setSaveErr] = useState('');

  // Start (or restart) editing from the version on screen.
  useEffect(() => {
    if (editing && v?.paper) {
      setRows({ questions: rowsFromQuestions(v.paper.questions), sections: v.paper.sections ?? [], passages: v.paper.passages ?? [] });
      setSaveErr('');
    } else if (!editing) setRows(null);
  }, [editing, v?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return null;
  const payload = draft.payload || {};

  const save = async () => {
    const clean = cleanPaper(rows);
    if (!clean.questions.length) return setSaveErr('Keep at least one complete question.');
    setSaveErr('');
    try { await onSave(v.n, { ...clean, instructions: v.paper?.instructions }); setEditing(false); }
    catch (e) { setSaveErr(e?.message || 'Could not save the changes.'); }
  };

  return (
    <div style={{ fontFamily: C.font }}>
      <div role="tablist" aria-label="Versions" style={{ display: 'flex', gap: 3, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
        {versions.map((x) => <Tab key={x.n} v={x} on={x.n === v.n} onClick={() => { if (!editing) onSelect(x.n); }} />)}
      </div>

      {v.status === 'drafting' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '40px 12px', color: C.muted, textAlign: 'center' }}>
          <Ico ti="ti-loader-2" size={20} color={PURPLE} style={{ animation: 'spin .8s linear infinite' }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Drafting version {v.n}…</div>
          <div style={{ fontSize: 12, maxWidth: 360, lineHeight: 1.5 }}>“{v.request}” — usually ready within a minute. You can keep chatting meanwhile.</div>
        </div>
      ) : v.status === 'failed' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '36px 12px', textAlign: 'center' }}>
          <Ico ti="ti-alert-triangle" size={20} color={RED} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Version {v.n} couldn't be drafted</div>
          <div style={{ fontSize: 12, color: C.muted }}>{v.error || 'Something went wrong.'}</div>
          <button type="button" onClick={() => onRetry(v.n)} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, fontFamily: C.font, fontSize: 12, fontWeight: 800, cursor: 'pointer', color: C.ink }}>
            <Ico ti="ti-rotate" size={12} /> Try again
          </button>
        </div>
      ) : (
        <>
          {/* What this round changed, and anything it missed */}
          {v.note && !editing && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 11px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
              <Ico ti="ti-sparkles" size={13} color={PURPLE} style={{ marginTop: 2, flexShrink: 0 }} />
              <span><b style={{ color: C.ink }}>Version {v.n}</b>
                {v.basedOn ? <> — from {versions.find((x) => x.n === v.basedOn)?.edited ? 'your edited ' : ''}V{v.basedOn}</> : null}: {v.note}
                {v.edited && <span style={{ color: C.brand, fontWeight: 700 }}> · you edited this version</span>}
              </span>
            </div>
          )}
          {v.warning && !editing && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 11px', borderRadius: 10, background: C.brandSoft, border: '1px solid #FED7AA', fontSize: 12, fontWeight: 700, color: '#B45309', lineHeight: 1.5, marginBottom: 8 }}>
              <Ico ti="ti-alert-triangle" size={13} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>Not quite what you asked for: {v.warning} Ask in the chat to fix it, or edit it yourself.</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}` }}>
              {[['edit', Pencil, 'ti-pencil', `Edit V${v.n}`], ['paper', Eye, 'ti-eye', 'Paper preview']].map(([k, Icon, ti, label]) => {
                const on = (k === 'edit') === !!editing;
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => setEditing(k === 'edit')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: C.font, fontSize: 11.5, fontWeight: 800,
                      background: on ? C.surface : 'transparent', color: on ? C.ink : C.muted, boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
                    <Ico ti={ti} size={12} /> {label}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{v.summary?.line}</span>
            {!editing && (
              <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.muted, cursor: 'pointer' }}>
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} style={{ accentColor: GREEN }} /> Show answer key
              </label>
            )}
          </div>

          {editing && rows ? (
            <>
              <PaperBuilder questions={rows.questions} sections={rows.sections} passages={rows.passages} assignment embedded
                title={payload.topic} instructions={v.paper?.instructions}
                onChange={(patch) => setRows((r) => ({ ...r, ...patch }))} />
              {saveErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 8 }}>{saveErr}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" onClick={() => setEditing(false)} disabled={busy}
                  style={{ padding: '8px 13px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontFamily: C.font, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={save} disabled={busy}
                  style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: PURPLE, color: '#fff', fontFamily: C.font, fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {busy && <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} />} Save to V{v.n}
                </button>
              </div>
            </>
          ) : (
            <VersionPaper draftId={draft.id} v={v} showKey={showKey} />
          )}
          {!editing && (v.paper?.questions || []).some((q) => q.figure_note && !q.figure) && (
            <div style={{ fontSize: 11.5, color: C.brand, fontWeight: 700, marginTop: 8 }}>Some questions need a figure — add it in Edit before assigning.</div>
          )}
        </>
      )}
      {!editing && v.status === 'ready' && (
        <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>Want changes? Ask in the chat — each round becomes a new version.</div>
      )}
    </div>
  );
}
