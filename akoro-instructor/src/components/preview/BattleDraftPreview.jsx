/*
 * BattleDraftPreview — a battle drafted in chat: Settings (the battle form,
 * prefilled), Preview (Play runs the battle as learners will see it, with
 * simulated agents) and Questions (the sample questions it plays). Sample
 * data only, no API calls (previewSamples.js); the battle draws its own
 * questions from the bank when it's created.
 */
import { useMemo, useState } from 'react';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import BattleForm from '../battles/BattleForm.jsx';
import { PreviewTabs, Section, PlayStage } from './PreviewKit.jsx';
import BattleSimulator from './BattleSimulator.jsx';
import { sampleBattleQuestions } from './previewSamples.js';

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
  const simQuestions = useMemo(() => sampleBattleQuestions({ subject: initial?.subject || draft.payload?.subject, topic: initial?.topic, count: total }), [initial?.subject, initial?.topic, draft.payload?.subject, total]);

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
        <BattleSimulator title={draft.title} topic={initial?.topic} subject={initial?.subject} questions={simQuestions}
          format={format} players={players} hpPerMiss={Number(initial?.hpPerMiss ?? 10)} onClose={() => setPlaying(false)} />
      ) : (
        <PlayStage onPlay={() => setPlaying(true)} label="Play preview"
          sub="Watch it as your learners will: simulated agents, sample questions."
          glimpse={<ArenaGlimpse title={draft.title} />} />
      ))}

      {tab === 'questions' && (
        <div>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45, marginBottom: 10 }}>Sample questions, the ones the preview plays. The battle draws its own {total} from the question bank when it's created.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {simQuestions.map((q, i) => (
              <div key={i} style={{ borderRadius: 12, border: `1px solid ${C.borderSoft}`, background: C.surface, padding: '11px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: C.muted2 }}>Q{i + 1}</span>
                  {q.topic && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: 'rgba(232,136,74,.14)', color: '#C2410C' }}>{q.topic}</span>}
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
        </div>
      )}
    </div>
  );
}

/* What sits blurred behind Play: the arena's shape. */
function ArenaGlimpse({ title }) {
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
