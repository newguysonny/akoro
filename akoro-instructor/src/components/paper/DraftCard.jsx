/*
 * DraftCard — what the instructor chat shows for a prepared draft: a short
 * summary and a Preview button, never the questions themselves.
 *
 *   [V2] Photosynthesis — assignment
 *        6 questions (4 MCQ · 2 Theory) · 24 marks · JSS 2 · due Fri 1 PM
 *        [👁 Preview]
 *
 * An assignment's version is written in the background, so the card shows
 * "Drafting questions…" and looks again every few seconds until it's ready.
 */
import { useEffect, useState } from 'react';
import { Eye, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiGet } from '../../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, PURPLE, RED, FONT } from '../../constants.js';

const POLL_MS = 4000;
const POLL_FOR_MS = 5 * 60 * 1000;

const fmtDue = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function DraftCard({ preview, state = null, label = 'Preview', onOpen, onDraft }) {
  const versioned = preview.type === 'assignment' && !!preview.version;
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

  const v = (draft?.payload?.versions || []).find((x) => x.n === preview.version);
  const due = draft?.payload?.due_at ? fmtDue(draft.payload.due_at) : draft?.payload?.due_hint || '';
  const audience = draft?.audience?.label || preview.audience || '';

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: WHITE, padding: '10px 12px', maxWidth: 380, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {versioned && <span style={{ fontSize: 10.5, fontWeight: 900, color: PURPLE, background: '#F1ECFF', borderRadius: 6, padding: '2px 7px' }}>V{preview.version}</span>}
        <span style={{ fontSize: 13, fontWeight: 800, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.title}</span>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {!versioned ? <span>{[audience, due].filter(Boolean).join(' · ') || 'Ready to preview'}</span>
          : !v || v.status === 'drafting' ? <><Loader2 size={11} color={PURPLE} style={{ animation: 'spin .8s linear infinite' }} /> Drafting questions…</>
          : v.status === 'failed' ? <span style={{ color: RED, display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> Couldn't draft the questions — open to try again</span>
          : <span>{[v.summary?.line, audience, due && `due ${due}`].filter(Boolean).join(' · ')}{v.basedOn && v.note ? <><br />{v.note}</> : null}</span>}
      </div>
      {versioned && v?.warning && <div style={{ fontSize: 11, color: '#B45309', fontWeight: 700, marginTop: 4 }}><AlertTriangle size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />{v.warning}</div>}
      <div style={{ marginTop: 8 }}>
        <button type="button" disabled={!!state} onClick={() => onOpen(preview.id, versioned ? preview.version : null)}
          title={state ? undefined : 'Preview this draft — assigning is your call'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 9, cursor: state ? 'default' : 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 800,
            border: state === 'assigned' ? '1px solid #BBF7D0' : state === 'discarded' ? `1px solid ${BORDER}` : 'none',
            background: state === 'assigned' ? '#DCFCE7' : state === 'discarded' ? LIGHT : PURPLE,
            color: state === 'assigned' ? GREEN : state === 'discarded' ? MUTED2 : WHITE }}>
          {state === 'assigned' ? <><CheckCircle2 size={12} /> Assigned ✓</> : state === 'discarded' ? 'Discarded' : <><Eye size={12} /> {label}</>}
        </button>
      </div>
    </div>
  );
}
