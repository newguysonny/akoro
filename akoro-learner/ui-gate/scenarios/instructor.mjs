/**
 * Suite "instructor" — the instructor app, signed in as an instructor test
 * account (tester51/tester52, 2026-seed-instructor-testers.sql).
 *
 * chat.history_pages: the instructor chat loads history a page at a time —
 * the newest 10 on open, the page before when scrolled to the top, with the
 * reading position kept. Makes its own chat (named with a run marker) with
 * 13 messages through the API and deletes it at the end.
 */
import { historyPagesCheck } from './chat.mjs';

export const scenarios = [
  {
    name: 'instructor.chat_history_pages',
    portal: 'instructor',
    description: 'The instructor chat opens on its newest 10 messages; scrolling to the top loads the earlier ones above, keeping the place.',
    run: (t) => historyPagesCheck(t, { path: '/chat' }),
  },
];
