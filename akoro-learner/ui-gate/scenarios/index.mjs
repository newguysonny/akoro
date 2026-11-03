/** Every frontend-gate scenario, by suite. Order matters within a suite. */
import { scenarios as auth } from './auth.mjs';
import { scenarios as reader, podcastScenarios } from './reader.mjs';
import { scenarios as chat } from './chat.mjs';
import { scenarios as instructor } from './instructor.mjs';
import { scenarios as battles } from './battles.mjs';
import { scenarios as activity } from './activity.mjs';
import { scenarios as onboarding, instructorScenarios as instructorOnboarding } from './onboarding.mjs';

// "all" is the learner app; "instructor" runs against the instructor app.
// reader-podcast runs on demand only (not in all): it narrates a whole episode.
// onboarding / onboarding-instructor: the setup chat, with its writes intercepted (see scenarios/onboarding.mjs) — on demand, not in all.
export const SUITES = { activity, auth, reader, chat, battles, all: [...auth, ...reader, ...chat, ...battles], instructor, 'reader-podcast': podcastScenarios, onboarding, 'onboarding-instructor': instructorOnboarding };
/** Which app a suite drives (default: the learner app). */
export const PORTAL_OF = { instructor: 'instructor', 'onboarding-instructor': 'instructor' };
export const ALL = [...SUITES.all, ...activity, ...instructor, ...onboarding, ...instructorOnboarding];
