# training/ — the Akoro Agent Model

Fine-tuning Qwen3-4B to operate the Akoro agent runtime: plan, pick tools, write valid calls, read results, recover, verify, hand off and stop — inside our harness, which keeps control of what actually happens.

- **[SPEC.md](./SPEC.md)** — the Training Dataset Specification (Phase 0): the agent contract, the episode format, the eight capabilities, the quality gate, the benchmark, the training plan, and the consent and anonymisation rules for real traffic.
- Grand Plan Phase 17 tracks the project.

Nothing here runs in production. Training data never contains credentials, learner identities or real traffic from anyone who hasn't opted in (SPEC.md §9).
