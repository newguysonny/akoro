// gp-invite.mjs — EVERY battle is an INVITATION, not a conscription.
//
// Group battles used to enter people with joined_at already set, whoever made
// them, so the battle simply happened to them. Being picked by a classmate is
// no more consent than being picked by a teacher, so the seat now starts empty
// either way; only the creator is in from the start, because they asked for it.
//
// Under test:
//   · a group battle puts a pending seat on every invitee, teacher-made or not
//   · that seat shows up in the learner's Challenges tab (/my-challenges)
//   · accepting takes the seat WITHOUT starting the battle for everyone else
//   · declining empties one seat, it does not cancel the battle
//   · a decline can be the LAST answer, and must start the battle too
//   · the creator can see who accepted, declined, and never answered
//
// The last one is the point of the exercise: before this, a teacher could see a
// participant COUNT and nothing else, so "did my class actually take this?" had
// no answer at all.

import { call, login, check, score } from './golden.mjs';

console.log('\n═══ BATTLE INVITATIONS ═══\n');

// Seeded logins are jss1_mate1 -> jss1.mate1@demo.akoro.app
const email = (m) => `${m.username.replace('_', '.')}@demo.akoro.app`;

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');

const cls  = await call(teacher, 'GET', '/api/battle/my-classes');
// JSS1 specifically: teacher1 is its teacher. Picking [0] landed on a class
// where this account is a *member*, which makes it a classmate rather than a
// teacher and so exercises the wrong branch entirely.
const jss1 = (cls.json?.data ?? []).find(c => c.name === 'JSS1');
check('teacher has a class', !!jss1, jss1?.name);

const roster = await call(teacher, 'GET', `/api/battle/classes/${jss1.id}/roster`);
// jss1_mateN are the seeded classmates whose passwords this suite knows.
const mates  = (roster.json?.data ?? [])
  .filter(m => m.has_agent && /^jss1_mate\d+$/.test(m.username ?? ''));
check('roster has learners with agents', mates.length >= 3, `${mates.length} eligible`);

// Three named learners, so accept / decline / ignore can each be exercised.
const [a, b, c] = mates;

console.log('\n· Teacher sets a battle for three learners');
const made = await call(teacher, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Invitation test battle', subject: 'Mathematics',
  total_questions: 10, question_source: 'bank',
  user_ids: [a.id, b.id, c.id],
});
check('battle created', made.status === 201,
  made.status !== 201 ? JSON.stringify(made.json).slice(0, 200) : `invited ${made.json.data.invited}`);
const battleId = made.json?.data?.battle_id;

console.log('\n· Nobody has been entered — every seat is pending');
const before = await call(teacher, 'GET', `/api/battle/battles/${battleId}/participants`);
check('participants endpoint answers', before.status === 200, JSON.stringify(before.json?.data?.summary));
check('all three still pending', before.json?.data?.summary?.pending === 3,
  `pending=${before.json?.data?.summary?.pending} accepted=${before.json?.data?.summary?.accepted}`);
check('teacher not counted as a competitor', before.json?.data?.summary?.invited === 3);

console.log('\n· It reaches the learners as a challenge');
const learnerA = await login('a', 'student', email(a), 'Password123!');
const listA = await call(learnerA, 'GET', '/api/battle/my-challenges');
check('challenge is in the learner\'s tab',
  (listA.json?.data ?? []).some(x => x.id === battleId),
  `${listA.json?.data?.length ?? 0} pending for ${a.username}`);

console.log('\n· Accepting takes a seat and does NOT start the battle');
const acc = await call(learnerA, 'POST', `/api/battle/challenges/${battleId}/accept`, {});
check('accept succeeds', acc.status === 200, JSON.stringify(acc.json).slice(0, 160));
check('accept reports the tally', acc.json?.accepted === 1 && acc.json?.invited === 3,
  `${acc.json?.accepted}/${acc.json?.invited}`);
check('battle did not go live on one accept', acc.json?.status !== 'live', `status=${acc.json?.status}`);

console.log('\n· It leaves that learner\'s Challenges tab once answered');
const listA2 = await call(learnerA, 'GET', '/api/battle/my-challenges');
check('no longer pending for them', !(listA2.json?.data ?? []).some(x => x.id === battleId));

console.log('\n· Declining empties one seat, it does not cancel the battle');
const learnerB = await login('b', 'student', email(b), 'Password123!');
const dec = await call(learnerB, 'POST', `/api/battle/challenges/${battleId}/decline`, {});
check('decline succeeds', dec.status === 200, JSON.stringify(dec.json).slice(0, 120));

const after = await call(teacher, 'GET', `/api/battle/battles/${battleId}/participants`);
const s = after.json?.data?.summary;
check('battle survives one decline', after.json?.data?.status !== 'cancelled', `status=${after.json?.data?.status}`);
check('teacher sees 1 accepted / 1 declined / 1 pending',
  s?.accepted === 1 && s?.declined === 1 && s?.pending === 1,
  `accepted=${s?.accepted} declined=${s?.declined} pending=${s?.pending}`);

console.log('\n· The roster names names, not ids');
const named = (after.json?.data?.participants ?? []).filter(p => p.role !== 'teacher');
check('each learner has a name and a state',
  named.length === 3 && named.every(p => p.fullName && p.fullName !== 'Unknown' && p.state),
  named.map(p => `${p.username}:${p.state}`).join(' '));

console.log('\n· A learner cannot read someone else\'s battle roster');
const outsider = mates[3];
if (outsider) {
  const nosey = await login('out', 'student', email(outsider), 'Password123!');
  const peek = await call(nosey, 'GET', `/api/battle/battles/${battleId}/participants`);
  check('uninvited learner is refused', peek.status === 403, `status=${peek.status}`);
}

console.log('\n· A learner-made group battle is an invitation too');
// Being picked by a classmate is no more consent than being picked by a
// teacher — the seats start empty either way. Only the creator is in from
// the start, because they are the one who asked for the battle.
const own = await call(learnerA, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Classmates own battle', subject: 'Mathematics',
  total_questions: 10, question_source: 'bank',
  user_ids: [b.id, c.id],
});
if (own.status === 201) {
  const ownView = await call(learnerA, 'GET', `/api/battle/battles/${own.json.data.battle_id}/participants`);
  // 3 seats: the creator plus the two they invited. The creator is in
  // (accepted); the two they picked still owe an answer.
  const own_s = ownView.json?.data?.summary;
  check('only the creator is in; the invited must accept',
    own_s?.invited === 3 && own_s?.accepted === 1 && own_s?.pending === 2,
    JSON.stringify(own_s));

  // And it reaches them the same way a teacher's does.
  const learnerC = await login('c', 'student', email(c), 'Password123!');
  const listC = await call(learnerC, 'GET', '/api/battle/my-challenges');
  check('classmate sees the invitation',
    (listC.json?.data ?? []).some(x => x.id === own.json.data.battle_id),
    `${listC.json?.data?.length ?? 0} pending for ${c.username}`);
} else {
  check('learner-made battle created', false, JSON.stringify(own.json).slice(0, 160));
}

console.log('\n· A decline can be the last answer — it must start the battle too');
// The early-start check first lived only in accept, so a battle whose final
// answer was a decline sat in its lobby for the full hour with nobody left to
// hear from. Creator + one accept = two players, which is enough to run.
const race = await call(learnerA, 'POST', `/api/battle/classes/${jss1.id}/battles/invite`, {
  title: 'Decline closes the door', subject: 'Mathematics',
  total_questions: 10, question_source: 'bank',
  user_ids: [b.id, c.id],
});
const raceId = race.json?.data?.battle_id;
const lb = await login('b2', 'student', email(b), 'Password123!');
await call(lb, 'POST', `/api/battle/challenges/${raceId}/accept`, {});
const lc = await login('c2', 'student', email(c), 'Password123!');
await call(lc, 'POST', `/api/battle/challenges/${raceId}/decline`, {});
await new Promise(r => setTimeout(r, 9000));
const raceView = await call(learnerA, 'GET', `/api/battle/battles/${raceId}/participants`);
check('a final decline starts it, it does not stall it',
  raceView.json?.data?.status === 'live',
  `status=${raceView.json?.data?.status} ${JSON.stringify(raceView.json?.data?.summary)}`);

score();
