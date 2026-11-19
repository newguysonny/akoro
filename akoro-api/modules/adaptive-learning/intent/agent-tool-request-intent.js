/**
 * Server-side consent gate for the Agent Chat product-request write tool.
 *
 * A missing tool never authorises the model to transmit a learner's request.
 * This narrow detector merely decides whether `submit_tool_request` can appear
 * in the current unified tool catalogue after the learner explicitly asks to
 * file/submit it. It does not craft a response or select an HTTP endpoint.
 */
const EXPLICIT_TOOL_REQUEST = /\b(?:submit|send|file|forward|share|pass\s+on|create)\s+(?:this|that|it|my|a|an|the|your)?\s*(?:as\s+)?(?:a\s+)?(?:(?:feature|tool|integration|product)\s+)?(?:request|suggestion|feedback)\b|\b(?:yes[,! ]+)?(?:please\s+)?(?:submit|send|file)\s+(?:it|this|that)\b|\b(?:tell|ask|notify)\s+(?:the\s+)?(?:akoro\s+)?(?:admin(?:s)?|team)\b.{0,120}\b(?:add|build|consider|integrate|request)\b|\b(?:ask|request|get)\s+(?:(?:an?|the)\s+admins?\s+)?(?:for\s+)?(?:the\s+)?(?:permission|access|approval)\b/i;

/** True only for a learner's clear instruction to send product feedback. */
export function hasExplicitToolRequestConsent(message, { previousAgentText = "" } = {}) {
  const value = String(message || "").replace(/\s+/g, " ").trim();
  if (EXPLICIT_TOOL_REQUEST.test(value)) return true;
  // A plain "Yes" to the agent's OWN offer to ask the Akoro team (the reply
  // right before it). Consent still comes only from the learner's words: the
  // offer alone, or a yes to something else, permits nothing.
  return agentOfferedRequest(previousAgentText) && plainYes(value);
}

const OFFER = /\b(?:send|file|submit|pass\s+on|forward)\b[^.?!]{0,60}\b(?:request|suggestion|feedback)\b|\b(?:ask|tell)\s+(?:the\s+)?akoro\s+team\b/i;
/** PURE: did the agent's last reply (its closing question) offer to send a request to the Akoro team? */
export function agentOfferedRequest(text) {
  const t = String(text || "");
  // Only the end of the reply: the offer is the question it closes on.
  return OFFER.test(t.slice(-400));
}
const YES = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|alright|please|please do|do it|go ahead|go for it|send it|file it)\b/i;
const NO = /\b(?:no|nope|don'?t|do not|not now|never ?mind|cancel|stop|wait)\b/i;
function plainYes(value) {
  return YES.test(value) && !NO.test(value) && value.length <= 80;
}
