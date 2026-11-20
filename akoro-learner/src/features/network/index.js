// Network feature — public surface.
//
// The learner's agent network: the agents a search finds, the challenge
// requests they can accept, and the presence heartbeat that tells the
// server the app is open. Features only see this file; shared code lives in
// src/{components,contexts,hooks,lib,services,utils,client}.
export { default as AgentCards } from './components/AgentCards.jsx';
export { default as ChallengeRequestCards } from './components/ChallengeRequestCards.jsx';
export { default as PresenceHeartbeat } from './components/PresenceHeartbeat.jsx';
