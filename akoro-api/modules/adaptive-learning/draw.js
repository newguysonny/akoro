/**
 * draw.js — AI diagram generation (prototype).
 *
 * POST /api/adaptive/draw  { prompt }  →  { mermaid, caption }
 *
 * Turns a learner's natural-language request into a Mermaid diagram. The
 * frontend renders it as editable Excalidraw shapes via mermaid-to-excalidraw.
 * Mermaid is used as the intermediate because the LLM is reliable at it and the
 * output stays editable (vs. asking for raw Excalidraw element JSON).
 */
import { Router } from "express";
import { llmComplete } from "../../lib/aiModel.js";

const router = Router();

const SYSTEM = `You are a diagramming assistant for a learning app. Given a student's request, produce ONE Mermaid diagram that clearly explains the concept.

Rules:
- Output ONLY valid Mermaid code. No prose, no markdown code fences, no explanation.
- Choose the best diagram type for the concept: flowchart (graph TD/LR), mindmap, sequenceDiagram, stateDiagram-v2, erDiagram, or timeline.
- Prefer flowchart 'graph TD' or 'mindmap' for general concepts and processes.
- Keep node labels short (2-5 words). Use clear, correct, educational content.
- Aim for 5-15 nodes — enough to be useful, not overwhelming.
- Do not use unsupported syntax, HTML, or click handlers.`;

// Strip accidental markdown fences / stray prose the model may add.
function cleanMermaid(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

router.post("/", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ success: false, message: "prompt is required" });
    if (prompt.length > 1000) return res.status(400).json({ success: false, message: "prompt too long" });

    const raw = await llmComplete(`Create a diagram for: ${prompt}`, {
      system: SYSTEM, maxTokens: 1200, temperature: 0.4,
    });
    const mermaid = cleanMermaid(raw);
    if (!mermaid) return res.status(502).json({ success: false, message: "Could not generate a diagram — try rephrasing." });

    res.json({ success: true, data: { mermaid, caption: prompt } });
  } catch (err) {
    console.error("[draw] generation failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Diagram generation failed" });
  }
});

export default router;
