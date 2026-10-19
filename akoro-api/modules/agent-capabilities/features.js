/**
 * modules/agent-capabilities/features.js — what the agent does that isn't a
 * chat tool: things it does on its own, in the chat around the tools, and in
 * the reader. Admin → Agent capabilities → Agent features reads this list;
 * add a line here when a feature ships.
 *
 *   who:   "learner" | "instructor" | "shared"
 *   isOn:  optional () => boolean from the feature's own switch (absent = on)
 *   since: the Grand Plan section, so the admin can read the detail
 */
const off = (name, dflt = "true") => () => String(process.env[name] ?? dflt).trim().toLowerCase() !== "false";

export const AGENT_FEATURES = Object.freeze([
  // Proactive (§7.16)
  { key: "proactive.ready", who: "learner", area: "proactive", name: "Ready suggestions",
    what: "Overnight the agent reviews goals, tasks, weak topics and the library, and posts a few ready next steps in chat with a preview. Yes runs it and reports back in the same chat.",
    examples: ["(arrives on its own)", "What have you suggested?"], since: "§7.16.3", switch: "Settings → Agent → Suggestions and ideas" },
  { key: "proactive.goal_work", who: "learner", area: "proactive", name: "Goal work",
    what: "A weekly progress line on each goal from counted facts, a nudge for goals untouched 7+ days, and spreading 3+ overdue tasks two a day.",
    examples: ["(arrives on its own)"], since: "§7.16.8 step 5", switch: "Settings → Agent → Suggestions and ideas" },
  { key: "proactive.ideas", who: "learner", area: "proactive", name: "Ideas",
    what: "Up to six ideas tied to a real record, goal, weak topic or note, in the Ideas section; a tap starts the chat about it.",
    examples: ["(Ideas tab → tap an idea)"], since: "§7.16.4", switch: "Settings → Agent → Suggestions and ideas" },
  { key: "proactive.quiet_learning", who: "learner", area: "chats", name: "Learns from conversations",
    what: "After a chat goes quiet, it notes what helps it help the learner — never health, feelings, money or contact details. Notes are listed and deletable in Memory.",
    examples: ["What do you remember about me?"], since: "§7.16.8 step 2", switch: "Settings → Agent → Learn from my conversations" },
  { key: "proactive.checkins", who: "learner", area: "plans", name: "Task check-ins",
    what: "A short message when a task is due or overdue, never in quiet hours.",
    examples: ["(arrives on its own)"], since: "§7.16", switch: "Settings → Agent → Task check-ins" },
  { key: "proactive.controls", who: "learner", area: "proactive", name: "Quiet hours, time zone and weekly budget",
    what: "Nothing proactive is sent in the learner's quiet hours, in their own time zone. Background work stops at the weekly budget (paid by Akoro, not coins).",
    examples: ["(Settings → Agent)"], since: "§7.16.8 step 8" },
  { key: "proactive.instructor", who: "instructor", area: "proactive", name: "Class review",
    what: "From the instructor's own activities only: who hasn't started work that's due, low class scores, and the next activity. Facts only; assigning is still the instructor's tap.",
    examples: ["(arrives on its own)"], since: "§7.16.8 step 7" },

  // Files (§7.17)
  { key: "files.upload_sort", who: "learner", area: "files", name: "Uploads sorted into subject folders",
    what: "Files dropped into the chat are read and moved into the matching subject folder; when it can't tell, it asks which subject. Undo is offered.",
    examples: ["(drop files into the chat)"], since: "§7.17" },
  { key: "files.past_papers", who: "learner", area: "files", name: "Past papers read into questions",
    what: "Uploaded past papers are read into questions by topic, so they can be analysed and practised.",
    examples: ["(upload a past paper)", "Which topics keep coming up?"], since: "§7.17" },
  { key: "files.find_similar", who: "learner", area: "files", name: "Find similar Akoro material",
    what: "Offers Akoro material on the same topics as an upload and adds it to the folder.",
    examples: ["Find similar material and add it to the folder."], since: "§7.17" },
  { key: "files.recently_deleted", who: "learner", area: "files", name: "Recently deleted",
    what: "Deleted files are kept 30 days and can be restored.",
    examples: ["Restore the file I deleted yesterday."], since: "§7.17" },
  { key: "files.reader_tools", who: "learner", area: "files", name: "Study tools in the reader",
    what: "From any document: a quiz, flashcards, notes or a teach session.",
    examples: ["Make a quiz from my Cell transport notes.", "Flashcards from chapter 3."], since: "§7.17" },

  // Teaching
  { key: "teaching.agent_check", who: "learner", area: "teaching", name: "Agent Check",
    what: "A free 5-question check the agent answers from what the learner taught it; the gaps show what to teach next.",
    examples: ["Start an Agent Check on osmosis."], since: "D45", isOn: off("AKORO_STUDY_PREP_AGENT_CHECK") },
  { key: "teaching.study_prep_wakes", who: "learner", area: "teaching", name: "Study Prep keeps working after the plan",
    what: "After the plan is ready, each approve, adjust, new topic and marked Agent Check wakes the agent for up to 4 decisions, shown in the chat. A check starts by itself a minute after its topic or teach-back, inside the approved coins; past them the agent asks first.",
    examples: ["Prepare me for my Basic Science exam in 5 weeks", "(approve the plan on the card)"], since: "2026-10-19", isOn: off("AKORO_STUDY_PREP_ENABLED") },

  // In the chat
  { key: "chat.trace", who: "shared", area: "other", name: "Live steps",
    what: "Each turn shows what the agent is doing (\"Checking your goals ✓\") in plain words — never raw tool names or data.",
    examples: ["(every turn)"], since: "§13.4" },
  { key: "chat.think", who: "shared", area: "other", name: "Think mode",
    what: "A slower, deeper answer on the reasoning model, with a summary of its reasoning.",
    examples: ["(Think switch in the chat box)"], since: "D9" },
  { key: "chat.write_confirm", who: "shared", area: "building", name: "Confirm before a tool writes",
    what: "A tool the agent built that changes the account shows a confirmation card first; writes also need admin approval.",
    examples: ["(card in the chat)"], since: "§7.12 S6" },
  { key: "activities.preview_assign", who: "instructor", area: "activities", name: "Preview and assign",
    what: "Every activity the agent prepares is a draft; the instructor previews it and taps Assign. The agent never assigns.",
    examples: ["(draft card in the chat)"], since: "HITL", isOn: off("AKORO_ACTIVITY_DRAFTS_ENABLED") },
]);
