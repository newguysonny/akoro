// Merged-domain and self-tooling tool handlers for the Agent Chat dispatcher.
//
// The case bodies of runChatTool for the learner-built merged tools (weak
// topics, past questions, study sessions and notes, goals, tasks, classes,
// class students, activities, activity results and drafts, chats, library
// documents) and the self-tooling cases (schema_lookup, create_tool,
// save_computation, await_decision) live here. The default learner-built-tools
// branch stays in tool-runtime.js, after every registered group, so it remains
// LAST in dispatch order. tool-runtime.js builds this map and passes its own
// helpers in through createHandlers — this module never imports tool-runtime,
// so recursion goes through the per-call context's seams and there is no
// import cycle.

import { schemaLookup } from "../../self-tooling/registry.js";
import { awaitDecision, listConfirmedDecisions } from "../../self-tooling/confirmations.js";
import { listChats, searchChats } from "./chat-history-tools.js";
import { searchMyStudyKnowledge } from "../learner-chat-read-tools.js";

// chat.js re-exports this from here, so the decisions module keeps one importer.
export { listConfirmedDecisions };

/**
 * Build the tool-name → handler map. `deps` carries the dispatcher's helpers
 * and the platform actions the merged tools dispatch to.
 */
export function createHandlers(deps) {
  const {
    clarify, asToolError, executeChatTool, runLearnerTool, selfToolDeps,
    selfToolingAllowedFor, SELF_TOOLING_ROLES, toolAudience, isDryRun,
    createTool, saveComputation,
    MERGED_DOMAINS, dispatchMerged,
    mergedChatsEnabled, CHATS_BASE_ACTIONS, CHATS_MERGED_ACTIONS, runChatsViewAction,
    mergedLibraryEnabled, LIBRARY_BASE_ACTIONS, LIBRARY_MERGED_ACTIONS, runLibraryViewAction,
    getWeakTopicsTool, getPastQuestionPracticeTool, getMyLearningSessionsTool,
    listMyGoalsTool, listTasksTool, searchMyLibraryTool,
  } = deps;

  return {
    async schema_lookup(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Building tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      if (!input?.goal || !String(input.goal).trim()) return clarify("goal", "What would you like the new tool to find out or do?", { action: "schema_lookup" });
      try { return await schemaLookup(String(input.goal).slice(0, 300), { audience: toolAudience(role), learnerId: studentId }); }
      catch (error) { return { error: error.message || "Couldn't check what's available right now" }; }
    },
    async create_tool(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Building tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      try {
        return await createTool({ learnerId: studentId, input: input || {}, dry: isDryRun(), conversationId,
          audience: toolAudience(role), ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] create_tool failed:", error?.stack || error?.message || error);
        return { status: "rejected", reason: "Building the tool failed unexpectedly — try again." };
      }
    },
    async save_computation(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Saving tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      try {
        return await saveComputation({ learnerId: studentId, hint: input?.hint || null, conversationId, ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] save_computation failed:", error?.stack || error?.message || error);
        return { status: "rejected", reason: "Saving the tool failed unexpectedly — try again." };
      }
    },
    async await_decision(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Card decisions are for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Self-tooling isn't turned on for this account yet." };
      if (!input?.confirmationId) return { error: "confirmationId is required — use the one from the card's tool result." };
      try {
        return await awaitDecision({ id: String(input.confirmationId), userId: studentId,
          callTool: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling_confirmed" }),
          buildTool: (args) => createTool({ ...args, ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") }),
          toolDeps: selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] await_decision failed:", error?.stack || error?.message || error);
        return { status: "error", error: "Waiting for the decision failed — the card is still live; the learner's tap will be picked up in the next turn." };
      }
    },
    async my_weak_topics(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Weak topics tool: list is the platform handler (weakest
      // first, confidence under 0.6, deduped), count/by_subject/search
      // are platform view reads, anything beyond them is the learner's
      // own delta action.
      if (MERGED_DOMAINS.my_weak_topics.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_weak_topics, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await getWeakTopicsTool(studentId, { subject: input?.subject || input?.query })), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_weak_topics", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_weak_topics", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_past_questions(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Past questions tool: accuracy is the platform handler
      // (attempted/correct/accuracy grouped by exam and subject),
      // count/list/by_subject/search are platform view reads, anything
      // beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_past_questions.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_past_questions, input, {
          studentId,
          platform: { accuracy: async () => ({ success: true, ...(await getPastQuestionPracticeTool(studentId, { subject: input?.subject || input?.query, exam: input?.exam, days: input?.days })), via: "built-in accuracy" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_past_questions", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_past_questions", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_study_sessions(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Study sessions tool: count/list/by_subject/search are
      // platform view reads over the session records; overview is the
      // platform profile handler (agent + taught subjects + recent
      // sessions); anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_study_sessions.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_study_sessions, input, {
          studentId,
          platform: { overview: async () => ({ success: true, ...(await getMyLearningSessionsTool(studentId)), via: "built-in overview" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_study_sessions", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_study_sessions", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_study_notes(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Study notes tool: search is the platform handler (finds
      // notes by what they say), count/list/by_subject are platform view
      // reads, anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_study_notes.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_study_notes, input, {
          studentId,
          platform: { search: async () => ({ success: true, ...(await searchMyStudyKnowledge(studentId, input).catch(asToolError("your saved study knowledge"))), via: "built-in search" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_study_notes", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_study_notes", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_goals(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Goals tool: list is the platform handler (goalIds,
      // progress notes), count/by_status/search are platform view reads,
      // anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_goals.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_goals, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await listMyGoalsTool(studentId)), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_goals", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_goals", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_tasks(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Tasks tool: list is the platform handler (pending tasks,
      // priority order, taskIds), count/by_status/search are platform view
      // reads, anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_tasks.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_tasks, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await listTasksTool(studentId)), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_tasks", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_tasks", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_classes(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Classes tool (instructor): list is the platform handler
      // (classes with learner counts and rosters), count/search are view
      // reads, anything beyond them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_classes.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_classes, input, {
          studentId,
          platform: { list: async () => executeChatTool("list_my_classrooms", {}, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_classes", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_classes", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_class_students(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Class students tool (instructor): every action is a view
      // read (the view carries class names via its embed); anything beyond
      // them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_class_students.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_class_students, input, {
          studentId,
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_class_students", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_class_students", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_activities(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Activities tool (instructor): every action is a view read
      // over the activities the instructor set; anything beyond them is the
      // instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activities.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activities, input, {
          studentId,
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_activities", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_activities", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_activity_results(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Activity results tool (instructor): overview is the
      // platform handler (one activity's outcome summary when query is an
      // assignmentId, else the recent activities to pick from),
      // count/list/by_subject/search are view reads, anything beyond them
      // is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activity_results.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activity_results, input, {
          studentId,
          platform: { overview: async () => executeChatTool("check_activity_outcomes", /^[0-9a-f-]{36}$/i.test(String(input?.query || "")) ? { assignmentId: String(input.query) } : {}, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_activity_results", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_activity_results", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_activity_drafts(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Activity drafts tool (instructor): list/get are the
      // platform handlers (pending drafts; one draft in full via query =
      // draftId), count/by_subject/search are view reads, anything beyond
      // them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activity_drafts.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activity_drafts, input, {
          studentId,
          platform: { list: async () => executeChatTool("list_activity_drafts", {}, studentId, { role, channel: "self_tooling" }), get: async () => executeChatTool("get_activity_draft", { draftId: String(input?.query || "") }, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool("my_activity_drafts", input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_activity_drafts", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async my_chats(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Chats tool: count is the platform view count (the true,
      // uncapped total), list/search are the platform handlers (list carries
      // chatIds, search matches message content — the view supplies
      // neither), anything beyond them is the learner's own delta action on
      // their row. With the merge off, the legacy learner-tool path below.
      if (mergedChatsEnabled()) {
        const action = String(input?.action || "count");
        if (action === "list") {
          const out = await listChats(studentId, { search: input?.query, limit: input?.limit, currentChatId: conversationId });
          let totalChats;
          try { const c = await runChatsViewAction("count", {}, studentId); totalChats = c?.rows?.[0]?.count; } catch {}
          return { success: true, ...out, ...(Number.isFinite(totalChats) ? { totalChats } : {}), via: "built-in list" };
        }
        if (action === "search") {
          const out = await searchChats(studentId, { query: input?.query, limit: input?.limit, currentChatId: conversationId });
          return { success: true, ...out, via: "built-in search" };
        }
        if (CHATS_BASE_ACTIONS.includes(action)) return runChatsViewAction(action, input, studentId);
        if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
          const out = await runLearnerTool("my_chats", input, studentId, {
            callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
            conversationId, dry: isDryRun(), audience: toolAudience(role),
          });
          if (out) return { ...out, via: "your saved action" };
        }
        return { error: `Unknown action "${action}" for the Chats tool. Available: ${CHATS_MERGED_ACTIONS.join(", ")}.` };
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("my_chats", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    },
    async library_documents(input, { studentId, conversationId = null, role = "student", channel = "ai_chat" }) {
      // The merged Library tool (pilot): search is the platform handler, the
      // base actions are platform-served view reads, and anything beyond them
      // is the learner's own delta action on their row. With the merge off,
      // this is exactly the legacy learner-tool path below.
      if (mergedLibraryEnabled()) {
        const action = String(input?.action || "");
        if (action === "search") return { ...(await searchMyLibraryTool(studentId, { query: input?.query, tool: input?.tool })), via: "built-in search" };
        if (LIBRARY_BASE_ACTIONS.includes(action)) return runLibraryViewAction(action, input, studentId);
        if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
          const out = await runLearnerTool("library_documents", input, studentId, {
            callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
            conversationId, dry: isDryRun(), audience: toolAudience(role),
          });
          if (out) return { ...out, via: "your saved action" };
        }
        return { error: `Unknown action "${action}" for the Library tool. Available: ${LIBRARY_MERGED_ACTIONS.join(", ")}.` };
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool("library_documents", input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: `Unknown tool: library_documents` };
    },
  };
}
