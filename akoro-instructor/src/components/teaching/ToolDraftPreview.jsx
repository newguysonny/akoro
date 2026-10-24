/**
 * ToolDraftPreview — a teaching resource's draft, one tab per version.
 *
 *   V1 | V2 ⋯            a tab per round with the agent; ⋯ while it is being written
 *   ✨ Version 2 — …      what that round changed
 *   [the resource]        drawn exactly as it will look in the Library
 *
 * Changes are asked for in the chat (each becomes the next version, built from the one on
 * screen); Save to Library (in the panel's footer) keeps the version on screen.
 */
import { PURPLE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { ResultHeader, ResultEntries, accentFor } from './ToolResult.jsx';

export const toolVersionsOf = (draft) => (Array.isArray(draft?.payload?.versions) ? draft.payload.versions : []);

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
    </button>
  );
}

export default function ToolDraftPreview({ draft, selected, onSelect, onRetry, busy = false, toolName = '', toolEmoji = '' }) {
  const versions = toolVersionsOf(draft);
  const v = versions.find((x) => x.n === selected) || versions.at(-1);
  if (!v) return null;
  const accent = accentFor(draft.payload?.tool);

  return (
    <div style={{ fontFamily: C.font }}>
      <div role="tablist" aria-label="Versions" style={{ display: 'flex', gap: 3, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
        {versions.map((x) => <Tab key={x.n} v={x} on={x.n === v.n} onClick={() => onSelect(x.n)} />)}
      </div>

      {v.status === 'drafting' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '40px 12px', color: C.muted, textAlign: 'center' }}>
          <Ico ti="ti-loader-2" size={20} color={PURPLE} style={{ animation: 'spin .8s linear infinite' }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Writing version {v.n}…</div>
          <div style={{ fontSize: 12, maxWidth: 360, lineHeight: 1.5 }}>“{v.request}” — usually ready within a minute. You can keep chatting meanwhile.</div>
        </div>
      ) : v.status === 'failed' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '36px 12px', textAlign: 'center' }}>
          <Ico ti="ti-alert-triangle" size={20} color={RED} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Version {v.n} couldn't be written</div>
          <div style={{ fontSize: 12, color: C.muted }}>{v.error || 'Something went wrong.'}</div>
          <button type="button" onClick={() => onRetry(v.n)} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, fontFamily: C.font, fontSize: 12, fontWeight: 800, cursor: 'pointer', color: C.ink }}>
            <Ico ti="ti-rotate" size={12} /> Try again
          </button>
        </div>
      ) : (
        <>
          {v.note && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 11px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
              <Ico ti="ti-sparkles" size={13} color={PURPLE} style={{ marginTop: 2, flexShrink: 0 }} />
              <span><b style={{ color: C.ink }}>Version {v.n}</b>{v.basedOn ? <> — from V{v.basedOn}</> : null}: {v.note}
                {v.basedOn && v.request ? <> “{v.request}”</> : null}</span>
            </div>
          )}
          <ResultHeader data={v.result} accent={accent} icon={toolEmoji} name={toolName} />
          <ResultEntries data={v.result} accent={accent} />
        </>
      )}
    </div>
  );
}
