/*
 * BattleDraftPreview — a battle drafted in chat: Settings (the battle form,
 * prefilled), Preview (Play runs the battle as learners will see it, with
 * simulated agents) and Questions. The draft makes its REAL questions
 * (payload.details.questions — bank first, AI tops up): the Questions tab
 * shows them, Play plays them, and the battle made from the draft asks
 * exactly those. Only a draft without them (none could be prepared) falls
 * back to sample questions, and says so.
 */
import { useMemo, useState } from 'react';
import { C } from '../../theme/colors.js';
import BattleForm from '../battles/BattleForm.jsx';
import { PreviewTabs, Section, PlayStage } from './PreviewKit.jsx';
import BattleSimulator from './BattleSimulator.jsx';
import { sampleBattleQuestions } from './previewSamples.js';
import { BattleQuestionList, ArenaGlimpse } from './ReviewBattleTabs.jsx';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function whenLabel(init) {
  if (init?.repeats) return `Repeats ${(init.days || []).map((d) => DAY[d]).join(', ')} ${init.repeatTime || ''}`.trim();
  if (init?.scheduledAt) return new Date(init.scheduledAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  return 'Starts when everyone has answered';
}

export default function BattleDraftPreview({ draft, initial, courses, onSubmit, audienceLabel }) {
  const [tab, setTab] = useState('settings');
  const [playing, setPlaying] = useState(false);
  const details = draft.payload?.details || {};
  const isReview = details.mode === 'review' || initial?.kind === 'review';
  const total = Number(initial?.totalQuestions) || details.total_questions || 10;


  const names = draft.audience?.names?.length ? draft.audience.names : ['Learner 1', 'Learner 2', 'Learner 3', 'Learner 4'];
  const players = useMemo(() => (isReview ? names.slice(0, 1) : names.slice(0, 6)).map((n, i) => ({ id: `p${i}`, name: `${String(n).replace(/^@/, '')}'s agent` })), [names, isReview]);
  const format = isReview ? 'review' : 'group';
  // The simulation plays sample data only (no API calls).
  const real = useMemo(() => (Array.isArray(details.questions) ? details.questions : []).map((q) => ({
    text: q.stem, options: (q.options || []).map((o) => o.text), correct: q.correctIndex, topic: q.topic || initial?.topic || null, exam: q.exam || null, year: q.year || null,
  })), [details.questions, initial?.topic]);
  const simQuestions = useMemo(() => (real.length ? real
    : sampleBattleQuestions({ subject: initial?.subject || draft.payload?.subject, topic: initial?.topic, count: total })), [real, initial?.subject, initial?.topic, draft.payload?.subject, total]);

  return (
    <div data-battle-preview="" style={{ fontFamily: C.font }}>
      <PreviewTabs value={tab} onChange={(t) => { setTab(t); setPlaying(false); }}
        tabs={[['settings', 'Settings'], ['preview', 'Preview'], ['questions', `Questions (${simQuestions.length})`]]} />

      {tab === 'settings' && (
        <div>
          <Section title="Overview" icon="ti-swords" summary={draft.title} chips={[isReview ? 'Study review' : 'Class battle', initial?.subject, initial?.topic]}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{draft.title}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              {isReview ? 'One learner. Their protégé answers a paper on the topic; a mark sheet, no opponent.' : 'Learner against learner: each learner’s agent answers from what the learner taught it. You host; you never compete.'}
            </div>
          </Section>
          <Section title="Who and when" icon="ti-users" chips={[audienceLabel, whenLabel(initial)]} />
          <Section title="Questions and stakes" icon="ti-list-numbers"
            chips={[`${total} questions`, `${initial?.duration || 15} min`, isReview ? 'No HP, no winner' : `${initial?.hpPerMiss ?? 10} HP per miss`, isReview ? null : `${initial?.xpPrize || 200} XP prize`, 'Bank first, AI tops up']} />
          <Section title="Battle settings" icon="ti-adjustments" defaultOpen>
            <BattleForm onSubmit={onSubmit} courses={courses || []} initial={initial} submitLabel="Create battle & close draft" embedded />
          </Section>
        </div>
      )}

      {tab === 'preview' && (playing ? (
        <BattleSimulator title={draft.title} topic={initial?.topic} subject={initial?.subject} questions={simQuestions} sample={!real.length}
          format={format} players={players} hpPerMiss={Number(initial?.hpPerMiss ?? 10)} onClose={() => setPlaying(false)} />
      ) : (
        <PlayStage onPlay={() => setPlaying(true)} label="Play preview"
          sub={real.length ? "Watch it as your learners will: simulated agents, the battle's own questions." : "Watch it as your learners will: simulated agents, sample questions."}
          glimpse={<ArenaGlimpse title={draft.title} />} />
      ))}

      {tab === 'questions' && (
        <div>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45, marginBottom: 10 }}>
            {real.length
              ? `The questions this ${isReview ? 'review' : 'battle'} will ask${real.length < total ? ` — ${real.length} of ${total}; it tops up the rest when it's created` : ''}. Change the subject in Settings and it draws fresh ones.`
              : (details.questions_note || `Sample questions — the battle draws its own ${total} when it's created.`)}
          </div>
          <BattleQuestionList questions={simQuestions} />
        </div>
      )}
    </div>
  );
}
