# Akoro Domain Tools — One Tool per Domain with Action Sub‑Params

**What this covers:** replacing the "one tool per question" explosion with **one tool per data domain** that exposes an `action` enum plus per-action params (a mini‑RPC: `{ action, …params }`). It covers (1) the concrete domain → action map, (2) how the builder extends an existing domain tool (`replace`) instead of adding a near‑duplicate, and (3) the core rule: **when an action is added or edited, every existing action in that domain is re‑run before the tool is saved** — a failed regression blocks the save.

**Reads alongside:** the self‑tooling pipeline (`akoro-api/modules/self-tooling/{pipeline,interpreter,builder,views,toolSimilarity}.js`), `chat.js` (`create_tool` schema), `confirmations.js` (`proposeWrite` — writes stay behind Confirm), and [[akoro-creator-agent(custom-learning-sessions,blueprint)]].

---

## 1. The problem

The agent builds a fresh tool per question, so closely related goals become separate tools:

- "Library count", "Library count (correct total)", "Library count fixed", "library_total_adds_up"
- "Delete my earliest chat", "Delete my earliest chat (by position)", "Delete a chat titled 'X'"
- "Library count by subject" (which read the wrong, subject‑bearing view — 51 sessions, not 12 documents)

Two mitigations are already live: **similar‑goal dedupe** (reuse an existing tool) and **`create_tool` with `replace`** (archive a saved tool and rebuild it in place). Domain tools are the structural fix underneath both: fewer tools, and a natural place to add the next related action.

## 2. The model: a domain tool with `action`

A tool takes `{ action: "<verb>", ...actionParams }`. The model calls **one** tool per domain with the right action.

| Domain | Tool name | `action` values | Params | Kind | Data view |
|---|---|---|---|---|---|
| Library **documents** | `library_documents` | `count`, `list`, `by_kind`, `search` | `kind?`, `query?`, `limit?` | read | `my_library` |
| Chats | `my_chats` | `list`, `read`, `search`, `delete`, `rename` | `chatId?`, `query?`, `title?` | read + **write** | `my_chats` |
| Tasks | `my_tasks` | `list`, `create`, `complete`, `delete`, `move`, `prioritize` | `taskId?`, `title?`, `due?`, `priority?` | read + **write** | `my_tasks` |
| Reminders | `my_reminders` | `list`, `schedule`, `cancel` | `when?`, `message?`, `followUpId?` | read + **write** | `scheduled_chat_follow_ups` |
| Study sessions | `my_study_sessions` | `count`, `list`, `by_subject`, `by_month` | `subject?`, `month?` | read | `my_learning_sessions` |
| XP | `my_xp` | `total`, `by_subject`, `by_month` | `subject?`, `month?` | read | `my_xp` |
| Past questions | `my_past_questions` | `list`, `accuracy`, `by_subject` | `subject?`, `year?` | read | `my_past_questions` |
| Library **notes** | `my_study_notes` | `list`, `by_subject`, `by_confidence` | `subject?` | read | `my_study_notes` |

Rules that hold across every domain:
- **Documents ≠ sessions.** Document goals only ever read `my_library`; a `subject` breakdown is impossible for documents (they have no subject).
- **Writes still ask.** A write action returns the usual **Confirm** card (`proposeWrite`); it never applies directly. Read actions run immediately.
- **One tool per domain.** A new, closely‑related need is a **new `action`**, not a new tool.

## 3. How a build works (now → domain)

- **Now:** `create_tool` builds a full definition per goal; dedupe reuses/archives dupes; `replace` rebuilds in place.
- **Domain:** the builder is told — *"if a saved tool covers this domain, ADD/refine its action(s) via `replace` instead of building a new tool"*. `replace` already archives the old and builds the corrected one under the same name, so the learner's tool list stays at one per domain.
- **Adding an action = rebuild the definition** with the extra action (there is no partial in‑place edit yet). `replace` is the mechanism; the tool count does not grow.

## 4. The regression rule (adding/editing an action re‑tests the domain)

The unit of verification is the **domain tool**, not the single action.

When building or editing an action (including any `replace`):
1. Run the tool once **per declared action**, against the learner's own data — read actions for real, **write actions in dry mode only** (never a card, never applied).
2. Each action must return a valid shape for its `action` and not error.
3. If **any existing action regresses** (errors, wrong shape, empty where it must have rows), **block the save**: keep the old tool active/unchanged, return which action failed and why.
4. Only when every action (old + new/changed) passes is the tool saved.

This is the "add or edit a tool → re‑test the previous ones in the domain" guarantee, generalised from the current single‑sample `verifyTool`.

Sketch (conceptual):
```
verifyDomain(def):
  for action in def.actions:            # old + new
    sample = safeSample(action)         # read: {}; write: dry only
    r = tryRun(def, { action, ...sample })
    assertions += [{ action, ok: r.ok && shapeOk(action, r), ms }]
  verdict = allPass(assertions)         # any fail → reject the save
```

## 5. Schema & discovery

- `params.action`: `{ type: "string", enum: [...], description: "<one line per action>" }`.
- Tool description lists the actions and what each returns, so the model picks one tool and the right action.
- Optional per‑action params are described next to the action.
- Keep actions **cohesive** (same data domain). Cap ~8 actions and a per‑action run budget.

## 6. Build order

| Phase | Deliverable | Notes |
|---|---|---|
| 1 | Builder guidance: "one tool per domain; extend via `replace`; `action` enum" | No runtime change; prompt/schema only. |
| 2 | **Per‑action verification** (`verifyTool` → `verifyDomain`) that blocks on regression | The core safety rule (§4). |
| 3 | First domain tools: `library_documents`, `my_chats` | Archive the existing near‑duplicates on first domain build. |
| 4 | Expand: `my_tasks`, `my_reminders`, `my_xp`, `my_past_questions` | Reads first; writes behind Confirm. |
| 5 | Domain tagging + dedupe/repair by domain | "Same domain" replaces fuzzy goal matching. |

Foundations already shipped: similar‑goal dedupe (`toolSimilarity.js`), wrong‑view replacement + document‑goal `my_library` pinning, and `create_tool` `replace`.

## 7. Acceptance tests

- `library_documents { action: "count" }` → the real document total (matches `my_library`), not sessions.
- Add `list` via `replace` → **`count` still returns the same total** (regression) and `list` returns titles; the tool list stays at one.
- Introduce a deliberate break in `count` while adding `list` → **save is blocked**, old tool unchanged, the failing action named.
- A wrong‑view count tool is repaired in place (`replace`) and returns the `my_library` total.
- A write action (`delete`/`schedule`) still shows **Confirm** and applies only on the learner's tap; read actions never card.
- Tool count per domain ≤ 1.

## 8. Open design decisions

- **Mixed read+write tools vs split.** One `my_chats` with read+write actions is convenient, but the interpreter's write path is recipe‑oriented (`{op:"write"}`); decide whether to (a) support a branch‑to‑write in one definition, or (b) split `my_chats` (read) / `my_chats_edit` (write). Read‑only domain tools are the easy first win.
- **Max actions per tool** (suggested 8) and the per‑action verify budget.
- **Domain identity:** an explicit `domain` column on `agent_tools` vs deriving it from `views`.
- **Migration of existing duplicates:** archive automatically on the first domain build, or leave them and let dedupe/replace converge.
- **Verification cost:** running every action on each build is more model/data work — gate by action count and skip unchanged actions when safe.
