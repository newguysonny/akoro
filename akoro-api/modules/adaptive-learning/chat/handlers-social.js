// Social and personal tool handlers for the Agent Chat dispatcher.
//
// The case bodies of runChatTool for the protégé, blog research and the
// learner's own blog, goals, proposals, suggestions, scheduled messages and
// follow-ups, chats and email live here. tool-runtime.js owns the dispatcher
// and builds this map, passing its own helpers in through createHandlers —
// this module never imports tool-runtime, so recursion goes through the
// per-call context's seams and there is no import cycle.

import db from "../../../db.js";
import { openai } from "../../../lib/aiModel.js";
import { appLink } from "../../../lib/urls.js";
import { teachRequest, loadTaughtKnowledge, buildGuideMessages, shapeGuideAnswer } from "../social/protege.js";
import { getSyllabusGrounding } from "../teaching/syllabus.js";
import { akoroMaterialFor } from "../../materials/index.js";
import { searchBlogPosts, readBlogPost } from "../../../lib/blogResearch.js";
import { listMyBlogs, createBlogPost, updateBlogPost } from "../../blogs/service.js";
import { scheduleChatFollowUp, listChatFollowUps, cancelChatFollowUp } from "./chat-follow-ups.js";
import { listChats, readChat, searchChats, postToChat, ownedChatId } from "./chat-history-tools.js";
import { getLearnerProfileContext } from "../../../lib/learnerProfileContext.js";
import { localiseInstant } from "../../../lib/learnerTime.js";
import { sendNotificationEmail } from "../../auth/index.js";
import { retrieveAgentKnowledge } from "../agents/student/knowledge.js";

/* Where the protégé's taught knowledge comes from (edu.student_agents / agent_knowledge). */
export const protegeDeps = {
  findAgent: async (studentId) => {
    const { data } = await db.schema("edu").from("student_agents").select("id").eq("student_id", studentId).maybeSingle();
    return data || null;
  },
  retrieve: (agentId, query, limit) => retrieveAgentKnowledge(agentId, query, limit),
  listTopics: async (agentId) => {
    const { data } = await db.schema("edu").from("agent_knowledge").select("topic, subject")
      .eq("agent_id", agentId).order("last_seen_at", { ascending: false }).limit(200);
    return data || [];
  },
};
// chat.js re-exports this from here, so the material lookup has one importer.
export { akoroMaterialFor };

/**
 * Build the tool-name → handler map. `deps` carries the dispatcher's helpers
 * (clarify) and the read tools defined in tool-runtime.js.
 */
export function createHandlers(deps) {
  const { clarify, listMyGoalsTool, listMyTools, createGoal, updateGoal } = deps;

  return {
    async ask_to_be_taught(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const teach = teachRequest(input);
      if (!teach) return clarify("topic", "Which topic should the learner teach you?", { error: "topic_required" });
      // Somewhere to read about it first: Akoro's own courses and posts on the topic (D52), shown as links.
      const materials = await akoroMaterialFor(teach.topic).catch(() => []);
      return {
        asked: true, ...teach, ...(materials.length ? { materials } : {}),
        note: materials.length
          ? "The learner now sees a Teach me button for this topic, and Akoro's material on it as links under your reply. Say you haven't been taught it, suggest they open one of those to learn it, then teach you — don't explain it or write study material (flashcards, notes, a quiz) on it yourself. Don't list the links; they're shown."
          : "The learner now sees a Teach me button for this topic. Say you haven't been taught it, point to where they can read about it first (the syllabus topics shown, their Library), and wait — don't explain it or write study material (flashcards, notes, a quiz) on it yourself.",
      };
    },
    async consult_teaching_guide(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const question = String(input?.question || "").trim();
      if (!question) return clarify("question", "What should I ask my teaching guide?", { error: "question_required" });
      try {
        const query = [input?.topic, question].filter(Boolean).join(" — ");
        const [taught, { context: syllabus }] = await Promise.all([
          loadTaughtKnowledge({ studentId, query, deps: protegeDeps }).catch(() => ({ chunks: [] })),
          getSyllabusGrounding(query, { limit: 3 }).catch(() => ({ context: "" })),
        ]);
        const completion = await openai.chat.completions.create({
          __role: "persona", temperature: 0.3, max_tokens: 700,
          __timeoutMs: 30_000, __maxRetries: 1,
          response_format: { type: "json_object" },
          messages: buildGuideMessages({ question, topic: input?.topic, subject: input?.subject, taught: taught.chunks || [], syllabus }),
          __userId: studentId, __feature: "teaching_guide",
        });
        const answer = shapeGuideAnswer(completion.choices?.[0]?.message?.content);
        if (!answer.explanation) return { consulted: false, error: "The teaching guide had no answer this time." };
        return {
          consulted: true, guide: "NaNa Esumai", explanation: answer.explanation, teachNext: answer.teachNext,
          ...(teachRequest(input) ? { teach: teachRequest(input) } : {}),
          rule: "Open with \"From NaNa, my teaching guide (you haven't taught me this):\", pass the explanation on in your own voice, then invite them to teach it back to you.",
        };
      } catch (error) {
        return { consulted: false, error: error.message || "The teaching guide is unavailable right now." };
      }
    },
    async search_blog_posts(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      try {
        return await searchBlogPosts({
          query: input?.query,
          category: input?.category,
          limit: input?.limit,
        });
      } catch (error) {
        return { error: error.message || "The blog search is unavailable right now" };
      }
    },
    async read_blog_post(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.slug || !String(input.slug).trim()) {
        return clarify("slug", "Which post should I read? Pass the slug from a blog search.", { action: "read_blog_post" });
      }
      try {
        return await readBlogPost({ slug: input.slug });
      } catch (error) {
        return { error: error.message || "The blog is unavailable right now" };
      }
    },
    async list_my_blogs(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      try {
        const { blogs, error } = await listMyBlogs(studentId);
        if (error) return { error };
        return {
          count: (blogs ?? []).length,
          blogs: (blogs ?? []).map((b) => ({
            blogId: b.id, title: b.title, status: b.status, excerpt: b.excerpt, updatedAt: b.updatedAt,
          })),
        };
      } catch (error) {
        return { error: error.message || "Could not load the blogs" };
      }
    },
    async save_blog_draft(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the blog be titled?", { action: "save_blog_draft" });
      }
      if (input?.body === undefined || !String(input.body).trim()) {
        return clarify("body", "Give me the blog text to save — draft the wording with me first if you like.", { action: "save_blog_draft" });
      }
      try {
        // Editing a PUBLISHED post would put the edit live at once — this tool
        // promises a draft, so it refuses and points at publish_blog.
        if (input?.blogId) {
          const { data: existing } = await db.schema("edu").from("blogs").select("status").eq("id", input.blogId).eq("user_id", studentId).maybeSingle();
          if (existing?.status === "published") {
            return { error: "That post is already published — saving would put the edit live. Ask the learner whether to publish the change (publish_blog) or save it as a new draft (no blogId)." };
          }
        }
        const result = input?.blogId
          ? await updateBlogPost(studentId, input.blogId, { title: input.title, body: input.body })
          : await createBlogPost(studentId, { title: input.title, body: input.body, status: "draft" });
        if (result.error) return { error: result.error };
        if (result.notFound) return { error: "That blogId doesn't match one of the learner's posts — call list_my_blogs." };
        return { saved: true, blogId: result.blog.id, title: result.blog.title, status: result.blog.status };
      } catch (error) {
        return { error: error.message || "Could not save the draft" };
      }
    },
    async publish_blog(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the blog be titled?", { action: "publish_blog" });
      }
      if (input?.body === undefined || !String(input.body).trim()) {
        return clarify("body", "Give me the full blog text — an empty post can't be published.", { action: "publish_blog" });
      }
      try {
        const result = input?.blogId
          ? await updateBlogPost(studentId, input.blogId, { title: input.title, body: input.body, status: "published" })
          : await createBlogPost(studentId, { title: input.title, body: input.body, status: "published" });
        if (result.error) return { error: result.error };
        if (result.notFound) return { error: "That blogId doesn't match one of the learner's posts — call list_my_blogs." };
        return { published: true, blogId: result.blog.id, title: result.blog.title, publishedAt: result.blog.published_at };
      } catch (error) {
        return { error: error.message || "Could not publish the blog" };
      }
    },
    async list_my_goals(input, ctx) { return listMyGoalsTool(ctx.studentId); },
    async create_goal(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What goal should I save? One clear line, e.g. 'Score 80% in Further Maths'.", { action: "create_goal" });
      }
      try {
        // The learner explicitly asked, so provenance is 'learner' — the agent
        // never self-inserts goals (autonomous ideas go via proposals).
        const { goal, error } = await createGoal(studentId, {
          title: input.title, category: input.category, metric: input.metric,
          exam: input.exam, target_date: input.targetDate,
        });
        if (error) return { error };
        return { created: true, goalId: goal.id, title: goal.title, category: goal.category, targetDate: goal.target_date, status: goal.status };
      } catch (error) {
        return { error: error.message || "Could not save the goal" };
      }
    },
    async update_goal_progress(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.goalId) {
        return clarify("goalId", "Which goal? Call list_my_goals first and match the one they mean.", { action: "update_goal_progress" });
      }
      try {
        const { goal, error, notFound } = await updateGoal(studentId, input.goalId, {
          status: input.status, progress_note: input.progressNote, target_date: input.targetDate,
        });
        if (notFound) return { error: "That goalId doesn't match one of the learner's goals — call list_my_goals." };
        if (error) return { error };
        return { updated: true, goalId: goal.id, title: goal.title, status: goal.status, progressNote: goal.progress_note };
      } catch (error) {
        return { error: error.message || "Could not update the goal" };
      }
    },
    async list_my_proposals(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      try {
        const { data, error } = await db.schema("edu").from("agent_proposals")
          .select("id, kind, title, rationale, status, created_at, decided_at")
          .eq("user_id", studentId)
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) return { error: "Could not load the proposals" };
        const rows = data ?? [];
        const pending = rows.filter((r) => r.status === "proposed");
        return {
          pendingCount: pending.length,
          proposals: [...pending, ...rows.filter((r) => r.status !== "proposed")].map((r) => ({
            proposalId: r.id, kind: r.kind, title: r.title, rationale: r.rationale,
            status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
          })),
          note: "The learner approves or dismisses each proposal in the Suggestions tab — you can discuss them, never execute them.",
        };
      } catch (error) {
        return { error: error.message || "Could not load the proposals" };
      }
    },
    async suggest_help(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      try {
        const kind = ["task", "goal", "conversation"].includes(input?.kind) ? input.kind : "conversation";
        const title = String(input?.title || "").trim().slice(0, 140);
        const rationale = String(input?.rationale || "").trim().slice(0, 400);
        if (!title) return { error: "A suggestion needs a title" };
        // A suggest_help filing is a special suggestion: it lands as a NEW
        // CHAT at the top of their chats (priority), never in the Suggestions
        // list — see modules/agent-proposals/suggestHelp.js (dedupe lives there).
        const { openSuggestHelpChat } = await import("../../agent-proposals/index.js");
        const out = await openSuggestHelpChat(studentId, { kind, title, rationale });
        if (out.duplicate) return { saved: false, duplicate: true, title, note: "This idea is already open for them — mention it instead of filing it again." };
        if (!out.delivered) return { error: out.error || "Could not open the chat" };
        return { saved: true, delivered: "new_chat", chatId: out.chatId, kind, title,
          note: `Tell the learner in one line that you've opened a new chat titled "${title}" — it's at the top of their chats.` };
      } catch (error) {
        return { error: error.message || "Could not save the suggestion" };
      }
    },
    async schedule_chat_follow_up(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.message || !String(input.message).trim()) {
        return clarify("message", "What should the future chat message say?", { action: "schedule_chat_follow_up" });
      }
      if (!input?.scheduledAt && !(Number(input?.inMinutes) > 0)) {
        return clarify("scheduledAt", "When should it be sent? Say e.g. 'in 10 minutes' or give the date and time.", { action: "schedule_chat_follow_up" });
      }
      try {
        // "remind me" with no destination → THIS chat, where the learner will
        // actually see it. Defaulting to a new chat hid reminders in a separate
        // thread ("Scheduled check-in") the learner never opened. A separate
        // chat must be asked for explicitly (where='new').
        const where = (input.where === "here" || input.where === "chat" || input.where === "new")
          ? input.where
          : (input.chatId ? "chat" : (conversationId ? "here" : "new"));
        let targetSessionId = null;
        if (where === "here") {
          if (!conversationId) return { error: "This chat is not saved yet, so a message can't be scheduled into it — send it to a new chat instead (where='new')." };
          targetSessionId = conversationId;
        } else if (where === "chat") {
          targetSessionId = await ownedChatId(studentId, input.chatId);
          if (!targetSessionId) return { error: "That chat wasn't found among the learner's chats — call list_chats for a valid chatId." };
        }
        // runTool must be one of THIS learner's own tools (it runs as them, read-only, at each send).
        if (input.runTool) {
          const mine = await listMyTools(studentId).catch(() => []);
          if (!mine.some((t) => t.name === input.runTool && t.status === "active")) {
            return { error: `"${input.runTool}" isn't one of the learner's active tools — build it first with create_tool, or schedule the reminder without runTool.` };
          }
        }
        const context = await getLearnerProfileContext(studentId);
        const schedule = await scheduleChatFollowUp({
          userId: studentId,
          input,
          defaultTimezone: context.timeZone,
          targetSessionId,
        });
        return {
          scheduled: true,
          ...schedule,
          deliversTo: where === "new" ? "a new chat" : where === "here" ? "this chat" : "the chosen chat",
          timezoneSource: input.timezone ? "explicit_request" : context.timeZoneSource,
          localScheduledAt: localiseInstant(schedule.scheduledAt, schedule.timezone),
        };
      } catch (error) {
        return { error: error.message || "Could not schedule the chat follow-up" };
      }
    },
    async list_scheduled_chat_follow_ups(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      try {
        return await listChatFollowUps({ userId: studentId });
      } catch (error) {
        return { error: error.message || "Could not load scheduled chat follow-ups" };
      }
    },
    async cancel_scheduled_chat_follow_up(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!input?.followUpId) {
        return clarify("followUpId", "Which scheduled message should be cancelled? Here are the pending ones — or ask me to list them.", { action: "cancel_scheduled_chat_follow_up" });
      }
      try {
        return await cancelChatFollowUp({ userId: studentId, followUpId: input.followUpId });
      } catch (error) {
        return { error: error.message || "Could not cancel the chat follow-up" };
      }
    },
    async list_chats(input, ctx) { try { return await listChats(ctx.studentId, { search: input?.search, limit: input?.limit, currentChatId: ctx.conversationId }); } catch (error) { return { error: error.message || "Could not load your chats" }; } },
    async read_chat(input, ctx) { if (!input?.chatId) return clarify("chatId", "Which chat should I read? I can list your chats.", { action: "read_chat" }); try { return await readChat(ctx.studentId, input.chatId, { limit: input.limit, around: input.around }); } catch (error) { return { error: error.message || "Could not read that chat" }; } },
    async search_chats(input, ctx) { if (!input?.query || !String(input.query).trim()) return clarify("query", "What should I look for in your past chats?", { action: "search_chats" }); try { return await searchChats(ctx.studentId, { query: input.query, limit: input.limit, currentChatId: ctx.conversationId }); } catch (error) { return { error: error.message || "Could not search your chats" }; } },
    async post_to_chat(input, ctx) { if (!input?.chatId) return clarify("chatId", "Which chat should I post it in? I can list your chats.", { action: "post_to_chat" }); if (!input?.message || !String(input.message).trim()) return clarify("message", "What should the message say?", { action: "post_to_chat" }); try { return await postToChat(ctx.studentId, { chatId: input.chatId, message: input.message, currentChatId: ctx.conversationId }); } catch (error) { return { error: error.message || "Could not post the message" }; } },
    async send_email_to_me(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      const subject = String(input?.subject || "").trim();
      const body = String(input?.body || "").trim();
      if (!subject) return clarify("subject", "What should the email's subject be?", { action: "send_email_to_me" });
      if (!body) return clarify("body", "What should the email say?", { action: "send_email_to_me" });
      try {
        const [{ data: user }, { data: prefs }] = await Promise.all([
          db.from("users").select("email, full_name, username").eq("id", studentId).maybeSingle(),
          db.from("user_notification_preferences").select("email_enabled").eq("user_id", studentId).maybeSingle(),
        ]);
        if (!user?.email) return { error: "There's no email address on this account, so an email can't be sent." };
        if (prefs?.email_enabled === false) return { error: "Email is turned off in this account's notification settings, so the email wasn't sent." };
        await sendNotificationEmail({
          to: user.email,
          name: user.full_name || user.username || undefined,
          subject: subject.slice(0, 120),
          heading: subject.slice(0, 120),
          body: body.slice(0, 4000),
          ctaUrl: appLink("tab=agent"),
          ctaLabel: "Open in Akoro",
        });
        return { sent: true, to: user.email };
      } catch (error) {
        return { error: error.message || "Could not send the email" };
      }
    },
  };
}
