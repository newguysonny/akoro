import re

# ── 1. drafts.js: the plan generator must never kill a prepare. ──
p = 'akoro-api/modules/self-study/drafts.js'
s = open(p).read()
old = '''    // self_study | assignment | project: fill the plan exactly like /plan.
    const { subtopics, objectives } = await generatePlan(topic, subject || "General");
    payload.subtopics = subtopics;
    payload.objectives = objectives;'''
assert s.count(old) == 1, "generatePlan site"
s = s.replace(old, '''    // self_study | assignment | project: fill the plan exactly like /plan.
    // The generator runs LIVE model calls — if it fails (quota, timeout),
    // the draft still exists with a minimal plan and the tool result says
    // so. A prepare must never die to content generation.
    try {
      const { subtopics, objectives } = await generatePlan(topic, subject || "General");
      payload.subtopics = subtopics;
      payload.objectives = objectives;
    } catch (planError) {
      console.error("[prepare_activity] plan generator failed:", planError.message);
      payload.subtopics = [topic];
      payload.objectives = { [topic]: [`Study and complete the activities on ${topic}`] };
      payload.planFallback = true;
    }'''
)
open(p, 'w').write(s)
print("drafts resilient")

# ── 2. chat.js: log real errors, surface them verbatim, drop bad due_at, one-class auto-confirm. ──
p = 'akoro-api/modules/adaptive-learning/chat.js'
s = open(p).read()

# 2a. due_at: an unparseable instant degrades to the hint instead of failing.
old = '''  let dueAt = null;
  if (input?.due_at) {
    const parsed = new Date(input.due_at);
    if (Number.isNaN(parsed.getTime())) throw invalid("due_at must be an ISO 8601 timestamp with a timezone offset");
    if (parsed.getTime() < Date.now() - 60 * 1000) throw invalid("due_at is in the past — check the date and time");
    dueAt = parsed.toISOString();
  }'''
assert s.count(old) == 1, "due_at block"
s = s.replace(old, '''  let dueAt = null;
  let dueAtNotice = null;
  if (input?.due_at) {
    const parsed = new Date(input.due_at);
    // An unparseable or past instant degrades to the human hint (shown at
    // preview for the human to confirm) instead of failing the prepare —
    // a broken machine date must not destroy a valid request.
    if (Number.isNaN(parsed.getTime())) {
      dueAtNotice = "The exact due time could not be parsed — the draft carries it as a label for you to confirm at preview.";
    } else if (parsed.getTime() < Date.now() - 60 * 1000) {
      dueAtNotice = "The stated due time is already past — no due date was set; confirm the real one at preview.";
    } else {
      dueAt = parsed.toISOString();
    }
  }'''
)

old = '''  if (input?.due_hint) payload.due_hint = String(input.due_hint).trim();'''
assert s.count(old) == 1, "due_hint site"
s = s.replace(old, '''  if (input?.due_hint) payload.due_hint = String(input.due_hint).trim();
  if (dueAtNotice) payload.due_notice = dueAtNotice;''')

# 2b. Executor: log + relay the real reason verbatim.
old = '''        return { prepared: false, error: error.message || "Could not prepare the draft" };
      }'''
assert s.count(old) == 1, "prepare catch"
s = s.replace(old, '''        console.error("[prepare_activity] failed:", error.status || "", error.message);
        return { prepared: false, error: error.message || "Could not prepare the draft",
          guidance: "Tell the instructor exactly what the error says and ask for that missing detail. Never call it a technical problem and never retry unchanged." };
      }'''
)

# 2c. Fallback-plan note rides the success result.
old = '''        return {
          prepared: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: audienceLabel, status: draft.status,
          previewHint: "Awaiting the instructor's preview — do not claim it was assigned.",
        };'''
assert s.count(old) == 1, "success result"
s = s.replace(old, '''        const result = {
          prepared: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: audienceLabel, status: draft.status,
          previewHint: "Awaiting the instructor's preview — do not claim it was assigned.",
        };
        if (draft.payload?.planFallback) result.planNote = "The study-plan generator was unavailable — the draft carries the topic only; mention the instructor can edit objectives in the preview.";
        if (draft.payload?.due_notice) result.dueNote = draft.payload.due_notice;
        return result;'''
)

# 2d. Guide: honesty about errors + one-class auto-confirm.
old = '''  `If the tool result carries needsClarification (audience_required), ask who the work is for before preparing anything. ` +'''
assert s.count(old) == 1, "hitl anchor"
s = s.replace(old, '''  `If a prepare fails, the error field says exactly why — repeat it to the instructor verbatim and fix that one thing together. NEVER call it a technical problem, NEVER retry with unchanged inputs. ` +
  `If the instructor says "the whole class" and list_my_classrooms shows exactly ONE class, use it without asking. ` +
  `If the tool result carries needsClarification, ask the question it carries before preparing anything. ` +''')
open(p, 'w').write(s)
print("chat.js hardened")
