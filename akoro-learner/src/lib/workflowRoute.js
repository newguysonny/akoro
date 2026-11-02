/**
 * workflowRoute.js — deterministic routing from a dashboard descriptor
 * (GET /api/workflows/dashboard/:id, Grand Plan §13.1) to what opens.
 * PURE. The server decides the surface from the workflow's type and state;
 * the app never infers it from a session's shape.
 *
 *   workflowIdFromSearch(search)   the ?workflow=<uuid> deep link, or null
 *   openFor(descriptor)            → { kind, ...what that surface needs } | null
 *     kind: 'teaching' | 'decay_review' | 'assessment' | 'agent_chat' | 'battle'
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workflowIdFromSearch(search) {
  const id = new URLSearchParams(search || '').get('workflow');
  return id && UUID.test(id) ? id : null;
}

export function openFor(descriptor) {
  const route = descriptor?.action?.route;
  if (!route?.workflowId) return null;
  const p = route.params || {};
  switch (route.surface) {
    case 'teaching_modal':
      return { kind: 'teaching', workflowId: route.workflowId, topic: p.topic || descriptor.title || null, subject: p.subject || null,
        mode: p.mode === 'continuation' ? 'continuation' : 'fresh', sessionId: p.adaptiveSessionId || null };
    case 'decay_review_modal':
      return { kind: 'decay_review', workflowId: route.workflowId, topic: p.topic || null, subject: p.subject || null };
    case 'assessment_room':
      return { kind: 'assessment', workflowId: route.workflowId, topic: p.topic || null, subject: p.subject || null, assessmentId: p.assessmentId || null };
    case 'agent_chat':
      return { kind: 'agent_chat', workflowId: route.workflowId };
    case 'battle':
      return p.battleId && UUID.test(p.battleId) ? { kind: 'battle', workflowId: route.workflowId, battleId: p.battleId } : null;
    default:
      return null;
  }
}
