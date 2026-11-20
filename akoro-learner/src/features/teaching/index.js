// Teaching feature — public surface.
//
// The screens that run a learning session: the Fortizo reader, the teaching
// guide session, decay review, concept/adaptive controls, the whiteboard and
// the session chat view. Features only see this file; shared code lives in
// src/{components,contexts,hooks,lib,services,utils,client}.
export { default as SessionReaderModal, buildSessionReaderPages, deriveToolContent, useIsMobileView } from './components/SessionReaderModal.jsx';
export { default as TeachAgentModal } from './components/TeachAgentModal.jsx';
export { default as SessionChatView } from './components/SessionChatView.jsx';
export { default as ReaderAsk } from './components/ReaderAsk.jsx';
export { default as ReaderDiscussion } from './components/ReaderDiscussion.jsx';
export { default as ReaderPodcast } from './components/ReaderPodcast.jsx';
export { default as LessonCheckCard } from './components/LessonCheckCard.jsx';
export { default as WhiteboardModal } from './components/WhiteboardModal.jsx';
export { default as DecaySessionModal } from './components/DecaySessionModal.jsx';
export { default as DecayReviewModal } from './components/DecayReviewModal.jsx';
export { default as ConceptTrackerModal } from './components/ConceptTrackerModal.jsx';
export { default as AdaptiveControlsModal } from './components/AdaptiveControlsModal.jsx';
export { default as ConfigModal } from './components/ConfigModal.jsx';
