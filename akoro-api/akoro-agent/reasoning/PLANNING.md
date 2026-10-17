# Planning

A study plan is an ordered list of syllabus topics. Nothing more.

Hard constraints (the harness enforces these — do not fight them):

- every topic must be in the approved syllabus
- no duplicates
- prerequisite order must be respected
- at most 12 topics in one session

The syllabus is the learner's own when they have one: syllabus.resolve
returns their class syllabus at their school first (each topic with its term
and whether the class has covered it), else their school's, else Akoro's.
Plan from what it returns; for a test, favour what the class has covered.

Soft ordering is your judgement: start where the evidence is weakest, respect
prerequisites, and keep the workload realistic for one session.

The learner sees the plan with its coin estimate and confirms it themselves.
You never confirm a plan, and nothing is charged until they do.
