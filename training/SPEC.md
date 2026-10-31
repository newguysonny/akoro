# Akoro Agent Model — Training Dataset Specification

Phase 0 of the Akoro Agent Model project (Grand Plan Phase 17). Status: **draft for approval**, 2026-10-31.

Decisions taken (2026-10-31):

| Decision | Choice |
|---|---|
| Base model | **Qwen3-4B** (text). The vision-language model comes at the multimodal stage, not before. |
| Training data | Synthetic episodes first; **anonymised, opt-in real traffic** planned now (§9). |
| Teacher model | **DeepSeek**, operating our real harness with stub tools. |
| Location | this folder, `training/`, in the main repo — it shares the contract, the tools and the evals. |

---

## 1. What we are training, and what we are not

**The model learns to operate the Akoro agent runtime:** read what the learner wants, plan, pick a tool, write valid arguments, read the result, recover from a failure, check the outcome, hand off, and stop.

**It does not learn:**
- the tool list itself — every episode gives the tools in context, as the runtime does, so a tool added tomorrow works without retraining;
- permissions — the harness, the policy (roles, learner-approved permissions, confirm cards, admin approvals) and the workflow engine decide what may happen; the model only proposes;
- facts about learners, credentials or ids — never in training data (§9).

The principle: **the model proposes; the runtime coordinates; the harness executes; the policy authorises; verification checks; memory keeps.**

---

## 2. The agent contract (one format for all three loops)

Today Akoro has three agent loops: Agent Chat (`adaptive-learning/chat.js` `runAgentToolLoop`), the workflow loop (`agent-runtime/loop.js`, Study Prep and teaching) and the task runner (`tasks/lib/agentLoop.js`). Chat and the task runner already share the observation envelope (`utils/toolObservation.js`); the workflow loop has its own (`observationFor`). Phase 1 brings all three onto this contract; training data is written in it.

### 2.1 Turn input (what the model sees)

```jsonc
{
  "contract": "akoro-agent/1",
  "surface": "agent_chat" | "workflow" | "task",
  "role": "student" | "instructor",
  "system": "…doctrine (agent-context), unchanged…",
  "tools": [ { "name": "create_task", "description": "…", "parameters": { /* JSON schema */ } } ],
  "state": {                       // what the runtime knows, never secrets
    "workflow": { "type": "study_prep", "status": "awaiting_confirmation", "allowed": ["confirm_plan", "cancel"] } | null,
    "ledger":   { "goal": "…", "steps": [ { "step": "…", "status": "pending|in_progress|done|blocked", "tool": "…" } ], "open_questions": [] } | null,
    "intent":   { "want": "…", "kind": "question|look_up|action|change|handoff|chat", "multi_step": true, "missing": [] } | null,
    "summary":  "earlier in this chat, model-written" | null,
    "budget":   { "tool_calls_left": 7 }
  },
  "messages": [ { "role": "user|assistant|tool", "content": "…", "tool_calls": [ … ], "tool_call_id": "…" } ]
}
```

### 2.2 Model output (one decision per step)

Exactly one of:

```jsonc
{ "tool_calls": [ { "name": "create_task", "arguments": { "title": "Revise organic chemistry", "due_at": "2026-11-05T17:00:00+01:00" } } ],
  "intent": "make the Thursday revision task" }          // a short reason, kept for observability (Phase 16 step 4's "why")
{ "reply": "…to the learner…" }                          // ends the turn
```

`update_plan` is an ordinary tool call. The model never writes a state change directly; workflow moves are tool calls the engine accepts or rejects.

### 2.3 Observation (what comes back after a tool runs)

The existing envelope, with an error **code** from a fixed list:

```jsonc
{ "success": false, "request_id": "req_8f72a1", "action": "create_task",
  "result": null,
  "error": { "code": "invalid_arguments", "message": "due_at must be in the future", "retryable": false },
  "recovery": "…hint from toolRecovery.js, when present…" }
```

| Error code | Meaning | Expected behaviour (trained) |
|---|---|---|
| `timeout` | no answer in time | read tool: retry once; change: check status before any retry (it may have run) |
| `unavailable` | the backend refused at the door (502/503) | retry once, then the documented alternative or report |
| `invalid_arguments` | the call didn't pass the schema or the harness checks | correct the arguments from the schema and the message; never invent missing values — ask |
| `missing_information` | the learner hasn't said something the job needs | ask for it; don't guess |
| `not_allowed` | role, permission or policy refused it | stop and report; never retry, never route around it |
| `needs_confirmation` | a confirm card was made | tell the learner to confirm; don't claim it happened |
| `not_found` / `empty` | nothing matched | the documented alternative, or say nothing was found |
| `state_conflict` | the workflow isn't in a state that allows this | read the state, pick an allowed move or explain |
| `insufficient_balance` | not enough coins/credits | stop the run and say so (a stop code in the workflow loop) |
| `repeated_failure` | the same call failed twice | escalate (tell the learner plainly, offer the next step, or hand to a human/admin route) |

---

## 3. Episode format (one JSON line per episode)

```jsonc
{
  "id": "ep_…", "contract": "akoro-agent/1", "source": "synthetic|real",
  "capabilities": ["planning", "tool_execution", "recovery"],        // §4
  "difficulty": "routine|complex",
  "turn_input": { /* §2.1, the first step */ },
  "steps": [
    { "decision": { /* §2.2 */ }, "observation": { /* §2.3, absent for a reply */ } }
  ],
  "outcome": {
    "verdict": "pass|fail",
    "checks": {                                                       // §6 — all computed by code, never by the teacher
      "harness_accepted_all_calls": true,
      "no_unbacked_claims": true,          // turnCheck.js
      "ledger_done_backed": true,          // taskLedger.js
      "workflow_transitions_valid": true,  // workflows/engine.js
      "no_policy_violation": true,
      "no_repeated_side_effect": true,     // tasks/lib/agentLoop.js once-only rule
      "task_completed": true               // the scenario's own success test
    },
    "failure_class": null | "wrong_tool|bad_arguments|unbacked_claim|missed_recovery|policy_violation|looped|gave_up_early|other"
  },
  "meta": { "teacher": "deepseek-…", "scenario": "sc_…", "tools_version": "…", "created_at": "…" }
}
```

Passing episodes are SFT data. Failing episodes are kept, classified, and paired with a passing one for the same scenario as DPO data later.

---

## 4. The eight capabilities and what an episode must show

| Capability | Episodes show | Examples from Akoro |
|---|---|---|
| **Intent understanding** | the request read correctly, ambiguity asked about | "Let's create an assignment" after a battle → ask "same topic?" (activityFields.js) |
| **Reasoning and planning** | `update_plan` for multi-step jobs; steps in a sensible order | "Plan my WASSCE Physics prep and set daily tasks" |
| **Tool selection** | the right tool, no unnecessary calls, no tool when none is needed | progress question → `check_progress`, not a search |
| **Tool execution** | valid arguments from the schema; nothing invented | dates resolved from the given current time; ids passed exactly |
| **Context management** | uses the ledger, workflow state and summary; asks for what's missing | resuming a Study Prep session at `awaiting_confirmation` |
| **Error recovery** | the behaviour in the §2.3 table for each code | `search_my_library` empty → `search_my_study_knowledge` |
| **Verification** | doesn't claim before the observation; reads back where the contract allows; says what's left | "I've created…" only after `success: true` |
| **Agent coordination** | hands off to the right workflow or agent with the needed context; reads the result back | start Study Prep; consult the teaching guide; consult peer agents; escalate to admins through the request route |

Two cross-cutting sets: **security** (prompt injection in tool results and uploaded files, attempts to act for another learner, requests the role can't make → refuse, never produce the call), and **stopping** (a reply when the job is done; no tool loops).

---

## 5. Scenario sources

1. **Benchmark scenarios** (Phase 2): 100–500 multi-step tasks, each with stub tool behaviour (including scripted failures) and a code-checked success test. **Never used for training.**
2. **Training scenarios**: generated from templates over the same tools — different learners, subjects, wordings, failure points — so the model learns the pattern, not the test.
3. **Existing assets reused:** the routing / learner-tools / agent-task / agent-checks / intent eval goldens (as seeds for scenario templates, not as training items), the gate scenarios' conversations, docs/CHAT-COMMANDS.md.
4. **Real traffic** (§9), once consent and anonymisation are live.

Targets: 1,000–3,000 passing synthetic episodes for the first fine-tune (balanced across §4, at least 20% with a failure to recover from), growing toward 10,000–20,000 with real traffic.

---

## 6. Quality gate for episodes

An episode is kept only when every check in `outcome.checks` is computed by code and passes — the same rules the live agent is held to (Phase 16): the harness accepted every call, no claim without a backing call, ledger steps done only when backed, only allowed workflow transitions, no policy violation, no repeated side effect, and the scenario's success test passed. The teacher model's own opinion of its episode is never a check. 5% of kept episodes are read by a person each batch.

---

## 7. The benchmark (Phase 2) and how models are compared

The same scenarios, tools, starting context and permissions for: original Qwen3-4B, the fine-tuned Qwen3-4B, and DeepSeek (baseline). Each scenario run 3 times.

| Metric | Measured as |
|---|---|
| Task success | the scenario's success test |
| Tool accuracy | right tool and valid arguments per step |
| Recovery | correct behaviour per error code (§2.3) |
| Verification | no unbacked claims; "left" stated when steps remain |
| Permission compliance | zero calls the policy refuses; zero attempts after `not_allowed` |
| Efficiency | extra calls beyond the scenario's minimum |
| Reliability | success in all 3 runs |
| Cost | per successful task, GPU idle time included for self-hosted |
| Latency | time to final reply |

A fine-tuned version ships only where it beats the original on every metric and matches or beats DeepSeek on task success, recovery, verification and compliance for that kind of task.

---

## 8. Training plan (Phase 4)

- **Method:** SFT with LoRA on Qwen3-4B, on a rented 24–48 GB GPU (RunPod); memory benchmarked before scaling.
- **Stages, each with its own eval before the next:** (1) tool selection and arguments → (2) multi-step with the ledger → (3) workflow states and hand-offs → (4) recovery, verification, security → later (5) preference training (DPO) on labelled failures, (6) multimodal with Qwen3-VL-4B.
- **Format:** the chat template's tool-calling format, generated from §3 episodes by `training/` scripts.
- **Serving:** vLLM on RunPod serverless behind `lib/aiModel.js` as one more provider (OpenAI-compatible), like the existing self-hosted models.

---

## 9. Real traffic: consent and anonymisation (planned now)

Real conversations are mostly minors'. Nothing from real traffic enters training until all of this is live:

1. **Consent:** a separate, off-by-default setting ("Help improve Akoro's study agent with my anonymised chats"), with a guardian's consent where the learner is a minor; withdrawable at any time, withdrawal removes their episodes from future training sets. The privacy policy states what is used, how it is anonymised, and how long it is kept.
2. **What is collected:** only agent episodes (§3) — decisions, tool calls, observations and verdicts — never voice, uploaded files, images, or the learner's Library content.
3. **Anonymisation, before storage in the training store:** names, usernames, emails, phone numbers, school names, ids and dates of birth replaced with typed placeholders (`<LEARNER_NAME>`, `<SCHOOL>`, `<ID>`); free text in tool results reduced to the fields the decision needed; a second pass by a detector for anything left; episodes with sensitive topics (health, family, safeguarding) dropped entirely.
4. **Review:** a sample of every batch read by a person before it joins a training set.
5. **Separation:** the training store is separate from the production database, access-logged, and never holds the mapping back to a learner.
6. **Never trained:** credentials, tokens, payment details, safeguarding reports, anything from a learner who hasn't opted in.

---

## 10. What comes next

| Phase | Deliverable |
|---|---|
| 0 | this specification, approved |
| 1 | the three loops on the contract (§2); a trajectory recorder writing §3 episodes with code-computed verdicts |
| 2 | the benchmark (§7) with stub tools and scripted failures; DeepSeek and Qwen3-4B baselines |
| 3 | synthetic episodes from DeepSeek on the harness, gated by §6 |
| 4 | the first LoRA fine-tune, staged (§8) |
| 5 | served on RunPod behind `aiModel.js`; a router that sends routine kinds to it and escalates on failed checks; shadow mode first |
| 6 | live for the kinds where it wins on the benchmark |
| 7 | DPO on failures; multimodal; other applications on the same contract |
| — | §9 consent setting and anonymisation pipeline, built in parallel with phases 1–3 |
