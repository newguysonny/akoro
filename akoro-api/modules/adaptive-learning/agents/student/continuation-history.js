// =============================================================
// agents/student/continuation-history.js
// Restores a persisted block transcript (edu.adaptive_sessions.block_history)
// into the orchestrator's bounded conversation history.
//
// WHY THIS EXISTS: "Continue Teaching" and decay reviews used to restart the
// agent with an empty session.history. The faded transcript in the UI was
// pixels, not memory — the agent had no idea what had been said. This module
// maps the stored typed blocks back into the { role, content } turns the
// teaching workflow already feeds to the model (agent.js slices the last 6).
// =============================================================

const DEFAULT_MAX_TURNS = 12;   // ≈ the last six exchanges (teacher + agent)
const DEFAULT_MAX_CHARS = 600;  // per entry — a full reply fits, prompts stay bounded

// Blocks that ARE the conversation. Everything else (guide tips, sargeant
// gates, subtopic headers, dividers, completion banners) is UI chrome around
// it — the agent's memory is what was taught and said, not the scaffolding.
const ROLE_FOR_BLOCK_TYPE = {
  "user":          "human_teacher",
  "student-agent": "student_agent",
};

export function blocksToConversationHistory(
  blocks,
  { maxTurns = DEFAULT_MAX_TURNS, maxChars = DEFAULT_MAX_CHARS } = {}
) {
  // Legacy rows may hold block_history as a JSON *string* (written before the
  // JSONB-safe inserts). Parse defensively so one bad row can't break session
  // start — an unreadable transcript degrades to a blank memory, never an error.
  let source = blocks;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return []; }
  }
  if (!Array.isArray(source)) return [];

  const turns = [];
  for (const block of source) {
    if (!block || typeof block !== "object") continue;
    const role = ROLE_FOR_BLOCK_TYPE[block.type];
    if (!role) continue;
    const text = typeof block.text === "string" ? block.text.trim() : "";
    if (!text) continue;
    turns.push({ role, content: text });
  }

  return turns.slice(-maxTurns).map(turn => ({
    role:      turn.role,
    content:   turn.content.length > maxChars
      ? turn.content.slice(0, maxChars - 1).trimEnd() + "…"
      : turn.content,
    timestamp: new Date(),
    // In-session pushes carry only role/content/timestamp; this flags that the
    // turn was restored from a previous session rather than spoken live.
    restored:  true,
  }));
}
