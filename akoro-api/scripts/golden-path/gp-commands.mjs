// gp-commands.mjs — every sample chat command in the docs actually routes.
//
// docs/CHAT-COMMANDS.md is what a teacher or tester is told to type. A command
// that routes to the wrong task type gets the wrong TOOL SET — the model is
// only shown the tools for the type it landed on — so a mis-routed example is
// not a documentation nit, it is a command that cannot work.
//
// Every line below is copied from that file. If you change one there, change it
// here.

import { extractIntent } from '../../modules/tasks/lib/context.js';

const TEACHER = [
  ['create_battle', 'Set JSS1 a Mathematics battle on fractions — 10 questions, medium'],
  ['create_battle', 'Create a class battle for JSS1: Basic Science, photosynthesis, 15 questions'],
  ['create_battle', 'Battle between priya and amaka in JSS1 on Mathematics — long division'],
  ['create_battle', 'Set a challenge for everyone on JSS Mathematics, topic simple interest'],
  ['create_battle', 'Schedule a Basic Science battle for JSS1 on Friday at 2pm, topic water cycle'],
  ['create_battle', 'Study review for priya — JSS1 Mathematics, fractions, 8 questions'],
  ['create_battle', 'Review amaka on Basic Science, topic photosynthesis'],
  ['create_battle', 'Check what priya knows about simple interest'],
  ['assign_self_study', 'Assign self study on the water cycle to JSS1 — Basic Science, due Friday'],
  ['assign_self_study', 'Give JSS1 independent study on photosynthesis for Basic Science'],
  ['assign_self_study', 'Self study for priya and amaka: Mathematics, fractions'],
  ['run_teaching_tool', 'Make a podcast about photosynthesis for JSS1 Basic Science, 5 minutes'],
  ['run_teaching_tool', 'Common misconceptions about fractions for JSS1 Mathematics'],
  ['run_teaching_tool', 'Real-world connections for simple interest, JSS1 Mathematics'],
  ['run_teaching_tool', 'Lesson hooks for the water cycle, JSS1 Basic Science'],
  ['run_teaching_tool', 'Vocabulary list for photosynthesis, JSS1 Basic Science'],
  ['generate_quiz', 'Make a quiz on fractions for JSS Mathematics — 10 MCQs with answers'],
  ['run_teaching_tool', 'Grade this essay for Amaka out of 20 against the mark scheme'],
  ['schedule_session', 'Schedule a live class for JSS Mathematics on Monday 10am — revision'],
  ['send_reminder', 'Remind JSS Mathematics students that homework is due Friday'],
  ['export_report', 'Export a progress report for JSS Mathematics this term'],
  
  ['attendance_rollcall', 'Take the register for JSS1 today'],
  ['run_teaching_tool', 'Write a lesson plan on fractions for JSS1, 40 minutes'],
  ['worksheet_fill', 'Make a worksheet on the water cycle for JSS1 with an answer key'],
  ['report_writing', 'Write an end-of-term report comment for Priya — strong in algebra, weak on word problems'],
  ['exam_prep', 'Build WAEC exam prep on simple interest for SS2 Mathematics'],
  ['interactive_material', 'Turn my fractions lesson into interactive slides for JSS1'],
];

const STUDENT = [
  ['quiz_me',            'Quiz me on fractions'],
  ['explain_concept',    'Explain photosynthesis simply'],
  ['create_study_plan',  'Make me a study plan for Mathematics before my exam'],
  ['set_study_reminder', 'Remind me to revise the water cycle tonight'],
  ['challenge_peer',     'Challenge amaka to a battle on fractions'],
];

let bad = 0;
console.log('\n═══ CHAT COMMAND ROUTING ═══');
for (const [group, list, role] of [['TEACHER', TEACHER, 'instructor'], ['STUDENT', STUDENT, 'student']]) {
  console.log(`\n── ${group} ──`);
  for (const [expect, text] of list) {
    const r = await extractIntent(text, '', role);
    const ok = r.taskType === expect;
    if (!ok) bad++;
    console.log(`${ok ? '  ok  ' : '  ✗   '} ${(r.taskType+'                  ').slice(0,20)} ${ok ? '' : `(wanted ${expect}) `}${text}`);
  }
}
console.log(`\nCHAT COMMANDS: ${TEACHER.length + STUDENT.length - bad} routed, ${bad} mis-routed`);
process.exit(bad ? 1 : 0);
