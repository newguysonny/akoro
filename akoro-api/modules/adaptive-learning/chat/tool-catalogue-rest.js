// Second half of the Agent Chat catalogue + instructor tools.
import { REPEAT_SCHEMA } from "./tool-catalogue-core.js";
import { BLOG_SEARCH_MAX_RESULTS } from "../../../lib/blogResearch.js";

export const CHAT_TOOLS_REST = [

  {
    name: "ask_to_be_taught",
    description: "You are the learner's protégé: use this when they ask you to explain, quiz or help with subject content you have NOT been taught " +
      "(nothing under \"What the learner has taught you\" covers it). It shows them a Teach me button for that topic. Say honestly that you " +
      "haven't been taught it and point to where they can read about it first. Do not explain the content yourself.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to be taught, short, e.g. 'Photosynthesis'." },
        subject: { type: "string", description: "The school subject, e.g. 'Biology'. Omit when unclear." },
      },
      required: ["topic"],
    },
  },
  {
    name: "consult_teaching_guide",
    description: "Ask NaNa Esumai, your teaching guide, about something you were NOT taught — ONLY after you told the learner you haven't been taught it " +
      "and they insisted on an answer (\"just tell me\", \"I don't know it either\", \"ask your guide\"). Returns the guide's explanation. " +
      "Pass it on opening with \"From NaNa, my teaching guide (you haven't taught me this):\" and invite them to teach it back to you. " +
      "Never present it as something you were taught.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The learner's question, as they asked it." },
        topic: { type: "string", description: "The topic, short." },
        subject: { type: "string", description: "The school subject, if clear." },
      },
      required: ["question"],
    },
  },
  {
    name: "search_blog_posts",
    featureGate: "blog_research",
    description: "Search Akoro's own blog — the platform's published articles on study methods, exam prep, and learning. " +
      "This is your internal research channel (there is no web search): use it to ground study advice, cite a real article " +
      "to the learner, or check what Akoro says about a topic before answering from general knowledge. Returns cards " +
      "(slug, title, excerpt) and, for a query, the best passages from the articles' bodies (passage, post title, " +
      "heading) — quote a passage and name its post; follow up with read_blog_post for the full text.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A word or two to look for, e.g. 'past questions' or 'spaced repetition'. Omit to list the latest posts." },
        category: { type: "string", description: "Optional category filter as published on the blog." },
        limit: { type: "number", description: `1-${BLOG_SEARCH_MAX_RESULTS}, default 5.` },
      },
      required: [],
    },
  },
  {
    name: "read_blog_post",
    featureGate: "blog_research",
    description: "Read one Akoro blog post in full (plain text) by its slug from search_blog_posts. Use it for research " +
      "and reasoning: quote real articles accurately instead of paraphrasing from memory.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The post slug returned by search_blog_posts." },
      },
      required: ["slug"],
    },
  },
  {
    name: "list_my_goals",
    description: "Show the learner's study goals (active, paused, achieved) with their target dates and progress notes. Use when they ask about their goals, or before creating a task or proposal that should align with one.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_goal",
    description: "Save a new study goal for the learner. ONLY when they explicitly ask to add/save a goal — never on your own initiative (autonomous goal ideas go through the proposal inbox instead). One clear line, e.g. 'Score 80% in Further Maths'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The goal in one clear line (max 120 characters)." },
        category: { type: "string", description: "Optional short category, e.g. 'Exam', 'Mastery', 'Habit'." },
        metric: { type: "string", description: "Optional how-we-measure line, e.g. 'WAEC further maths score'." },
        exam: { type: "string", description: "Optional exam this targets, e.g. 'WAEC', 'JAMB'." },
        targetDate: { type: "string", description: "Optional target date (YYYY-MM-DD)." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_goal_progress",
    description: "Update one of the learner's goals: mark it achieved/paused/active or add a progress note. ONLY when they explicitly ask. Get the goalId from list_my_goals.",
    input_schema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "The goalId from list_my_goals." },
        status: { type: "string", enum: ["active", "paused", "achieved"], description: "Only when the learner wants a status change." },
        progressNote: { type: "string", description: "A short progress note (max 500 characters)." },
        targetDate: { type: "string", description: "New target date (YYYY-MM-DD), only if they asked." },
      },
      required: ["goalId"],
    },
  },
  {
    name: "list_my_proposals",
    description: "Show the suggestions from your background reviews waiting in the learner's inbox (pending, plus recent decisions). Read-only: the learner approves or dismisses each one in the Suggestions tab — you can discuss them and point there, but you can never execute or approve a proposal yourself.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_my_blogs",
    description: "Show the learner's own blog posts (drafts and published) with excerpts. Use when they ask about their blogs or before editing one.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_blog_draft",
    description: "Save one of the learner's blog posts as a draft — a new draft (no blogId) or an update to an existing one (blogId from list_my_blogs). ONLY when they explicitly ask. If they want help writing, draft the text WITH them in the conversation first, then save what they approve.",
    input_schema: {
      type: "object",
      properties: {
        blogId: { type: "string", description: "An existing post to update; omit to create a new draft." },
        title: { type: "string", description: "The blog title (max 120 characters)." },
        body: { type: "string", description: "The full blog text in the chat markdown subset (## headings, - lists, > quotes)." },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "publish_blog",
    description: "Publish one of the learner's blog posts — new (no blogId) or an existing draft (blogId). ONLY on an explicit ask to publish; confirm the title with them first if it is not settled. Published posts also appear on the public blog under Community.",
    input_schema: {
      type: "object",
      properties: {
        blogId: { type: "string", description: "An existing draft to publish; omit to write and publish in one step." },
        title: { type: "string", description: "The blog title (max 120 characters)." },
        body: { type: "string", description: "The full blog text — publishing an empty post is rejected." },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "list_tasks",
    description: "Get the student's pending tasks sorted by priority.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_battles",
    description: "Find the learner's active and upcoming battles: ones they're in or invited to, battles in their courses and classes, and the next daily battle. Each has when it starts, subject, XP prize, HP lost per miss and minimum XP to join.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ranking",
    description: "Get the student's total XP and leaderboard rank (overall, and in their courses/classes), and battles won. Not for how other players did in battles the learner played — that needs create_tool.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_weak_topics",
    description: "Get topics where the student has low confidence. Use for study recommendations.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Filter by subject (optional)" },
      },
      required: [],
    },
  },

  {
    name: "get_learning_overview",
    description: "Read a bounded cross-subject overview of the signed-in learner's active courses, pending tasks, recorded knowledge subjects, and one deterministic next-study suggestion. Use for requests such as 'how is my study going?' or 'what should I do next?'. This is not a full account export.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_knowledge_map",
    description: "Read the signed-in learner's recorded subject/topic knowledge health: topic counts, confidence bands, and review-due status. It never returns saved note bodies. Use when they ask what topics they have covered, which are due for review, or how their knowledge map looks.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Optional exact subject to focus on (maximum 180 characters)." },
      },
      required: [],
    },
  },
  {
    name: "search_my_study_knowledge",
    description: "Search a small, bounded set of the signed-in learner's saved study knowledge — what their agent learnt from past teaching sessions. For documents, files or notes in their Library (uploads, links, pasted notes) use search_my_library instead. A query is required; never search teacher/private material or another learner's records.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The learner's study term or question to find in their saved knowledge (3 to 300 characters)." },
        subject: { type: "string", description: "Optional exact subject filter (maximum 180 characters)." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_my_library",
    description: "Find documents in the signed-in learner's own Library (uploads, links, pasted notes) by name or by what is inside them. Use when recommending study material, or when they ask for their notes or a document; the reply then shows each one as a link that opens it in the reader. When they ask you to MAKE a quiz, flashcards, a summary or a podcast from their material, use make_study_material instead (it builds it and saves it). For notes (they write those themselves), call this with `tool` set: the link opens the document on that tool. Search again every time (the Library changes; an earlier answer in this chat may be out of date). Never invent a document — mention only what this returns, by name; never show record ids, the app shows each as a link.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "REQUIRED. The topic or document to look for (3-200 characters)." },
        tool: { type: "string", enum: ["quiz", "flashcards", "summary", "notes", "podcast"], description: "OPTIONAL. The reader's study tool they asked for - the returned link opens the document on it. Omit when they just want the document." },
      },
      required: ["query"],
    },
  },
  {
    name: "make_study_material",
    description: "Make a quiz, flashcards, a summary or a podcast FROM study material, and save it in the reader (cited to the document's pages). Call it whenever they ask to make one — including a bare topic ask like 'create a quiz on properties of matter' with no document named and nothing attached. WHERE it comes from is the `source` action — pick it like an action on a domain tool, and for a topic ask work through them in this order: (1) source 'taught' — built from what the learner taught you (their taught notes on the topic); (2) source 'library' — a document in their own Library (give `query` for the topic or document name — REQUIRED for topic asks, use their words — or `folder` when they name a folder); (3) source 'discover' — the free notes other learners share in Discover (one winner is first copied into their Library; several that would help are written into ONE gathered content in their Library, cited to each source, and the build reads that). But when the learner NAMES a source in their ask — 'from my library', 'from the platform' or 'in Discover', 'from what I taught you', 'from the file I sent' — call THAT source first and only: the order above is only for asks that name no source, and a hit in an earlier source never overrides the source they named. If a call comes back with a `next` field, call again with source set to it — do NOT tell the learner it can't be done until 'discover' has been tried. Use source 'upload' (or from_chat_file) when they mean a file they sent in THIS chat ('this material', 'the photo I uploaded'): that one is final — if it hasn't been read yet, say so; never substitute a different document. The result says which source it was built from — name it in your one line (e.g. 'from what you taught me', 'from your Library document X', 'from Adaeze's free notes in Discover — a copy is now in your Library', 'from a gathered content in your Library, written from N free notes in Discover'). The reply shows the result as a card that opens the reader on it — say what you made in one line (how many questions or cards, from which source); never write the questions, cards or summary in chat. A podcast takes a minute or two to finish: say it's being made. If several of THEIR OWN documents match almost equally, it returns them — ask which one. Never invent a document.",
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string", enum: ["quiz", "flashcards", "summary", "podcast"], description: "REQUIRED. What to make." },
        query: { type: "string", description: "OPTIONAL, but required unless folder is given. The topic or document name to build it from (3-200 characters). Use the learner's words." },
        folder: { type: "string", description: "OPTIONAL. The Library folder they named, e.g. 'Basic Science'. Use instead of query when they point at a folder; if it holds several documents the tool returns them so you can ask which." },
        source: { type: "string", enum: ["taught", "library", "discover", "upload"], description: "OPTIONAL. WHERE to build from — the tool's action. 'taught': from what the learner taught you. 'library': their Library documents. 'discover': free notes in Discover. 'upload': a file they sent in this chat. If the learner names a source in their ask, call THAT source — the naming overrides the default order. For a topic ask that names no source, start with 'taught' and follow the `next` field on a miss. Omit only when they name a document or folder directly (the server then runs the whole order in one call)." },
        from_chat_file: { type: "boolean", description: "OPTIONAL. Set true when the learner means a file they sent in this chat ('this material', 'this file', 'the photo I uploaded', 'the PDF I just sent'). The server then builds from that file (same as source 'upload'). Leave unset/false for named documents, topics and folders." },
        focus: { type: "string", description: "OPTIONAL. A narrower focus inside the document, e.g. 'photosynthesis' or 'chapter 2'. Applies to quiz/flashcards/summary/podcast." },
        scope: { type: "string", enum: ["document", "page"], description: "OPTIONAL. 'document' (default) builds from the whole file; 'page' builds from one page and REQUIRES pageNumber. Use 'page' only when the learner says 'this page' or names a page." },
        pageNumber: { type: "integer", minimum: 1, description: "OPTIONAL. The 1-based page for scope='page'. Omit for the whole document." },
        count: { type: "integer", minimum: 1, maximum: 20, description: "OPTIONAL. How many questions or cards they asked for; omit to let the tool choose. Not used by summary/podcast." },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"], description: "OPTIONAL. Quiz difficulty; omit for medium. Ignored by flashcards/summary/podcast." },
        length: { type: "string", enum: ["short", "medium", "long"], description: "OPTIONAL. Podcast length; omit for the default. Ignored by the other tools." },
      },
      required: ["tool"],
    },
  },
  {
    name: "read_upload",
    description: "Read one of the learner's chat uploads (a file they sent in this chat that is saved in their Library but not filed yet). Returns the extraction state first: 'extracting' (still being read in the background — tell them briefly and don't guess at the content), 'failed' (call retry_extraction, then read_upload again), or 'ready' with the extracted content from the database. When the uploads section of your context lists waiting uploads, call this for each one before answering about them. After a ready read, decide the filing and call file_upload.",
    input_schema: {
      type: "object",
      properties: {
        ingest_id: { type: "string", description: "REQUIRED. The upload id from the uploads section of your context." },
      },
      required: ["ingest_id"],
    },
  },
  {
    name: "retry_extraction",
    description: "Re-run the extraction for an upload whose read failed (read_upload said 'failed'). Then call read_upload again — it waits for the new read to land. If it fails a second time, tell the learner plainly and carry on with the rest of their message.",
    input_schema: {
      type: "object",
      properties: {
        ingest_id: { type: "string", description: "REQUIRED. The upload id whose extraction failed." },
      },
      required: ["ingest_id"],
    },
  },
  {
    name: "list_folders",
    description: "The learner's Library folders (name and how many items each holds). Call it when sorting an upload: if one of their folders clearly fits the file, pass its folder_id to file_upload instead of letting a new folder be created.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "file_upload",
    description: "File an upload you have read (read_upload returned its content) into the learner's Library, from YOUR decision: a short descriptive title, the subject, the kind, and up to 6 topic names — decided from the content and the conversation (what they said the file is for beats a guess from the text). Pass folder_id only when list_folders showed a folder that clearly fits; otherwise the folder is picked or created from the subject and kind. Returns where it was filed — name that folder in your reply, never before this returns. If it returns needsSubject, ask the learner which subject it is, in one line.",
    input_schema: {
      type: "object",
      properties: {
        ingest_id: { type: "string", description: "REQUIRED. The upload id to file." },
        title: { type: "string", description: "A short descriptive title for the file, from its content (e.g. 'Fossil Fuels: Coal Formation and Types'). Becomes the file's name in the Library." },
        subject: { type: "string", description: "The school subject it belongs to, e.g. 'Geography'. Omit only when the content gives no subject at all." },
        kind: { type: "string", enum: ["past_paper", "notes", "textbook", "syllabus", "slides", "other"], description: "What kind of document it is." },
        folder_id: { type: "string", description: "OPTIONAL. A folder id from list_folders, when one clearly fits. Omit to file by subject and kind." },
        topics: { type: "array", items: { type: "string" }, description: "Up to 6 topic names the file covers, from its content." },
      },
      required: ["ingest_id"],
    },
  },
  {
    name: "analyse_past_papers",
    description: "Across the past papers the signed-in learner uploaded (read into questions by topic): which topics keep coming back — in how many papers and which years, how many questions and marks. Use for 'which topics keep coming up?', 'what should I focus on for WAEC Biology?', or after they upload a past paper. Answer only from this result; with one paper, say more years would show the pattern. Their papers are private to them.",
    input_schema: {
      type: "object",
      properties: { subject: { type: "string", description: "Only this subject, e.g. Biology (optional)." } },
    },
  },
  {
    name: "get_concept_tracker_summary",
    description: "When Concept Tracker is enabled, read the signed-in learner's bounded approved-concept statuses, resume points, and learner-visible confusion notes. Use for 'where was I stuck?' or 'what should I resume?'. Never expose raw chat, model rationale, or Guardian review internals.",
    featureGate: "concept_tracker",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Optional exact subject filter (maximum 180 characters)." },
      },
      required: [],
    },
  },
  {
    name: "get_learning_insights_summary",
    description: "When Learning Insights is enabled, read only a privacy-minimised, expiry-aware study-signal summary: evidence confidence label, observed learning approach, pacing recommendation, and compact server-created study episodes. Use when a learner asks why their study guidance is adapting. Never present this as a diagnosis, identity, or hidden psychological profile.",
    featureGate: "learning_insights",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_exam_prep_status",
    description: "When generated exam-style practice is enabled, read the signed-in learner's recent generated-practice runs and workflow states: topic, attempt, score, status, and next workflow state. Use for resume/progress questions. Never return answer keys or call generated questions historical past papers.",
    featureGate: "exam_prep_confidence",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_chat_memory",
    description: "When durable Agent Chat memory is enabled, read the signed-in learner's bounded, learner-clearable study memories and the current chat's compact summary. Use only when they ask what the agent remembers about their study goals or context. Never expose a raw transcript, internal scratchpad, hidden reasoning, or raw tool output.",
    featureGate: "durable_agent_chat_context",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_agent_preferences",
    description: "Read only the signed-in learner's selected learning guide and its public teaching style. Use when they ask which guide or teaching setup they selected. Never expose private account settings, purchases, or system configuration.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_autonomy_status",
    description: "Read the signed-in learner's visible Agent Online/Offline choice and the exact limited due-task behaviour. Use when they ask whether the agent is online, can remind them, or will initiate a due-task chat. Never claim the agent completes, changes, or schedules tasks autonomously.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "start_study_prep_session",
    description: "Start a study-prep session for the learner: resolves the approved syllabus, inspects their recorded knowledge, and proposes an ordered plan with a coin estimate. Plan-only — no practice is generated and nothing is charged until the learner approves the plan card. Use when they ask to prepare for a test or exam covering multiple topics. When they ask for a study plan from a file, paper or folder they uploaded (\"make a study plan from this paper\"), pass from_materials: true — the plan then comes from that material's topics, the most-tested first, and its practice from their own past-paper questions.",
    featureGate: "study_prep",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The learner's study goal in their own words (3 to 300 characters)." },
        subject: { type: "string", description: "The subject, e.g. 'Basic Science'." },
        classLevel: { type: "string", description: "Class level, e.g. 'JSS1' or 'SS2'." },
        examBoard: { type: "string", description: "Exam board, e.g. 'WAEC', 'NECO', 'JAMB'." },
        from_materials: { type: "boolean", description: "Plan from the material they uploaded in this chat (or the folder named in `folder`), not the school syllabus." },
        folder: { type: "string", description: "With from_materials: the Library folder to plan from, if they named one." },
      },
      required: ["goal"],
    },
  },
  {
    name: "cancel_study_prep_session",
    description: "Cancel the learner's study-prep session when THEY ask to cancel, stop or remove their study plan. A plan not yet approved is cancelled at once (nothing was charged). A plan already under way (studying or paused) keeps its recorded progress but stops: call first without confirm, tell them what is lost, and call again with confirm: true only after they say yes.",
    featureGate: "study_prep",
    input_schema: {
      type: "object",
      properties: { confirm: { type: "boolean", description: "Only for a plan already under way: true once the learner has said yes to ending it." } },
      required: [],
    },
  },
  {
    name: "get_running_work",
    description: "What is running for the learner right now, outside this chat: their Study Prep plan (topic, status), an Agent Check battle (topic, how many questions answered so far, the link to watch it in Battles) and teaching sessions waiting on their dashboard (topic, parts, progress, link). Use when they ask about progress, ask for a link, or ask about a battle or session that is running.",
    featureGate: "study_prep",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "stop_agent_check",
    description: "Stop the learner's running Agent Check when THEY ask to stop (or stop and redo) it. Its battle is cancelled, its coins are refunded and the try isn't counted; a stopped check never restarts by itself. Call first without confirm and tell them that; call again with confirm: true only after they say yes. restart: true also starts a NEW check right away (a new battle, 2 coins from the plan's approved coins) — say so before confirming.",
    featureGate: "study_prep",
    input_schema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "true once the learner has said yes." },
        restart: { type: "boolean", description: "Also start a new Agent Check right away (charged)." },
      },
      required: [],
    },
  },
  {
    name: "cancel_teaching_session",
    description: "Close the teaching session Study Prep offered (or set up on the dashboard) for the current topic, when THEY ask to cancel it. Call first without confirm, then with confirm: true after they say yes.",
    featureGate: "study_prep",
    input_schema: { type: "object", properties: { confirm: { type: "boolean", description: "true once the learner has said yes." } }, required: [] },
  },
  {
    name: "get_study_prep_session",
    description: "Read the learner's current study-prep session: status, topics with their states, the plan-card estimate, and the recent agent activity log. Use for progress/resume questions. Never returns answer keys.",
    featureGate: "study_prep",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "submit_tool_request",
    description: "Create a compact request for Akoro admins: a missing ability you don't have, a study tool, an integration, OR a missing learning method/component (a study technique or reusable learning building-block, e.g. a 'mind-map learning' method or an 'active recall' component — set kind='component' for those; set kind='tool' for a missing tool, executor or integration). NOT for anything schema_lookup lists as needs_your_ok or needs_approval (e.g. deleting or completing the learner's tasks): for those call create_tool with it in hint.capabilities — the learner allows a needs_your_ok change themselves on a card, and an admin decides a needs_approval one; either way the tool is finished in this chat. It lands on the admins' Agent requests page; the answer comes later, not now. Use ONLY when the learner explicitly asks — 'ask for permission to …', 'request access', 'send it to the admins', 'submit it' — and when they do, CALL it: never say a request was made without this call succeeding, and tell them exactly what its `tell` says (a repeat of an earlier request is NOT a new one). Never submit automatically merely because something is unsupported, and never copy raw chat, attachments, passwords, contact details, or sensitive account data. Describe the needed capability concisely instead.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short feature or integration title (6 to 120 characters)." },
        description: { type: "string", description: "Privacy-minimised description of the requested capability and study use case (20 to 800 characters). Do not include the original prompt, private data, or attachments." },
        category: { type: "string", enum: ["study_support", "organisation", "integration", "accessibility", "other"], description: "Best matching requested capability category." },
        kind: { type: "string", enum: ["tool", "component"], description: "'tool' for a missing tool/executor/integration; 'component' for a missing learning method or reusable learning component." },
      },
      required: ["title", "description", "category"],
    },
  },
  {
    name: "check_my_requests",
    description:
      "Read the status of the feature requests this learner has filed with the admins " +
      "(tool ideas or learning component requests): title, kind, status " +
      "(new / under_review / planned / declined / implemented) and any admin note. Use " +
      "when the learner asks \"is my request ready?\", \"did the admins build it?\", or " +
      "before you confirm a requested feature is available.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "submit_bug_report",
    description:
      "File a bug report for the Akoro team when something in the app is broken or wrong " +
      "(a tool returns wrong numbers, a screen fails, a feature misbehaves). Use ONLY when " +
      "the learner reports a problem and explicitly asks you to report it. Describe what " +
      "happened vs what was expected, with the steps, and never paste private data. It lands " +
      "on the admins' Agent requests page as a bug; when it is fixed the learner is notified " +
      "and you are told here. Call it — never say a bug was reported without this call succeeding.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short bug summary, e.g. 'Library count shows 6 instead of 51' (6 to 120 characters)." },
        description: { type: "string", description: "What happened, what was expected, and the steps to reproduce. Concise; no private data (20 to 800 characters)." },
        category: { type: "string", enum: ["study_support", "organisation", "integration", "accessibility", "other"], description: "Roughly where the bug is (defaults to other)." },
      },
      required: ["title", "description"],
    },
  },
];
// Kill switches: AKORO_AGENT_PEER_CONSULT_ENABLED=false, AKORO_BLOG_RESEARCH_ENABLED=false, AKORO_AGENT_NETWORK_ENABLED=false remove those tools everywhere at once.
export const peerConsultEnabled = String(process.env.AKORO_AGENT_PEER_CONSULT_ENABLED ?? "true").toLowerCase() !== "false";
export const blogResearchEnabled = String(process.env.AKORO_BLOG_RESEARCH_ENABLED ?? "true").toLowerCase() !== "false";
export const agentNetworkEnabled = String(process.env.AKORO_AGENT_NETWORK_ENABLED ?? "true").toLowerCase() !== "false";

// Instructor catalogue: built by chat.js with its teaching tools + field props.
export function buildInstructorTools(teachingTools, teachingFieldProps) {
  return [
  {
    name: "prepare_activity",
    description: "Prepare an activity draft for the instructor to review and assign (human-in-the-loop: you never assign — the instructor previews the draft and taps Assign). Use when the instructor asks you to create/set/prepare an activity, assignment, project, self study, live session, journey or battle. AUDIENCE IS REQUIRED: if the instructor did not say who the work is for, do not call this tool — ask them first, then call it with their answer. The server drafts the study plan itself (subtopics and objectives — the same generator the workbench uses), so you never supply those. But subject IS required for every type except battle: if the instructor did not NAME it, ask before calling — even when the topic makes it look obvious ('fractions' is still 'Which subject is it for?'). The same for who it's for and the topic: only what the instructor said, never your guess (the server refuses unsaid fields and hands back the question to ask). ` For a batch request (\"prep this week's activities\"), call this once per activity in the same reply - each gets its own Preview button. ASSIGNMENTS: pass the instructor's words about the questions in question_request VERBATIM (e.g. \"5 questions on photosynthesis, 3 MCQ, 2 direct theory\") and fill question_plan from them; the server writes the questions in the background (Version 1) and holds them to that count and mix — never write the questions yourself. Add diagrams only when the instructor asks for them or a question can't be asked without one.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["self_study", "assignment", "project", "live_course", "multi_stage", "battle"], description: "The workbench activity type. multi_stage takes stages; battle drafts are completed by the instructor in the battle form at preview time." },
        title: { type: "string", description: "What learners will see (optional — derived from the topic when omitted)." },
        subject: { type: "string", description: "School subject, e.g. 'Basic Science' or 'Mathematics'. REQUIRED for every type except battle — ask when the instructor did not name one." },
        topic: { type: "string", description: "The topic the activity is built from." },
        instructions: { type: "string", description: "Optional instructions to learners." },
        difficulty: { type: "string", enum: ["easy", "intermediate", "hard"], description: "Only when the instructor said, or the level is obvious." },
        due_hint: { type: "string", description: "The due date as a human-friendly label exactly as the instructor said it, e.g. 'Friday at 1 PM'. Never invent one." },
        due_at: { type: "string", description: "Optional exact due instant in ISO 8601 with a timezone offset. Resolve relative phrases ('tomorrow at 8pm') against the Current date and time in your context (+01:00 for Africa/Lagos). If you still cannot resolve it precisely, send due_hint as the label instead — never guess an exact time." },
        scheduled_hint: { type: "string", description: "For live_course: when the session holds, as the instructor said it." },
        stages: { type: "array", maxItems: 6, description: "For multi_stage: the ordered journey.", items: { type: "object", properties: {
          kind: { type: "string", enum: ["self_study", "assignment", "project", "battle"], description: "battle = a real learner-vs-learner battle in the journey (needs a class and the whole class or two+ learners)." },
          title: { type: "string" }, topic: { type: "string" }, subject: { type: "string" },
          questions: { type: "number", description: "battle stage only: how many questions (5-20, default 5)." },
        }, required: ["topic"] } },
        question_request: { type: "string", description: "assignment only: the instructor's own words about the questions, verbatim — count, mix of types, diagrams, marks." },
        ai_auto_grade: { type: "boolean", description: "assignment only: true ONLY when the instructor asked for AI / auto grading (the server then writes a marking rubric from the questions, which they review in the Rubric tab). Leave out otherwise." },
        answer_format: { type: "string", enum: ["images", "text", "images_text", "all"], description: "assignment only: how learners may answer — ONLY when the instructor said (images = photos of answers, text = typed, images_text = both, all = anything incl. PDF/Word). Leave out otherwise." },
        question_plan: { type: "object", description: "assignment only: the same request as structure. Only what the instructor said — leave the rest out.", properties: {
          total: { type: "number", description: "How many questions in all." },
          mix: { type: "array", description: "Each kind of question and how many, e.g. [{label:'MCQ',kind:'mcq',count:3},{label:'Theory',kind:'open',count:2}]. 'direct theory', 'short answer', 'essay' are open. Named kinds keep their shape — use these labels: 'True or false' (mcq), 'Assertion and reason' (mcq), 'Labelling' (label: name the marked parts of a diagram), 'Case study' (open: a scenario then its questions — count the questions).", items: { type: "object", properties: {
            label: { type: "string" }, kind: { type: "string", enum: ["mcq", "open", "label"] }, count: { type: "number" },
          }, required: ["label", "kind", "count"] } },
          diagrams: { type: "number", description: "How many questions must have a diagram. 0 when they said no diagrams; omit when they didn't say." },
          options: { type: "number", enum: [4, 5], description: "Options per MCQ — 4 unless they asked for 5 (A–E)." },
          total_points: { type: "number", description: "Total marks, if they said." },
        } },
        battle_format: { type: "string", enum: ["battle", "review"], description: "battle only: 'review' = a STUDY REVIEW of ONE learner (a mark sheet, no opponent); otherwise a battle between two or more learners. A teacher never competes — they host." },
        total_questions: { type: "number", description: "battle only: how many questions, if the instructor said (5–30)." },
        scheduled_at: { type: "string", description: "battle only: when it starts, ISO 8601 with offset (+01:00), resolved against the current date and time — only if the instructor gave a time." },
        repeat: { ...REPEAT_SCHEMA, description: "battle only, RECURRING ('every Friday at 2pm until the end of term'): days 0=Sun…6=Sat, time 'HH:MM', until ISO 8601. Ask for the end date if they gave none." },
        audience: { type: "object", description: "WHO this is for, from the instructor's own words. Ask first if unknown.", properties: {
          whole_class: { type: "boolean", description: "True for 'my whole class' / 'everyone'." },
          classroom_name: { type: "string", description: "The class as named, e.g. 'JSS 2'." },
          classroom_id: { type: "string", description: "When the instructor referenced a specific class id." },
          usernames: { type: "array", items: { type: "string" }, description: "Learner handles or emails for picked learners." },
          user_ids: { type: "array", items: { type: "string" } },
        } },
      },
      required: ["type", "topic", "audience"],
    },
  },
  {
    // The teaching-tool workbench, callable from chat: the same runner the
    // workbench and the task scheduler use, so unlock checks, charge-after
    // billing and saving to the Library behave identically.
    name: "run_teaching_tool",
    description: "Draft a teaching resource for the instructor to preview — it reaches their Library only when they approve it (Save to Library), and each follow-up (\"make it more playful\") becomes a new version via revise_activity_draft with change_request. Use when they ask for a podcast, common misconceptions, real-world connections, lesson hooks, a vocabulary list, a lesson plan, an activities pack or an assignment sheet. (Activities that go to learners — assignments, projects, battles, self study — use prepare_activity instead.) Ask for the topic if it is missing;\n\nAvailable tools:\n" +
      teachingTools.map((t) => `  • ${t.key} — ${t.name}: ${t.blurb} (fields: ${t.fields.map((f) => f.name).join(", ")})`).join("\n"),
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string", enum: teachingTools.map((t) => t.key), description: "Which teaching tool to run" },
        ...teachingFieldProps,
      },
      required: ["tool"],
    },
  },
  {
    name: "list_activity_drafts",
    description: "List the instructor's still-pending activity drafts (prepared, awaiting preview/assign). Use when they ask what is prepared or want to pick a draft back up.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "discard_activity_draft",
    description: "Discard one pending activity draft at the instructor's request. A draft reaches nobody, so discarding it touches no learner.",
    input_schema: { type: "object", properties: { draftId: { type: "string", description: "The draft id from prepare_activity or list_activity_drafts." } }, required: ["draftId"] },
  },
  {
    name: "list_my_classrooms",
    description: "List the instructor's classes with learner counts, the student roster (up to 40 names per class), and class details. Use it to confirm the audience before prepare_activity when the instructor refers to a class by name, or whenever they ask about their classes or who is in them — never guess a class.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_my_profile",
    description: "The signed-in instructor's own account details: full name, email, username, role, school, and how many classes they have. Use when they ask about their account or want to confirm who the agent is acting for. Read-only.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_activity_outcomes",
    description: "See how ONE assigned activity actually went: completion counts and class-average understanding, confusion and engagement (not grades across several activities — build a tool with create_tool for that). Use when the instructor asks how an activity went or wants to act on results (revision work, a follow-up). Without an assignment id you get their recent activities to pick from. Suggest next steps - but any new activity still goes through prepare_activity and their preview.",
    input_schema: { type: "object", properties: { assignmentId: { type: "string", description: "From prepare/list flows or the workbench. Omit to list recent activities." } }, required: [] },
  },
  {
    name: "schedule_activity_routine",
    description: "Schedule a recurring weekly preparation: at the slot, a DRAFT is prepared automatically for the instructor to preview and assign (it is never assigned automatically). Use when the instructor says 'every <day>...' for work they want to PREPARE afresh each week (assignments, self study). NOT for a recurring BATTLE: a battle that repeats is ONE prepare_activity (type battle) with repeat — its occurrences run themselves. The audience is required - ask who each occurrence is for before scheduling, and confirm the day. hour is UTC (default 7).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The routine's name, e.g. 'Friday multiplication drill'." },
        day: { type: "string", enum: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] },
        hour: { type: "number", description: "UTC hour 0-23 the draft is prepared. Default 7 (mid-morning Lagos)." },
        brief: { type: "object", description: "The prepare_activity template replayed every occurrence.", properties: {
          type: { type: "string", enum: ["self_study", "assignment", "project", "live_course", "multi_stage", "battle"] },
          title: { type: "string" }, subject: { type: "string" }, topic: { type: "string" },
          instructions: { type: "string" }, difficulty: { type: "string", enum: ["easy", "intermediate", "hard"] },
          audience: { type: "object", description: "Same shape as prepare_activity's audience - required." },
        }, required: ["type", "topic", "audience"] },
      },
      required: ["title", "day", "brief"],
    },
  },
  {
    name: "list_activity_routines",
    description: "List the instructor's weekly routines (what is scheduled, the day, and whether active or paused).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_activity_routine",
    description: "Cancel one weekly routine at the instructor's request.",
    input_schema: { type: "object", properties: { routineId: { type: "string", description: "The routineId from list_activity_routines (its exact title works too)." } }, required: ["routineId"] },
  },
  {
    name: "get_activity_draft",
    description: "Read one of your pending activity drafts — the title, audience, and the full plan (entries and their objectives). Use it before revising a draft, so your changes build on what is actually written rather than what you remember.",
    input_schema: { type: "object", properties: { draftId: { type: "string", description: "The draft id from prepare_activity or list_activity_drafts." } }, required: ["draftId"] },
  },
  {
    name: "revise_activity_draft",
    description: "Apply the instructor's requested changes to a PENDING activity draft after they previewed it — e.g. make entry 2 easier, entry 1 harder, add one more entry, change the title or instructions. For an assignment's QUESTIONS (make Q4 harder, add a diagram question, swap Q2) send question_request instead — each such follow-up becomes the next version (V2, V3…). First call get_activity_draft, write the revised content yourself, then send the changed fields here. The topic cannot change (discard and prepare again instead); drafts already assigned cannot be revised.",
    input_schema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "The draft id being revised." },
        changeNote: { type: "string", description: "One short line summarising what changed, e.g. 'Entry 2 made easier, added a recap entry'." },
        question_request: { type: "string", description: "assignment only: the instructor's follow-up about the QUESTIONS, verbatim (\"make question 4 harder and add a diagram question\"). The server writes the next version in the background from the latest one (their edits included) and changes only what was asked — never write the questions yourself." },
        change_request: { type: "string", description: "teaching-resource drafts only (type teaching_tool): the instructor's follow-up about the resource, verbatim (\"make the hooks more playful\", \"add two more misconceptions\"). The server writes the next version in the background from the latest one and changes only what was asked — never write the resource yourself." },
        base_version: { type: "number", description: "assignment or teaching-resource drafts: the version to build on when the instructor names one (\"go back to version 1 and…\"). Omit to build on the latest." },
        title: { type: "string", description: "Replacement title." },
        instructions: { type: "string", description: "REPLACES the instructions to learners entirely — only when the instructor gives the whole new text." },
        add_instructions: { type: "string", description: "A line to ADD to the instructions, keeping what's there — use for \"add to the instructions: …\", \"also tell them …\". Their words, as said." },
        due_at: { type: "string", description: "A new exact due instant, ISO 8601 with a timezone offset (+01:00 for Africa/Lagos), resolved against the Current date and time. Only when the instructor states one." },
        due_hint: { type: "string", description: "The due date as said, when it can't be resolved exactly ('end of the week')." },
        audience: { type: "object", description: "A new audience — same shape as prepare_activity's audience — when the instructor changes who it's for.", properties: {
          whole_class: { type: "boolean" }, classroom_id: { type: "string" }, classroom_name: { type: "string" },
          usernames: { type: "array", items: { type: "string" } }, user_ids: { type: "array", items: { type: "string" } },
        } },
        difficulty: { type: "string", enum: ["easy", "intermediate", "hard"] },
        add_subtopics: { type: "array", items: { type: "string" }, description: "Entries to ADD to the plan (study plan / task breakdown / milestones) — use this for \"add a subtopic on…\". The stored plan is kept and these are appended; you do not need to know the existing entries." },
        remove_subtopics: { type: "array", items: { type: "string" }, description: "Entries to REMOVE from the plan, by their title or key words. The rest of the stored plan is kept." },
        subtopics: { type: "array", items: { type: "string" }, description: "ONLY to reorder or rewrite the WHOLE plan: the FULL list in order. Never send it to add or remove one entry, and never from memory — you usually have not seen the stored plan (call get_activity_draft first if you really must rewrite it)." },
        objectives: { type: "object", description: "Map of entry title to its objective lines. Omitted entries keep their existing objectives." },
        stages: { type: "array", description: "multi_stage only: the full revised ordered journey.", items: { type: "object", properties: {
          kind: { type: "string", enum: ["self_study", "assignment", "project", "battle"] },
          title: { type: "string" }, topic: { type: "string" }, subject: { type: "string" },
          questions: { type: "number", description: "battle stage only: how many questions (5-20)." },
        } } },
        scheduled_hint: { type: "string", description: "live_course only." },
        note: { type: "string", description: "battle only: the intent note the instructor completes in the battle form." },
        topic: { type: "string", description: "battle only: the question topic." },
      },
      required: ["draftId"],
    },
  },
  ];
}
