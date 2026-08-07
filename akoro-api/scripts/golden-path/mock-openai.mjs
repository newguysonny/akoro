/**
 * mock-openai.mjs — a stand-in for the chat-completions API.
 *
 * It exists so the golden-path tests can drive every AI-backed path — the task
 * agent loop, teaching tools, battle question generation, tutor chat — without
 * a live key and without paying per run.
 *
 * What this DOES prove: routing, tool selection plumbing, argument validation,
 * DB writes, coin charging, output persistence, and every failure branch.
 * What it CANNOT prove: whether the real model picks the right tool or writes
 * good questions. That needs a real key, and the tests say so rather than
 * implying otherwise.
 *
 * Replies are shaped from the request: if tools were offered it returns a
 * tool_call; otherwise it returns JSON matching whatever the caller asked for.
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4900);
const calls = [];

/** Which tool should a given brief select? Mirrors what a real model would do. */
function pickTool(names, text) {
  const t = text.toLowerCase();
  const has = (n) => names.includes(n);
  if (has('assign_battle')     && /battle|challenge|speed round|competition/.test(t)) return 'assign_battle';
  if (has('assign_self_study') && /self study|self-study|independent study/.test(t)) return 'assign_self_study';
  if (has('run_teaching_tool') && /podcast|hook|misconception|vocabulary|essay|lesson plan|assignment/.test(t)) return 'run_teaching_tool';
  return names[0];
}

function toolArgs(name, text) {
  const cls = (text.match(/\b(JSS ?\d|SS ?\d)\b/i) || [])[0]?.replace(/\s+/g, '') ?? 'JSS1';
  if (name === 'assign_battle')
    return { title: 'Weekly class battle', audience: 'class', className: cls, subject: 'Mathematics', totalQuestions: 8, difficulty: 'intermediate', questionSource: 'bank' };
  if (name === 'assign_self_study')
    return { topic: 'The water cycle', subject: 'Basic Science', audience: 'class', className: cls, title: 'Water cycle — self study' };
  if (name === 'run_teaching_tool')
    return { tool: 'lesson-hooks', topic: 'Photosynthesis', subject: 'Basic Science', class: cls };
  return {};
}

/** Content replies, shaped to whatever JSON the caller's prompt asked for. */
function contentFor(prompt) {
  const p = prompt.toLowerCase();

  if (p.includes('"questions"')) {                       // battle question generation
    const n = Number((prompt.match(/write (\d+)/i) || [])[1] || 5);
    return JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({
      stem: `Mock question ${i + 1}: which process moves water from a leaf to the air?`,
      options: [{ label: 'A', text: 'Respiration' }, { label: 'B', text: 'Transpiration' },
                { label: 'C', text: 'Condensation' }, { label: 'D', text: 'Precipitation' }],
      answer: 'B', explanation: 'Transpiration is water loss through stomata.',
      topic: 'Water cycle', difficulty: 'medium',
    })) });
  }
  if (p.includes('"cards"'))                             // teaching tools with a doc output
    return JSON.stringify({ title: 'Mock lesson hooks', summary: 'Five openers.',
      cards: [{ heading: 'Hook 1', body: 'Ask who has seen dew on grass at dawn.' },
              { heading: 'Hook 2', body: 'Show a wilted plant and a watered one.' }] });
  if (p.includes('"turns"'))                             // podcast
    return JSON.stringify({ title: 'Mock episode', summary: 'A short one.',
      turns: [{ speaker: 'Ade', text: 'Welcome!' }, { speaker: 'Ngozi', text: 'Today: photosynthesis.' }] });
  if (p.includes('"subtopics"'))                         // self-study plan
    return JSON.stringify({ subtopics: ['Evaporation', 'Condensation', 'Precipitation'],
      objectives: { Evaporation: ['Explain how water becomes vapour'] } });
  if (p.includes('subtopic'))
    return JSON.stringify(['Evaporation', 'Condensation', 'Precipitation']);
  return 'This is a mock reply from the stand-in model.';
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}
    const msgs   = payload.messages ?? [];
    const prompt = msgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const names  = (payload.tools ?? []).map((t) => t.function?.name ?? t.name).filter(Boolean);
    calls.push({ url: req.url, tools: names, promptHead: prompt.slice(0, 80) });

    // A real model calls a tool, reads the result, and then ANSWERS. Mirror
    // that: if a tool result is already in the conversation, stop calling.
    const alreadyRan = msgs.some((m) => m.role === 'tool');

    let message;
    if (names.length && !alreadyRan) {
      const name = pickTool(names, prompt);
      message = { role: 'assistant', content: null, tool_calls: [{
        id: `call_${calls.length}`, type: 'function',
        function: { name, arguments: JSON.stringify(toolArgs(name, prompt)) },
      }] };
    } else {
      message = { role: 'assistant', content: contentFor(prompt) };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
      model: payload.model || 'gpt-4o-mini',
      choices: [{ index: 0, message, finish_reason: names.length ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 },
    }));
  });
}).listen(PORT, () => console.log(`mock model on :${PORT}`));

process.on('SIGTERM', () => { console.log(JSON.stringify(calls, null, 1)); process.exit(0); });
