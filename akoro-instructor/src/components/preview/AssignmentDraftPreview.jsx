/*
 * AssignmentDraftPreview — an assignment drafted in chat, in the same three
 * tabs as battles and self study: Settings (who, when, the review battle),
 * Preview (Play: a sample learner answers it and submits, as in the learner
 * app — AssignmentSimulator, sample data only) and Questions (the versions
 * and their paper, edited and switched as before).
 *
 * The panel hands in what each tab shows; this owns the tabs and the play.
 */
import { useState } from 'react';
import { C } from '../../theme/colors.js';
import ReviewBattleTab, { reviewBattleTabs } from './ReviewBattleTabs.jsx';
import { PreviewTabs, PlayStage } from './PreviewKit.jsx';
import AssignmentSimulator from './AssignmentSimulator.jsx';
import { MathText } from '../paper/PaperView.jsx';

export default function AssignmentDraftPreview({ settings, questions, version, title, topic, battle = null, initialTab = 'settings' }) {
  const [tab, setTab] = useState(initialTab);
  const [playing, setPlaying] = useState(false);
  const paper = version?.status === 'ready' ? version.paper : null;
  const count = paper?.questions?.length || 0;
  return (
    <div data-assignment-preview="" style={{ fontFamily: C.font }}>
      <PreviewTabs value={tab} onChange={(t) => { setTab(t); setPlaying(false); }}
        tabs={[['settings', 'Settings'], ['preview', 'Preview'], ['questions', count ? `Questions (${count})` : 'Questions'], ...reviewBattleTabs(battle)]} />
      {tab === 'settings' && settings}
      {tab === 'preview' && (!paper ? (
        <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 12.5, color: C.muted }}>
          {version?.status === 'failed' ? `Version ${version.n} couldn't be drafted — try it again on the Questions tab.` : 'The questions are still being written — the preview plays them once they are ready.'}
        </div>
      ) : playing ? (
        <AssignmentSimulator paper={paper} title={title} topic={topic} instructions={paper.instructions} onClose={() => setPlaying(false)} />
      ) : (
        <PlayStage onPlay={() => setPlaying(true)} label="Play preview"
          sub={`Watch a learner answer Version ${version.n} and submit it — sample answers, nothing is sent.`}
          glimpse={<Glimpse paper={paper} />} />
      ))}
      {tab === 'questions' && questions}
      {tab.startsWith('battle-') && <ReviewBattleTab key={tab} tab={tab} battle={battle} />}
    </div>
  );
}

/* What sits blurred behind Play: the first question, as the learner sees it. */
function Glimpse({ paper }) {
  const q = paper.questions[0];
  return (
    <div style={{ padding: 6 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {paper.questions.slice(0, 8).map((_, i) => <span key={i} style={{ width: 28, height: 28, borderRadius: 9, border: `1.5px solid ${C.border}`, background: '#fff' }} />)}
      </div>
      <div style={{ background: '#fff', borderRadius: 14, padding: 14, border: `1px solid ${C.borderSoft}` }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, marginBottom: 6 }}>QUESTION 1 OF {paper.questions.length}</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}><MathText text={String(q?.q || '')} /></div>
      </div>
      <div style={{ marginTop: 10, height: 70, borderRadius: 16, border: `1px solid ${C.border}`, background: '#fff' }} />
    </div>
  );
}
