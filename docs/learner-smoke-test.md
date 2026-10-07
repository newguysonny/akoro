# Learner App — Release Smoke Test

Run this against a **staging environment** (real DB + Redis + OpenAI) to close the
gap between "code-audited" and "live-verified" before shipping to users. It walks
the learner golden path and explicitly re-checks every bug fixed in this audit
cycle. Tick each box; note anything that doesn't match **Expected**.

**Time:** ~20–30 min. **You need:** a browser, a demo student login, an admin
login, and terminal access for the health curls.

---

## 0. Preconditions (do these first)

- [ ] Deploy is up; migrations ran (schema + demo groups).
- [ ] `OPENAI_API_KEY` is set in the API environment (the whole AI stack now runs
      on OpenAI — tasks, battles, chat, teaching).
- [ ] **Health check** — the task system reports ready:
  ```bash
  curl -s https://<api-host>/api/tasks/health | jq
  ```
  **Expected:** `"ok": true`, `redis: "up"`, `worker.enabled: true`,
  `openai.keyConfigured: true`, `openai.model: "gpt-4o-mini"` (or your pinned
  `OPENAI_MODEL`), `tools.loaded: 18`.
  > If `ok:false` → fix the env before continuing (usually `OPENAI_API_KEY`).

**Demo credentials** (from the demo seed — password = FirstName + 2026):
- Student: `stu.jss11@demo.akoro.app` / `Priya2026`
- Admin app: an account with platform **role = admin** (the admin endpoints and
  `/messages` inbox require it — the school-admin demo account is not enough).

---

## 1. Auth & onboarding

- [ ] **Sign up** a brand-new account → lands in **onboarding** (not the app).
- [ ] Complete onboarding (name, agent name/emoji, year, subjects) → lands on `/app`.
- [ ] Log out → **Sign in** with the demo student → lands on `/app`.
- [ ] **Password reset**: request on `/forgot-password` (email sends), then reset.
- [ ] *(If a 2FA account exists)* **2FA login** → after the code, you land on **`/app`**, not the marketing landing page. *(regression: 2FA nav)*

## 2. Dashboard & tabs

- [ ] Header shows your real name, avatar, XP. Bell icon present.
- [ ] **Learn / My Sessions** lists sessions; All / Live / Agent filters + counts work.
- [ ] **Rankings** — My Classroom / Courses / Inter-Schools all load real leaders (or a clean empty state), you're highlighted.
- [ ] **Discover** — marketplace agents + published courses load.
- [ ] **Battles** — challenges/battles list loads; accept/decline a challenge works.
- [ ] **Emoji avatar** *(regression)*: Settings → profile → pick an emoji avatar → **reload the page** → the emoji **persists** (doesn't revert to the default).

## 3. Course → enrol → pay → watch  (the money path)

- [ ] Open a **video** course from Discover/landing → details render (price in ₦, syllabus, reviews).
- [ ] Enrol in a **free** course → immediate access.
- [ ] Enrol in a **paid** course → **Paystack** checkout opens; complete a test payment → redirected back → access granted.
- [ ] Open an enrolled video lesson → **video plays** (HLS); scrub, then leave and return → **resume position** restored.
- [ ] Mark a lesson complete → progress advances.

## 4. Live class  *(regression: was broken app-wide)*

- [ ] Enrol in a **live** course (e.g. the "Rapid Live Demo" that goes live every ~10 min, or wait for a scheduled one to go live).
- [ ] When a session is **live**, open it in **My Sessions → Live** → tap **Join Live**.
      **Expected:** a new tab opens the meeting URL (Zoom/Meet). *(Not the agent-teaching modal.)*
- [ ] Tap **Join Live** on a session that is **not** live yet.
      **Expected:** a toast like "This class isn't live yet — come back at the start time." (no crash, no wrong modal).
- [ ] Course details page → enrolled live course → **"Join live now"** leads into the app join flow.

## 5. Agent teaching, decay, battles, assessment  *(all now on OpenAI)*

- [ ] **Teach agent**: start a fresh teaching session → blocks stream in, agent responds, you can complete it and see a summary.
- [ ] **Continue / Decay**: a session with history or a decay/revision alert opens with prior context.
- [ ] **Guide name** *(regression)*: if you use/switch to a **trained teacher** agent, the chat header shows that teacher's real name/emoji — **not** always "NaNa Esumai".
- [ ] **Battle**: join a battle with questions → answer → see score/XP → results.
- [ ] **Assessment**: start a proctored assessment → it runs and submits a verdict.
- [ ] *(Optional)* **Voice**: start a voice teaching turn → transcription + spoken reply work.

## 6. Agent chat & tasks  *(OpenAI function-calling)*

- [ ] Agent tab → send a normal question → reply **streams in** (not one lump after a pause).
- [ ] **Hamburger → chat sessions drawer**: past chats listed; open one, start a New chat; **refresh** → conversation persists.
- [ ] Trigger a task intent — **"Quiz me on Algebra"** → after a moment a quiz renders in chat.
- [ ] **"Explain photosynthesis"** and **"Create a study plan for Biology"** → each returns real content.
      > Cross-check: `curl .../api/tasks/health` — `tasks.done` and `tasks.doneWithOutputs` both tick up. If `doneWithoutOutputs` climbs instead, a tool is erroring.
- [ ] Tasks tab: create / toggle-complete / delete a task.

## 7. Settings, notifications, profile

- [ ] Change a profile field (name/phone) → saves and persists after reload.
- [ ] **Change password** → inline validation errors show (no native `alert()` popup); a valid change succeeds.
- [ ] Toggle notification preferences → persists.
- [ ] Notifications page → list loads; mark-read / mark-all work.
- [ ] *(If set up)* 2FA enable/disable flow.

## 8. Public / marketing pages

- [ ] Footer links all resolve to real pages (no dead `#` links).
- [ ] Info pages (student/instructor/school) CTAs → `/signup`.
- [ ] **Contact form** *(regression)*: submit → success screen; then confirm it actually arrived (see §9). On a network error you get an inline error + fallback email, not a false success.
- [ ] **Partners form** *(regression)*: submit → success; confirm arrival in §9.

## 9. Admin — contact inbox  *(new)*

Log into the **admin app** as a platform admin:

- [ ] Sidebar shows a **Messages** item with a red **unread badge** reflecting new submissions.
- [ ] Open **Messages** → the Contact and Partners submissions from §8 appear (type/from/org/subject/message/date).
- [ ] Filter by type/status; search works.
- [ ] Click a row → detail drawer opens, auto-marks it **read** (badge decrements within ~60s).
- [ ] **Archive** a message; **Reply by email** opens a prefilled mail draft.

---

## Sign-off

| Section | Pass? | Notes |
|---|---|---|
| 0 Preconditions / health |  |  |
| 1 Auth & onboarding |  |  |
| 2 Dashboard & tabs |  |  |
| 3 Course/enrol/pay/watch |  |  |
| 4 Live class |  |  |
| 5 Teaching/battles/assessment |  |  |
| 6 Agent chat & tasks |  |  |
| 7 Settings/notifications |  |  |
| 8 Marketing pages |  |  |
| 9 Admin inbox |  |  |

**Release when:** every section passes, or remaining failures are triaged as
non-blocking with owners assigned. Anything in §3 (payment) or §4 (live join) is
a hard blocker.
