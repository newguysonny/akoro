# Learning methodology

Learning engine, active recall, spaced repetition, Feynman, Socratic learning, interleaving, Pomodoro, teach-back, assessment, mastery, retention and adaptive learning.

Status: Phase 2 in progress. All 13 documents are written from the current
code (`akoro-api/modules/adaptive-learning` and `akoro-api/lib`). Statuses
are declared per document and are honest about partial or absent
implementations: spaced repetition, active recall and teach-back are
implemented engine mechanisms; interleaving and Socratic learning are
partial; the Feynman technique and Pomodoro are planned and **not**
implemented.

## Documents

- [Learning engine](learning-engine.md)
- [Learning methodologies](learning-methodologies.md)
- [Active recall](active-recall.md)
- [Spaced repetition](spaced-repetition.md)
- [Feynman technique](feynman-technique.md)
- [Socratic learning](socratic-learning.md)
- [Interleaving](interleaving.md)
- [Pomodoro](pomodoro.md)
- [Teach-back method](teach-back-method.md)
- [Assessment framework](assessment-framework.md)
- [Mastery framework](mastery-framework.md)
- [Knowledge retention](knowledge-retention.md)
- [Adaptive learning](adaptive-learning.md)

## Rules

- Educational rules are part of the product. Agents must follow the documented methodology and wait for the learning engine to verify mastery.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
- Do not describe a planned or partial methodology as fully available.
