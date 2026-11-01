/**
 * Suites "onboarding" (learner app) and "onboarding-instructor" — the conversational onboarding, driven
 * through the real chat as a test account against the real API's read endpoints (the teacher and school
 * directories, the prefill lookup).
 *
 * A test account is already onboarded, so each scenario shows the app a not-yet-onboarded session: the
 * stored user reads onboardingCompleted:false and /api/auth/me is served with the same flag. Every WRITE
 * the onboarding makes (PATCH /api/profiles/me, PUT /api/user/agent, the teacher/school join request) is
 * intercepted in the browser and recorded, never sent: the scenario asserts the exact bodies the app
 * would have sent, nothing about the account changes, no real teacher or school admin gets a request,
 * and there is nothing to clean up on the server.
 */

/** Make the page's session look un-onboarded: the stored user, and the server's answer for "who am I". */
async function showUnonboarded(t, { meBody }) {
  const { page } = t;
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      const v = get.call(this, k);
      if (k === 'akoro_user' && v && get.call(sessionStorage, '__ob_gate')) {
        try { return JSON.stringify({ ...JSON.parse(v), onboardingCompleted: false }); } catch { /* not JSON */ }
      }
      return v;
    };
  });
  await page.goto(`${t.app}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('__ob_gate', '1'));
  await page.route('**/api/auth/me', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...meBody, onboardingCompleted: false } }) });
  });
  t.cleanup(async () => {
    await page.unroute('**/api/auth/me').catch(() => {});
    await page.evaluate(() => sessionStorage.removeItem('__ob_gate')).catch(() => {});
  });
}

/** Record (never send) the writes at `pattern`; any other method on it goes through untouched. */
async function captureWrites(t, pattern, method, into) {
  await t.page.route(pattern, (route) => {
    const req = route.request();
    if (req.method() !== method) return route.continue();
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { /* not JSON */ }
    into.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });
  t.cleanup(() => t.page.unroute(pattern).catch(() => {}));
}

const composer = (page) => page.locator('.ob-composer input').last();
const sendButton = (page) => page.getByRole('button', { name: 'Send message' });
const chipNames = async (page) => (await page.locator('.ob-q button').allInnerTexts()).map((x) => x.trim());
const settle = (page) => page.waitForTimeout(1_000);   // Ako types for ~0.6s before each question

export const scenarios = [
  {
    name: 'onboarding.conversation',
    description: 'The learner onboarding as a chat: required answers cannot be skipped, optional ones can, class/school/teacher are found by searching, and the app sends exactly the saves the old form made (intercepted, not sent).',
    async run(t) {
      const { page } = t;
      const me = await t.api('GET', '/api/auth/me');
      if (!me.body?.data?.id) t.block(`could not read the test account (/api/auth/me answered ${me.status})`);
      const teachers = (await t.api('GET', '/api/profiles/directory/teachers')).body?.data || [];
      if (!teachers.length) t.block('the teacher directory is empty, so the required teacher step cannot be exercised');
      const schools = (await t.api('GET', '/api/profiles/directory/schools')).body?.data || [];
      const teacher = teachers[0];

      const profile = []; const agent = []; const request = [];
      await showUnonboarded(t, { meBody: me.body.data });
      await captureWrites(t, '**/api/profiles/me', 'PATCH', profile);
      await captureWrites(t, '**/api/user/agent', 'PUT', agent);
      await captureWrites(t, '**/api/profiles/me/teacher-request', 'POST', request);

      await page.goto(`${t.app}/onboarding`, { waitUntil: 'domcontentloaded' });
      t.check('an un-onboarded session lands on the onboarding chat', await page.waitForSelector('.ob-terms', { timeout: 45_000 }).then(() => true, () => false), { actual: page.url() });
      const backs = await page.getByRole('button', { name: /back/i }).allInnerTexts();
      t.check('Ako speaks first', (await page.locator('.ob-bubble').count()) >= 1);
      t.check('there is no Back button', backs.length === 0, { actual: backs });

      // 1 · terms — required
      t.check('terms: send is disabled until the box is ticked', await sendButton(page).isDisabled());
      await page.locator('.ob-terms input').check(); await sendButton(page).click(); await settle(page);
      // 2 · name — required
      t.check('name: send is disabled while empty', await sendButton(page).isDisabled());
      await composer(page).fill('Gate Tester'); await sendButton(page).click(); await settle(page);
      // 3 · level (required) + class (optional)
      // A learner a teacher already added is asked "…says you're in JSS 2 — is that right?" first; anyone else goes straight to the levels.
      const changeIt = page.getByRole('button', { name: 'No, change it' });
      const level = page.getByRole('button', { name: 'Junior Secondary' });
      await Promise.race([changeIt.waitFor({ timeout: 15_000 }), level.waitFor({ timeout: 15_000 })]).catch(() => {});
      if (await changeIt.isVisible()) {
        t.check('prefill: the learner can confirm what is on file', (await chipNames(page)).includes("Yes, that's right"));
        t.note('this account has a class on file, so the prefill question was asked');
        await changeIt.click(); await settle(page);
      }
      t.check('level: send is disabled until a level is chosen', await sendButton(page).isDisabled());
      await level.click(); await settle(page);
      t.check('class: it can be skipped', (await chipNames(page)).includes('Skip'));
      await page.getByRole('button', { name: 'JSS 2', exact: true }).click(); await sendButton(page).click(); await settle(page);
      // 4 · school — optional, searchable
      t.check('school: it can be skipped', (await chipNames(page)).some((c) => /learn on my own/i.test(c)));
      t.check('school: a search box is shown in the chat', (await page.locator('.ob-search').count()) === 1);
      let schoolSent = '';
      if (schools.length) {
        const s = schools[0];
        await composer(page).fill(String(s.name).slice(0, 6));
        t.equal('school: the chat search box mirrors what is typed in the composer', (await page.locator('.ob-search').innerText()).trim(), String(s.name).slice(0, 6).trim());
        const card = page.locator('.ob-tcard', { hasText: s.name }).first();
        t.check('school: searching lists the school', await card.waitFor({ timeout: 10_000 }).then(() => true, () => false), { expected: s.name });
        await card.click();
        t.equal('school: tapping a result puts its name in the composer', await composer(page).inputValue(), s.name);
        schoolSent = s.name;
      } else {
        await composer(page).fill('Gate Test School'); schoolSent = 'Gate Test School';
        t.note('the school directory is empty on this API; the school was typed instead of searched');
      }
      await sendButton(page).click(); await settle(page);
      // 5 · subjects — optional
      t.check('subjects: they can be skipped', (await chipNames(page)).includes('Skip for now'));
      // Subjects a teacher put on file arrive pre-picked: start from a clean slate, then pick two.
      for (let i = 0; i < 40 && (await page.locator('.ob-q button.on').count()) > 0; i++) await page.locator('.ob-q button.on').first().click();
      await page.getByRole('button', { name: 'Mathematics' }).click(); await page.getByRole('button', { name: 'English Language' }).click();
      await sendButton(page).click();
      // 6 · agent — name required
      await page.waitForSelector('.ob-avas', { timeout: 20_000 }); await settle(page);
      t.check('agent: send is disabled until it has a name', await sendButton(page).isDisabled());
      await page.locator('.ob-avopt').nth(3).click(); await composer(page).fill('Gate Bot'); await sendButton(page).click();
      // 7 · teacher — required, searchable, no skip
      await page.waitForSelector('.ob-search', { timeout: 20_000 }); await settle(page);
      t.check('teacher: there is no skip chip', (await chipNames(page)).length === 0, { actual: await chipNames(page) });
      // A learner a teacher already added has that teacher on file, so the card is pre-selected; for anyone else send waits for a pick.
      const prefilled = (await t.api('GET', '/api/profiles/onboarding-prefill')).body?.data?.teacherId || null;
      const sendOff = await sendButton(page).isDisabled();
      t.check(prefilled ? 'teacher: the teacher already on file is pre-selected (send is enabled)' : 'teacher: send is disabled until one is picked', prefilled ? !sendOff : sendOff, { actual: { prefilled, sendDisabled: sendOff } });
      const query = String(teacher.full_name || teacher.username).slice(0, 6);
      await composer(page).fill(query);
      const tcard = page.locator('.ob-tcard', { hasText: teacher.full_name || teacher.username }).first();
      t.check('teacher: searching lists the teacher', await tcard.waitFor({ timeout: 10_000 }).then(() => true, () => false), { expected: teacher.full_name });
      await tcard.click();
      t.check('teacher: send is enabled once one is picked', await sendButton(page).isEnabled());
      await t.shot('teacher-picked');
      await sendButton(page).click();
      // 8 · preferences — defaults can be sent as they are
      await page.waitForSelector('.ob-seg', { timeout: 20_000 }); await settle(page);
      await sendButton(page).click();
      t.check('the summary appears', await page.waitForSelector('.ob-sum', { timeout: 20_000 }).then(() => true, () => false));
      await t.shot('done');

      // What the app would have saved — the old form's exact requests.
      t.equal('one profile save', profile.length, 1);
      const p = profile[0] || {};
      t.equal('profile: fullName', p.fullName, 'Gate Tester');
      t.equal('profile: studyLevel', p.studyLevel, 'Junior Secondary');
      t.equal('profile: yearGroup', p.yearGroup, 'JSS 2');
      t.equal('profile: schoolName', p.schoolName, schoolSent);
      t.check('profile: subjects include the two picked', ['Mathematics', 'English Language'].every((x) => (p.subjects || []).includes(x)), { actual: p.subjects });
      t.equal('profile: onboardingCompleted', p.onboardingCompleted, true);
      t.check('profile: language, displayMode and accentColor are included', !!p.language && !!p.displayMode && !!p.accentColor, { actual: [p.language, p.displayMode, p.accentColor] });
      t.equal('one agent save', agent.length, 1);
      const a = agent[0] || {};
      t.equal('agent: name', a.agent_name, 'Gate Bot');
      t.equal('agent: emoji', a.agent_emoji, '🦉');
      t.equal('agent: study_level', a.study_level, 'Junior Secondary');
      t.equal('agent: year_group', a.year_group, 'JSS 2');
      t.equal('one teacher join request, for the picked teacher', request.length === 1 ? request[0]?.teacher_id : request.length, teacher.id);

      // Start learning → the dashboard. The real server answer returns first (it says onboarded).
      await page.unroute('**/api/auth/me').catch(() => {});
      await page.getByRole('button', { name: /Start learning/ }).click();
      t.check('Start learning lands on /app', await page.waitForURL(/\/app(\?|$)/, { timeout: 30_000 }).then(() => true, () => false), { actual: page.url() });
    },
  },
];

export const instructorScenarios = [
  {
    name: 'onboarding.instructor_conversation',
    portal: 'instructor',
    description: 'The instructor onboarding as a chat: name, school (required, found by searching) and a subject are required, the guide name can be skipped, and the app sends exactly the old form\'s saves (intercepted, not sent).',
    async run(t) {
      const { page } = t;
      const me = await t.api('GET', '/api/auth/me');
      if (!me.body?.data?.id) t.block(`could not read the test account (/api/auth/me answered ${me.status})`);
      const schools = (await t.api('GET', '/api/profiles/directory/schools')).body?.data || [];
      if (!schools.length) t.block('the school directory is empty, so the required school step cannot be exercised');
      const school = schools[0];

      const profile = []; const request = [];
      await showUnonboarded(t, { meBody: me.body.data });
      await captureWrites(t, '**/api/profiles/me', 'PATCH', profile);
      await captureWrites(t, '**/api/profiles/me/school-request', 'POST', request);

      await page.goto(`${t.app}/onboarding`, { waitUntil: 'domcontentloaded' });
      t.check('an un-onboarded instructor lands on the onboarding chat', await page.waitForSelector('.ob-composer input:not([disabled])', { timeout: 45_000 }).then(() => true, () => false), { actual: page.url() });
      await settle(page);
      // 1 · name — required (the account's own name arrives pre-filled; clear it to check the rule)
      await composer(page).fill('');
      t.check('name: send is disabled while empty', await sendButton(page).isDisabled());
      await composer(page).fill('Dr. Gate Tester'); await sendButton(page).click();
      // 2 · school — required, searchable, no skip
      await page.waitForSelector('.ob-search', { timeout: 20_000 }); await settle(page);
      t.check('school: there is no skip chip', (await chipNames(page)).length === 0, { actual: await chipNames(page) });
      t.check('school: send is disabled until one is picked', await sendButton(page).isDisabled());
      await composer(page).fill(String(school.name).slice(0, 6));
      t.equal('school: the chat search box mirrors the composer', (await page.locator('.ob-search').innerText()).trim(), String(school.name).slice(0, 6).trim());
      const card = page.locator('.ob-tcard', { hasText: school.name }).first();
      t.check('school: searching lists the school', await card.waitFor({ timeout: 10_000 }).then(() => true, () => false), { expected: school.name });
      await card.click();
      t.check('school: send is enabled once one is picked', await sendButton(page).isEnabled());
      await t.shot('school-picked');
      await sendButton(page).click(); await settle(page);
      // 3 · subjects — at least one required
      t.check('subjects: send is disabled until one is picked', await sendButton(page).isDisabled());
      t.check('subjects: no skip chip', !(await chipNames(page)).some((c) => /skip/i.test(c)));
      await page.getByRole('button', { name: 'Physics' }).click(); await page.getByRole('button', { name: 'Chemistry' }).click();
      await sendButton(page).click();
      // 4 · guide — name optional
      await page.waitForSelector('.ob-avas', { timeout: 20_000 }); await settle(page);
      t.check('guide: the name can be skipped', (await chipNames(page)).includes('Skip the name'));
      await page.locator('.ob-avopt').nth(6).click();
      await page.getByRole('button', { name: 'Skip the name' }).click();
      t.check('the summary appears', await page.waitForSelector('.ob-sum', { timeout: 20_000 }).then(() => true, () => false));
      await t.shot('done');

      t.equal('one profile save', profile.length, 1);
      const p = profile[0] || {};
      t.equal('profile: fullName', p.fullName, 'Dr. Gate Tester');
      t.equal('profile: schoolName', p.schoolName, school.name);
      t.check('profile: subjects', JSON.stringify(p.subjects) === JSON.stringify(['Physics', 'Chemistry']), { actual: p.subjects });
      t.equal('profile: guideEmoji', p.guideEmoji, '🦉');
      t.check('profile: a skipped guide name is not sent', p.teachingGuide === undefined, { actual: p.teachingGuide });
      t.equal('profile: onboardingCompleted', p.onboardingCompleted, true);
      t.equal('one school join request, for the picked school', request.length === 1 ? request[0]?.school_id : request.length, school.id);

      await page.unroute('**/api/auth/me').catch(() => {});
      await page.getByRole('button', { name: /Go to dashboard/ }).click();
      t.check('Go to dashboard leaves the onboarding', await page.waitForFunction(() => !location.pathname.startsWith('/onboarding'), null, { timeout: 30_000 }).then(() => true, () => false), { actual: page.url() });
    },
  },
];
