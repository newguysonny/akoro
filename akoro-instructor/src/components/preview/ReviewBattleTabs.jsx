/*
 * ReviewBattleTabs — the review battle a self study or assignment comes with,
 * seen from its draft: Battle preview (Play runs the class review as learners
 * will meet it, simulated agents) and Battle questions (the questions it will
 * ask — written on the draft, POST /api/self-study/drafts/:id/review-questions,
 * and placed as they are when the review battle is made). Shown as two more
 * tabs whenever the review battle is on.
 */
import { useMemo, useState } from 'react';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { PlayStage } from './PreviewKit.jsx';
import BattleSimulator from './BattleSimulator.jsx';

/** A draft's saved questions ({ stem, options:[{label,text}], correctIndex }) in the simulator's shape. */
export const toSimQuestions = (list, topic = null) => (Array.isArray(list) ? list : []).map((q) => ({
  text: q.stem, options: (q.options || []).map((o) => o.text), correct: q.correctIndex, topic: q.topic || topic || null, exam: q.exam || null, year: q.year || null,
}));

/** The question list, answers marked — the battle draft's Questions tab and the review's Battle questions. */
export function BattleQuestionList({ questions }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {questions.map((q, i) => (
        <div key={i} style={{ borderRadius: 12, border: `1px solid ${C.borderSoft}`, background: C.surface, padding: '11px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: C.muted2 }}>Q{i + 1}</span>
            {q.topic && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: 'rgba(232,136,74,.14)', color: '#C2410C' }}>{q.topic}</span>}
            {q.exam && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: C.bg, color: C.muted }}>{q.exam}{q.year ? ` ${q.year}` : ''}</span>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, lineHeight: 1.5, marginBottom: 7 }}>{q.text}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {q.options.map((o, j) => (
              <div key={j} style={{ fontSize: 11.5, padding: '5px 8px', borderRadius: 8, background: j === q.correct ? 'rgba(16,185,129,.12)' : C.bg, color: j === q.correct ? '#047857' : C.muted, fontWeight: j === q.correct ? 800 : 600, display: 'flex', gap: 6 }}>
                <span style={{ fontWeight: 900 }}>{'ABCDE'[j]}</span>{o}{j === q.correct && <Ico ti="ti-check" size={12} color="#047857" style={{ marginLeft: 'auto' }} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* What sits blurred behind Play: the arena's shape. */
export function ArenaGlimpse({ title }) {
  return (
    <div style={{ borderRadius: 16, background: 'linear-gradient(160deg,#0f1320,#141c2e,#1a1430)', padding: 14, minHeight: 340 }}>
      <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'space-around', margin: '22px 0' }}>
        {['#6C3BFF', '#EC4899'].map((c) => <div key={c} style={{ width: 52, height: 52, borderRadius: '50%', background: `${c}44` }} />)}
      </div>
      {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 34, borderRadius: 12, background: 'rgba(255,255,255,.08)', marginBottom: 7 }} />)}
    </div>
  );
}

/** The tab names: added after the activity's own when the review battle is on. */
export const reviewBattleTabs = (battle) => (battle?.on
  ? [['battle-preview', 'Battle preview'], ['battle-questions', battle.questions?.length ? `Battle questions (${battle.questions.length})` : 'Battle questions']]
  : []);

const Waiting = ({ battle }) => (
  <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
    {battle.loading ? <><Ico ti="ti-loader-2" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Writing the review battle's questions…</>
      : battle.note || "The review battle's questions aren't ready yet."}
  </div>
);

/**
 * `battle`: { on, title, topic, subject, questions (saved shape), loading, note, players: [names] }
 * `tab`: 'battle-preview' | 'battle-questions'
 */
export default function ReviewBattleTab({ tab, battle }) {
  const [playing, setPlaying] = useState(false);
  const questions = useMemo(() => toSimQuestions(battle?.questions, battle?.topic), [battle?.questions, battle?.topic]);
  const players = useMemo(() => (battle?.players?.length ? battle.players : ['Learner 1', 'Learner 2', 'Learner 3', 'Learner 4'])
    .slice(0, 6).map((n, i) => ({ id: `p${i}`, name: `${String(n).replace(/^@/, '')}'s agent` })), [battle?.players]);
  if (!battle?.on) return null;
  if (!questions.length) return <Waiting battle={battle} />;
  if (tab === 'battle-questions') {
    return (
      <div data-review-battle-questions="">
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45, marginBottom: 10 }}>
          The questions the class review battle will ask — every learner's protégé answers them after the activity. Change how many in Settings: fewer keeps the first ones, more keeps these and adds the rest.
        </div>
        {battle.loading && (
          <div data-review-battle-writing="" style={{ fontSize: 11.5, fontWeight: 700, color: '#6C3BFF', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} />Writing the extra questions…
          </div>
        )}
        <BattleQuestionList questions={questions} />
      </div>
    );
  }
  return playing ? (
    <BattleSimulator title={battle.title} topic={battle.topic} subject={battle.subject} questions={questions} format="group" players={players} hpPerMiss={10} sample={false} onClose={() => setPlaying(false)} />
  ) : (
    <PlayStage onPlay={() => setPlaying(true)} label="Play preview" sub="Watch the class review battle as your learners will: their protégés answer, mark sheets ranked — sample agents, the real questions."
      glimpse={<ArenaGlimpse title={battle.title} />} />
  );
}
