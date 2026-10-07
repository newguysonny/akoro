// modules/tasks/tools/_json.js
// Robust JSON extraction from LLM text. Models occasionally wrap JSON in
// ```json fences or add a line of preamble even when told not to — a raw
// JSON.parse then throws and the whole tool run fails. parseJsonLoose strips
// fences and, if needed, extracts the outermost {...} / [...] block before
// parsing, so these tools tolerate the common formatting drift.

export function parseJsonLoose(text) {
  if (text == null) throw new Error("empty LLM response");
  let s = String(text).trim().replace(/```(?:json)?/gi, "").trim();

  try { return JSON.parse(s); } catch { /* fall through to extraction */ }

  // Grab from the first opening bracket to the last matching closing bracket.
  const first = s.search(/[[{]/);
  const last  = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first !== -1 && last > first) {
    return JSON.parse(s.slice(first, last + 1));
  }
  throw new Error("no JSON found in LLM response");
}
