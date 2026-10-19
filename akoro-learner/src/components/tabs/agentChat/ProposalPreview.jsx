/**
 * ProposalPreview — what a ready suggestion prepared, shown before the
 * learner says yes (Grand Plan §7.16.3). Every line comes from the server's
 * preview, which code wrote from their real records, goals and topics —
 * never invented questions or numbers.
 */
import { Icon } from '../../common/Icons.jsx';
import { BRAND } from '../../../constants.js';

const Line = ({ icon, children }) => (
  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '2px 0' }}>
    <Icon name={icon} size={13} color="var(--ak-text-muted)"/><span>{children}</span>
  </li>
);

function body(p) {
  switch (p.kind) {
    case 'quiz': return { head: `Quiz · ${p.record}`, tag: '10 questions · free', icon: 'ti-list-check', lines: [
      ['ti-file-text', <>From your <b>{p.record}</b>{p.pages ? ` · ${p.pages} pages` : ''}</>],
      ...(p.topics?.length ? [['ti-tags', <>Covers {p.topics.map((t, i) => <span key={t}>{i ? ', ' : ''}{t === p.focus ? <b>{t}</b> : t}</span>)}</>]] : []),
      ...(p.focus ? [['ti-target-arrow', <>Weighted to {p.focus}</>]] : []),
    ], note: 'The reader writes the questions from the whole document when you open it.' };
    case 'teach': return { head: `Teach your agent · ${p.topic}`, icon: 'ti-school', lines: [
      ...(p.mastery != null ? [['ti-chart-line', <>You're at <b>{p.mastery}%</b> on it{p.subject ? ` (${p.subject})` : ''}</>]] : []),
      ['ti-bulb', <>Explaining it is the fastest way to fix it — even roughly</>]] };
    case 'check': return { head: `Agent Check · ${p.topic}`, tag: `${p.questions || 5} questions · free`, icon: 'ti-swords', lines: [
      ...(p.mastery != null ? [['ti-chart-line', <>You're at <b>{p.mastery}%</b> on it</>]] : []),
      ['ti-robot', <>Your agent answers from what you taught it — the gaps show what to teach next</>]] };
    case 'plan': return { head: `Study plan · ${p.goal}`, icon: 'ti-calendar-event', lines: [
      ['ti-clock', <><b>{p.daysLeft} days</b> to go{p.subject ? ` · ${p.subject}` : ''}</>],
      ['ti-coin', <>You'll see the plan and its coin estimate before anything is charged</>]] };
    case 'follow_up': return { head: 'Picking up where you left off', icon: 'ti-message-circle', lines: [['ti-quote', <>{p.note}</>]] };
    case 'step': return { head: `First step · ${p.goal}`, icon: 'ti-target', lines: [
      ...(p.daysSince != null ? [['ti-hourglass', <>Untouched for <b>{p.daysSince} days</b></>]] : []),
      ...(p.daysLeft != null ? [['ti-flag', <><b>{p.daysLeft} days</b> to go</>]] : [])] };
    case 'reschedule': return { head: `Spread ${p.tasks?.length || 0} overdue tasks`, icon: 'ti-calendar-repeat', lines: (p.tasks || []).slice(0, 4).map((t) => ['ti-circle-dashed', <>{t}</>]),
      note: `Two a day from tomorrow, over ${p.days || 2} days.` };
    default: return null;
  }
}

export default function ProposalPreview({ preview }) {
  const b = preview ? body(preview) : null;
  if (!b) return null;
  return (
    <div data-proposal-preview={preview.kind} style={{ border: '1px solid var(--ak-border2)', borderRadius: 14, overflow: 'hidden', margin: '6px 0 10px', background: 'var(--ak-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--ak-surface-hover)', borderBottom: '1px solid var(--ak-border)', fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)' }}>
        <Icon name={b.icon} size={14} color={BRAND}/> <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.head}</span>
        {b.tag && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap' }}>{b.tag}</span>}
      </div>
      {b.lines.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ak-text)' }}>{b.lines.map(([i, c], k) => <Line key={k} icon={i}>{c}</Line>)}</ul>}
      {b.note && <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 700, padding: '0 12px 10px' }}>{b.note}</div>}
    </div>
  );
}
