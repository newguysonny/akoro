/*
 * previewSamples.js — the sample data the preview simulations play. PURE, no
 * API calls: the battle simulation's questions (a small set per subject, a
 * general set otherwise) and the teaching session's conversation (shaped by
 * the plan's topic, concepts and objectives). For watching, not for marking.
 */

const SETS = {
  math: [
    { text: 'What is 3/4 + 1/8?', options: ['4/12', '7/8', '1', '5/8'], correct: 1 },
    { text: 'Which fraction is equivalent to 6/9?', options: ['2/3', '3/6', '9/6', '1/3'], correct: 0 },
    { text: 'Simplify 12/16.', options: ['6/9', '3/4', '4/3', '2/4'], correct: 1 },
    { text: 'What is 2/5 of 30?', options: ['6', '10', '12', '15'], correct: 2 },
    { text: 'Solve: 2x + 5 = 17.', options: ['x = 5', 'x = 6', 'x = 11', 'x = 7'], correct: 1 },
    { text: 'What is 15% of 200?', options: ['15', '20', '30', '35'], correct: 2 },
  ],
  science: [
    { text: 'Which gas do plants take in for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correct: 2 },
    { text: 'What gives leaves their green colour?', options: ['Chlorophyll', 'Glucose', 'Starch', 'Xylem'], correct: 0 },
    { text: 'Which organ pumps blood around the body?', options: ['Lungs', 'Heart', 'Liver', 'Kidney'], correct: 1 },
    { text: 'What is the basic unit of life?', options: ['Atom', 'Tissue', 'Cell', 'Organ'], correct: 2 },
    { text: 'Water boils at what temperature at sea level?', options: ['90 °C', '100 °C', '110 °C', '120 °C'], correct: 1 },
    { text: 'Which of these is a source of light?', options: ['The Moon', 'A mirror', 'The Sun', 'Water'], correct: 2 },
  ],
  english: [
    { text: 'Choose the noun: "The girl ran quickly."', options: ['ran', 'quickly', 'girl', 'the'], correct: 2 },
    { text: 'Which is the plural of "child"?', options: ['childs', 'children', 'childes', 'childrens'], correct: 1 },
    { text: 'Pick the antonym of "ancient".', options: ['old', 'modern', 'early', 'past'], correct: 1 },
    { text: 'Which sentence is correct?', options: ['She don’t like it.', 'She doesn’t likes it.', 'She doesn’t like it.', 'She not like it.'], correct: 2 },
    { text: '"As brave as a lion" is a…', options: ['metaphor', 'simile', 'proverb', 'idiom'], correct: 1 },
    { text: 'Choose the verb: "They sing every morning."', options: ['They', 'sing', 'every', 'morning'], correct: 1 },
  ],
  general: [
    { text: 'Sample question 1: which option best describes the key idea?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 1 },
    { text: 'Sample question 2: which example fits the definition?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 2 },
    { text: 'Sample question 3: what happens next in the process?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 0 },
    { text: 'Sample question 4: which statement is true?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 3 },
    { text: 'Sample question 5: which term matches the description?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 1 },
    { text: 'Sample question 6: which is the odd one out?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 2 },
  ],
};

/** PURE: sample questions for the battle simulation (by subject). */
export function sampleBattleQuestions({ subject = '', topic = '', count = 6 } = {}) {
  const s = String(subject).toLowerCase();
  const key = /math/.test(s) ? 'math' : /(science|biolog|chemi|physic|agric)/.test(s) ? 'science' : /(english|literat)/.test(s) ? 'english' : 'general';
  return SETS[key].slice(0, Math.max(3, Math.min(6, count))).map((q) => ({ ...q, topic: topic || null }));
}

const lower = (s) => String(s || '').replace(/^[A-Z]/, (m) => m.toLowerCase()).replace(/\.$/, '');

/** PURE: a sample teaching session: the guide, the learner and the protégé, in order. */
export function sampleSession({ topic = 'the topic', subject = '', concepts = [], objectives = {} } = {}) {
  const list = (concepts.length ? concepts : [topic]).slice(0, 3);
  const msgs = [{ who: 'guide', text: `Welcome! Today you'll teach your protégé about ${topic}${subject ? ` in ${subject}` : ''}. We'll take it one concept at a time; I'll keep you on track.` }];
  list.forEach((c, i) => {
    const [o1, o2] = objectives[c] || [];
    msgs.push({ who: 'guide', text: `${i === 0 ? 'Let’s start with' : i === list.length - 1 ? 'Last one:' : 'Next:'} “${c}”.${o1 ? ` By the end, your protégé should be able to ${lower(o1)}.` : ''} Explain it in your own words.` });
    msgs.push({ who: 'learner', text: `Okay. “${c}” is about how ${lower(topic)} works at this step.${o1 ? ` The main thing is to ${lower(o1)}.` : ''} I'll give an example after.` });
    msgs.push({ who: 'protege', text: i === 0 ? `So if I've got it, “${c}” is the starting point for ${lower(topic)}? Can you give me an example?` : `How does “${c}” connect to what you taught me before?` });
    msgs.push({ who: 'learner', text: o2 ? `Good question. Think of it like this: we ${lower(o2)}. That's the example.` : `Here's an example from everyday life that shows it.` });
    if (i === 0) msgs.push({ who: 'guide', text: 'Nice. Make the example concrete, a real case or a number, so your protégé remembers it.' });
  });
  msgs.push({ who: 'protege', text: `Thanks! I've noted ${list.map((c) => `“${c}”`).join(', ')}. I'll use these when I'm asked about ${lower(topic)}.` });
  msgs.push({ who: 'guide', text: 'Well taught. That’s the session.' });
  return msgs;
}
