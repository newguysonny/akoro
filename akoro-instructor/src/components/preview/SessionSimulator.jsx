/*
 * SessionSimulator — a self study is a teaching session, and this plays a
 * sample of it: the messages between the teaching guide, the learner and
 * their protégé, in the order they come in. No composer — nothing to type;
 * it is a simulation to watch.
 *
 * Sample data only (previewSamples.js, no API calls), shaped by the study
 * plan's topic, concepts and objectives. The look follows the learner app's session (SessionChatView.jsx):
 * the guide's purple bubbles, the protégé's amber ones, the learner's grey.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '../../theme/Ico.jsx';
import { C } from '../../theme/colors.js';
import { sampleSession } from './previewSamples.js';

const STYLE = {
  guide:   { name: 'NaNa Esumai · teaching guide', ti: 'ti-brain', bg: '#EEEDFE', color: '#3C3489', ring: '#AFA9EC' },
  protege: { name: 'Protégé', ti: 'ti-robot', bg: '#FEF0E6', color: '#92400E', ring: '#F59E0B' },
};
const STEP_MS = 1500;

export default function SessionSimulator({ topic, subject, concepts = [], objectives = {}, onClose }) {
  const turns = useMemo(() => sampleSession({ topic, subject, concepts, objectives }), [topic, subject, concepts, objectives]);
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(0);
  const scrollRef = useRef(null);
  useEffect(() => { setShown(0); }, [run]);
  useEffect(() => {
    if (shown >= turns.length) return undefined;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 400 : STEP_MS);
    return () => clearTimeout(t);
  }, [shown, turns.length]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [shown]);
  const done = shown >= turns.length;
  const next = turns[shown];

  const Agent = ({ kind, text }) => {
    const st = STYLE[kind];
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: st.bg, border: `1.5px solid ${st.ring}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti={st.ti} size={15} color={st.color} /></div>
        <div style={{ maxWidth: '84%' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, margin: '0 0 2px 2px' }}>{st.name}</div>
          <div style={{ padding: '9px 13px', borderRadius: '4px 18px 18px 18px', background: st.bg, border: `0.5px solid ${st.ring}`, color: st.color, fontSize: 13, lineHeight: 1.6, fontWeight: 500 }}>{text}</div>
        </div>
      </div>
    );
  };
  const Learner = ({ text }) => (
    <div style={{ alignSelf: 'flex-end', maxWidth: '84%' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, margin: '0 2px 2px 0', textAlign: 'right' }}>Learner</div>
      <div style={{ padding: '9px 13px', borderRadius: '18px 4px 18px 18px', background: C.tagBg, border: `1px solid ${C.border}`, color: C.ink, fontSize: 13, lineHeight: 1.6, fontWeight: 600 }}>{text}</div>
    </div>
  );
  const typing = next && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: next.who === 'learner' ? 'flex-end' : 'flex-start', paddingLeft: next.who === 'learner' ? 0 : 36, fontSize: 11, color: C.muted2, fontWeight: 700 }}>
      <span style={{ letterSpacing: 3, fontSize: 16, fontWeight: 900 }}>···</span>{next.who === 'learner' ? 'Learner is typing' : next.who === 'protege' ? 'Protégé is thinking' : 'Guide is typing'}
    </div>
  );

  return (
    <div data-session-sim="" style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.bg, display: 'flex', flexDirection: 'column', height: 540, fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}`, background: C.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 16, background: '#6C3BFF22', border: '1px solid #6C3BFF55', fontSize: 9, fontWeight: 900, letterSpacing: .5, color: '#6C3BFF' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6C3BFF' }} />LEARN BY TEACHING
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: .5, padding: '3px 8px', borderRadius: 20, background: C.tagBg, color: C.muted }}>SAMPLE SESSION</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{topic}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2 }}>{subject} · the learner, their protégé and the teaching guide</div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {turns.slice(0, shown).map((t, i) => (t.who === 'learner' ? <Learner key={i} text={t.text} /> : <Agent key={i} kind={t.who === 'protege' ? 'protege' : 'guide'} text={t.text} />))}
        {!done && typing}
        {done && <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, color: C.muted2, padding: '6px 0' }}>End of the sample session</div>}
      </div>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderSoft}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: C.muted2 }}>Sample data shaped by the study plan; real sessions follow each learner</span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={() => setRun((r) => r + 1)} style={{ padding: '7px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-reload" size={12} />Replay</button>
          {onClose && <button type="button" onClick={onClose} style={{ padding: '7px 12px', borderRadius: 10, border: 'none', background: '#6C3BFF', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Done</button>}
        </div>
      </div>
    </div>
  );
}
