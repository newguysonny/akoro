// gp-alerts.mjs — alerting, with the emphasis on NOT crying wolf.
//
// The dashboard answers "what is happening" only while someone is looking.
// This is the other half. The property that matters is that an alert is a
// TRANSITION, not an observation: a check that sends a message every time it
// runs is a metronome, and the first thing anyone does with a metronome is
// mute it. So the state machine gets the attention here, not the thresholds.

import db from '../../db.js';
import { evaluateAll, currentAlerts, RULES } from '../../lib/alerts.js';

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓ ' : '✗ FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const stateOf = async (key) =>
  (await db.schema('edu').from('alert_state').select('*').eq('rule_key', key).maybeSingle()).data;
const eventsOf = async (key) =>
  (await db.schema('edu').from('alert_events').select('*').eq('rule_key', key).order('id')).data ?? [];

console.log('\n═══ ALERTING ═══');

// A rule of our own, so the test drives the state machine rather than waiting
// for the platform to misbehave.
let breaching = false;
const PROBE = {
  key: 'gp_probe', severity: 'warning', title: 'Probe rule',
  async check() { return { value: breaching ? 99 : 0, breached: breaching, detail: breaching ? 'probe is breaching' : 'probe is fine' }; },
};
RULES.push(PROBE);
await db.schema('edu').from('alert_state').delete().eq('rule_key', 'gp_probe');
await db.schema('edu').from('alert_events').delete().eq('rule_key', 'gp_probe');

console.log('\n· Every rule runs, and reports itself');
const first = await evaluateAll({ deliver: false });
check('all rules evaluated', first.length === RULES.length, `${first.length} of ${RULES.length}`);
check('none errored', !first.some(r => r.error), first.filter(r => r.error).map(r => `${r.key}: ${r.error}`).join('; ') || 'clean');
check('the probe is quiet while healthy', first.find(r => r.key === 'gp_probe')?.kind === 'ok');

console.log('\n· A breach does not alert immediately');
// ALERT_FOR_MINUTES defaults to 10 — a single bad minute is noise.
breaching = true;
const second = await evaluateAll({ deliver: false });
const probe2 = second.find(r => r.key === 'gp_probe');
check('it is pending, not fired', probe2?.kind === 'pending', `kind=${probe2?.kind}`);
check('but the state remembers when it started', (await stateOf('gp_probe'))?.firing === true);
check('and nobody has been told yet', (await eventsOf('gp_probe')).length === 0, `${(await eventsOf('gp_probe')).length} events`);

console.log('\n· Once it has held, it fires exactly once');
// Backdate the start so the hold requirement is met without a ten-minute test.
await db.schema('edu').from('alert_state')
  .update({ since: new Date(Date.now() - 30 * 60_000).toISOString() }).eq('rule_key', 'gp_probe');
const third = await evaluateAll({ deliver: false });
check('it fires', third.find(r => r.key === 'gp_probe')?.kind === 'fired');
const afterFire = await eventsOf('gp_probe');
check('one event recorded', afterFire.length === 1, afterFire.map(e => e.kind).join(','));

// The whole point: still breaching, repeatedly checked, silent.
for (let i = 0; i < 3; i++) await evaluateAll({ deliver: false });
const afterRepeats = await eventsOf('gp_probe');
check('three more checks add no new events', afterRepeats.length === 1,
  `${afterRepeats.length} events after 4 breaching checks`);
check('and it reports still_firing rather than firing again',
  (await evaluateAll({ deliver: false })).find(r => r.key === 'gp_probe')?.kind === 'still_firing');

console.log('\n· It says when it clears — once');
breaching = false;
const cleared = await evaluateAll({ deliver: false });
check('resolved', cleared.find(r => r.key === 'gp_probe')?.kind === 'resolved');
const afterResolve = await eventsOf('gp_probe');
check('a resolve event was recorded', afterResolve.map(e => e.kind).join(',') === 'fired,resolved',
  afterResolve.map(e => e.kind).join(','));
await evaluateAll({ deliver: false });
check('and staying healthy stays quiet', (await eventsOf('gp_probe')).length === 2);

console.log('\n· A breach that never held is not announced when it clears');
// Otherwise every transient blip produces a "resolved" for something nobody
// was ever told about — noise that reads as an incident.
await db.schema('edu').from('alert_state').delete().eq('rule_key', 'gp_probe');
await db.schema('edu').from('alert_events').delete().eq('rule_key', 'gp_probe');
breaching = true;  await evaluateAll({ deliver: false });   // pending only
breaching = false; await evaluateAll({ deliver: false });   // gone again
check('no events at all', (await eventsOf('gp_probe')).length === 0);

console.log('\n· A rule that cannot run is reported, not treated as healthy');
RULES.push({ key: 'gp_broken', severity: 'warning', title: 'Broken', async check() { throw new Error('boom'); } });
const withBroken = await evaluateAll({ deliver: false });
check('the failure is surfaced', withBroken.find(r => r.key === 'gp_broken')?.error === 'boom');
check('and it is not counted as ok', withBroken.find(r => r.key === 'gp_broken')?.kind !== 'ok');

console.log('\n· The dashboard sees every rule, not only the firing ones');
const listed = await currentAlerts();
check('all rules listed', listed.length === RULES.length, `${listed.length}`);
check('each carries a title and severity', listed.every(r => r.title && r.severity));
check('a disabled rule says so', listed.some(r => r.enabled === false) || !process.env.ALERT_USD_PER_HOUR,
  'spend rule is off without a budget');

// Clean up after ourselves.
RULES.splice(RULES.findIndex(r => r.key === 'gp_probe'), 1);
RULES.splice(RULES.findIndex(r => r.key === 'gp_broken'), 1);
await db.schema('edu').from('alert_state').delete().in('rule_key', ['gp_probe', 'gp_broken']);
await db.schema('edu').from('alert_events').delete().in('rule_key', ['gp_probe', 'gp_broken']);

console.log(`\nALERTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
