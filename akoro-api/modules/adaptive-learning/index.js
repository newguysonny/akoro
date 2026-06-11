/**
 * modules/adaptive-learning/index.js  —  Adaptive Learning Module Entry
 *
 * Registers:
 *   HTTP routes → express router (mounted at /api/adaptive in app.js)
 *   Socket.io   → wired directly to the shared io instance from app.js
 *
 * Architecture: Option A — shared public.users identity
 *   All user_id FKs in the edu schema reference public.users(id)
 *   Auth is handled by our JWT middleware from modules/auth/routes.js
 *   No second login required — same token works across all modules
 *
 * New env vars needed (.env):
 *   OPENAI_API_KEY       GPT-4o agents + embeddings + Whisper STT + TTS
 *
 * Usage in app.js:
 *   import { adaptiveLearningRoutes, setupAdaptiveWebSocket }
 *     from "./modules/adaptive-learning/index.js";
 *   app.use("/api/adaptive", adaptiveLearningRoutes);
 *   setupAdaptiveWebSocket(io);
 */

import { Router }                from "express";
import trainingRouter            from "./training/agentTraining.js";
import { startLiveStream, receiveChunk, endLiveStream } from "./training/agentTraining.js";
import marketplaceRouter         from "./marketplace/routes.js";
import chatRouter                from "./chat.js";
import teachingSessionRouter     from "./teachingSession.js";
import { setupWebSocket }        from "./websocket.js";
import { authenticateToken }     from "../auth/routes.js";

// ─── HTTP Router ──────────────────────────────────────────────────────────────

const router = Router();

// Training pipeline — instructor uploads audio/video to train their agent
// POST /api/adaptive/training/start
// GET  /api/adaptive/training/stream/:runId
// GET  /api/adaptive/training/run/:runId
// GET  /api/adaptive/training/sessions/:teacherId
// DELETE /api/adaptive/training/sessions/:sessionId
router.use("/training",     authenticateToken, trainingRouter);

// Live device stream training
router.post("/training/stream/start", authenticateToken, startLiveStream);
router.post("/training/stream/chunk", authenticateToken, receiveChunk);
router.post("/training/stream/end",   authenticateToken, endLiveStream);

// Agent marketplace — buy/sell trained teacher agents
// GET  /api/adaptive/marketplace/listings
// POST /api/adaptive/marketplace/list
// POST /api/adaptive/marketplace/checkout
// POST /api/adaptive/marketplace/webhook   ← no auth (Paystack signature)
// GET  /api/adaptive/marketplace/my-agents/:userId
router.use("/marketplace",  marketplaceRouter);

// HTTP chat fallback (for non-WebSocket clients)
// POST /api/adaptive/chat
// GET  /api/adaptive/chat/history/:agentId
// Teaching session — phase engine (configure + start + message + state + assess)
// Mounted BEFORE chatRouter so /teaching/* is handled here, not by chat.js
router.use("/teaching",      authenticateToken, teachingSessionRouter);

router.use("/chat",          authenticateToken, chatRouter);

// ─── WebSocket setup ──────────────────────────────────────────────────────────

/**
 * setupAdaptiveWebSocket
 * Wires all adaptive learning Socket.io events to the shared io instance.
 * Called from app.js after the server starts.
 *
 * Socket events added:
 *   Client → Server:
 *     list_agent_pairs         get available teaching agents
 *     get_my_agents            get user's purchased agents
 *     start_session            start a teaching session
 *     start_student_session    start student self-study session
 *     start_decay_session      start a spaced-repetition review
 *     teacher_message          send a teaching turn message
 *     end_session              end the session + get evaluation
 *     switch_agent_pair        switch to a different agent
 *     get_knowledge_health     get student's knowledge decay dashboard
 *     get_subject_topics       get topics by subject
 *     acknowledge_alert        mark a decay notification as read
 *     get_state                get current session state snapshot
 *     get_agent_growth         get student agent growth history
 *
 *   Server → Client:
 *     session_ready            session initialised, ready for teaching
 *     student_session_ready    student session initialised
 *     student_token            streaming token from student agent
 *     guide_token              streaming token from guide agent
 *     student_done             student agent finished streaming
 *     guide_done               guide agent finished streaming
 *     typing_start             agent is generating a response
 *     turn_complete            full turn result with XP + adaptive engine
 *     state_update             real-time cognitive state update
 *     session_ended            session complete with evaluation
 *     agent_pairs_list         list of available agent pairs
 *     my_agents_data           user's full agent inventory
 *     agent_pair_switching     switching to new agent pair
 *     knowledge_health_data    knowledge decay dashboard
 *     subject_topics_data      topics for a subject
 *     alert_acknowledged       decay notification marked read
 *     state_snapshot           current session state
 *     agent_growth_data        agent growth history
 *     agent_purchased          emitted after marketplace payment confirms
 *     error                    error message
 */
export const setupAdaptiveWebSocket = (io) => setupWebSocket(io);

export default router;
