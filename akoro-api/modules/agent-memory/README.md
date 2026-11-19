# agent-memory

Quiet learning (Grand Plan §7.16.6): a settled chat gets one background pass
that writes a summary and merges learner memories, platform-paid and
consent-gated.

## Entry

`index.js` is the cross-module entry point for the chat hook (`noteChatTurn`),
the pass itself (`runQuietPass`), and the pure sensitivity rules
(`isSensitive`). `startQuietLearningWorker` is deliberately not re-exported:
`app.js` starts it directly at boot.

## Extend

Add pure rules to `quietLearningCore.js` so tests can exercise them without a
database. Anything that writes memories belongs in `quietLearning.js`.

## Limits

Learning needs a model key and the learner's consent; without either the pass
is a no-op. The worker is opt-in via `QUIET_LEARNING_ENABLED`.
