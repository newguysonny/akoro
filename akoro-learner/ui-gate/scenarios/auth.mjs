/**
 * Suite "auth" — signing in through the real form, as a test learner.
 */
import { DEVICES } from '../lib/gate.mjs';

export const scenarios = [
  {
    name: 'auth.signin_form',
    description: 'The sign-in form signs a test learner in and lands on the dashboard.',
    async run(t) {
      // Its own signed-out browser, the size of this device.
      const fresh = await t.context.browser().newContext({ ...DEVICES[t.device], ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, serviceWorkers: 'block' });
      t.cleanup(() => fresh.close());
      const page = await fresh.newPage();
      await page.goto(`${t.app}/signin`, { waitUntil: 'domcontentloaded' });
      await page.locator('input[type=email]').fill(t.learner.email);
      await page.locator('input[type=password]').fill(process.env.UI_GATE_PASSWORD || 'Password123!');
      await page.locator('button[type=submit]').click();
      t.check('signing in lands on /app', await page.waitForURL(/\/app(\?|$)/, { timeout: 30_000 }).then(() => true, () => false), { actual: page.url() });
      const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('akoro_user')); } catch { return null; } });
      t.equal('the app knows who signed in', stored?.username, t.learner.username);
    },
  },
];
