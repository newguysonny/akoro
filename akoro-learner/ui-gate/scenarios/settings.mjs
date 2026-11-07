/**
 * Suite "settings" — the profile drawer (phones) and the grouped Settings pages, as a test learner on the real app
 * and API. Read-only: it opens pages and taps cards, it saves nothing.
 */
const ACCOUNT = ['profile', 'learn', 'personalization', 'notifications', 'plan', 'security', 'help'];
const AGENT = ['agent-profile', 'agent-study', 'agent-goals', 'agent-focus', 'agent-autonomy', 'agent-memory', 'agent-tools', 'agent-network'];

export const scenarios = [
  {
    name: 'settings.groups',
    description: 'Settings home lists a card per group; a card opens its own page with a back arrow; Agent tab has its own cards and the tab is remembered; a bad address goes back to Settings.',
    async run(t) {
      const { page } = t;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${t.app}/settings`, { waitUntil: 'domcontentloaded' });
      for (const k of ACCOUNT) t.check(`account card: ${k}`, await page.getByTestId(`settings-card-${k}`).waitFor({ timeout: 25_000 }).then(() => true, () => false));
      t.check('the old quick-link cards are gone', (await page.getByText('Your payments & receipts').count()) === 0);
      await t.shot('home');

      await page.getByTestId('settings-card-learn').click();
      t.check('Learn & Study opens its own page', await page.getByTestId('settings-group-title').filter({ hasText: 'Learn & Study' }).waitFor({ timeout: 10_000 }).then(() => true, () => false));
      t.check('the address is /settings/learn', new URL(page.url()).pathname === '/settings/learn', { url: page.url() });
      t.check('only its options are shown (no Profile or Notifications section)', (await page.getByText('Full Name', { exact: true }).count()) === 0);
      await t.shot('learn');
      await page.getByRole('button', { name: 'Back to settings' }).click();
      t.check('back returns to the home', await page.getByTestId('settings-card-learn').waitFor({ timeout: 10_000 }).then(() => true, () => false));

      // Agent pages
      await page.goto(`${t.app}/settings/agent/memory`, { waitUntil: 'domcontentloaded' });
      t.check('an agent page opens directly', await page.getByTestId('settings-group-title').filter({ hasText: 'Memory' }).waitFor({ timeout: 25_000 }).then(() => true, () => false));
      await page.getByRole('button', { name: 'Back to settings' }).click();
      for (const k of AGENT) t.check(`agent card: ${k}`, await page.getByTestId(`settings-card-${k}`).waitFor({ timeout: 15_000 }).then(() => true, () => false));
      await t.shot('agent-home');

      await page.goto(`${t.app}/settings/not-a-group`, { waitUntil: 'domcontentloaded' });
      t.check('an unknown group goes back to Settings', await page.getByTestId('settings-card-profile').waitFor({ timeout: 25_000 }).then(() => true, () => false) && new URL(page.url()).pathname === '/settings', { url: page.url() });
      t.check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
    },
  },
  {
    name: 'settings.profile_drawer',
    description: 'Phones: the profile photo opens the drawer (name, settings icon, tier pill, the learner\'s pages, log out) and a row navigates. Desktop: the photo goes straight to Settings.',
    async run(t) {
      const { page } = t;
      await page.goto(`${t.app}/app`, { waitUntil: 'domcontentloaded' });
      const photo = page.getByTestId('header-profile');
      t.check('the header has the profile photo', await photo.waitFor({ timeout: 30_000 }).then(() => true, () => false));
      const phone = (page.viewportSize()?.width || 0) <= 768;
      await photo.click();
      if (!phone) {
        await page.waitForURL(/\/settings$/, { timeout: 15_000 }).catch(() => {});
        t.check('desktop: the photo goes straight to Settings', new URL(page.url()).pathname === '/settings', { url: page.url() });
        return;
      }
      const drawer = page.getByTestId('profile-drawer');
      t.check('phone: the drawer opens', await drawer.waitFor({ timeout: 10_000 }).then(() => true, () => false));
      for (const k of ['orders', 'library', 'wallet']) t.check(`row: ${k}`, (await page.getByTestId(`drawer-${k}`).count()) === 1);
      t.check('Activities (or Communities for higher-ed) is listed', (await page.getByTestId('drawer-activities').count()) + (await page.getByTestId('drawer-communities').count()) === 1);
      t.check('the tier pill is there', (await page.getByTestId('drawer-tier').count()) === 1);
      t.check('the settings icon and log out are there', (await page.getByTestId('drawer-settings').count()) === 1 && (await page.getByTestId('drawer-logout').count()) === 1);
      await t.shot('drawer');
      await page.keyboard.press('Escape');
      t.check('Escape closes it', await drawer.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false));
      await photo.click();
      await page.getByTestId('drawer-orders').click();
      await page.waitForURL(/\/orders/, { timeout: 15_000 }).catch(() => {});
      t.check('Order history opens from the drawer', new URL(page.url()).pathname === '/orders', { url: page.url() });
      await page.goto(`${t.app}/app`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('header-profile').click();
      await page.getByTestId('drawer-settings').click();
      await page.waitForURL(/\/settings$/, { timeout: 15_000 }).catch(() => {});
      t.check('the settings icon opens Settings', new URL(page.url()).pathname === '/settings', { url: page.url() });
    },
  },
];
