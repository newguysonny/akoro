import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SETTINGS_GROUPS, AGENT_GROUPS, ACCOUNT_CARDS, AGENT_CARDS, groupOf, isAgentGroup, tr } from './groups.js';
import { drawerItems, tierPill } from '../../components/drawerItems.js';
import { EN } from '../../contexts/i18n/en.js';
import { TRANSLATIONS } from '../../contexts/i18n/index.js';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFile(here(p), 'utf8');

test('settings groups: unique keys, every key resolves, agent groups are under agent/', () => {
  const all = [...SETTINGS_GROUPS, ...AGENT_GROUPS];
  assert.equal(new Set(all.map((g) => g.key)).size, all.length);
  for (const g of SETTINGS_GROUPS) { assert.ok(!g.key.includes('/')); assert.equal(isAgentGroup(groupOf(g.key)), false); }
  for (const g of AGENT_GROUPS) { assert.ok(g.key.startsWith('agent/')); assert.equal(isAgentGroup(groupOf(g.key)), true); }
  assert.equal(groupOf('nope'), null);
  assert.equal(groupOf(''), null);
  assert.equal(isAgentGroup(null), false);
  assert.equal(SETTINGS_GROUPS.length, 7);
  assert.equal(AGENT_GROUPS.length, 8);
});

test('study profile is split: study profile, goals and learning goal are separate agent pages', () => {
  for (const k of ['agent/study', 'agent/goals', 'agent/focus']) assert.ok(groupOf(k), k);
});

test('every group has an English title and description, and the translation keys exist in every language', () => {
  for (const g of [...ACCOUNT_CARDS, ...AGENT_CARDS]) {
    assert.ok(g.title && g.sub && g.icon, g.key);
    assert.match(g.subKey, /^settings\.gsub\.[a-z_]+$/);
    assert.ok(EN[g.subKey], `en ${g.subKey}`);
    for (const [lang, cat] of Object.entries(TRANSLATIONS)) assert.ok(cat[g.subKey], `${lang} ${g.subKey}`);
  }
  for (const k of ['settings.autonomy', 'settings.memory', 'settings.my_tools', 'settings.agent_network', 'settings.help_about', 'drawer.account', 'drawer.upgrade', 'drawer.logout', 'drawer.edit_profile']) {
    assert.ok(EN[k], `en ${k}`);
    for (const [lang, cat] of Object.entries(TRANSLATIONS)) assert.ok(cat[k], `${lang} ${k}`);
  }
});

test('tr falls back to the English text when a key is missing', () => {
  assert.equal(tr(() => 'x.y', 'x.y', 'English'), 'English');
  assert.equal(tr(() => '', 'x.y', 'English'), 'English');
  assert.equal(tr(() => 'Hola', 'x.y', 'English'), 'Hola');
});

test('drawer rows: school learner, higher-ed learner, and the Gradebook paywall', () => {
  const school = drawerItems({});
  assert.deepEqual(school.map((i) => i.key), ['orders', 'activities', 'gradebook', 'library', 'wallet']);
  assert.equal(school.find((i) => i.key === 'gradebook').to, '/gradebook');
  assert.equal(drawerItems({ gradebookGated: true }).find((i) => i.key === 'gradebook').to, '/upgrade?trigger=gradebook');
  const higher = drawerItems({ higherEd: true });
  assert.deepEqual(higher.map((i) => i.key), ['orders', 'communities', 'library', 'wallet']);
  assert.equal(higher.find((i) => i.key === 'communities').to, '/communities');
  assert.ok(school.find((i) => i.key === 'wallet').wallet);
});

test('tier pill: free and trial are nudged to upgrade; paid tiers open Plan & Usage', () => {
  for (const p of ['Free', 'Trial', 'free', undefined, '']) { const t = tierPill(p); assert.equal(t.unpaid, true); assert.equal(t.to, '/upgrade'); }
  for (const p of ['Premium', 'Freemium']) { const t = tierPill(p); assert.equal(t.unpaid, false); assert.equal(t.to, '/settings/plan'); assert.equal(t.name, p); }
});

test('wiring: one splat route, invalid group redirects, the old quick-link cards are gone, the drawer is phone-only', async () => {
  const app = await read('../../App.jsx');
  assert.match(app, /<Route path="\/settings\/\*"/);
  assert.doesNotMatch(app, /<Route path="\/settings" /);
  const page = await read('./SettingsPage.jsx');
  assert.match(page, /if \(groupKey && !group\) return <Navigate to="\/settings" replace\/>/);
  assert.match(page, /\{!group && <div style=\{\{ display:'flex',background/);   // tabs only on the home
  assert.match(page, /useState\(isAgentGroup\(group\) \? 'agent' : 'user'\)/);
  const user = await read('./userTab.jsx');
  for (const gone of ['settings.order_history_sub', "navigate('/orders')", "navigate('/gradebook')", "navigate('/library')"]) assert.ok(!user.includes(gone), gone);
  const dash = await read('../../features/dashboard/LearnerDashboard.jsx');
  assert.match(dash, /matchMedia\?\.\("\(max-width: 768px\)"\)\.matches\) setDrawer\(true\); else navigate\("\/settings"\)/);
  const drawer = await read('../../components/ProfileDrawer.jsx');
  assert.match(drawer, /go\('\/settings\/profile'\)/);
  assert.match(drawer, /go\('\/settings'\)/);
});
