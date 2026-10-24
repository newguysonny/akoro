/**
 * Close what a model left open. Long answers sometimes end a bracket or two short (the gate saw
 * `…"}]}]}` with the entries array and the root never closed); the content is all there, so close
 * the brackets in order rather than throwing the whole answer away.
 */
export function closeJson(text) {
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of text) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") { if (stack.at(-1) === ch) stack.pop(); else return null; }
  }
  return text + (inStr ? '"' : "") + stack.reverse().join("");
}
