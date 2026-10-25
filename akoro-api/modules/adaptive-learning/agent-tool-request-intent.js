/**
 * Server-side consent gate for the Agent Chat product-request write tool.
 *
 * A missing tool never authorises the model to transmit a learner's request.
 * This narrow detector merely decides whether `submit_tool_request` can appear
 * in the current unified tool catalogue after the learner explicitly asks to
 * file/submit it. It does not craft a response or select an HTTP endpoint.
 */
const EXPLICIT_TOOL_REQUEST = /\b(?:submit|send|file|forward|share|pass\s+on|create)\s+(?:this|that|it|my|a|an)?\s*(?:as\s+)?(?:a\s+)?(?:(?:feature|tool|integration|product)\s+)?(?:request|suggestion|feedback)\b|\b(?:yes[,! ]+)?(?:please\s+)?(?:submit|send|file)\s+(?:it|this|that)\b|\b(?:tell|ask|notify)\s+(?:the\s+)?(?:akoro\s+)?(?:admin(?:s)?|team)\b.{0,120}\b(?:add|build|consider|integrate|request)\b|\b(?:ask|request|get)\s+(?:(?:an?|the)\s+admins?\s+)?(?:for\s+)?(?:the\s+)?(?:permission|access|approval)\b/i;

/** True only for a learner's clear instruction to send product feedback. */
export function hasExplicitToolRequestConsent(message) {
  const value = String(message || "").replace(/\s+/g, " ").trim();
  return EXPLICIT_TOOL_REQUEST.test(value);
}
