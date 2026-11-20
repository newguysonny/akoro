// PHARM.D feature — public surface.
//
// The PHARM.D discovery screen and its topic session. Features only see
// this file; shared code lives in
// src/{components,contexts,hooks,lib,services,utils,client}.
export { default } from './pages/PharmDProgram.jsx';
export { default as PharmDProgram } from './pages/PharmDProgram.jsx';
export { default as PharmDTopicSession } from './components/PharmDTopicSession.jsx';
export { ACCENTS, AUTHOR, PROGRAM, accentFor } from './lib/pharmdData.js';
