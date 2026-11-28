// The Final check strip (2026-11-28, Matt's design): when every part of a
// teach session has been taught, the session's verdict is an end-of-session
// check — NaNa asks one question per part, the protégé answers only from
// what it was taught, each part lands HELD or GAP. The strip is its OWN
// strip, stacked directly above the material strip (never shared with it);
// it opens into a panel where the asking and answering run, and collapses
// back to one line. A gap's only action is Re-teach: the chat returns to
// that part, and the part is re-checked once it is taught again.
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../../constants.js';

const FONT = "'Nunito',sans-serif";
const GREEN = '#22B573';
const AMBER = '#D9930D';

const STATUS_TAG = {
  held:      { label: 'HELD',       color: GREEN },
  gap:       { label: 'GAP',        color: AMBER },
  asking:    { label: 'ASKING',     color: BRAND },
  waiting:   { label: 'WAITING',    color: 'var(--ak-text-sub)' },
  reteaching:{ label: 'RE-TEACHING', color: BRAND },
};

function StatusIcon({ status }) {
  if (status === 'held')
    return <span className="ti ti-circle-check" style={{ fontSize: 17, color: GREEN, flexShrink: 0 }} />;
  if (status === 'gap')
    return <span className="ti ti-alert-circle" style={{ fontSize: 17, color: AMBER, flexShrink: 0 }} />;
  if (status === 'asking')
    return <span className="ti ti-loader-2" style={{ fontSize: 16, color: BRAND, animation: 'tam-spin 1s linear infinite', flexShrink: 0 }} />;
  if (status === 'reteaching')
    return <span className="ti ti-refresh" style={{ fontSize: 15, color: BRAND, flexShrink: 0 }} />;
  return <span className="ti ti-circle" style={{ fontSize: 15, color: 'var(--ak-text-sub)', flexShrink: 0 }} />;
}

export default function TeachFinalCheckStrip({ finalCheck, onReteach }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const lastStatusRef = useRef(null);

  // The panel opens itself when a run starts and when gaps land; the
  // learner can collapse it back to the strip at any time.
  useEffect(() => {
    if (!finalCheck) return;
    const prev = lastStatusRef.current;
    if (finalCheck.status === 'running' && prev !== 'running') setOpen(true);
    if (finalCheck.status === 'open' && finalCheck.gaps > 0 && prev !== 'open') setOpen(true);
    lastStatusRef.current = finalCheck.status;
  }, [finalCheck]);

  // While a run is landing, follow the latest judged part; once gaps are
  // open, rest on the first gap (its Q&A carries the Re-teach action).
  useEffect(() => {
    if (!finalCheck || !open) return;
    if (finalCheck.status === 'running') {
      const judged = [...finalCheck.items].reverse().find(i => i.question && (i.status === 'held' || i.status === 'gap'));
      if (judged) setExpanded(judged.index);
    } else if (finalCheck.status === 'open') {
      const gap = finalCheck.items.find(i => i.status === 'gap');
      if (gap) setExpanded(gap.index);
    }
  }, [finalCheck, open]);

  if (!finalCheck || !finalCheck.items?.length) return null;
  const { status, items, held, gaps, total } = finalCheck;
  const done = status === 'passed' || status === 'settled';
  const reteachItem = status === 'reteach' ? items.find(i => i.status === 'reteaching') : null;

  const stripLabel = status === 'running'
    ? (held + gaps > 0 ? `${held} of ${total} held` : 'Let’s see what stuck')
    : status === 'reteach'
      ? `Re-teaching ${reteachItem ? reteachItem.concept : 'a part'}`
      : status === 'open'
        ? `${held} of ${total} held · ${gaps} to re-teach`
        : `${held} of ${total} held`;

  const strip = (
    <button
      type="button"
      onClick={() => setOpen(v => !v)}
      title="Final check"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        borderRadius: 11, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
        background: 'var(--ak-surface)',
        border: `1.5px solid ${done ? '#BEE7D2' : '#D9D0FF'}`,
      }}>
      <span style={{
        width: 23, height: 23, borderRadius: 7, flexShrink: 0,
        background: done ? GREEN : BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className={done ? 'ti ti-check' : 'ti ti-list-check'} style={{ fontSize: 13, color: '#fff' }} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ fontWeight: 900, color: 'var(--ak-text)' }}>Final check</span>
        {' · '}{stripLabel}
      </span>
      {status === 'running'
        ? <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'tam-spin 1s linear infinite', flexShrink: 0 }} />
        : <span className={`ti ti-chevron-${open ? 'down' : 'up'}`} style={{ fontSize: 14, color: 'var(--ak-text-sub)', flexShrink: 0 }} />}
    </button>
  );

  if (!open) return strip;

  return (
    <div style={{
      background: 'var(--ak-surface)', border: '1.5px solid #D9D0FF', borderRadius: 16,
      overflow: 'hidden', fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', borderBottom: '1px solid var(--ak-border)' }}>
        <span style={{ width: 23, height: 23, borderRadius: 7, background: done ? GREEN : BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className={done ? 'ti ti-check' : 'ti ti-list-check'} style={{ fontSize: 13, color: '#fff' }} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>Final check</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
          {held} of {total} held{gaps > 0 && status !== 'running' ? ` · ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Close the check"
          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', display: 'flex' }}>
          <span className="ti ti-x" style={{ fontSize: 16, color: 'var(--ak-text-sub)' }} />
        </button>
      </div>

      <div style={{ maxHeight: 330, overflowY: 'auto', padding: '4px 6px 8px' }}>
        {items.map(item => {
          const tag = STATUS_TAG[item.status] || STATUS_TAG.waiting;
          const isOpen = expanded === item.index && !!item.question;
          return (
            <div key={item.index}>
              <button
                type="button"
                onClick={() => { if (item.question) setExpanded(isOpen ? null : item.index); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 8px', borderRadius: 10, border: 'none', textAlign: 'left',
                  background: item.status === 'asking' || item.status === 'reteaching' ? '#F3F1FF' : 'transparent',
                  cursor: item.question ? 'pointer' : 'default', fontFamily: FONT,
                }}>
                <StatusIcon status={item.status} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 12.8, lineHeight: 1.3,
                  color: item.status === 'waiting' ? 'var(--ak-text-muted)' : 'var(--ak-text)',
                }}>{item.concept}</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, color: tag.color, flexShrink: 0 }}>{tag.label}</span>
              </button>

              {isOpen && (
                <div style={{
                  margin: '2px 8px 8px', background: 'var(--ak-tag-bg)', borderRadius: 13, padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--ak-text-sub)' }}>NANA ASKS</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, fontWeight: 700, color: 'var(--ak-text)', marginTop: 2 }}>{item.question}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--ak-text-sub)', marginTop: 10 }}>
                    YOUR PROTÉGÉ ANSWERS · FROM WHAT YOU TAUGHT
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ak-text)', marginTop: 2 }}>
                    {item.answer || 'Your protégé had nothing to answer from.'}
                  </div>
                  {item.status === 'held' && (
                    <div style={{ display: 'flex', gap: 7, marginTop: 9, fontSize: 12, lineHeight: 1.5, color: '#177A4C' }}>
                      <span className="ti ti-circle-check" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} />
                      <span><b>Held</b>{item.note ? ` — ${item.note}` : ' — your protégé could answer this from your teaching.'}</span>
                    </div>
                  )}
                  {item.status === 'gap' && (
                    <>
                      <div style={{ display: 'flex', gap: 7, marginTop: 9, fontSize: 12, lineHeight: 1.5, color: '#8A6414' }}>
                        <span className="ti ti-alert-circle" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} />
                        {item.outcome === 'guessed' || item.outcome === 'guessed_right'
                          ? <span><b>Gap:</b> your protégé answered this from its own knowledge, not from your teaching — and a guess doesn’t count, however right it sounds. It needs to come from you.</span>
                          : <span><b>Gap:</b> {item.note || 'Your protégé couldn’t answer this from what you taught.'}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setOpen(false); onReteach?.(item.index); }}
                        style={{
                          width: '100%', marginTop: 10, background: BRAND, color: '#fff', border: 'none',
                          fontFamily: FONT, fontSize: 13.5, fontWeight: 800, borderRadius: 12, padding: 11, cursor: 'pointer',
                        }}>
                        Re-teach this part
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
