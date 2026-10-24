/*
 * SessionSimulator — the self study as a learner will meet it: a teaching
 * session on the plan's topic and concepts, played in the preview. It copies
 * the learner app's session (akoro-learner/src/components/teaching/
 * SessionChatView.jsx): the LEARN BY TEACHING pill, the topic header, the
 * guide's purple bubbles, Sargeant's checks, the protégé's amber bubbles and
 * the learner's own grey ones — then the end-of-session card.
 *
 * Scripted from the plan, not generated: it shows the shape and the order of
 * a real session (the guide frames each concept, the learner teaches it, the
 * protégé asks, Sargeant checks), with the learner's turns marked as theirs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '../../theme/Ico.jsx';
import { C } from '../../theme/colors.js';

const STYLE = {
  guide:    { name: 'NaNa Esumai', ti: 'ti-brain', bg: '#EEEDFE', color: '#3C3489', ring: '#AFA9EC' },
  sargeant: { name: 'Sargeant',    ti: 'ti-bolt',  bg: '#FFF0F0', color: '#7F1D1D', ring: '#FCA5A5' },
  protege:  { name: 'Protégé',     ti: 'ti-robot', bg: '#FEF0E6', color: '#92400E', ring: '#F59E0B' },
};
const STEP_MS = 1300;

/** PURE: the session's turns, from the plan. */
export function scriptSession({ topic, subject, concepts = [], objectives = {}, agentName = 'Your protégé' }) {
  const list = (concepts.length ? concepts : [topic]).slice(0, 3);
  const turns = [{ who: 'guide', text: `Welcome! Today you'll teach ${agentName} about **${topic}**${subject ? ` (${subject})` : ''}. We'll go concept by concept: you explain, your protégé asks, and I'll keep it on track.` }];
  list.forEach((c, i) => {
    const obj = (objectives[c] || [])[0];
    turns.push({ who: 'guide', text: `${i === 0 ? 'First' : i === list.length - 1 ? 'Last one' : 'Next'}: **${c}**.${obj ? ` By the end you should be able to ${obj.replace(/^[A-Z]/, (m) => m.toLowerCase()).replace(/\.$/, '')}.` : ''} Explain it in your own words.` });
    turns.push({ who: 'you', text: `The learner explains “${c}” here, in their own words (typed or spoken).` });
    turns.push({ who: 'protege', text: i === 0 ? `I think I follow. Can you give me an example of “${c}”, so I know I've got it?` : `How does “${c}” connect to what you taught me before? I'd like to get it right in my review.` });
    turns.push({ who: 'you', text: `The learner answers the protégé, with an example.` });
    if (i === 0) turns.push({ who: 'sargeant', text: `Quick check: that explanation is on track. Make the example concrete: a number or a real case.` });
  });
  turns.push({ who: 'guide', text: `Well taught. Your protégé now has notes on ${list.join(', ')}. When you're ready, your review battle checks what it learned.` });
  return turns;
}

export default function SessionSimulator({ topic, subject, concepts = [], objectives = {}, review = null, onClose }) {
  const turns = useMemo(() => scriptSession({ topic, subject, concepts, objectives }), [topic, subject, concepts, objectives]);
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(1);
  const scrollRef = useRef(null);
  useEffect(() => { setShown(1); }, [run]);
  useEffect(() => {
    if (shown > turns.length) return undefined;
    const t = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, turns.length]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [shown]);
  const done = shown > turns.length;
  const sc = '#6C3BFF';

  const rich = (s) => s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part));
  const Agent = ({ kind, text }) => {
    const st = STYLE[kind];
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: st.bg, border: `1.5px solid ${st.ring}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti={st.ti} size={15} color={st.color} /></div>
        <div style={{ maxWidth: '84%' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, margin: '0 0 2px 2px' }}>{st.name}</div>
          <div style={{ padding: '9px 13px', borderRadius: '4px 18px 18px 18px', background: st.bg, border: `0.5px solid ${st.ring}`, color: st.color, fontSize: 13, lineHeight: 1.6, fontWeight: 500 }}>{rich(text)}</div>
        </div>
      </div>
    );
  };
  const You = ({ text }) => (
    <div style={{ alignSelf: 'flex-end', maxWidth: '84%' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, margin: '0 2px 2px 0', textAlign: 'right' }}>Learner</div>
      <div style={{ padding: '9px 13px', borderRadius: '18px 4px 18px 18px', background: C.tagBg, border: `1px dashed ${C.border}`, color: C.muted, fontSize: 12.5, lineHeight: 1.6, fontStyle: 'italic' }}>{text}</div>
    </div>
  );

  return (
    <div data-session-sim="" style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.bg, display: 'flex', flexDirection: 'column', height: 520, fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}`, background: C.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 16, background: `${sc}22`, border: `1px solid ${sc}55`, fontSize: 9, fontWeight: 900, letterSpacing: .5, color: sc }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc }} />LEARN BY TEACHING
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: .5, padding: '3px 8px', borderRadius: 20, background: 'rgba(232,136,74,.15)', color: '#C2410C' }}>PREVIEW · SIMULATED</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{topic}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2 }}>{subject} · Protégé · NaNa Esumai · Sargeant</div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {turns.slice(0, shown).map((t, i) => (t.who === 'you' ? <You key={i} text={t.text} /> : <Agent key={i} kind={t.who} text={t.text} />))}
        {!done && <div style={{ fontSize: 18, letterSpacing: 3, color: C.muted2, fontWeight: 900, paddingLeft: 36 }}>···</div>}
        {done && (
          <div style={{ marginTop: 4, padding: '13px 14px', borderRadius: 14, background: `${sc}0C`, border: `1px solid ${sc}26` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 900, color: C.ink }}><Ico ti="ti-flag-check" size={16} color={sc} />End of the session</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>The learner gets a teaching score, the concepts taught and the gaps to work on.</div>
            {review?.on && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 11.5, fontWeight: 800, color: sc }}>
                <Ico ti="ti-swords" size={14} color={sc} />Review battle scheduled{review.label ? ` · ${review.label}` : ''}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderSoft}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: C.muted2 }}>Scripted from the study plan · the learner's turns are theirs</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setRun((r) => r + 1)} style={{ padding: '7px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-reload" size={12} />Replay</button>
          {onClose && <button type="button" onClick={onClose} style={{ padding: '7px 12px', borderRadius: 10, border: 'none', background: sc, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Done</button>}
        </div>
      </div>
    </div>
  );
}
