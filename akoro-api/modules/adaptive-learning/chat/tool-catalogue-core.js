// First half of the learner Agent Chat tool catalogue (order is user-visible).

export const REPEAT_SCHEMA = {
  type: "object",
  description: "RECURRING only, when the learner asks for a battle that repeats. days: 0=Sun … 6=Sat; time: 'HH:MM' 24-hour in their time zone; until: ISO 8601 (+01:00) when the series ends — a date without a year is its next occurrence (don't ask which year); ask only if they gave no end at all.",
  properties: {
    days: { type: "array", items: { type: "number" } }, time: { type: "string" },
    tz: { type: "string", description: "IANA zone, default Africa/Lagos." }, until: { type: "string" },
  },
  required: ["days", "time", "until"],
};

export const CHAT_TOOLS_CORE = [
  {
    name: "get_learner_context",
    description: "Read the signed-in learner's safe personalisation context: preferred name, city/country, language, study level, subjects, account timezone, and current local/UTC time. Use before interpreting relative dates or times such as 'tomorrow at 8am', and before personalising a response. City/country are self-reported context only: never infer a timezone from them. Never ask for or expose contact, payment, authentication, or other sensitive account data.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_agent_capabilities",
    description: "Return the current feature-aware capability inventory when the learner asks what you can do, your abilities, or your limitations. Use this tool before answering those questions. Do not claim web access, historical past-paper access, autonomous task completion, or a feature absent from the result. Tools are loaded by area in a conversation: if a request needs a tool you do not have, call this with `area` naming the area to load its tools (built-in and the learner's own), then continue the request.",
    input_schema: { type: "object", properties: { area: { type: "string", description: "Optional area id to load that area's tools into this conversation: profile, progress, teaching, plans, files, chats, network, blogs, proactive, building, activities, other." } }, required: [] },
  },
  {
    name: "check_progress",
    description: "Check the student's progress across all enrolled courses. Returns completion % and overall XP.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_progress_overview",
    description: "The student's WHOLE progress picture in ONE call: course progress and XP (check_progress), the learning overview (get_learning_overview), leaderboard ranking (get_ranking) and the knowledge map (get_knowledge_map), returned together as { progress, overview, ranking, knowledgeMap }. Prefer this single call whenever the learner asks how they are doing, their progress, or where they stand — do NOT call the four tools separately for that; call them individually only when the learner asks about one specific part.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_my_school",
    description: "Read the signed-in learner's school identity: the school's public profile (name, description, website, address) and the learner's class. Use for ANY question about their school — its name, what it is, where it is — or their class/level. If no school is linked, say exactly that; never guess a school. Public information only: never expose staff contact details or internal school records.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_school_subjects",
    description: "List the subjects in the signed-in learner's SCHOOL CATALOGUE — the full school list, plus their own class's subjects and subject teacher when the school has recorded them. Use for ANY question about which subjects the school or class offers ('what subjects do we have?'). This is the catalogue, NOT what the learner has learnt — for their own learning history use get_my_learning_sessions. Answer ONLY from this result: if the list is empty, say the school has not registered subjects yet — never invent a subject list.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_my_teachers",
    description: "List the signed-in learner's teachers: their classroom teachers and, where the school records it, per-subject teachers — name, subject, and the class they teach. Use for ANY question about who teaches the learner ('who is my teacher?', 'who teaches us Maths?'). Names, subjects and classes only — never contact details. If the result is empty, say no teachers are linked yet; never invent names.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_teacher",
    description: "Find one teacher by name within the signed-in learner's school and classrooms, returning their public identity: full name, subject, and the classes they teach. Use when the learner asks about a specific teacher ('who is Mrs Adeyemi?', 'does Mr Okafor teach here?'). The name is required — if the learner did not give one, ask for it instead of calling. Public identity only: never expose contact details or private staff records. If nothing matches, say so; never guess a person.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The teacher's name as the learner said it, e.g. 'Mrs Adeyemi' or 'Okafor'." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_my_learning_sessions",
    description: "Read the signed-in learner's own agent learning history: their learning agent (name, level, sessions), every subject and topic they have actually LEARNT by teaching their agent, with confidence per topic, recent learning sessions and what each achieved. Use for ANY question about what the learner has learnt, studied or covered with their agent ('what subjects have I learnt?', 'show my learning sessions', 'my learning history'). This is NOT the school's subject catalogue — never mix the two.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_task",
    description: "Create one learner-owned study task (a to-do on their Tasks list) after the learner explicitly asks. If they want the AGENT TO SEND THEM A MESSAGE later ('message me in 10 minutes', 'remind me here at 5pm'), use schedule_chat_follow_up instead — a task does not send anything. For a relative time like 'in 30 minutes' use dueInMinutes; for 'tomorrow' alone ask for the time. First call get_learner_context when the request needs a clock date. For a task that REPEATS ('every day', 'weekly', 'every 3 days'), pass repeat (and repeatIntervalDays for interval); it needs a due time, and completing it creates the next occurrence.",
    input_schema: {
      type: "object",
      properties: {
        title:       { type: "string", description: "A concise, action-led task title, not the learner's entire request." },
        description: { type: "string", description: "Optional useful details, scope, or starting point for the learner (maximum 800 characters)." },
        priority:    { type: "string", enum: ["high", "medium", "low"], description: "Use high only for an explicit urgency/deadline." },
        due:         { type: "string", description: "Optional human-friendly display label, e.g. 'Tomorrow at 1 PM'." },
        dueAt:       { type: "string", description: "Optional exact due instant in ISO 8601 format with Z or a numeric timezone offset. Call get_learner_context before resolving relative times. Supply this only when the learner stated a precise date and time; never infer it from 'tomorrow' alone." },
        dueInMinutes: { type: "number", description: "Due this many minutes from now — use for relative times like 'in 10 minutes' or 'in 2 hours' (120) instead of working out dueAt." },
        timezone:    { type: "string", description: "Optional IANA timezone for display, e.g. Africa/Lagos. Defaults to the account timezone returned by get_learner_context." },
        course:      { type: "string", description: "Related course or subject (optional)" },
        repeat:      { type: "string", enum: ["daily", "weekly", "interval"], description: "Make the task repeat: 'daily', 'weekly', or 'interval' (with repeatIntervalDays). Omit for a one-off to-do. A repeating task needs a due time (dueAt or dueInMinutes) to anchor it; when the learner completes it, the next occurrence is created automatically." },
        repeatIntervalDays: { type: "number", description: "With repeat='interval': how many days between occurrences (1–365)." },
        repeatEvery: { type: "number", description: "With repeat='interval': the count for an arbitrary interval, e.g. 15 for 'every 15 minutes' (use with repeatUnit)." },
        repeatUnit: { type: "string", enum: ["second", "minute", "hour", "day", "week", "month", "year"], description: "With repeatEvery: the unit. Minimum 1 minute." },
      },
      required: ["title", "priority"],
    },
  },
  {
    name: "suggest_help",
    description: "Open a NEW CHAT for the learner with one proactive idea — a special suggestion that lands as its own conversation at the top of their chats, not in the Suggestions list, so it gets priority. File when you notice, in passing, a way to help beyond what they asked: something spotted in their data while doing another job (a weak topic, a pattern), something valuable but not for now (an exam months away, a next-term topic), something they put off or turned down for now but still need, or a goal worth aiming at — never create goals unasked; open this chat instead. At most one per reply, only when genuinely useful, and never for something the learner already asked you to do — do that instead. Filing changes nothing in this conversation; afterwards, tell them in one line that you've opened a chat about it.",
    input_schema: {
      type: "object",
      properties: {
        kind:      { type: "string", enum: ["task", "goal", "conversation"], description: "task = something worth doing; goal = something worth aiming at; conversation = a check-in or topic worth talking through." },
        title:     { type: "string", description: "Concise, action-led suggestion title (maximum 120 characters)." },
        rationale: { type: "string", description: "One or two sentences on why this would help them right now (maximum 280 characters)." },
      },
      required: ["kind", "title", "rationale"],
    },
  },
  {
    name: "schedule_chat_follow_up",
    description: "Schedule the agent to SEND THE LEARNER A MESSAGE later — 'message me in 10 minutes', 'remind me here at 5pm', 'check on me tomorrow at 9', 'remind me EVERY DAY at 4:30pm' (repeat='daily'). Use this (not create_task) whenever they want to receive a message. Delivery: where='here' (the DEFAULT) posts it into THIS chat — where the learner will see it; where='chat' posts into the chat given by chatId (from list_chats); use where='new' ONLY when they explicitly ask for a separate/named new chat. Timing: inMinutes for relative times ('in 10 minutes' = 10, 'in 2 hours' = 120), or scheduledAt for a clock time (call get_learner_context first; ISO 8601 with offset, e.g. 2026-09-08T14:00:00+01:00). At least 1 minute ahead. ALWAYS report back where and when it will send, copied from the result (deliversTo, localScheduledAt) — never say a reminder is set without that result.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The exact helpful message the agent will send." },
        inMinutes: { type: "number", description: "Send this many minutes from now (relative requests). Use this OR scheduledAt." },
        scheduledAt: { type: "string", description: "Future ISO 8601 timestamp including timezone offset (clock-time requests)." },
        where: { type: "string", enum: ["here", "chat", "new"], description: "here = this chat (DEFAULT — where the learner sees it); chat = the chat in chatId; new = a separate new chat (ONLY when they explicitly ask for one)." },
        chatId: { type: "string", description: "With where='chat': the chatId from list_chats." },
        timezone: { type: "string", description: "Optional IANA timezone for display, for example Africa/Lagos. Defaults to the account timezone returned by get_learner_context." },
        title: { type: "string", description: "Optional title for the new chat, for example 'Biology revision check-in'." },
        repeat: { type: "string", enum: ["daily", "weekdays", "hourly", "interval"], description: "Repeat: 'daily' (every day), 'weekdays' (Mon–Fri), 'hourly' (every hour), or 'interval' (every N seconds/minutes/hours/days/weeks/months/years — set repeatEvery + repeatUnit). Use interval for 'every 15 minutes', 'every 2 hours', 'every 3 days'. The first send is scheduledAt; each later one goes into the same chat." },
        repeatDays: { type: "number", description: "With repeat: how many days the series runs. Daily/weekdays default 30 (max 90); hourly default 1 (max 7); interval default 7." },
        repeatEvery: { type: "number", description: "With repeat=interval: the count — e.g. 15 for 'every 15 minutes'." },
        repeatUnit: { type: "string", enum: ["second", "minute", "hour", "day", "week", "month", "year"], description: "With repeat=interval: the unit. A reminder cannot repeat more often than every 10 minutes (Redis cost); tell the learner so if they ask for more frequent." },
        runTool: { type: "string", description: "Optional: the name of one of the learner's OWN read tools (from Settings → Agent → My tools / their tool list) to run fresh at each send; its answer is added under the message — e.g. a 'subjects I haven't studied' tool for a daily reminder." },
      },
      required: ["message"],
    },
  },
  {
    name: "list_scheduled_chat_follow_ups",
    description: "List the student's scheduled Agent Chat messages — both the still-pending ones (followUps) and recent delivery history (recent: delivered / failed / missed / cancelled, each with scheduledAt, deliveredAt, lastError and a `missed` flag). Use when they ask what check-ins are scheduled, OR whether a reminder actually sent, arrived, or failed — answer from `status`, `deliveredAt` and `missed`; never guess or claim a send you cannot see in this result.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_scheduled_chat_follow_up",
    description: "Cancel one pending scheduled Agent Chat message. Use only after the student explicitly asks to cancel it and has identified the scheduled follow-up.",
    input_schema: {
      type: "object",
      properties: {
        followUpId: { type: "string", description: "The followUpId returned by list_scheduled_chat_follow_ups or schedule_chat_follow_up." },
      },
      required: ["followUpId"],
    },
  },
  {
    name: "send_email_to_me",
    description: "Send an email to the learner's OWN account email address (the one on their Akoro account - you cannot choose or change the recipient). Use ONLY when the learner explicitly asks to be emailed something: 'email me this summary', 'send that to my email', 'mail me my plan'. Write the full content yourself in body - the email must stand on its own outside the chat. Never send email on your own initiative, and never use this as a reminder channel: scheduled follow-ups and agent task notifications do NOT email automatically. If the account has no email address or email is turned off in their notification settings, the tool returns an error - relay it plainly.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The email subject line (maximum 120 characters)." },
        body: { type: "string", description: "The full email body in plain text - everything the learner asked to receive, written to stand alone (maximum 4000 characters)." },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "get_past_question_practice",
    description: "The learner's own past-question practice: per exam and subject — questions attempted, correct, accuracy, years practised, last practised — plus totals. Use for 'how am I doing on past questions', accuracy by subject, or combining with weak topics. For an OVERALL answer call it ONCE with no filters — the result already covers every exam and subject with totals; never guess subjects to filter by. Exam-prep runs are a different thing (get_exam_prep_status).",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Optional subject filter, e.g. Physics." },
        exam: { type: "string", description: "Optional exam filter, e.g. WAEC, JAMB." },
        days: { type: "number", description: "Optional: only the last N days." },
      },
      required: [],
    },
  },
  {
    name: "schema_lookup",
    featureGate: "self_tooling",
    description: "Self-tooling (preview): find what data and operations a NEW tool could use for a goal no existing tool covers. Returns data views (fields you can filter, sort and count — always the learner's own data or published content) and capabilities, each 'available', 'needs_your_ok' (the learner can allow it themselves) or 'needs_approval' (only an admin), plus anything not allowed. Read-only; builds nothing. Use an existing tool first; call this only when none fits. If it finds available views or capabilities for the goal, call create_tool next IN THE SAME TURN to build the tool and answer the learner from its result — don't just describe what a tool could do. Only explain what can't be done when nothing available fits, or part of the goal isn't allowed. Never tell the learner some data doesn't exist just because an unrelated tool came back empty — check here first. Never show the learner view or capability names (e.g. my_learning_sessions); describe them in plain words (\"your learning sessions\").",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the learner wants to find out or do, in plain language." },
      },
      required: ["goal"],
    },
  },
  {
    name: "save_computation",
    featureGate: "self_tooling",
    description: "Self-tooling (preview): SAVE a one-off computation the agent worked out earlier (a create_tool outcome of 'answered') as the learner's permanent tool — ONLY when the learner explicitly asks to save or keep it ('save that', 'keep that tool'), or when their message comes from tapping a tool suggestion. It saves the exact verified computation; it does not rebuild. Pass `hint` with the tool's label or goal words when the one to save isn't the most recent one-off. Outcomes: saved (it's in their tools now — confirm in plain words); exists (already saved — just call it by name); none (no recent one-off to save — build it with create_tool instead); full (their tool list is full — say so). Never call this unasked.",
    input_schema: {
      type: "object",
      properties: { hint: { type: "string", description: "The one-off's label or goal words, when it isn't the most recent." } },
    },
  },
  {
    name: "create_tool",
    featureGate: "self_tooling",
    description: "Self-tooling (preview): BUILD a new tool when no existing tool answers the learner's question or does what they ask (it reads their own data; when schema_lookup lists a write such as deleting or completing their tasks, the tool changes only the rows the learner confirms on a card) (call schema_lookup first to see what it can use). It is built safely from the learner's own data, checked and RUN at once — the answer comes back in `result`. If the request acts on ONE specific row the learner names (a titled chat, task, note or goal), do NOT bake that name into the goal: write the goal as the general action (e.g. 'delete a chat conversation by title'), declare the row's identity as a param (e.g. title) and pass its current value in `run` — a tool built around one hard-coded name can never be reused for a different row. A brand-new tool is drafted OFF and only saved when the learner taps Keep on its card. Outcomes: created (answer from result; next time call the tool by name); offer (a change they can allow — ask if they want it built) / offer_request (a change nothing can make yet — offer to ask the Akoro team); requested (the request was sent — say exactly what `tell` says); needs_permission (a change to the learner's own data they can allow themselves — a card is shown; tell them you don't have that ability yet but will build it as soon as they approve on the card; nothing is built or changed yet); escalated (it needs a permission only an admin can give — a request was made; tell the learner in plain words that you've asked, and that the answer will come back in this chat); needs_consent (a brand-new tool: built and checked, but drafted OFF — a card asks the learner to Keep it; answer from `result` now, say in plain words what it does and anything it can't do, and invite changes; never say it is saved or on); offer_own_copy (a built-in already covers this data and the learner has no tool of their own for it yet: NOTHING was built or drafted — ask the learner in plain words whether they want their own copy in My tools anyway; if they say yes, call create_tool again with the same goal and hint.ownCopy set to true; if they say no, answer with the built-in); answered (a pure computed read that takes no inputs at run time: worked out and verified, the answer is in `result` — it was NOT saved and no card is shown; answer from result and mention it wasn't saved; if the learner asks to save or keep it, call save_computation); rejected (say plainly it can't be done and why). To FIX one of the learner's saved tools that gives a wrong or self-contradictory answer, call create_tool again with the same name/label and `replace` set to that tool's name — the old tool is archived and a corrected one is built and run. When you report a rebuild, say only what you verified: if the old answer was wrong and the new one differs, say what changed; if you could not establish what was wrong with the old tool, say that plainly — never invent a cause. Prefer ONE tool per data domain: for another breakdown of the SAME data, call create_tool again with the same name and the goal 'by <field>' — it adds that action and re-checks the existing ones; do NOT build a separate tool for a count/list/breakdown of data you already have a tool for. If schema_lookup shows a needed capability as needs_approval, pass it in hint.capabilities so the request names it. Never describe how it was built; never show internal names.",
    input_schema: {
      type: "object",
      properties: {
        goal:   { type: "string", description: "What the tool should work out, in plain language (≤ 300 chars), e.g. 'total hours of my learning sessions per month this year'. State the general action — never one specific row's name; that identity goes in a param." },
        name:   { type: "string", description: "snake_case name, e.g. session_hours_by_month." },
        label:  { type: "string", description: "Learner-facing name, e.g. 'Study hours by month'." },
        params: { type: "object", description: "Optional inputs the learner might change next time (a year, a subject — or the identity of the specific row a change acts on, e.g. { title: { type: string } } for the chat, task or note it should act on): { paramName: { type: string|number|integer|boolean, description, default } } (≤ 6). Never data — the tool reads the learner's data itself. Usually none or one." },
        run:    { type: "object", description: "Values for the params to answer THIS request with." },
        hint:   { type: "object", description: "Optional: { views: [...], capabilities: [...] } from schema_lookup; or { ownCopy: true } — ONLY on the re-call after the learner said yes to an offer_own_copy outcome (they want their own tool even though a built-in covers the data)." },
        replace:{ type: "string", description: "An existing saved tool to REBUILD in place — its name, id, or exact label (e.g. \"Goals percentage\"); use when that tool gives a wrong or self-contradictory answer. The old tool is archived and a corrected one built. Use the same name." },
      },
      required: ["goal", "name", "label"],
    },
  },
  {
    name: "await_decision",
    featureGate: "self_tooling",
    description: "Self-tooling: WAIT for the learner's tap on a confirmation card you just showed (a Keep card from create_tool, an Allow card for a permission, or a Confirm card for a change a tool proposed). Call it with the confirmationId from that tool's result, in the SAME turn, right after telling the learner about the card. It waits while they decide; on their tap it applies exactly what the card proposed and returns the outcome — report it in your own words and continue with what they originally asked. If it returns 'waiting', call it again (up to 3 calls) instead of ending your turn. If it returns 'declined', acknowledge briefly and move on. Never call it without a card waiting, and never decide for the learner.",
    input_schema: {
      type: "object",
      properties: { confirmationId: { type: "string", description: "The confirmationId from the card's tool result." } },
      required: ["confirmationId"],
    },
  },
  {
    name: "list_chats",
    description: "List the learner's Agent Chat conversations (newest first) with their chatId and title. Use when they refer to another chat by name ('my last chat', 'the Physics chat') — to find a chat by what was DISCUSSED in it use search_chats — or before read_chat / post_to_chat / schedule_chat_follow_up with where='chat'. isThisChat marks the current one.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional words to match in chat titles." },
        limit: { type: "number", description: "How many (default 15, max 30)." },
      },
      required: [],
    },
  },
  {
    name: "read_chat",
    description: "Read the latest messages of one of the learner's chats by chatId (from list_chats). Use to pick up what was said elsewhere — 'continue from my physics chat', 'what did you tell me about X in the other chat'.",
    input_schema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "The chatId from list_chats or search_chats." },
        limit: { type: "number", description: "How many messages (default 30, max 60)." },
        around: { type: "string", description: "Optional: a matchedAt time from search_chats — read the messages around that point instead of the latest ones." },
      },
      required: ["chatId"],
    },
  },
  {
    name: "search_chats",
    description: "Search the learner's PAST chats by what was discussed (meaning and exact words), not just titles — 'what did we say about osmosis last week?', 'find the chat where you explained photosynthesis', 'which chat had my WAEC 2019 question?'. Returns the matching chats (chatId, title, a snippet, matchedAt). Then call read_chat with around=matchedAt to read that part. Use this BEFORE saying you don't remember something the learner says was discussed before. What was said in a chat is not proof of the learner's current progress — check records for that.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in the learner's words (a topic, a question, a phrase)." },
        limit: { type: "number", description: "How many chats (default 6, max 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "post_to_chat",
    description: "Drop a message from the agent into ANOTHER of the learner's chats right now (instructions, a summary, a note to pick up later) — only when they ask for it. For this chat just reply; to send it later use schedule_chat_follow_up. chatId comes from list_chats.",
    input_schema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "The chatId from list_chats." },
        message: { type: "string", description: "The message to post (maximum 4000 characters)." },
      },
      required: ["chatId", "message"],
    },
  },
  {
    name: "consult_peer_agents",
    featureGate: "peer_consult",
    description: "Ask up to two other learners' study agents for ideas and suggestions " +
      "(study habits, exam prep, streaks, motivation, goals, subjects) to help this student. " +
      "Use sparingly — at most once per conversation — when the student is stuck or explicitly " +
      "wants fresh ideas. If the student asks whether you can talk to other agents, the answer " +
      "is YES: say you can consult other learners' study agents and offer to ask them — never " +
      "claim you cannot. Keep the question general: contact details (emails, phone numbers, " +
      "invite links) are rejected, and peer agents never see this student's data, only the question.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One focused, general question to the peer agents (10-300 characters)." },
        topic: { type: "string", enum: ["study_habits", "exam_prep", "streaks", "motivation", "goals", "subjects", "general"], description: "What the question is about." },
        struggleType: { type: "string", description: "When the student is stuck: the struggle, as a type from the struggle list (e.g. misconception, interference, procrastination, overload, streak_break). Then other learners' breakthroughs on the same struggle come back first: what worked for them." },
        concept: { type: "string", description: "For a concept struggle (misconception, interference…): the concept's name, e.g. 'Transpiration'." },
        subject: { type: "string", description: "The concept's subject, e.g. 'Basic Science'." },
      },
      required: ["question"],
    },
  },
  // ── The agent network: other learners' agents (modules/agent-network) ──
  {
    name: "search_agents",
    featureGate: "agent_network",
    description: "Find other learners' agents — ALWAYS first, before messaging, consulting or challenging anyone, so you know who is online and their real names. " +
      "Filters (all optional): online_only (default for 'who is online'), available_only (online and not in a battle), scope (everyone | classmates | school | course | live_class | community, " +
      "with scope_id for one course/community), query (a name or @username), school, same_school, year_group, study_level, subject, exam (WAEC/JAMB/NECO/BECE), goal, " +
      "topic (agents TAUGHT that topic), complements_me (strong where this learner is weak — best for consulting), min_xp/max_xp, fair_match (similar XP), min_level/max_level, " +
      "rank_max (top N nationally), min_win_rate, min_battles, min_past_questions, active_within_days, open_to_challenges, battle_time (morning|afternoon|evening|night|weekend), " +
      "city, language, sort (relevance|xp|rank|fair|recent), page. Returns each agent's learner first name, @username, agent name, level, XP, rank, presence, what you share " +
      "(classmate, same course…) and matches. Only agents whose privacy allows it are returned. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        online_only: { type: "boolean" }, available_only: { type: "boolean" },
        scope: { type: "string", enum: ["everyone", "classmates", "school", "course", "live_class", "community"] }, scope_id: { type: "string" },
        query: { type: "string" }, school: { type: "string" }, same_school: { type: "boolean" }, year_group: { type: "string" }, study_level: { type: "string" },
        subject: { type: "string" }, exam: { type: "string" }, goal: { type: "string" }, topic: { type: "string" }, complements_me: { type: "boolean" },
        min_xp: { type: "number" }, max_xp: { type: "number" }, fair_match: { type: "boolean" }, min_level: { type: "number" }, max_level: { type: "number" },
        rank_max: { type: "number" }, min_win_rate: { type: "number" }, min_battles: { type: "number" }, min_past_questions: { type: "number" },
        active_within_days: { type: "number" }, open_to_challenges: { type: "boolean" },
        battle_time: { type: "string", enum: ["morning", "afternoon", "evening", "night", "weekend"] },
        city: { type: "string" }, language: { type: "string" },
        sort: { type: "string", enum: ["relevance", "xp", "rank", "fair", "recent"] }, page: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "update_agent_network_settings",
    featureGate: "agent_network",
    description: "Change who can find or message this learner's agent, and their challenge preferences — ONLY when they explicitly ask " +
      "('hide me', 'only my school can find me', 'stop challenges', 'I battle in the evenings'). visibility: everyone | school | classmates | hidden; " +
      "accept_messages: everyone | school | classmates | nobody; open_to_challenges; battle_times; battle_types (1v1 | open | team | review).",
    input_schema: {
      type: "object",
      properties: {
        visibility: { type: "string", enum: ["everyone", "school", "classmates", "hidden"] },
        accept_messages: { type: "string", enum: ["everyone", "school", "classmates", "nobody"] },
        open_to_challenges: { type: "boolean" }, show_on_leaderboards: { type: "boolean" },
        battle_times: { type: "array", items: { type: "string", enum: ["morning", "afternoon", "evening", "night", "weekend"] } },
        battle_types: { type: "array", items: { type: "string", enum: ["1v1", "open", "team", "review"] } },
      },
      required: [],
    },
  },
  {
    name: "block_agent",
    featureGate: "agent_network",
    description: "Block another learner's agent — ONLY when the learner explicitly asks. Blocked agents can't find, message or challenge them (and vice versa). " +
      "Pass report_reason too when they say it was rude, unsafe or spam: that also reports it for review.",
    input_schema: {
      type: "object",
      properties: { userId: { type: "string", description: "The other learner's userId from search_agents." }, report_reason: { type: "string" } },
      required: ["userId"],
    },
  },
  {
    name: "log_past_question_practice",
    featureGate: "agent_network",
    description: "Record past-question practice the learner just did with you (e.g. you quizzed them on 10 WAEC 2019 Chemistry questions and they got 7). " +
      "Battles from past papers are recorded on their own. Also returns their practice summary.",
    input_schema: {
      type: "object",
      properties: {
        exam: { type: "string" }, subject: { type: "string" }, year: { type: "number" },
        attempted: { type: "number" }, correct: { type: "number" },
      },
      required: ["exam", "attempted"],
    },
  },
  {
    name: "find_competitors",
    featureGate: "agent_network",
    description: "Find agents to battle: classmates, the same video course, the same live class, a community, or anyone — open to challenges, " +
      "fairly matched by XP unless the learner asks for stronger or weaker opponents. Same filters as search_agents (source picks the scope). Read-only.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["classmates", "course", "live_class", "community", "school", "everyone"] }, scope_id: { type: "string" },
        subject: { type: "string" }, exam: { type: "string" }, online_only: { type: "boolean" }, fair_match: { type: "boolean" },
        min_xp: { type: "number" }, max_xp: { type: "number" }, rank_max: { type: "number" }, min_win_rate: { type: "number" },
        battle_time: { type: "string", enum: ["morning", "afternoon", "evening", "night", "weekend"] }, query: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "challenge_agent",
    featureGate: "agent_network",
    description: "Challenge other learners' agents to a battle — ONLY when the learner explicitly asks. Use userIds from search_agents / find_competitors " +
      "(or @usernames). kind: 1v1 (one opponent), group (2–7 opponents), team (2v2: teammate + two opponents). Start now, or pass scheduled_for " +
      "(ISO 8601 with +01:00, resolved against the current date and time) to schedule it. They get an invitation to accept. Questions come from past papers and AI. " +
      "RECURRING (\u201cevery Monday and Thursday at 4pm until December\u201d): pass repeat instead of scheduled_for — the opponents are in every one automatically unless they opt out.",
    input_schema: {
      type: "object",
      properties: {
        opponents: { type: "array", items: { type: "string" }, description: "userIds or @usernames of the opponents." },
        kind: { type: "string", enum: ["1v1", "group", "team"] },
        teammate: { type: "string", description: "team only: the userId/@username on the learner's side." },
        subject: { type: "string" }, topic: { type: "string" }, exam: { type: "string" },
        difficulty: { type: "string", enum: ["easy", "intermediate", "hard"] },
        total_questions: { type: "number", description: "5–30 (default 10)." },
        hp_per_miss: { type: "number", description: "HP each agent loses per question it misses (0–50, default 10; 100 HP to start, 0 HP = out and unranked). The invitee sees it before accepting." },
        min_xp: { type: "number", description: "Minimum XP an agent needs to accept (default 0 = open to all)." },
        scheduled_for: { type: "string" }, title: { type: "string" },
        repeat: REPEAT_SCHEMA,
      },
      required: ["opponents", "subject"],
    },
  },
  {
    name: "class_battle",
    description: "Battle CLASSMATES in one of the learner's classes (questions from the class subject) or courses (from the course) — ONLY when the learner explicitly asks. " +
      "opponents: classmates' @usernames exactly as the learner gave them, or whole_class — no need to search_agents first (the class itself is checked). One classmate = a 1v1; more = a group battle (they each accept). Start now, scheduled_for (ISO 8601 +01:00), " +
      "or repeat for a RECURRING one (they're in every one automatically). Name the class (class_name) or course (course_name) if they have more than one. " +
      "For agents outside their classes, use challenge_agent. A learner never battles a teacher — for being checked by a teacher or the guide, use request_guide_review.",
    input_schema: {
      type: "object",
      properties: {
        class_name: { type: "string" }, classroom_id: { type: "string" }, course_name: { type: "string" }, course_id: { type: "string" },
        opponents: { type: "array", items: { type: "string" }, description: "Classmates' @usernames." },
        whole_class: { type: "boolean" },
        subject: { type: "string" }, topic: { type: "string" }, difficulty: { type: "string", enum: ["easy", "intermediate", "hard"] },
        total_questions: { type: "number", description: "5–30 (default 10)." },
        hp_per_miss: { type: "number" }, min_xp: { type: "number" },
        scheduled_for: { type: "string" }, title: { type: "string" },
        repeat: REPEAT_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: "post_challenge_request",
    featureGate: "agent_network",
    description: "Post an open challenge request other agents can find and accept (\u201cJAMB Chemistry 1v1, 10 questions, tonight at 8\u201d) — ONLY when the learner explicitly asks. " +
      "kind: 1v1 | team (2v2) | group (3–8, set max_players). scope: everyone | school | classmates | course | community (scope_id for one course/community). " +
      "Optional XP range for fair matches, scheduled_for (ISO 8601 +01:00), expires_in_hours (default 24). The battle starts when the seats fill (or at its time). " +
      "RECURRING (\u201cpost this every Saturday at 8pm\u201d): pass repeat instead of scheduled_for — a fresh post goes up 12 hours before each one.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["1v1", "team", "group"] }, max_players: { type: "number" },
        subject: { type: "string" }, topic: { type: "string" }, exam: { type: "string" },
        difficulty: { type: "string", enum: ["easy", "intermediate", "hard"] }, total_questions: { type: "number" },
        hp_per_miss: { type: "number", description: "HP lost per missed question (0–50, default 10)." },
        scope: { type: "string", enum: ["everyone", "school", "classmates", "course", "community"] }, scope_id: { type: "string" },
        min_xp: { type: "number" }, max_xp: { type: "number" }, scheduled_for: { type: "string" }, expires_in_hours: { type: "number" },
        note: { type: "string" }, title: { type: "string" },
        repeat: REPEAT_SCHEMA,
      },
      required: ["subject"],
    },
  },
  {
    name: "search_challenge_requests",
    featureGate: "agent_network",
    description: "Find open challenge requests this learner can take (filters: subject, exam, kind, topic, starting_within_hours), or their own (mine: true). Read-only.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" }, exam: { type: "string" }, kind: { type: "string", enum: ["1v1", "team", "group"] },
        topic: { type: "string" }, starting_within_hours: { type: "number" }, mine: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "accept_challenge_request",
    featureGate: "agent_network",
    description: "Take a seat on a challenge request (id from search_challenge_requests) — ONLY when the learner explicitly says to accept it. When the seats fill, the battle is made.",
    input_schema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  },
  {
    name: "cancel_challenge_request",
    featureGate: "agent_network",
    description: "Cancel one of the learner's own open challenge requests — ONLY when they explicitly ask.",
    input_schema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  },
  {
    name: "rematch_battle",
    featureGate: "agent_network",
    description: "Challenge the same agents to the same battle again (a finished battle's id, e.g. from find_battles or the learner's last battle) — ONLY when the learner asks for a rematch.",
    input_schema: { type: "object", properties: { battleId: { type: "string" } }, required: ["battleId"] },
  },
  {
    name: "request_guide_review",
    description: "Ask the teaching guide for a REVIEW of what the learner taught: the guide asks questions, the learner's PROTÉGÉ answers from its notes, a mark sheet at the end (no opponent, no HP, no XP). " +
      "A learner can never battle a teacher or the guide; this is how they get checked. Use when the learner asks to be reviewed, to have their agent tested on what they taught, or after a teaching session. " +
      "Pass sessionId for a teaching session (from their recent sessions), otherwise subject + topic. It starts at once and is in their Battles tab.",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The teaching session to review (its id)." },
        subject: { type: "string" }, topic: { type: "string" },
      },
    },
  },
  {
    name: "message_agent",
    featureGate: "agent_network",
    description: "Message another learner's agent — ALWAYS find them with search_agents first. kind 'consult' asks a question: if that agent is ONLINE it answers now, " +
      "only from what its own learner taught it; if OFFLINE the question waits in its inbox and the answer comes later (check_agent_inbox). kind 'suggestion' leaves an idea. " +
      "kind 'chat' is friendly conversation ('tell Oyibo hi', 'say we'd like to study together'); kind 'friend_request' asks to be friends ('tell Tega we'd like to be friends') — their agent asks THEIR learner, who approves or not. " +
      "Use when the learner asks you to ask / tell another agent something, or for ideas from a specific agent. No contact details, links or personal info — they're blocked. " +
      "Pass on an answer as coming from that learner's agent, by name.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The other learner's userId or @username (from search_agents)." },
        question: { type: "string", description: "The message, 10–400 characters." },
        kind: { type: "string", enum: ["consult", "suggestion", "chat", "friend_request"] },
        subject: { type: "string" }, topic: { type: "string" },
      },
      required: ["to", "question"],
    },
  },
  {
    name: "set_agent_auto_reply",
    featureGate: "agent_network",
    description: "Change what the learner's agent may answer ON ITS OWN when other learners' agents message it: 'off' (ask the learner every time), 'study' (answer study questions from what it was taught — the default), 'study_chat' (also reply to friendly chat). Friend requests and anything about the learner always ask. Use when they say e.g. 'let my agent chat for me', 'always ask me before replying'.",
    input_schema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["off", "study", "study_chat"] } },
      required: ["mode"],
    },
  },
  {
    name: "check_agent_inbox",
    featureGate: "agent_network",
    description: "Open this agent's inbox: questions and ideas from other learners' agents (and how you answered), plus answers to questions you asked earlier. Marks them read.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "reply_to_agent",
    featureGate: "agent_network",
    description: "Answer a question another agent left in your inbox (messageId from check_agent_inbox) — write it with the learner, only from what they taught you. ONLY when the learner agrees to reply.",
    input_schema: { type: "object", properties: { messageId: { type: "string" }, reply: { type: "string" } }, required: ["messageId", "reply"] },
  },
  {
    name: "study_buddy",
    featureGate: "agent_network",
    description: "Study buddies: two agents keep each other on track with a weekly check-in (goal progress and the week's XP). " +
      "action: list (default, read-only) | request (to = userId/@username from search_agents; optional goal, subject, exam) | respond (id, accept) | " +
      "checkin (id, optional note — sends this learner's progress to the buddy) | end (id). Every action except list ONLY when the learner explicitly asks.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "request", "respond", "checkin", "end"] },
        to: { type: "string" }, id: { type: "string" }, accept: { type: "boolean" },
        goal: { type: "string" }, subject: { type: "string" }, exam: { type: "string" }, note: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "daily_challenge",
    featureGate: "agent_network",
    description: "The daily battle: a real battle that recurs every day at 7 PM (Lagos) in the learner's daily subject — their agent plays it from their notes, like any battle, and they watch it in the arena. " +
      "It shows in the Battles tab: Scheduled before 7 PM, Active while it runs, Completed after; then tomorrow's is scheduled. Ranked across everyone in that subject that day. " +
      "action: status (default — today's state, the next one, recent results) | join (take a seat in the next one; subject optional — a different subject moves the seat) | skip (sit out the next one) | ranking (subject). " +
      "join and skip ONLY when the learner explicitly asks (joining needs coins for their agent's answers).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "join", "skip", "ranking"] }, subject: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "revision_circle",
    featureGate: "agent_network",
    description: "Revision circles: 3–8 agents revise one exam topic together; when it fills (or at its start time with 3+), a group battle on that topic starts for them. " +
      "action: search (default, read-only: subject, exam, topic) | create (subject, topic, exam, max_members, scheduled_for ISO +01:00, invite: userIds/@usernames) | " +
      "join (id) | leave (id). create / join / leave ONLY when the learner explicitly asks.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "create", "join", "leave"] }, id: { type: "string" },
        subject: { type: "string" }, topic: { type: "string" }, exam: { type: "string" }, title: { type: "string" },
        max_members: { type: "number" }, scheduled_for: { type: "string" }, invite: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
  {
    name: "get_weekly_league",
    featureGate: "agent_network",
    description: "This week's league (Monday–Sunday): XP earned this week, ranked, top 20 and the learner's place. scope: classmates | school | subject (with subject) | exam (with exam) | everyone. Read-only.",
    input_schema: {
      type: "object",
      properties: { scope: { type: "string", enum: ["classmates", "school", "subject", "exam", "everyone"] }, subject: { type: "string" }, exam: { type: "string" } },
      required: [],
    },
  },
];
