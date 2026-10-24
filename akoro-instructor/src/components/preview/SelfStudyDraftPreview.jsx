/*
 * SelfStudyDraftPreview — a self study drafted in chat: a teaching session
 * whose plan the instructor sets. Settings (who, when, the review battle it
 * comes with, the session), Preview (Play runs the session as a learner will
 * meet it) and Study plan (topic, concepts, objectives).
 */
import { useState } from 'react';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { PreviewTabs, Section, Field, PlayStage, inputStyle } from './PreviewKit.jsx';
import ReviewBattleSettings from './ReviewBattleSettings.jsx';
import SessionSimulator from './SessionSimulator.jsx';

const fmt = (local) => (local ? new Date(local).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '');

export default function SelfStudyDraftPreview({ draft, audience = {}, dueLocal, onDue, dueHint, review, onReview, onEditPlan }) {
  const [tab, setTab] = useState('settings');
  const [playing, setPlaying] = useState(false);
  const p = draft.payload || {};
  const concepts = p.subtopics || [];
  const objectives = p.objectives || {};
  const who = audience.whole_class ? `Everyone in ${audience.class_name || 'the class'}` : (audience.label || '—');

  return (
    <div data-selfstudy-preview="" style={{ fontFamily: C.font }}>
      <PreviewTabs value={tab} onChange={(t) => { setTab(t); setPlaying(false); }}
        tabs={[['settings', 'Settings'], ['preview', 'Preview'], ['plan', 'Study plan']]} />

      {tab === 'settings' && (
        <div>
          <Section title="Overview" icon="ti-school" summary={p.instructions || `A teaching session on ${p.topic}.`} chips={[p.subject, p.topic, `${concepts.length} concepts`]}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{draft.title}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{p.instructions || 'Learners teach their protégé the plan, concept by concept, with the teaching guide.'}</div>
          </Section>
          <Section title="Assignment" icon="ti-calendar" defaultOpen chips={[who, dueLocal ? `Due ${fmt(dueLocal)}` : 'No due date']}>
            <Field label="Who gets it">{who}{audience.resolved_count ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#047857' }}>{audience.resolved_count} learners</span> : null}</Field>
            <Field label="Available from" hint="When learners can start the session.">
              <div style={{ ...inputStyle, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}><Ico ti="ti-calendar" size={13} color={C.muted2} />As soon as it's assigned</div>
            </Field>
            <Field label="Due date" hint="When the session closes and the work is handed in.">
              <input type="datetime-local" value={dueLocal || ''} onChange={(e) => onDue(e.target.value)} aria-label="Due date" style={inputStyle} />
              {dueHint && !dueLocal && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>You said “{dueHint}” — pick the exact date and time.</div>}
            </Field>
          </Section>
          <ReviewBattleSettings value={review} onChange={onReview} dueLocal={dueLocal} defaultOpen={false} />
          <Section title="Teaching session" icon="ti-brain" chips={['Guide: NaNa Esumai', 'Sargeant checks', 'Learner teaches their protégé', 'Voice or text']} />
          <Section title="Language" icon="ti-language" chips={['English', 'Learners may answer in their language']} />
        </div>
      )}

      {tab === 'preview' && (playing ? (
        <SessionSimulator topic={p.topic} subject={p.subject} concepts={concepts} objectives={objectives}
          review={{ on: review?.on, label: review?.at ? fmt(review.at) : '' }} onClose={() => setPlaying(false)} />
      ) : (
        <PlayStage onPlay={() => setPlaying(true)} label="Play preview" sub="See the session as a learner will: the guide frames each concept, the learner teaches it, the protégé asks."
          glimpse={<SessionGlimpse topic={p.topic} />} />
      ))}

      {tab === 'plan' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['Topic', p.topic], ['Subject', p.subject]].map(([k, v]) => (
              <div key={k} style={{ padding: '9px 11px', borderRadius: 10, background: C.surface, border: `1px solid ${C.borderSoft}` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, letterSpacing: .4, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginTop: 2 }}>{v || '—'}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .4, textTransform: 'uppercase', margin: '4px 0 7px' }}>Concepts and objectives</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {concepts.map((c, i) => (
              <div key={i} style={{ padding: '10px 12px', borderRadius: 11, background: C.surface, border: `1px solid ${C.borderSoft}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6C3BFF', color: '#fff', fontSize: 10.5, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{c}</span>
                </div>
                {(objectives[c] || []).length > 0 && (
                  <ul style={{ margin: '6px 0 0 28px', padding: 0 }}>
                    {objectives[c].map((o, j) => <li key={j} style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{o}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {!concepts.length && <div style={{ fontSize: 12, color: C.muted2 }}>The plan is being written…</div>}
          </div>
          {onEditPlan && (
            <button type="button" onClick={onEditPlan} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              <Ico ti="ti-pencil" size={13} />Edit the plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SessionGlimpse({ topic }) {
  const bubble = (bg, w, right) => <div style={{ alignSelf: right ? 'flex-end' : 'flex-start', width: w, height: 42, borderRadius: 16, background: bg, marginBottom: 9 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 340, padding: 6 }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.ink, marginBottom: 14 }}>{topic}</div>
      {bubble('#EEEDFE', '78%')}{bubble(C.tagBg, '60%', true)}{bubble('#FEF0E6', '70%')}{bubble(C.tagBg, '55%', true)}{bubble('#EEEDFE', '74%')}
    </div>
  );
}
