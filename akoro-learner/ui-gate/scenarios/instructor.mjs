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

// Every instructor route with no id in it (the console rebuild's baseline and
// its legacy/next pairs — reference/Akoro Console Rebuild — Plan.md).
export const INSTRUCTOR_ROUTES = [
  '/', '/courses', '/courses/schedule', '/courses/manage', '/course-creator', '/course-creator/courses', '/course-creator/library',
  '/sales', '/orders', '/students', '/battles', '/tasks', '/self-study', '/activities', '/submissions', '/wallet',
  '/lesson-review', '/documents', '/assessments', '/chat',
  '/mgmt/students', '/mgmt/join-requests', '/mgmt/attendance', '/mgmt/behavior', '/mgmt/curriculum', '/mgmt/syllabus',
  '/mgmt/subjects', '/mgmt/gradebook', '/mgmt/my-timetable', '/mgmt/timetable', '/mgmt/weekly-forecast', '/mgmt/daily-schedule',
  '/settings', '/agent-tools', '/profile', '/marketplace', '/apps', '/library', '/notifications', '/privacy', '/terms',
];

export const scenarios = [
  {
    name: 'instructor.routes_baseline',
    portal: 'instructor',
    description: 'A screenshot of every instructor route (no ids) — the console rebuild\'s before/after record. UI_GATE_UI=legacy|next adds ?ui= to each; UI_GATE_THEME=dark sets the dark theme; UI_GATE_ROUTES=/,/chat limits the routes. For a person to look at; a route that throws is a failed check.',
    async run(t) {
      const { page } = t;
      const ui = process.env.UI_GATE_UI || '';
      const theme = process.env.UI_GATE_THEME || '';
      if (theme) await page.addInitScript((m) => { try { localStorage.setItem('akoro_display_mode', m); } catch { /* private mode */ } }, theme);
      const errors = [];
      page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
      const only = (process.env.UI_GATE_ROUTES || '').split(',').map((r) => r.trim()).filter(Boolean);
      for (const route of only.length ? INSTRUCTOR_ROUTES.filter((r) => only.includes(r)) : INSTRUCTOR_ROUTES) {
        const url = `${t.app}${route}${ui ? `${route.includes('?') ? '&' : '?'}ui=${ui}` : ''}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2500);
        await t.shot(`${(route === '/' ? 'home' : route.slice(1)).replace(/\//g, '_')}${ui ? `.${ui}` : ''}${theme ? `.${theme}` : ''}`);
      }
      t.note(`${INSTRUCTOR_ROUTES.length} routes`);
      t.check('no route threw', errors.length === 0, { errors: errors.slice(0, 10) });
    },
  },
  {
    name: 'instructor.chat_history_pages',
    portal: 'instructor',
    description: 'The instructor chat opens on its newest 10 messages; scrolling to the top loads the earlier ones above, keeping the place.',
    run: (t) => historyPagesCheck(t, { path: '/chat' }),
  },
];
