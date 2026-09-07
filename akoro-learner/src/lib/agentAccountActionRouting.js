/**
 * Decide whether a learner chat turn needs the authenticated account-tool
 * route rather than the ordinary streaming study tutor.
 *
 * This deliberately recognizes explicit account requests only. A standalone
 * sentence such as “I have Maths tomorrow at 8am” remains a normal study
 * conversation; the same detail is routed to account tools when it follows a
 * short task/reminder/scheduling conversation.
 */
const ACCOUNT_ACTION_INTENTS = [
  /\b(remind me|set (?:a )?reminder|create (?:a )?task|add (?:a )?task)\b/i,
  /\b(?:schedule|plan|set) (?:a )?(?:study )?(?:task|to-?do|reminder)\b/i,
  /\b(?:what(?:'s| is) due|my (?:tasks?|to-?dos?|reminders?))\b/i,
  /\b(message|send|notify|check in with) me\b/i,
  /\b(?:schedule|reschedule|cancel)\b(?=[\s\S]{0,60}\b(?:reminder|message|check-?in|follow-?up)\b)/i,
];

// A generic noun such as “task” is not enough to keep a later study turn on
// the account path—“No task was created” must close the flow. Keep only an
// earlier explicit action request or an agent question that is collecting the
// missing task/date/time details.
const ACTION_FOLLOW_UP_QUESTION = /\b(?:what|which)\s+(?:task|subject|date|time)\b|\b(?:when|what time|which date)\b[\s\S]{0,48}\b(?:task|due|deadline|reminder|check-?in)\b|\btask\b[\s\S]{0,48}\b(?:when|due|schedule)\b/i;

export function isAccountActionIntent(text) {
  return ACCOUNT_ACTION_INTENTS.some((re) => re.test(String(text || "")));
}

export function isAccountActionFollowUp(messages = []) {
  return messages.slice(-3).some((message) => {
    const text = String(message?.text || "");
    return isAccountActionIntent(text) || ACTION_FOLLOW_UP_QUESTION.test(text);
  });
}

export function routesToAccountTools(text, messages = []) {
  return isAccountActionIntent(text) || isAccountActionFollowUp(messages);
}
