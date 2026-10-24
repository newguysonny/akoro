/*
 * DraftCard — what the instructor chat shows for a prepared draft: a short
 * summary and a Preview button, never the questions themselves.
 *
 *   [V2] Photosynthesis — assignment
 *        6 questions (4 MCQ · 2 Theory) · 24 marks · JSS 2 · due Fri 1 PM
 *        [👁 Preview]
 *
 * An assignment's (or teaching resource's) version is written in the background, so the card shows
 * "Drafting…" and looks again every few seconds until it's ready. A resource that was saved
 * shows "Saved to Library · Open" — the link to its page.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../../services/api.js';
import { GREEN, PURPLE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const POLL_MS = 4000;
const POLL_FOR_MS = 5 * 60 * 1000;

const fmtDue = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function DraftCard({ preview, state = null, label = 'Preview', onOpen, onDraft, outputId = null, onOpenOutput }) {
  const isTool = preview.type === 'teaching_tool';
  const versioned = (preview.type === 'assignment' || isTool) && !!preview.version;
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (state) return undefined;
    let dead = false;
    const started = Date.now();
    let timer = null;
    const look = () => apiGet(`/api/self-study/drafts/${preview.id}`).then((d) => {
      if (dead) return;
      const next = d?.data?.draft ?? d?.draft ?? null;
      setDraft(next);
      if (next) onDraft?.(next);
      const v = (next?.payload?.versions || []).find((x) => x.n === preview.version);
      if (versioned && v?.status === 'drafting' && Date.now() - started < POLL_FOR_MS) timer = setTimeout(look, POLL_MS);
    }).catch(() => { if (!dead && Date.now() - started < POLL_FOR_MS) timer = setTimeout(look, POLL_MS * 2); });
    look();
    return () => { dead = true; clearTimeout(timer); };
  }, [preview.id, preview.version, versioned, state]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A card the page has not just resolved still knows how its draft ended (a reload, another tab).
  const resolved = state || (draft?.status === 'assigned' ? (isTool ? 'saved' : 'assigned') : draft?.status === 'discarded' ? 'discarded' : null);
  const savedId = outputId || draft?.assignment_id || null;
  const v = (draft?.payload?.versions || []).find((x) => x.n === preview.version);
  const due = draft?.payload?.due_at ? fmtDue(draft.payload.due_at) : draft?.payload?.due_hint || '';
  const audience = draft?.audience?.label || preview.audience || '';

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: '10px 12px', maxWidth: 380, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {versioned && <span style={{ fontSize: 10.5, fontWeight: 900, color: PURPLE, background: '#F1ECFF', borderRadius: 6, padding: '2px 7px' }}>V{preview.version}</span>}
        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.title}</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {!versioned ? <span>{[audience, due].filter(Boolean).join(' · ') || 'Ready to preview'}</span>
          : !v || v.status === 'drafting' ? <><Ico ti="ti-loader-2" size={11} color={PURPLE} style={{ animation: 'spin .8s linear infinite' }} /> {isTool ? 'Writing it…' : 'Drafting questions…'}</>
          : v.status === 'failed' ? <span style={{ color: RED, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-alert-triangle" size={11} /> Couldn't draft it — open to try again</span>
          : <span>{[v.summary?.line, audience, due && `due ${due}`].filter(Boolean).join(' · ')}{v.basedOn && v.note ? <><br />{v.note}</> : null}</span>}
      </div>
      {versioned && v?.warning && <div style={{ fontSize: 11, color: '#B45309', fontWeight: 700, marginTop: 4 }}><Ico ti="ti-alert-triangle" size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />{v.warning}</div>}
      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {resolved === 'saved' && savedId ? (
          <button type="button" onClick={() => onOpenOutput?.(savedId)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: C.font, fontSize: 11.5, fontWeight: 800, border: '1px solid #BBF7D0', background: '#DCFCE7', color: GREEN }}>
            <Ico ti="ti-circle-check" size={12} /> Saved to Library · Open
          </button>
        ) : (
        <button type="button" disabled={!!resolved} onClick={() => onOpen(preview.id, versioned ? preview.version : null)}
          title={resolved ? undefined : isTool ? 'Preview this draft — saving it to the Library is your call' : 'Preview this draft — assigning is your call'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 9, cursor: resolved ? 'default' : 'pointer', fontFamily: C.font, fontSize: 11.5, fontWeight: 800,
            border: resolved === 'assigned' ? '1px solid #BBF7D0' : resolved === 'discarded' ? `1px solid ${C.border}` : 'none',
            background: resolved === 'assigned' ? '#DCFCE7' : resolved === 'discarded' ? C.bg : PURPLE,
            color: resolved === 'assigned' ? GREEN : resolved === 'discarded' ? C.muted2 : '#fff' }}>
          {resolved === 'assigned' ? <><Ico ti="ti-circle-check" size={12} /> Assigned ✓</> : resolved === 'discarded' ? 'Discarded' : <><Ico ti="ti-eye" size={12} /> {label}</>}
        </button>
        )}
      </div>
    </div>
  );
}
