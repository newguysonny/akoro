/**
 * modules/records/service-tools.js — the structured reader tools (summary,
 * quiz, flashcards) over numbered passages, each item carrying the citation
 * of the passage it came from.
 */
import { TOOL_IDS, TOOL_LIMITS } from "./toolsLib.js";
import { generateToolResult } from "./studyMaterial.js";
import { res400 } from "./http.js";
import { resolveAskTarget } from "./service-ask.js";

/*
 * POST /api/records/tools/:tool  (summary | quiz | flashcards)
 * { recordId | contentKey, scope: "page"|"document", pageNumber?, pageText?, values }
 * One structured model call over numbered passages; every point / question /
 * card carries the citation of the passage it came from. pageText is the
 * reader's own text for a page the server never extracted (capped).
 */
export async function runTool(req, res) {
  const tool = String(req.params.tool || "");
  if (!TOOL_IDS.includes(tool)) return res400(res, `tool must be one of: ${TOOL_IDS.join(", ")}.`);
  const target = await resolveAskTarget(req, req.body);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });

  const scope = req.body?.scope === "document" ? "document" : "page";
  const pageNumber = Number(req.body?.pageNumber);
  const pageText = typeof req.body?.pageText === "string" ? req.body.pageText.slice(0, TOOL_LIMITS.MAX_PAGE_TEXT_CHARS) : "";
  const raw = req.body?.values && typeof req.body.values === "object" ? req.body.values : {};
  const values = {
    focus: typeof raw.focus === "string" ? raw.focus.slice(0, TOOL_LIMITS.MAX_FOCUS_CHARS) : "",
    depth: typeof raw.depth === "string" ? raw.depth.slice(0, 20) : "",
    count: typeof raw.count === "string" || typeof raw.count === "number" ? String(raw.count).slice(0, 3) : "",
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty.slice(0, 10) : "",
  };

  const g = await generateToolResult({ target, tool, scope, pageNumber: Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : null, pageText, values });
  if (g.status) return res.status(g.status).json({ success: false, message: g.message });
  return res.json({ success: true, data: { tool, scope, ...g.result } });
}
