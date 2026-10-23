/*
 * chatIdeas.js — the suggestion chips above the instructor chat's composer.
 *
 * Fresh chat     starters ("Draft a quiz", "Assignment: 3 MCQ, 2 theory"…)
 * A draft ready  ideas for THAT version, read from its questions: fix what
 *                the draft missed, make the easiest question harder, add
 *                a kind it doesn't have yet (a diagram, true/false, a case
 *                study…), round the marks
 * Assigned       what's next (a follow-up, a weekly routine)
 *
 * A chip fills the composer (the instructor can adjust it, then sends) —
 * every idea goes through the agent like anything they type.
 * → [{ label, fill }]
 */

export const STARTERS = [
  { label: 'Assignment: 3 MCQ, 2 theory', fill: 'Prepare an assignment on  for my class — 5 questions: 3 MCQ, 2 direct theory' },
  { label: 'With diagrams', fill: 'Prepare an assignment on  for my class — 6 questions, 2 with diagrams' },
  { label: 'True/False + case study', fill: 'Prepare an assignment on  for my class — 4 true/false and a case study with 2 questions' },
  { label: 'Lesson plan', fill: 'Make a lesson plan on  for JSS1, 40 minutes' },
  { label: 'Draft a quiz', fill: 'Draft a 10-question quiz for ' },
  { label: 'Prep this week\'s activities', fill: 'Prep this week\'s activities — ' },
  { label: 'Last assignment results', fill: 'How did the last assignment go? ' },
  { label: 'Weekly routine', fill: 'Schedule a weekly revision draft every ' },
];

const MAX = 5;
const ROUND = [10, 20, 25, 30, 40, 50, 60, 80, 100];
const RANK = { easy: 0, medium: 1, hard: 2 };
const has = (qs, f) => qs.some(f);

/** Ideas for one ready version of an assignment draft. */
export function versionIdeas(version) {
  const paper = version?.paper;
  const qs = Array.isArray(paper?.questions) ? paper.questions : [];
  if (!qs.length) return [];
  const out = [];
  const add = (label, fill) => { if (out.length < MAX && !out.some((x) => x.label === label)) out.push({ label, fill }); };

  // 1. What the draft missed against the request comes first.
  if (version.warning) add('Fix what was missed', `Fix version ${version.n}: ${String(version.warning).split('. ')[0].replace(/\.$/, '')}`);

  // 2. The easiest question (by difficulty, then marks) — not a true/false.
  const candidates = qs.map((q, i) => ({ q, i })).filter(({ q }) => q?.format !== 'true_false');
  if (candidates.length) {
    const easiest = [...candidates].sort((a, b) =>
      (RANK[String(a.q.difficulty).toLowerCase()] ?? 1) - (RANK[String(b.q.difficulty).toLowerCase()] ?? 1)
      || (Number(a.q.max_points) || 0) - (Number(b.q.max_points) || 0))[0];
    if (String(easiest.q.difficulty).toLowerCase() !== 'hard') add(`Make Q${easiest.i + 1} harder`, `Make question ${easiest.i + 1} harder`);
  }

  // 3. Kinds the paper doesn't have yet.
  if (!has(qs, (q) => q?.figure || q?.figure_note)) add('Add a diagram question', 'Add a question with a diagram');
  // 3b. Marks that don't land on a round total.
  const total = version.summary?.totalPoints ?? qs.reduce((n, q) => n + (Number(q?.max_points) > 0 ? Number(q.max_points) : 5), 0);
  if (!ROUND.includes(total)) {
    const next = ROUND.find((r) => r >= total) || 100;
    add(`Marks total ${next}`, `Change the marks so they total ${next}`);
  }
  if (!has(qs, (q) => q?.format === 'true_false')) add('Add true/false', 'Add 2 true/false questions');
  if (!has(qs, (q) => q?.format === 'case_study')) add('Add a case study', 'Add a short case study with 2 questions');
  if (!has(qs, (q) => q?.format === 'assertion_reason')) add('Add assertion & reason', 'Add an assertion and reason question');
  if (!has(qs, (q) => q?.format === 'label')) add('Add a labelling question', 'Add a labelling question with a diagram');

  if (qs.length < 10) add('Add 2 more questions', 'Add 2 more questions');
  add('Make it easier overall', 'Make the whole paper a little easier');
  return out;
}

/** Ideas for a draft that isn't an assignment (self study, project…). */
function draftIdeas(draft) {
  const p = draft?.payload || {};
  const out = [];
  if (!p.due_at && !p.due_hint) out.push({ label: 'Add a due date', fill: 'Set it due on Friday at 1 PM' });
  if (!p.instructions) out.push({ label: 'Add instructions', fill: 'Add short instructions for learners: ' });
  out.push({ label: 'Make it easier', fill: 'Make it easier' });
  out.push({ label: 'Add an entry', fill: 'Add one more entry on ' });
  return out.slice(0, MAX);
}

/**
 * The chips for the chat right now.
 *   latest  the newest draft card in the chat: { draft, version, state } or null
 *   tools   the tools the agent's last reply ran (names)
 */
export function chatIdeas({ latest = null, tools = [] } = {}) {
  if (latest?.state === 'assigned') {
    return [
      { label: 'A follow-up for next week', fill: 'Prepare a follow-up activity for next week on the same topic' },
      { label: 'Make it a weekly routine', fill: 'Schedule a weekly draft like this every ' },
      { label: 'Same for another class', fill: 'Prepare the same assignment for ' },
    ];
  }
  if (latest?.draft && latest.state !== 'discarded') {
    const d = latest.draft;
    if (d.type === 'assignment') {
      const vs = Array.isArray(d.payload?.versions) ? d.payload.versions : [];
      const v = vs.find((x) => x.n === latest.version) || vs.at(-1);
      // Ideas belong to the newest version — an older card's chips would build on the wrong one.
      if (v && v.n === vs.at(-1)?.n && v.status === 'ready') return versionIdeas(v);
      if (v?.status === 'drafting') return [];
    } else return draftIdeas(d);
  }
  if (tools.includes('check_activity_outcomes')) {
    return [
      { label: 'Revision on the weak areas', fill: 'Prepare a revision activity on the weak areas for the same class' },
      { label: 'Easier practice first', fill: 'Prepare short, easier practice questions on the same topic' },
    ];
  }
  return STARTERS;
}
