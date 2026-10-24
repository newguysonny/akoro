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
import { draftPreviewScenarios } from './draftPreviews.mjs';

// Every instructor route with no id in it (the console rebuild's screenshots —
// reference/Akoro Console Rebuild — Plan.md). /courses* redirect to Course Creator.
export const INSTRUCTOR_ROUTES = [
  '/', '/courses/schedule', '/course-creator', '/course-creator/courses', '/course-creator/library',
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
    description: 'A screenshot of every instructor route (no ids) — the console rebuild\'s record. UI_GATE_THEME=dark sets the dark theme; UI_GATE_ROUTES=/,/chat limits the routes; UI_GATE_FULL=1 also shoots each screen further down. For a person to look at; a route that throws is a failed check.',
    async run(t) {
      const { page } = t;
      const theme = process.env.UI_GATE_THEME || '';
      const full = process.env.UI_GATE_FULL === '1';
      if (theme) await page.addInitScript((m) => { try { localStorage.setItem('akoro_display_mode', m); } catch { /* private mode */ } }, theme);
      const errors = [];
      page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
      // A render error the ErrorBoundary catches never reaches pageerror: it logs to the console instead.
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|WebSocket connection/.test(m.text())) errors.push(`${page.url()}: console: ${m.text().slice(0, 300)}`); });
      const crashed = [];
      const only = (process.env.UI_GATE_ROUTES || '').split(',').map((r) => r.trim()).filter(Boolean);
      for (const route of only.length ? INSTRUCTOR_ROUTES.filter((r) => only.includes(r)) : INSTRUCTOR_ROUTES) {
        await page.goto(`${t.app}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2500);
        if (await page.getByText('This page ran into a problem').first().isVisible().catch(() => false)) crashed.push(route);
        const shotName = `${(route === '/' ? 'home' : route.slice(1)).replace(/\//g, '_')}${theme ? `.${theme}` : ''}`;
        await t.shot(shotName);
        // UI_GATE_FULL=1: the page scrolls inside the frame, so step down it and shoot each screen (up to 6).
        for (let i = 2; full && i <= 6; i++) {
          const moved = await page.evaluate(() => {
            const scrolls = (e) => e && e.scrollHeight > e.clientHeight + 20 && !e.closest('.ak-sidebar');
            const el = [document.querySelector('.ak-shell-main'), ...document.querySelectorAll('main, [style*="overflow"]'), document.scrollingElement].find(scrolls);
            if (!el || el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return false;
            el.scrollBy(0, el.clientHeight - 60);
            return true;
          }).catch(() => false);
          if (!moved) break;
          await page.waitForTimeout(400);
          await t.shot(`${shotName}.${i}`);
        }
      }
      t.note(`${INSTRUCTOR_ROUTES.length} routes`);
      if (errors.length) t.note(`errors: ${errors.slice(0, 8).join(' | ')}`);
      t.check('no route showed the error screen', crashed.length === 0, { crashed });
      t.check('no route threw', !errors.some((e) => !e.includes('console:')), { errors: errors.slice(0, 10) });
    },
  },
  {
    name: 'instructor.chat_history_pages',
    portal: 'instructor',
    description: 'The instructor chat opens on its newest 10 messages; scrolling to the top loads the earlier ones above, keeping the place.',
    run: (t) => historyPagesCheck(t, { path: '/chat' }),
  },
  ...draftPreviewScenarios,
];
