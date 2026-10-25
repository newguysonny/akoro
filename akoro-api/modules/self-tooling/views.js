/**
 * modules/self-tooling/views.js — the Data Views a created tool may query.
 * Plan: reference/Self-Tooling & Verification Gate — Grand Plan.md §7.2.
 *
 * A Data View is a curated, typed projection of ONE table. It is the only
 * thing a query spec (stage 2) can read; the agent never sees table names.
 *   scope "self"    → the interpreter ALWAYS adds  <owner> = learner  (rule 26)
 *   scope "public"  → published content only, via a fixed `where`
 * Fields are allowlisted — never "*". `filter`/`sort`/`aggregate` say what a
 * spec may do with each field. Embedded fields (path "battles.subject") come
 * from a joined row the view declares in `embed`.
 *
 * Contract: every source column exists (gate scenario
 * selftool.views_match_schema checks it against the live database).
 */
const f = (type, ops = {}) => ({ type, filter: true, sort: true, ...ops });
const text = (ops) => f("string", ops);
const num = (ops) => f("number", { aggregate: true, ...ops });
const int = (ops) => f("integer", { aggregate: true, ...ops });
const time = (ops) => f("timestamp", ops);
const date = (ops) => f("date", ops);
const flag = (ops) => f("boolean", ops);
/** A person's display name, looked up from a user-id column (never their email or anything else). */
const person = (col, ops) => f("string", { person: col, ...ops });

export const DATA_VIEWS = Object.freeze({
  my_tasks: {
    description: "The learner's own tasks (to-dos): title, priority, status, due time.",
    keywords: ["task", "todo", "to-do", "due", "deadline", "reminder"],
    scope: "self", source: { schema: "public", table: "tasks", owner: "creator_id" }, ref: "id",   // write target (tasks.mark_done)
    fields: { title: text({ sort: false }), priority: text(), status: text(), task_type: text(), due_at: time(), completed_at: time(), created_at: time() },
  },
  my_goals: {
    description: "The learner's own goals: title, category, target date, exam, status.",
    keywords: ["goal", "aim", "target", "achieve"],
    scope: "self", source: { schema: "edu", table: "learner_goals", owner: "user_id" }, ref: "id",
    fields: { title: text({ sort: false }), category: text(), metric: text(), target_date: date(), exam: text(), status: text(), source: text(), created_at: time() },
  },
  my_chats: {
    description: "The learner's Agent Chat conversations: title and when they were active (not the messages).",
    keywords: ["chat", "conversation", "talked", "discussed"],
    scope: "self", source: { schema: "public", table: "chat_sessions", owner: "user_id" }, ref: "id",
    fields: { title: text({ sort: false }), created_at: time(), last_message_at: time() },
  },
  my_weak_topics: {
    description: "Topics the learner taught their agent, with how well the agent knows each (confidence 0-1; under 0.5 is weak) and when it is due for review.",
    keywords: ["weak", "topic", "confidence", "know", "struggle", "review", "revise", "taught"],
    scope: "self", source: { schema: "edu", table: "agent_knowledge", owner: "student_id" },
    fields: { subject: text(), topic: text(), confidence: num(), times_seen: int(), priority: text(), last_seen_at: time(), next_review_due: time() },
  },
  my_study_notes: {
    description: "The learner's saved study notes per topic, with confidence (titles and subjects, not the note text).",
    keywords: ["note", "notes", "study", "saved"],
    scope: "self", source: { schema: "edu", table: "student_knowledge", owner: "student_id" },
    fields: { subject: text(), topic: text(), confidence: num(), source: text(), created_at: time() },
  },
  my_learning_sessions: {
    description: "Teaching sessions the learner ran with their agent: subject, topic, status, start and end.",
    keywords: ["session", "lesson", "learning", "taught", "teach"],
    scope: "self", source: { schema: "edu", table: "adaptive_sessions", owner: "student_id" },
    fields: { subject: text(), topic: text(), status: text(), started_at: time(), completed_at: time() },
  },
  my_past_questions: {
    description: "Past-question practice: exam, subject, year, how many attempted and correct (accuracy = correct / attempted).",
    keywords: ["past question", "past questions", "practice", "exam", "waec", "jamb", "neco", "bece", "accuracy", "score"],
    scope: "self", source: { schema: "edu", table: "past_question_attempts", owner: "user_id" },
    fields: { exam: text(), subject: text(), year: int(), source: text(), attempted: int(), correct: int(), created_at: time() },
  },
  my_battles: {
    description: "The learner's own battle results: score, correct and wrong answers, rank, XP earned, win, and the battle's subject, title, status and start.",
    keywords: ["battle", "battles", "challenge", "won", "win", "rank", "score", "competition"],
    scope: "self", source: { schema: "public", table: "battle_participants", owner: "user_id" },
    embed: { battles: ["subject", "title", "status", "scheduled_start", "battle_type"] },
    fields: {
      score: int(), correct_answers: int(), wrong_answers: int(), final_rank: int(), xp_earned: int(), is_winner: flag(), joined_at: time(),
      subject: text({ path: "battles.subject" }), title: text({ path: "battles.title", sort: false }), status: text({ path: "battles.status" }),
      scheduled_start: time({ path: "battles.scheduled_start" }), battle_type: text({ path: "battles.battle_type" }),
    },
  },
  my_xp: {
    description: "XP the learner earned: amount, subject, reason, when.",
    keywords: ["xp", "points", "earned", "progress"],
    scope: "self", source: { schema: "public", table: "xp_transactions", owner: "user_id" },
    fields: { amount: int(), subject: text(), reason: text(), created_at: time() },
  },
  my_courses: {
    description: "Courses the learner is enrolled in: progress (0-100), status, and the course's title, subject and level.",
    keywords: ["course", "courses", "enrolled", "progress", "class"],
    scope: "self", source: { schema: "public", table: "enrollments", owner: "user_id" },
    embed: { courses: ["title", "subject", "level", "course_type"] },
    fields: {
      progress: int(), status: text(), enrolled_at: time(),
      title: text({ path: "courses.title", sort: false }), subject: text({ path: "courses.subject" }),
      level: text({ path: "courses.level" }), course_type: text({ path: "courses.course_type" }),
    },
  },
  my_buddies: {
    description: "The learner's study buddy pairings: subject, exam, goal, status, last and next check-in.",
    keywords: ["buddy", "buddies", "partner", "study buddy"],
    scope: "self", source: { schema: "edu", table: "study_buddies", owner: ["requester_id", "buddy_id"] }, ref: "id",   // write target (buddies.end)
    fields: { subject: text(), exam: text(), goal: text({ sort: false }), status: text(), accepted_at: time(), last_checkin_at: time(), next_checkin_at: time() },
  },
  my_agent_messages: {
    description: "Messages other learners' agents sent to the learner's agent: kind, subject, topic, status, when (not the text).",
    keywords: ["message", "messages", "inbox", "asked", "consult"],
    scope: "self", source: { schema: "edu", table: "agent_messages", owner: "to_user" }, ref: "id",
    fields: { kind: text(), subject: text(), topic: text(), status: text(), created_at: time(), answered_at: time(), read_at: time() },
  },
  public_blog_posts: {
    description: "Published Akoro blog articles: title, category, author, reading time, publish date.",
    keywords: ["blog", "article", "articles", "post", "read"],
    scope: "public", source: { schema: "content", table: "blog_posts", where: { status: "published" } },
    fields: { title: text({ sort: false }), category: text(), author: text(), read_min: int(), published_at: time() },
  },

  // ── Instructors (S7): their own classes and the work set in them ───────
  // audience "instructor": only an instructor's tools may use these, and
  // only for their OWN classes and activities (owner / ownerPath, forced in
  // viewRuntime). Students appear by name only — never contact details,
  // never their private chats, notes or memories.
  my_classes: {
    audience: "instructor",
    description: "The instructor's own classes: name, description, size limit, created.",
    keywords: ["class", "classes", "classroom", "my class"],
    scope: "self", source: { schema: "public", table: "classrooms", owner: "teacher_id" },
    fields: { name: text(), description: text({ sort: false }), student_limit: int(), created_at: time() },
  },
  my_class_students: {
    audience: "instructor",
    description: "Students in the instructor's own classes: student name, class, status, joined.",
    keywords: ["student", "students", "roster", "class list", "enrolled", "learners"],
    scope: "self", source: { schema: "public", table: "classroom_students", ownerPath: "classrooms.teacher_id" },
    embed: { classrooms: ["name"] },
    fields: { student: person("user_id"), class: text({ path: "classrooms.name" }), status: text(), joined_at: time() },
  },
  my_activities: {
    audience: "instructor",
    description: "Activities the instructor set (assignments, projects, self-study…): title, type, subject, topic, difficulty, due date, status.",
    keywords: ["activity", "activities", "assignment", "assignments", "homework", "project", "set", "due"],
    scope: "self", source: { schema: "edu", table: "self_study_assignments", owner: "created_by" },
    fields: { title: text({ sort: false }), type: text(), subject: text(), topic: text(), difficulty: text(), due_at: time(), status: text(), created_at: time() },
  },
  my_activity_results: {
    audience: "instructor",
    description: "Each student's result on the instructor's activities: student, activity, subject, topic, status (assigned/started/complete), grade, started, completed, graded.",
    keywords: ["result", "results", "grade", "grades", "score", "scores", "submission", "submissions", "completed", "average", "marks", "performance"],
    scope: "self", source: { schema: "edu", table: "self_study_targets", ownerPath: "self_study_assignments.created_by" },
    embed: { self_study_assignments: ["title", "subject", "topic", "type", "due_at"] },
    fields: {
      student: person("student_id"), activity: text({ path: "self_study_assignments.title", sort: false }),
      subject: text({ path: "self_study_assignments.subject" }), topic: text({ path: "self_study_assignments.topic" }),
      activity_type: text({ path: "self_study_assignments.type" }), due_at: time({ path: "self_study_assignments.due_at" }),
      status: text(), grade: int(), started_at: time(), completed_at: time(), graded_at: time(),
    },
  },
  my_activity_drafts: {
    audience: "instructor",
    description: "Activity drafts the instructor's agent prepared and they haven't assigned yet: title, type, subject, topic, status.",
    keywords: ["draft", "drafts", "prepared", "unassigned"],
    scope: "self", source: { schema: "public", table: "activity_drafts", owner: "created_by" },
    fields: { title: text({ sort: false }), type: text(), subject: text(), topic: text(), status: text(), created_at: time() },
  },
});

/** Who a view is for: "learner" (default) or "instructor". */
export const audienceOf = (view) => view?.audience || "learner";

/**
 * The PostgREST select for a view: its own columns (not paths, not person
 * fields), the user-id columns person fields read, the owner columns, and its
 * embeds — the ownerPath relation joined !inner so the owner filter applies.
 */
export function selectColumns(view) {
  const own = Object.entries(view.fields).filter(([, x]) => !x.path && !x.person).map(([k]) => k);
  const people = Object.values(view.fields).filter((x) => x.person).map((x) => x.person);
  const owners = [view.source.owner].flat().filter(Boolean);
  const [ownerRel, ownerCol] = String(view.source.ownerPath || "").split(".");
  const embeds = { ...(view.embed || {}) };
  if (ownerRel) embeds[ownerRel] = [...new Set([...(embeds[ownerRel] || []), ownerCol])];
  const embedSel = Object.entries(embeds).map(([rel, cols]) => `${rel}${rel === ownerRel ? "!inner" : ""}(${cols.join(",")})`);
  const cols = [...new Set([...own, ...people, ...owners, ...(view.ref ? [view.ref] : [])])];
  return [...cols, ...embedSel].join(", ") || "*";
}

/** The columns a view reads from its own table, and its embeds — for the schema check. */
export function viewColumns(view) {
  return selectColumns(view);
}

/** What schema_lookup shows for a view: field types and allowed operations, nothing else. */
export function describeView(name, view) {
  const fields = Object.fromEntries(Object.entries(view.fields).map(([k, x]) => [k, x.type]));
  const can = new Set(["filter", "sort", "limit"]);
  if (Object.values(view.fields).some((x) => x.aggregate)) { can.add("count"); can.add("sum"); can.add("avg"); can.add("group"); }
  return { name, description: view.description, fields, can: [...can],
    whose: view.scope === "self" ? (audienceOf(view) === "instructor" ? "the instructor's own classes and activities" : "the learner's own") : "published" };
}
