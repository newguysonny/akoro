/** Every frontend-gate scenario, by suite. Order matters within a suite. */
import { scenarios as auth } from './auth.mjs';
import { scenarios as reader } from './reader.mjs';
import { scenarios as chat } from './chat.mjs';
import { scenarios as instructor } from './instructor.mjs';

// "all" is the learner app; "instructor" runs against the instructor app.
export const SUITES = { auth, reader, chat, all: [...auth, ...reader, ...chat], instructor };
/** Which app a suite drives (default: the learner app). */
export const PORTAL_OF = { instructor: 'instructor' };
export const ALL = [...SUITES.all, ...instructor];
