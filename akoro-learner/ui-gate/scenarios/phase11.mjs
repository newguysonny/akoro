/**
 * Suite "phase11" — the Phase 11 screens (previews approved 2026-11-07), in
 * the real app as a test learner. The server answers are sample data (routes
 * mocked) so the screens show every state; nothing is written.
 *   home.needs_you_card   Home leads with the run most worth continuing and
 *                         links to Tasks → Needs you (one list, two places)
 *   chat.model_picker     plan badge, cost per message, a plan-locked model,
 *                         the confirm on a dearer model
 */
const WF = '0b0b0b0b-1111-4222-8333-444444444444';
const dashboard = {
  workflows: [{ workflowId: 'aaaaaaaa-1111-4222-8333-444444444444', title: 'Agent Check · Algebra', needsYou: null, action: { label: 'Watch', route: { href: '/app?tab=battles' } }, progress: { label: '2 of 5 answered' } }],
  needsYou: {
    items: [
      { ref: 'i:x', source: 'suggestion', category: 'decision', title: 'Join the Friday revision circle?', waitsFor: { label: 'Yes or no' }, action: { label: 'Decide', href: '/app?tab=agent&inbox=x' } },
      { ref: `w:${WF}`, source: 'workflow', category: 'answer', title: 'Teaching: Transpiration', waitsFor: { label: 'Your turn to teach' }, progress: { label: '1 of 3 parts' },
        badge: { tone: 'your_turn', label: 'Teaching' }, action: { label: 'Continue teaching', href: `/app?workflow=${WF}` } },
      { ref: 'w:p', source: 'workflow', category: 'blocked', title: 'Study Prep · Mathematics', waitsFor: { label: 'Paused until you resume it' },
        badge: { tone: 'paused', label: 'Paused' }, action: { label: 'Resume', href: '/app?tab=agent' } },
    ],
    counts: { total: 3, answer: 1, decision: 1, blocked: 1 },
  },
};
const models = {
  modes: [{ id: 'default', model: 'gpt-4o-mini', kind: 'Fast', description: 'Quick answers.' }],
  picker: { enabled: true, tier: 'Freemium', defaultId: 'akoro-standard' },
  models: [
    { id: 'akoro-standard', label: 'Akoro Standard', default: true, available: true, description: 'Quick, grounded answers.', costMultiple: 1, costHint: null },
    { id: 'deepseek', label: 'DeepSeek', available: true, description: 'Strong reasoning, low cost.', costMultiple: 0.5, costHint: 'Fewer coins per message' },
    { id: 'gpt-4.1', label: 'GPT-4.1', available: true, description: 'Careful, longer answers.', costMultiple: 3, costHint: '≈ 3× coins per message' },
    { id: 'claude-sonnet', label: 'Claude Sonnet', available: false, locked: 'plan', note: 'Not in your plan.', description: 'Best for writing and long explanations.', costMultiple: 8, costHint: '≈ 8× coins per message' },
  ],
};

const blogReply = {
  messages: [
    { id: "m-user", role: "user", text: "How is transpiration different from evaporation?", created_at: "2026-11-07T10:00:00Z" },
    { id: "m-agent", role: "agent", text: "Transpiration is water vapour leaving a plant through the stomata in its leaves, while evaporation can happen from any wet surface.", created_at: "2026-11-07T10:00:05Z",
      meta: { materials: [
        { kind: "blog_passage", title: "How plants lose water", href: "/blog/how-plants-lose-water", sub: "Akoro blog · Stomata and the leaf" },
        { kind: "blog_passage", title: "Evaporation made simple", href: "/blog/evaporation-made-simple", sub: "Akoro blog · Everyday examples" },
      ] } },
  ],
  hasMore: false,
};

export const scenarios = [
  {
    name: 'chat.blog_sources',
    description: 'An answer that used Akoro blog posts shows them under it as chips: the post and its section, opening the post.',
    async run(t) {
      const { page } = t;
      await page.route('**/api/adaptive/chat/sessions/*/messages*', (r) => r.fulfill({ json: blogReply }));
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const chip = page.locator('[data-material="blog_passage"]').first();
      t.check('the blog source chips show under the answer', await chip.waitFor({ timeout: 45_000 }).then(() => true, () => false));
      t.check('…with the post and its section', await chip.getByText('Akoro blog · Stomata and the leaf').isVisible().catch(() => false));
      t.check('…two of them', (await page.locator('[data-material="blog_passage"]').count()) === 2);
      await t.shot('blog-sources');
    },
  },
  {
    name: 'home.needs_you_card',
    description: 'Home shows one Needs you card: the open teaching run leads; "Needs you · 2 more" opens Tasks → Needs you with the same list.',
    async run(t) {
      const { page } = t;
      await page.route('**/api/workflows/dashboard', (r) => r.fulfill({ json: { success: true, data: dashboard } }));
      await page.goto(`${t.app}/app`, { waitUntil: 'domcontentloaded' });
      const card = page.locator('[data-needs-you-home]').first();
      t.check('the Needs you card shows on Home', await card.waitFor({ timeout: 45_000 }).then(() => true, () => false));
      t.check('…leading with the open lesson, not the first item', await card.getByText('Teaching: Transpiration').isVisible().catch(() => false));
      t.check('…counting the rest', await card.getByText(/Needs you · 2 more/).isVisible().catch(() => false));
      await t.shot('home');
      await card.locator('[data-needs-you-all]').click();
      const list = page.locator('[data-needs-you]').first();
      t.check('the link opens Tasks → Needs you', await list.waitFor({ timeout: 20_000 }).then(() => true, () => false));
      t.check('…the same three items', (await list.locator('[data-needs-item]').count()) === 3);
      t.check('…with the server badges', (await list.locator('[data-workflow-badge]').count()) === 2);
      await t.shot('needs-you');
    },
  },
  {
    name: 'chat.model_picker',
    description: 'The model menu shows the plan, each model\'s cost per message, a model locked to a higher plan, and asks once before a dearer model.',
    async run(t) {
      const { page } = t;
      await page.route('**/api/adaptive/chat/models', (r) => r.fulfill({ json: models }));
      await page.goto(`${t.app}/app?tab=agent`, { waitUntil: 'domcontentloaded' });
      const chip = page.getByRole('button', { name: /Choose a model/ }).first();
      t.check('the model switch shows', await chip.waitFor({ timeout: 45_000 }).then(() => true, () => false));
      await chip.click();
      const menu = page.getByRole('menu', { name: 'Models' });
      t.check('the menu says the plan', await menu.locator('[data-model-tier]').getByText('Freemium').isVisible().catch(() => false));
      t.check('…a cost per message', await menu.getByText(/≈ 3× coins per message/).isVisible().catch(() => false));
      t.check('…a model locked to a plan', await menu.getByText('Plan', { exact: true }).isVisible().catch(() => false));
      await menu.getByRole('menuitemradio', { name: /GPT-4\.1/ }).click();
      t.check('a dearer model asks once first', await menu.locator('[data-model-confirm]').isVisible().catch(() => false));
      await t.shot('model-picker');
    },
  },
];
