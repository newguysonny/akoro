# adaptive-learning

The learning engine and Agent Chat: everything a learner's agent can do with
their own data, plus the teaching, assessment and progress machinery behind it.

## Entry points

- `index.js` — the module's router and WebSocket setup; this is what `app.js`
  mounts. Import this from other modules, never an internal file.
- `chat.js` — the Agent Chat router (`/api/adaptive-learning/agent`,
  sessions, model picker, stop) now a thin composition of the files below.

## Areas (one home per feature)

| Folder | Owns |
|---|---|
| `chat/` | Agent Chat turned into parts: `turn-prepare.js` (SSE shell, grounding, prompt), `turn-answer.js` (tool selection, fallbacks, save order), `agent-loop.js`, `tool-runtime.js` + `handlers-*.js` (tool catalogue, policy, dispatch), `turn-store.js`, `runtime-state.js`, reply scrub/claims/narration, ledger and recovery helpers |
| `learner/` | learner model, autonomy, profile context, time context, task validation, learning events/backfill, public learning state, struggles, teaching evidence |
| `teaching/` | adaptive engine, lesson ladder (+ prewarm), teaching session, syllabus, draw |
| `assessment/` | assessment gateway and routes, activity fields, question signals |
| `exam-prep/` | exam-prep confidence and service |
| `study-prep/` | Study Prep workflow, tools and wiring |
| `practice/`, `proctoring/`, `decay-review/` | their workflows and routes |
| `grounding/` | document grounding, context budget, session references, responses input, PDF render, blog research |
| `social/` | protégé and peer consult |
| `intent/` | chat intent, tool-request intent, the intent step |
| `execution/` | execution log, failure digest, reminder email |
| `realtime/` | the Agent Chat WebSocket |
| `tools/`, `strategies/`, `agents/`, `marketplace/`, `training/`, `syllabus-import/`, `teaching-workflow/`, `teaching-session/` | as named |

## How to extend

- New chat behaviour: put the logic in the area that owns it and wire it from
  `chat/turn-*.js`; a new tool goes in a `handlers-*.js` group plus the
  catalogue, never back into `chat.js`.
- New feature area: a folder with a `README.md` if it grows past a couple of
  files; import it through relative paths inside this module.
- Structural rules are enforced by `akoro-api/modules/structure.contract.test.mjs`
  (see `modules/README.md`): new files ≤ 600 lines, no cross-module internal
  imports, no module cycles, a README per module.

## Known limits

- The tool catalogue is assembled at import time, so feature flags are read
  once at boot (the kill switches in `chat/runtime-state.js`).
- Agent Chat state that must be shared (`activeTurnStops`, `conversationAreas`,
  live session turns) lives in `chat/runtime-state.js`; importing a copy
  anywhere else silently forks it.
- A handful of source-string contract tests still fail (pre-existing drift) —
  they are re-pointed whenever their subject moves, not deleted.
