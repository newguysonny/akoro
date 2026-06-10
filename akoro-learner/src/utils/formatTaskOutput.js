// formatTaskOutput.js
// Turns a task_output row (produced by the agentic task worker) into a
// readable chat message the learning agent can "say" in conversation.
// Each output has { output_type, content }.

function formatQuiz(c) {
  const qs = c.questions ?? [];
  if (!qs.length) return `I prepared a quiz on ${c.topic || 'your topic'}, but couldn't generate questions this time.`;
  let out = `📝 Here's a ${qs.length}-question quiz on ${c.topic || 'your topic'}:\n`;
  qs.forEach((q, i) => {
    out += `\n${i + 1}. ${q.question}`;
    if (Array.isArray(q.options) && q.options.length) {
      out += `\n${q.options.join('\n')}`;
    }
  });
  out += `\n\nReply with your answers and I'll mark them for you. 💪`;
  return out;
}

function formatExplanation(c) {
  return `💡 ${c.concept ? `${c.concept}\n\n` : ''}${c.text || ''}`.trim();
}

function formatStudyPlan(c) {
  const plan = c.plan ?? [];
  if (!plan.length) return `I drafted a study plan for ${c.subject || 'you'}, but it came back empty — try again?`;
  let out = `🗓️ Your study plan for ${c.subject || 'your subject'}${c.goal ? ` (${c.goal})` : ''}:\n`;
  plan.forEach((d) => {
    const label = d.day != null ? `Day ${d.day}` : 'Day';
    const dur = d.durationMins ? ` · ${d.durationMins} min` : '';
    out += `\n${label}: ${d.focus || ''}${dur}`;
    if (Array.isArray(d.activities) && d.activities.length) {
      out += `\n  • ${d.activities.join('\n  • ')}`;
    }
  });
  return out;
}

function formatReminder(c) {
  const when = c.remindAt ? ` for ${new Date(c.remindAt).toLocaleString()}` : '';
  return `⏰ Reminder set${when}:\n"${c.message || ''}"\n\nI'll nudge you so you don't forget.`;
}

function formatBattle(c) {
  return `⚔️ Challenge created on ${c.topic || 'your topic'}! Head to the Battles tab to see it — your opponent has been notified.`;
}

function formatMessage(c) {
  return c.text || '';
}

const FORMATTERS = {
  quiz:        formatQuiz,
  explanation: formatExplanation,
  study_plan:  formatStudyPlan,
  reminder:    formatReminder,
  battle:      formatBattle,
  message:     formatMessage,
};

// Convert one output row → chat text. Returns null if nothing renderable.
export function formatTaskOutput(output) {
  const content = output?.content ?? {};
  const type = output?.output_type ?? content.type;
  const fn = FORMATTERS[type];
  if (!fn) return null;
  const text = fn(content);
  return text && text.trim() ? text : null;
}

// Convert a list of outputs → chat texts. Prefers structured outputs over
// the generic "message" summary, but falls back to it when nothing else renders.
export function formatTaskOutputs(outputs = []) {
  const structured = outputs.filter(o => (o.output_type ?? o.content?.type) !== 'message');
  const chosen = structured.length ? structured : outputs;
  return chosen.map(formatTaskOutput).filter(Boolean);
}
