/**
 * modules/adaptive-learning/teachingSession.js
 *
 * Phase engine + endpoints for the "human teaches Student AI Agent" flow.
 *
 * Three participants:
 *   Human learner  — teaches (role:"user" on frontend)
 *   Nexus (agent)  — being taught (fetched from user_agents by studentId)
 *   NaNa Esumai    — coaches human teaching quality
 *   Sargeant       — assessment gate between subtopics
 *
 * Endpoints:
 *   POST /api/adaptive/teaching/configure     → AI generates subtopics + objectives
 *   POST /api/adaptive/teaching/start         → creates session in DB, returns NaNa opening
 *   POST /api/adaptive/teaching/message       → phase engine processes human message
 *   GET  /api/adaptive/teaching/:sessionId    → session state
 *   POST /api/adaptive/teaching/:sessionId/assess → trigger Sargeant gate manually
 */

import { Router }          from "express";
import Anthropic             from "@anthropic-ai/sdk";
import db                    from "../../db.js";
import { NaNaEsumai }        from "./agents/nana-esumai/guide.js";
import { Sargeant }          from "./agents/sargeant/assessment.js";
import { TrainedOrchestrator } from "./agents/trained/orchestrator.js";
import { authenticateToken } from "../auth/routes.js";
import { getAgentPreferences } from "./student-state.js";
import { saveAgentKnowledge, embed } from "./agents/student/knowledge.js";
import {
  DECAY_CONFIG, calculateDecayedConfidence, getPriority, getNextReviewDate,
} from "./agents/student/decayEngine.js";

const router    = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const nana      = new NaNaEsumai();
const sargeant  = new Sargeant();

const PHASES = ["1", "2", "3", "4", "assessment"];

const PHASE_PLAN = [
  "Phase 1 → what do they know",
  "Phase 2 → must-know parts",
  "Phase 3 → teach it back",
  "Phase 4 → push further",
];

/* ─── Save per-subtopic confidence after every Sargeant gate ────────────────
   Writes to edu.knowledge_confidence (one row per student × topic × subtopic).
   Stability increases on each pass → decay rate slows over time (Ebbinghaus).
─────────────────────────────────────────────────────────────────────────────*/
async function saveSubtopicConfidence({
  studentId, agentId, sessionId, topic, subject, subtopic,
  objectives, confidence, misconceptions = [], passed = false,
}) {
  try {
    // Read existing record for stability tracking
    const { data: existing } = await db.schema("edu")
      .from("knowledge_confidence")
      .select("confidence, assess_count, passed_count, stability, decay_rate")
      .eq("student_id", studentId)
      .eq("topic", topic)
      .eq("subtopic", subtopic)
      .single()
      .catch(() => ({ data: null }));

    const prevConf    = existing?.confidence     ?? 20;
    const assessCount = (existing?.assess_count  ?? 0) + 1;
    const passedCount = (existing?.passed_count  ?? 0) + (passed ? 1 : 0);

    // Stability grows with each pass, capped at 3.0 — slows decay significantly
    const stability = passed
      ? Math.min(3.0, (existing?.stability ?? 1.0) + 0.15)
      : Math.max(0.5, (existing?.stability ?? 1.0) - 0.05);

    // Effective decay rate = base / stability
    const decayRate = Math.max(0.02, DECAY_CONFIG.baseDecayRate / stability);

    // Next review date based on confidence level and priority
    const priority    = getPriority(confidence / 100);
    const nextReview  = getNextReviewDate(confidence / 100, priority);

    await db.schema("edu").from("knowledge_confidence").upsert({
      student_id:      studentId,
      agent_id:        agentId,
      session_id:      sessionId,
      topic,
      subject,
      subtopic,
      objectives:      objectives || [],
      confidence:      Math.round(confidence),
      prev_confidence: Math.round(prevConf),
      assess_count:    assessCount,
      passed_count:    passedCount,
      misconceptions:  misconceptions.filter(Boolean),
      stability,
      decay_rate:      decayRate,
      last_assessed:   new Date().toISOString(),
      next_review_due: nextReview,
      updated_at:      new Date().toISOString(),
    }, { onConflict: "student_id,topic,subtopic" });

  } catch (e) {
    console.warn("[saveSubtopicConfidence]", e.message);
  }
}

/* ─── Append blocks to block_history in adaptive_sessions ──────────────────
   Persists the typed block array so decay sessions can reconstruct history.
─────────────────────────────────────────────────────────────────────────────*/
async function appendBlockHistory(sessionId, newBlocks) {
  try {
    const { data: session } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history")
      .eq("id", sessionId)
      .single();
    const existing = session?.block_history || [];
    await db.schema("edu").from("adaptive_sessions").update({
      block_history: [...existing, ...newBlocks],
      updated_at:    new Date().toISOString(),
    }).eq("id", sessionId);
  } catch (e) {
    console.warn("[appendBlockHistory]", e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

async function loadSessionState(sessionId) {
  const { data, error } = await db.schema("edu")
    .from("adaptive_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error || !data) throw new Error("Session not found: " + sessionId);
  return data;
}

async function saveSessionState(sessionId, updates) {
  const { error } = await db.schema("edu")
    .from("adaptive_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error("Failed to save session: " + error.message);
}

async function savePhaseProgress(sessionId, subtopicIdx, subtopic, phase, data) {
  await db.schema("edu")
    .from("session_phase_progress")
    .upsert({
      session_id:        sessionId,
      subtopic_idx:      subtopicIdx,
      subtopic,
      phase,
      confidence_start:  data.confidenceStart ?? 0,
      confidence_end:    data.confidenceEnd   ?? null,
      gaps_covered:      data.gapsCovered     ?? [],
      objectives_met:    data.objectivesMet   ?? [],
      assessment_score:  data.assessmentScore ?? null,
      passed:            data.passed          ?? null,
      completed_at:      data.completed ? new Date().toISOString() : null,
    }, { onConflict: "session_id,subtopic_idx,phase" });
}

async function fetchStudentAgent(studentId) {
  const { data } = await db.from("user_agents")
    .select("id, agent_name, agent_emoji, agent_color, agent_bg, total_xp, system_prompt, personality")
    .eq("user_id", studentId)
    .single()
    .catch(() => ({ data: null }));
  return data ?? { id: null, agent_name: "Nexus", agent_emoji: "🤖", agent_color: "#E8884A", agent_bg: "#FEF0E6" };
}

async function resolveTeacherGuide(teacherAgentId, studentId) {
  // 1. If an explicit teacher agent is requested, try loading it first
  if (teacherAgentId) {
    try {
      const trained = await TrainedOrchestrator.fromAgentId(teacherAgentId);
      if (trained) {
        return {
          guide:            trained.guide,
          guideName:        trained.profile.name,
          guideEmoji:       "🎓",
          studentConfig:    trained.config?.student_config    || null,
          phaseDefinitions: trained.config?.phase_definitions || null,
          isTrained:        true,
        };
      }
    } catch { /* fall through */ }
  }

  // 2. Read the student's saved default from edu.user_agent_preferences
  if (studentId) {
    try {
      const prefs  = await getAgentPreferences(studentId);
      const pairId = prefs.guide_pair_id;

      if (pairId && pairId.startsWith("trained:")) {
        const agentId = pairId.replace("trained:", "");
        const trained = await TrainedOrchestrator.fromAgentId(agentId);
        if (trained) {
          return {
            guide:            trained.guide,
            guideName:        trained.profile.name,
            guideEmoji:       "🎓",
            studentConfig:    trained.config?.student_config    || null,
            phaseDefinitions: trained.config?.phase_definitions || null,
            isTrained:        true,
          };
        }
      }
    } catch { /* fall through */ }
  }

  // 3. Built-in fallback — NaNa Esumai
  return { guide: nana, guideName: "NaNa Esumai", guideEmoji: "🧠", isTrained: false };
}

function buildBlocks(parts) {
  return parts.filter(Boolean);
}

/* ─── Fix 3: Retrieve student knowledge via pgvector ────────────────────────
   Queries edu.agent_knowledge to build context for Nexus's reply.
   Student agent responds from what IT was previously taught, not from scratch.
─────────────────────────────────────────────────────────────────────────────*/
async function retrieveStudentKnowledge(studentAgentId, query, limit = 4) {
  if (!studentAgentId) return [];
  try {
    const embedding = await embed(query);
    const { data }  = await db.rpc("match_agent_knowledge", {
      p_agent_id:        studentAgentId,
      p_query_embedding: embedding,
      p_match_count:     limit,
    });
    return (data ?? []).map(c => `[${c.chunk_type}] ${c.topic}: ${c.content}`);
  } catch { return []; }
}

/* ─── Fix 4: Extract and save knowledge chunk after each exchange ────────────
   Saves meaningful exchanges to edu.agent_knowledge with embedding.
─────────────────────────────────────────────────────────────────────────────*/
async function extractAndSaveKnowledge({
  agentId, studentId, sessionId, subtopic, subject,
  humanMessage, objectiveCovered, confidence,
}) {
  if (!agentId || !studentId) return;
  if (confidence < 40 && !objectiveCovered) return;     // nothing meaningful yet
  try {
    const content = objectiveCovered
      ? `${objectiveCovered}: ${humanMessage.substring(0, 400)}`
      : `${subtopic}: ${humanMessage.substring(0, 400)}`;
    await saveAgentKnowledge({
      agentId, studentId, sessionId,
      topic:      objectiveCovered || subtopic,
      subject:    subject || "General",
      content,
      chunkType:  "taught",
      confidence: Math.min(0.95, (confidence / 100)),
    });
  } catch (e) {
    console.warn("[teachingSession] knowledge save failed:", e.message);
  }
}

/* ─── Fix 4b: Save learning objectives as knowledge chunks at subtopic end ───*/
async function saveObjectivesAsKnowledge({ agentId, studentId, sessionId, subtopic, subject, objectives, confidence }) {
  if (!agentId || !objectives?.length) return;
  for (const obj of objectives) {
    try {
      await saveAgentKnowledge({
        agentId, studentId, sessionId,
        topic:      subtopic,
        subject:    subject || "General",
        content:    `Objective covered: ${obj}`,
        chunkType:  "recalled",
        confidence: Math.min(0.95, (confidence / 100)),
      });
    } catch { /* skip failed saves */ }
  }
}

/* ─── Generate Nexus reply using Anthropic ─────────────────── */
async function generateNexusReply({ agentName, agentEmoji, subtopic, phase, confidence, humanMessage, history, systemPrompt: customPrompt, studentAgentId }) {
  const phaseCtx = {
    "1": "You are hearing about this topic for the first time. Show low confidence. Ask one focused question about something unclear.",
    "2": "You are learning the must-know parts. Acknowledge each piece of information and ask follow-up questions as your understanding builds.",
    "3": "Teach back what you learned — explain it in your own words. You may have one small gap.",
    "4": "Show that you understand deeply. Reason causally when asked edge case questions.",
    "assessment": "Answer the assessment questions directly from what you were taught.",
  };

  // Fix 3: retrieve from student's own knowledge base via pgvector
  const knowledgeChunks = await retrieveStudentKnowledge(studentAgentId, `${subtopic} ${humanMessage}`, 3);
  const knowledgeCtx = knowledgeChunks.length > 0
    ? `\n\nFrom your knowledge base:\n${knowledgeChunks.join("\n")}`
    : "";

  const system = customPrompt
    ? customPrompt + knowledgeCtx
    : `You are ${agentName} ${agentEmoji}, a Student AI Agent being taught about "${subtopic}".\n` +
      `Current phase: Phase ${phase}\n` +
      `Your current confidence on this topic: ${confidence}%\n\n` +
      `Behaviour for this phase: ${phaseCtx[phase] || phaseCtx["1"]}\n\n` +
      (knowledgeCtx ? `Context from your knowledge base:${knowledgeCtx}\n\n` : "") +
      `Rules:\n` +
      `- Stay in character as an AI agent learning — not a human student\n` +
      `- Reference your knowledge base when you have prior context on this\n` +
      `- Say "I have no prior data on this" when the knowledge base is empty\n` +
      `- Show confidence growing as teaching progresses\n` +
      `- Keep response to 2-3 sentences\n` +
      `- Never lecture back`;

  const messages = [
    ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: humanMessage },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 200, system, messages,
  });
  return response.content[0]?.text ?? `I'm processing what you taught me about ${subtopic}...`;
}

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 1: POST /teaching/configure
   Modal step 1 — AI generates subtopics + objectives.
   No DB write. User reviews + edits before /start.
═══════════════════════════════════════════════════════════════ */
router.post("/configure", authenticateToken, async (req, res) => {
  try {
    const { topic, subject } = req.body;
    if (!topic?.trim() || !subject?.trim())
      return res.status(400).json({ error: "topic and subject are required" });

    const subtopics = await nana.generateSubtopics(topic, subject);

    const objectivesArr = await Promise.all(
      subtopics.map(st => nana.generateObjectives(st, topic, subject))
    );
    const objectives = {};
    subtopics.forEach((st, i) => { objectives[st] = objectivesArr[i]; });

    res.json({ success: true, topic, subject, subtopics, objectives });
  } catch (err) {
    console.error("[teaching/configure]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 2: POST /teaching/start
   Modal step 2 — create session in DB, get NaNa opening message.
═══════════════════════════════════════════════════════════════ */
router.post("/start", authenticateToken, async (req, res) => {
  try {
    const {
      topic, subject, subtopics, objectives,
      studentId, teacherAgentId,
    } = req.body;

    const uid = req.user.id;
    const sid = studentId || uid;

    if (!topic || !subject || !subtopics?.length)
      return res.status(400).json({ error: "topic, subject and subtopics are required" });

    const [agentProfile, guideProfile] = await Promise.all([
      fetchStudentAgent(sid),
      resolveTeacherGuide(teacherAgentId, sid),
    ]);

    const agentName  = agentProfile.agent_name;
    const agentEmoji = agentProfile.agent_emoji;

    const firstSubtopic   = subtopics[0];
    const firstObjectives = objectives[firstSubtopic] || [];

    const openingMessage = await nana.openSubtopic({
      subtopic:        firstSubtopic,
      topic, subject,
      agentName, agentEmoji,
      phase:           "1",
      objectives:      firstObjectives,
      subtopicIdx:     0,
      totalSubtopics:  subtopics.length,
    });

    const { data: session, error } = await db.schema("edu")
      .from("adaptive_sessions")
      .insert({
        student_id:           sid,
        student_agent_id:     agentProfile.id,
        topic, subject,
        subtopics:            JSON.stringify(subtopics),
        objectives:           JSON.stringify(objectives),
        current_subtopic_idx: 0,
        current_phase:        "1",
        status:               "active",
        started_at:           new Date().toISOString(),
        session_history:      JSON.stringify([]),
        objectives_covered:   JSON.stringify({}),
        confidence_by_subtopic: JSON.stringify({}),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await savePhaseProgress(session.id, 0, firstSubtopic, "1", {
      confidenceStart: 20, gapsCovered: [], objectivesMet: [],
    });

    // Full opening block sequence — same as simulator
    const openingBlocks = [
      {
        type:    "subtopic-hdr",
        subtopic: firstSubtopic,
        idx:     0,
        total:   subtopics.length,
        topic,   subject,
      },
      {
        type:   "plan",
        phases: PHASE_PLAN,
      },
      {
        type:     "objectives",
        subtopic: firstSubtopic,
        items:    firstObjectives,
      },
      {
        type:  "guide",
        agent: guideProfile.guideName,
        emoji: guideProfile.guideEmoji,
        text:  openingMessage,
        phase: `Phase 1 — What does ${agentName} already know?`,
      },
    ];

    // Persist blocks to history
    await appendBlockHistory(session.id, openingBlocks);

    // Seed initial confidence record (starts at 20%)
    await saveSubtopicConfidence({
      studentId:    sid,
      agentId:      agentProfile.id,
      sessionId:    session.id,
      topic,        subject,
      subtopic:     firstSubtopic,
      objectives:   firstObjectives,
      confidence:   20,
      misconceptions: [],
      passed:       false,
    });

    res.status(201).json({
      success:     true,
      sessionId:   session.id,
      agentName,   agentEmoji,
      agentColor:  agentProfile.agent_color,
      guideName:   guideProfile.guideName,
      guideEmoji:  guideProfile.guideEmoji,
      topic, subject, subtopics,
      objectives,
      currentSubtopic:     firstSubtopic,
      currentSubtopicIdx:  0,
      currentPhase:        "1",
      openingMessage,
      blocks: openingBlocks,
    });
  } catch (err) {
    console.error("[teaching/start]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 3: POST /teaching/message
   Phase engine — routes human message through the correct handler.
═══════════════════════════════════════════════════════════════ */
router.post("/message", authenticateToken, async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message?.trim())
      return res.status(400).json({ error: "sessionId and message required" });

    const session     = await loadSessionState(sessionId);
    const subtopics   = JSON.parse(session.subtopics);
    const objectives  = JSON.parse(session.objectives);
    const history     = JSON.parse(session.session_history || "[]");
    const objCovered  = JSON.parse(session.objectives_covered || "{}");
    const confMap     = JSON.parse(session.confidence_by_subtopic || "{}");

    const idx         = session.current_subtopic_idx;
    const phase       = session.current_phase;
    const subtopic    = subtopics[idx];
    const subObjKeys  = objectives[subtopic] || [];
    const covered     = objCovered[subtopic] || [];

    const sid         = session.student_id;
    const agentProfile = await fetchStudentAgent(sid);
    const agentName   = agentProfile.agent_name;
    const agentEmoji  = agentProfile.agent_emoji;
    const confidence  = confMap[subtopic] ?? 20;

    const blocks = [];

    /* ─────────────────────── ASSESSMENT PHASE ─────────────── */
    if (phase === "assessment") {
      const currentAssess = session.assessment_state
        ? JSON.parse(session.assessment_state)
        : null;

      if (!currentAssess) {
        return res.status(400).json({ error: "No active assessment. Use /:sessionId/assess to start." });
      }

      const questionIdx = currentAssess.questionIdx ?? 0;
      const answers     = currentAssess.answers     ?? [];
      answers.push({ q: currentAssess.questions[questionIdx], a: message });

      if (questionIdx < 1) {
        const nextQ = currentAssess.questions[1];
        await saveSessionState(sessionId, {
          assessment_state: JSON.stringify({ ...currentAssess, questionIdx: 1, answers }),
        });
        blocks.push({
          type: "sargeant", agent: "Sargeant", emoji: "⚡",
          text: nextQ,
          phase: `Assessment — ${subtopic} · Q2`,
        });
        return res.json({ success: true, blocks, phase: "assessment", subtopic });
      }

      const result = await sargeant.runAssessment({
        subtopic, topic: session.topic, subject: session.subject,
        objectives: subObjKeys, agentName,
        agentAnswers: answers.map(a => a.a),
      });

      blocks.push({
        type:    "assess-result",
        agent:   "Sargeant",
        emoji:   "⚡",
        text:    result.verdict,
        phase:   `Assessment — ${subtopic}`,
        confidence: result.score,
        passed:     result.passed,
        subtopic,
        nextSubtopic: subtopics[idx + 1] ?? null,
      });

      await savePhaseProgress(sessionId, idx, subtopic, "assessment", {
        assessmentScore: result.score,
        passed:          result.passed,
        objectivesMet:   subObjKeys,
        completed:       true,
        misconceptions:  result.reteachFocus ? [result.reteachFocus] : [],
        reteachFocus:    result.reteachFocus ?? null,
      });

      // ── Write per-subtopic confidence to knowledge_confidence ──
      await saveSubtopicConfidence({
        studentId:     sid,
        agentId:       agentProfile.id,
        sessionId,
        topic:         session.topic,
        subject:       session.subject,
        subtopic,
        objectives:    subObjKeys,
        confidence:    result.score,
        misconceptions: result.reteachFocus ? [result.reteachFocus] : [],
        passed:        result.passed,
      });

      if (result.passed) {
        const nextIdx = idx + 1;
        if (nextIdx >= subtopics.length) {
          await saveSessionState(sessionId, {
            status:           "complete",
            current_phase:    "complete",
            completed_at:     new Date().toISOString(),
            assessment_state: null,
          });
          const completeBlock = {
            type:     "session-complete",
            agent:    "NaNa Esumai",
            emoji:    "🧠",
            text:     `🎉 Session complete! ${agentName} has been taught all ${subtopics.length} subtopics of ${session.topic}. Knowledge map updated.`,
            phase:    "Session Complete",
            isDecay:  false,
          };
          blocks.push(completeBlock);
          await appendBlockHistory(sessionId, [...blocks]);
        } else {
          const nextSubtopic = subtopics[nextIdx];
          const nextObjs     = objectives[nextSubtopic] || [];

          await saveObjectivesAsKnowledge({
            agentId:    agentProfile.id,
            studentId:  sid,
            sessionId,
            subtopic,
            subject:    session.subject,
            objectives: subObjKeys,
            confidence: result.score,
          });

          const openMsg = await nana.openSubtopic({
            subtopic: nextSubtopic, topic: session.topic, subject: session.subject,
            agentName, agentEmoji, phase: "1",
            objectives: nextObjs, subtopicIdx: nextIdx,
            totalSubtopics: subtopics.length,
          });

          await saveSessionState(sessionId, {
            current_subtopic_idx: nextIdx,
            current_phase:        "1",
            assessment_state:     null,
          });
          await savePhaseProgress(sessionId, nextIdx, nextSubtopic, "1", {
            confidenceStart: 20, gapsCovered: [], objectivesMet: [],
          });

          // Seed confidence record for next subtopic
          await saveSubtopicConfidence({
            studentId:   sid,
            agentId:     agentProfile.id,
            sessionId,
            topic:       session.topic,
            subject:     session.subject,
            subtopic:    nextSubtopic,
            objectives:  nextObjs,
            confidence:  20,
            passed:      false,
          });

          // Full block sequence for next subtopic — same as simulator
          const advanceBlocks = [
            { type: "subtopic-hdr", subtopic: nextSubtopic, idx: nextIdx,
              total: subtopics.length, topic: session.topic, subject: session.subject },
            { type: "plan", phases: PHASE_PLAN },
            { type: "objectives", subtopic: nextSubtopic, items: nextObjs },
            { type: "guide", agent: "NaNa Esumai", emoji: "🧠",
              text: openMsg, phase: `Subtopic ${nextIdx + 1}/${subtopics.length}: ${nextSubtopic}` },
          ];
          blocks.push(...advanceBlocks);
          await appendBlockHistory(sessionId, [...blocks]);
        }
      } else {
        await saveSessionState(sessionId, {
          current_phase:    "2",
          assessment_state: null,
        });
        const retBlock = {
          type:  "guide",
          agent: "NaNa Esumai",
          emoji: "🧠",
          text:  `Sargeant has identified a gap. Back to Phase 2 — ${agentName} needs more on: ${result.reteachFocus || subtopic}. Human, please re-explain this concept.`,
          phase: "Phase 2 — Re-teach",
        };
        blocks.push(retBlock);
        await appendBlockHistory(sessionId, [...blocks]);
      }

      await saveSessionState(sessionId, { session_history: JSON.stringify([...history, { role: "user", content: message }]) });
      return res.json({ success: true, blocks, phase: result.passed ? "advancing" : "2", subtopic, assessmentResult: result });
    }

    /* ─────────────────────── TEACHING PHASES 1-4 ──────────── */

    // Fix 5: drift check before processing human message
    const recentHistory = [...history.slice(-4), { role: "user", content: message }];
    const drift = await sargeant.checkForDrift(recentHistory, subtopic);
    if (drift.isDrifting) {
      return res.json({
        success: true,
        blocks: [{
          type:  "sargeant",
          agent: "Sargeant",
          emoji: "⚡",
          text:  sargeant.generateRedirectMessage(drift, subtopic),
          phase: `Phase ${phase} — drift warning`,
        }],
        phase, subtopic,
      });
    }

    // Fix 3: pass studentAgentId for pgvector retrieval
    const nexusReply = await generateNexusReply({
      agentName, agentEmoji, subtopic,
      phase, confidence, humanMessage: message, history,
      systemPrompt: agentProfile.system_prompt,
      studentAgentId: agentProfile.id,
    });

    const coaching = await nana.coachHuman({
      subtopic, topic: session.topic, agentName, phase,
      humanMessage: message, agentResponse: nexusReply,
      agentConfidence: confidence,
      objectives: subObjKeys, objectivesCovered: covered,
      history,
    });

    const newConfidence = Math.min(100, Math.max(0, confidence + (coaching.confidenceDelta || 5)));
    const newCovered    = coaching.objectiveCovered && !covered.includes(coaching.objectiveCovered)
      ? [...covered, coaching.objectiveCovered]
      : covered;

    // Fix 4: save knowledge chunk when meaningful learning happened
    await extractAndSaveKnowledge({
      agentId:          agentProfile.id,
      studentId:        sid,
      sessionId:        sessionId,
      subtopic,
      subject:          session.subject,
      humanMessage:     message,
      objectiveCovered: coaching.objectiveCovered ?? null,
      confidence:       newConfidence,
    });

    blocks.push({
      type:       "student-agent",
      agent:      agentName,
      emoji:      agentEmoji,
      text:       nexusReply,
      confidence: newConfidence,
      phase:      `Phase ${phase}`,
    });

    blocks.push({
      type:   "guide",
      agent:  "NaNa Esumai",
      emoji:  "🧠",
      text:   coaching.coachingTip,
      phase:  `Phase ${phase} — NaNa coaching`,
      gap:    coaching.gapIdentified ?? null,
      urgent: coaching.isUrgent ?? false,
    });

    const updatedHistory = [
      ...history,
      { role: "user",      content: message     },
      { role: "assistant", content: nexusReply  },
    ];

    let nextPhase = phase;

    if (coaching.readyToAdvance) {
      if (phase === "4") {
        nextPhase = "assessment";
        const questions = await sargeant.generateQuestions({
          subtopic, topic: session.topic, subject: session.subject,
          objectives: subObjKeys, agentName,
        });
        await saveSessionState(sessionId, {
          assessment_state: JSON.stringify({ questions: [questions.q1, questions.q2], answers: [], questionIdx: 0 }),
        });
        blocks.push({
          type:  "sargeant",
          agent: "Sargeant",
          emoji: "⚡",
          text:  `${questions.opening}\n\nQ1: ${questions.q1}`,
          phase: `Assessment gate — ${subtopic} · Q1`,
        });
      } else {
        const phaseNum  = parseInt(phase, 10);
        nextPhase       = String(phaseNum + 1);
        const phaseLabels = {
          "2": `Phase 2 — Must-know parts for ${subtopic}`,
          "3": `Phase 3 — ${agentName} teaches it back`,
          "4": `Phase 4 — Push further`,
        };
        if (phase === "2") {
          const prompt = await nana.promptTeachBack({ subtopic, agentName });
          blocks.push({ type: "guide", agent: "NaNa Esumai", emoji: "🧠", text: prompt, phase: phaseLabels["3"] });
        } else if (phase === "3") {
          const prompt = await nana.pushFurther({ subtopic, topic: session.topic, agentName, humanMessage: message, agentResponse: nexusReply });
          blocks.push({ type: "guide", agent: "NaNa Esumai", emoji: "🧠", text: prompt, phase: phaseLabels["4"] });
        }
      }
    }

    const newConfMap = { ...confMap, [subtopic]: newConfidence };
    const newObjCov  = { ...objCovered, [subtopic]: newCovered };

    await saveSessionState(sessionId, {
      current_phase:            nextPhase,
      session_history:          JSON.stringify(updatedHistory.slice(-40)),
      objectives_covered:       JSON.stringify(newObjCov),
      confidence_by_subtopic:   JSON.stringify(newConfMap),
    });

    await savePhaseProgress(sessionId, idx, subtopic, phase, {
      confidenceEnd:  newConfidence,
      gapsCovered:    coaching.gapIdentified ? [coaching.gapIdentified] : [],
      objectivesMet:  newCovered,
      completed:      coaching.readyToAdvance && phase !== "4",
    });

    // Persist blocks to session history for decay reconstruction
    await appendBlockHistory(sessionId, blocks);

    res.json({
      success: true, blocks,
      phase:        nextPhase,
      subtopic,     subtopicIdx: idx,
      confidence:   newConfidence,
      phaseAdvanced: nextPhase !== phase,
    });

  } catch (err) {
    console.error("[teaching/message]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 4: GET /teaching/:sessionId
   Returns current session state for frontend.
═══════════════════════════════════════════════════════════════ */
router.get("/:sessionId", authenticateToken, async (req, res) => {
  try {
    const session    = await loadSessionState(req.params.sessionId);
    const subtopics  = JSON.parse(session.subtopics);
    const objectives = JSON.parse(session.objectives);
    const confMap    = JSON.parse(session.confidence_by_subtopic || "{}");
    const objCov     = JSON.parse(session.objectives_covered     || "{}");
    const idx        = session.current_subtopic_idx;

    const agentProfile = await fetchStudentAgent(session.student_id);

    const { data: progress } = await db.schema("edu")
      .from("session_phase_progress")
      .select("*")
      .eq("session_id", session.id)
      .order("subtopic_idx");

    res.json({
      success: true,
      sessionId:           session.id,
      topic:               session.topic,
      subject:             session.subject,
      status:              session.status,
      agentName:           agentProfile.agent_name,
      agentEmoji:          agentProfile.agent_emoji,
      currentSubtopic:     subtopics[idx],
      currentSubtopicIdx:  idx,
      totalSubtopics:      subtopics.length,
      currentPhase:        session.current_phase,
      subtopics,
      objectives,
      confidenceMap:       confMap,
      objectivesCovered:   objCov,
      phaseProgress:       progress ?? [],
      allSubtopicsDone:    session.status === "complete",
      percentComplete:     Math.round(((idx + (session.current_phase === "complete" ? 1 : 0)) / subtopics.length) * 100),
    });
  } catch (err) {
    console.error("[teaching/:sessionId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 5: POST /teaching/:sessionId/assess
   Manually trigger Sargeant assessment gate.
═══════════════════════════════════════════════════════════════ */
router.post("/:sessionId/assess", authenticateToken, async (req, res) => {
  try {
    const session   = await loadSessionState(req.params.sessionId);
    const subtopics = JSON.parse(session.subtopics);
    const objectives = JSON.parse(session.objectives);
    const idx       = session.current_subtopic_idx;
    const subtopic  = subtopics[idx];
    const subObjs   = objectives[subtopic] || [];

    const agentProfile = await fetchStudentAgent(session.student_id);
    const agentName   = agentProfile.agent_name;

    const questions = await sargeant.generateQuestions({
      subtopic, topic: session.topic, subject: session.subject,
      objectives: subObjs, agentName,
    });

    await saveSessionState(req.params.sessionId, {
      current_phase:    "assessment",
      assessment_state: JSON.stringify({ questions: [questions.q1, questions.q2], answers: [], questionIdx: 0 }),
    });

    res.json({
      success:  true,
      phase:    "assessment",
      subtopic,
      block: {
        type:  "sargeant",
        agent: "Sargeant",
        emoji: "⚡",
        text:  `${questions.opening}\n\nQ1: ${questions.q1}`,
        phase: `Assessment gate — ${subtopic} · Q1`,
      },
    });
  } catch (err) {
    console.error("[teaching/:sessionId/assess]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 6: POST /teaching/summary
   Generates a session summary using Anthropic.
   Frontend calls after session complete or ≥ 2 user turns.
═══════════════════════════════════════════════════════════════ */
router.post("/summary", authenticateToken, async (req, res) => {
  try {
    const { sessionId, studentId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const session    = await loadSessionState(sessionId);
    const subtopics  = JSON.parse(session.subtopics || "[]");
    const confMap    = JSON.parse(session.confidence_by_subtopic || "{}");
    const objCov     = JSON.parse(session.objectives_covered || "{}");
    const history    = JSON.parse(session.session_history || "[]");

    const agentProfile = await fetchStudentAgent(session.student_id);
    const agentName    = agentProfile.agent_name;

    // Pull subtopic confidence from knowledge_confidence table
    const { data: confRows } = await db.schema("edu")
      .from("knowledge_confidence")
      .select("subtopic, confidence, passed_count, misconceptions")
      .eq("student_id", session.student_id)
      .eq("topic", session.topic);

    const subtopicSummary = (confRows || []).map(r => (
      `${r.subtopic}: ${r.confidence}% confidence (${r.passed_count} passes)` +
      (r.misconceptions?.length ? ` · gaps: ${r.misconceptions.join(", ")}` : "")
    )).join("\n");

    const transcript = history.slice(-20)
      .map(h => `${h.role === "user" ? "Human" : agentName}: ${h.content}`)
      .join("\n\n");

    const system = `You are a teaching quality analyser. Analyse this teach-back session.
Return ONLY valid JSON matching this schema exactly:
{
  "teachingScore": <number 0-100>,
  "xpEarned": <number 50-200>,
  "agentFeedback": "<2-3 sentence feedback on human teaching quality>",
  "keyConcepts": ["<concept>", ...],
  "strengthAreas": ["<strength>", ...],
  "gapsIdentified": ["<gap>", ...]
}`;

    const prompt = `Topic: ${session.topic} (${session.subject})
Subtopics taught: ${subtopics.join(", ")}

Per-subtopic confidence after session:
${subtopicSummary || "No assessment data yet."}

Session transcript (last 20 turns):
${transcript}

Generate JSON summary.`;

    const aiRes = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 600, system,
      messages: [{ role: "user", content: prompt }],
    });

    let summary;
    try {
      const raw = (aiRes.content[0]?.text || "{}").replace(/```json|```/g, "").trim();
      summary   = JSON.parse(raw);
    } catch {
      summary = {
        teachingScore:  72,
        xpEarned:       100,
        agentFeedback:  `Good session on ${session.topic}. ${agentName}'s confidence improved across all subtopics.`,
        keyConcepts:    subtopics.slice(0, 3),
        strengthAreas:  ["Clear explanations", "Good sequencing"],
        gapsIdentified: ["More examples needed"],
      };
    }

    res.json({ success: true, summary });

  } catch (err) {
    console.error("[teaching/summary]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 7: GET /adaptive/sessions
   Returns all past adaptive sessions for the student.
   Used by Agent tab → Sessions sub-tab.
═══════════════════════════════════════════════════════════════ */
router.get("/sessions", authenticateToken, async (req, res) => {
  try {
    const studentId = req.user?.id || req.query.studentId;
    if (!studentId) return res.status(400).json({ error: "studentId required" });

    const { data: rows, error } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("id, topic, subject, status, subtopics, objectives, updated_at, completed_at, block_history")
      .eq("student_id", studentId)
      .in("status", ["active", "complete"])
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);

    // Enrich with per-subtopic confidence data
    const { data: confRows } = await db.schema("edu")
      .from("knowledge_confidence")
      .select("topic, subtopic, confidence, assess_count, misconceptions")
      .eq("student_id", studentId)
      .catch(() => ({ data: [] }));

    const confByTopic = {};
    for (const c of confRows || []) {
      if (!confByTopic[c.topic]) confByTopic[c.topic] = [];
      confByTopic[c.topic].push(c);
    }

    const SUBJECTS = { science:"science", maths:"maths", english:"english",
      biology:"science", chemistry:"science", physics:"science",
      history:"english", geography:"english" };

    const sessions = (rows || []).map((s, i) => {
      const subtopics    = JSON.parse(s.subtopics || "[]");
      const topicConf    = confByTopic[s.topic] || [];
      const avgConf      = topicConf.length
        ? Math.round(topicConf.reduce((sum, c) => sum + c.confidence, 0) / topicConf.length)
        : 0;
      const totalAssess  = topicConf.reduce((sum, c) => sum + (c.assess_count || 0), 0);
      const hasHistory   = Array.isArray(s.block_history) && s.block_history.length > 0;
      const completedAt  = s.completed_at || s.updated_at;
      const daysSince    = Math.max(0, Math.round(
        (Date.now() - new Date(completedAt).getTime()) / 86_400_000
      ));

      return {
        // SessionCard shape
        id:             s.id,
        type:           "agent",
        status:         s.status,
        title:          s.topic,
        topic:          s.topic,
        subject:        SUBJECTS[s.subject?.toLowerCase()] || s.subject || "science",
        avatar:         `https://i.pravatar.cc/150?img=${(i % 30) + 10}`,
        tutor:          "AI Agent",
        level:          "Adaptive",
        startsAt:       completedAt,
        time:           new Date(completedAt).toLocaleTimeString("en-NG", { hour:"2-digit", minute:"2-digit" }),
        nextSession:    daysSince === 0 ? "Today" : daysSince === 1 ? "Yesterday" : `${daysSince}d ago`,
        topics:         subtopics.length || 1,
        revisions:      totalAssess,
        reviews:        topicConf.filter(c => c.confidence >= 70).length,
        progress:       avgConf,
        unread:         0,
        priority:       "medium",
        scheduleBucket: "later",
        // Continuation context
        hasHistory,
        avgConfidence:  avgConf,
        subtopicCount:  subtopics.length,
        subtopicList:   subtopics,
        misconceptions: topicConf.flatMap(c => c.misconceptions || []).slice(0, 3),
        daysSince,
      };
    });

    res.json({ success: true, sessions, total: sessions.length });

  } catch (err) {
    console.error("[adaptive/sessions]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 8: GET /adaptive/sessions/:sessionId/history
   Returns faded block history for a continuation session.
   Called when "Continue Teaching" CTA is tapped in SessionSheet.
═══════════════════════════════════════════════════════════════ */
router.get("/sessions/:sessionId/history", authenticateToken, async (req, res) => {
  try {
    const session = await loadSessionState(req.params.sessionId);

    const completedAt = session.completed_at || session.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));

    let historyBlocks = [];
    if (Array.isArray(session.block_history) && session.block_history.length > 0) {
      historyBlocks = [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...session.block_history.map(b => ({ ...b, faded: true })),
      ];
    }

    const subtopics  = JSON.parse(session.subtopics  || "[]");
    const objectives = JSON.parse(session.objectives || "{}");

    res.json({
      success:       true,
      historyBlocks,
      topic:         session.topic,
      subject:       session.subject,
      subtopics,
      objectives,
      daysSince,
      status:        session.status,
      hasHistory:    historyBlocks.length > 0,
    });

  } catch (err) {
    console.error("[adaptive/sessions/history]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
