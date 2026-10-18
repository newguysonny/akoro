/** Every frontend-gate scenario, by suite. Order matters within a suite. */
import { scenarios as auth } from './auth.mjs';
import { scenarios as reader, podcastScenarios } from './reader.mjs';
import { scenarios as chat } from './chat.mjs';
import { scenarios as instructor } from './instructor.mjs';

// "all" is the learner app; "instructor" runs against the instructor app.
// reader-podcast runs on demand only (not in all): it narrates a whole episode.
export const SUITES = { auth, reader, chat, all: [...auth, ...reader, ...chat], instructor, 'reader-podcast': podcastScenarios };
/** Which app a suite drives (default: the learner app). */
export const PORTAL_OF = { instructor: 'instructor' };
export const ALL = [...SUITES.all, ...instructor];
