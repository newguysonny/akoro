/**
 * draw.js — AI diagram generation (prototype, multi-engine).
 *
 * POST /api/adaptive/draw  { prompt, mode }  →  { mode, svg | elements | mermaid, caption }
 *
 * Three engines so we can compare quality:
 *   • svg        — a rich, teacher-style illustration (best visual fidelity;
 *                  static image, not editable). This is the "chalkboard" look.
 *   • excalidraw — editable hand-drawn shapes (boxes/arrows/text skeleton).
 *   • mermaid    — structured flow/mind/sequence diagrams (most reliable, but
 *                  only for structured content).
 */
import { Router } from "express";
import { llmComplete, openai, OPENAI_MODEL } from "../../../lib/aiModel.js";

const router = Router();

// System prompt for reading a learner's own hand-drawn sketch.
const INTERPRET_SYSTEM = `You are a patient tutor looking at a student's hand-drawn sketch. Describe what they've drawn, judge whether it correctly represents the concept, and give brief, encouraging, specific feedback (what's right, what's missing or wrong, one tip). Be concise (3-5 short sentences). If the drawing is unclear or empty, say so kindly and ask what they intended.`;

const SYSTEM = {
  mermaid: `You are a diagramming assistant for a learning app. Given a student's request, output ONE Mermaid diagram (flowchart graph TD/LR, mindmap, sequenceDiagram, stateDiagram-v2, or timeline). Output ONLY valid Mermaid code — no prose, no code fences. Short node labels (2-5 words), 5-15 nodes, correct educational content.`,

  svg: `You are an expert educational illustrator that draws like a great teacher at a whiteboard. Given a concept, produce ONE self-contained SVG illustration that EXPLAINS it visually — not a flowchart.

Requirements:
- Output ONLY the <svg>...</svg> element. No prose, no markdown fences, no <script>.
- Use viewBox="0 0 820 500". Set font-family="'Nunito', sans-serif".
- DRAW THE ACTUAL THING: use shapes, curved <path> lines, arrows (via <marker>), gradients and colour to depict real objects (magnets, cells, forces, orbits, molecules, graphs…), not just labelled boxes.
- Add a clear title, concise labels, a key formula/relationship if relevant, and one short caption or "key insight".
- Use a clean, friendly palette (purples #7c3aed, teal #0d9488, amber #f59e0b, slate #334155). Keep it uncluttered and scientifically correct.
- Give drawable stroke <path>/<line>/<circle> a pathLength="1" attribute so the client can animate them drawing on.`,

  excalidraw: `You are a diagram generator that outputs Excalidraw skeleton elements. Given a concept, output ONLY a JSON array (no prose, no fences) of elements the app converts with convertToExcalidrawElements.

Each element: { "type": "rectangle"|"ellipse"|"diamond"|"arrow"|"line"|"text", "x": number, "y": number, "width"?: number, "height"?: number, "text"?: string, "label"?: { "text": string }, "strokeColor"?: hex, "backgroundColor"?: hex }.
Lay out a 800x500 space. Use arrows to connect shapes, labels for names, one text element for a key formula. 6-14 elements. Keep labels short and content correct.`,
};

function stripFences(t, tag) {
  let s = (t || "").trim();
  const fence = s.match(/```(?:[a-z]+)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (tag === "svg") {
    const m = s.match(/<svg[\s\S]*<\/svg>/i);
    if (m) s = m[0];
  }
  return s;
}

router.post("/", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    const mode = ["svg", "excalidraw", "mermaid"].includes(req.body?.mode) ? req.body.mode : "svg";
    if (!prompt) return res.status(400).json({ success: false, message: "prompt is required" });
    if (prompt.length > 1000) return res.status(400).json({ success: false, message: "prompt too long" });

    const raw = await llmComplete(`Illustrate this concept for a student: ${prompt}`, {
      system: SYSTEM[mode],
      maxTokens: mode === "svg" ? 3000 : 1400,
      temperature: 0.5,
    });
    const out = stripFences(raw, mode);
    if (!out) return res.status(502).json({ success: false, message: "Empty result — try rephrasing." });

    if (mode === "svg") return res.json({ success: true, data: { mode, svg: out, caption: prompt } });
    if (mode === "mermaid") return res.json({ success: true, data: { mode, mermaid: out, caption: prompt } });

    // excalidraw
    let elements;
    try { elements = JSON.parse(out); } catch { return res.status(502).json({ success: false, message: "Could not parse diagram." }); }
    if (!Array.isArray(elements)) return res.status(502).json({ success: false, message: "Unexpected diagram format." });
    return res.json({ success: true, data: { mode, elements, caption: prompt } });
  } catch (err) {
    console.error("[draw] generation failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Diagram generation failed" });
  }
});

// POST /api/adaptive/draw/interpret  { image (data URL png), prompt? }
// Vision: read the learner's own sketch and give feedback.
router.post("/interpret", async (req, res) => {
  try {
    const image = String(req.body?.image || "");
    const prompt = String(req.body?.prompt || "").trim();
    if (!image.startsWith("data:image/")) return res.status(400).json({ success: false, message: "image (data URL) is required" });
    if (image.length > 8_000_000) return res.status(413).json({ success: false, message: "Drawing too large" });

    const userText = prompt
      ? `The student was asked to draw: "${prompt}". Here is their sketch — read it and give feedback.`
      : `Here is the student's sketch. Read it and give feedback.`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: 400,
      messages: [
        { role: "system", content: INTERPRET_SYSTEM },
        { role: "user", content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: image } },
        ] },
      ],
    });
    const reading = resp.choices?.[0]?.message?.content?.trim() || "I couldn't read that drawing — try adding more detail.";
    res.json({ success: true, data: { reading } });
  } catch (err) {
    console.error("[draw/interpret] failed:", err?.message || err);
    res.status(500).json({ success: false, message: "Could not read the drawing" });
  }
});

export default router;
