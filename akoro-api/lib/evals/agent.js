// lib/evals/agent.js
//
// Does the agent actually FINISH the job?
//
// The routing suite asks a single-turn question — given a sentence, which tool?
// That is the easy half. The task runner is a real loop: the model calls a
// tool, reads what came back, and decides again, up to twenty times. Everything
// that goes wrong in production goes wrong in that gap. A model that misread a
// tool result once produced twenty battles and eighteen self-study assignments
// before the iteration cap stopped it, and no single-turn eval could have seen
// it coming.
//
// So this runs the REAL loop — modules/tasks/lib/agentLoop.js, the same code
// the worker runs — against STUB tools. The stubs are the only difference. A
// suite that created real battles for real classes would be a worse problem
// than the one it detects, and a suite that reimplemented the loop would pass
// while the real one drifted.
//
// What is scored is the trace, not the prose: which tools were asked for, with
// what arguments, how many times, and whether the loop ended because the model
// was finished or because it ran out of rope.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgentLoop } from "../../modules/tasks/lib/agentLoop.js";
import { getToolsForTaskType } from "../../modules/tasks/tools/index.js";
import { buildSystemPrompt } from "../../modules/tasks/lib/context.js";
import { argMatches } from "./match.js";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("./data/agent.json", import.meta.url)), "utf8"));

// The agent the task would have run as. Not a DB row — buildSystemPrompt only
// needs a name and an optional system prompt, and reaching into the database
// would make the suite depend on which demo rows happen to exist.
const AGENT  = { name: "Akoro Teaching Assistant" };
const COURSE = { id: "11111111-1111-1111-1111-111111111111", title: "JSS1 Mathematics", subject: "Mathematics" };

/**
 * Stub tool results.
 *
 * Shaped like the real ones — same keys, same success flag — because the model
 * reads them and decides what to do next. A stub that returned `{ok: true}`
 * where production returns a battle object would be testing a different loop.
 */
function stubResult(name, args, mode) {
  if (mode === "fail-no-class") {
    return { success: false, error: `No class named "${args.className ?? "that"}" exists in your school. Check the name and try again.` };
  }
  if (mode === "ambiguous") {
    // Success, in a shape that does not shout it — the case that caused the
    // duplicate-assignment bug.
    return { assignmentIds: ["a1", "a2"], count: 2 };
  }

  switch (name) {
    case "assign_battle":
      return { success: true, battleId: "b-eval-1", title: args.title ?? "Battle",
               participants: Array.isArray(args.usernames) ? args.usernames.length : 24,
               message: "Battle created and sent to participants." };
    case "assign_self_study":
      return { success: true, assignmentIds: ["s-eval-1"],
               count: Array.isArray(args.usernames) ? args.usernames.length : 24,
               message: "Self study assigned." };
    case "run_teaching_tool":
      return { success: true, tool: args.tool, artifactId: "art-eval-1",
               message: `${args.tool} generated and saved to your library.` };
    case "fetch_student_data":
      // Real-shaped data the model must then ACT on — the whole point of the
      // multi-turn cases is that the second call's arguments come from here.
      return { success: true, className: "JSS1", subject: "Mathematics", learners: [
        { username: "priya",  averageScore: 41, weakestTopic: "Fractions" },
        { username: "amaka",  averageScore: 47, weakestTopic: "Fractions" },
        { username: "chidi",  averageScore: 88, weakestTopic: "Algebra" },
        { username: "tunde",  averageScore: 79, weakestTopic: "Simple interest" },
      ] };
    case "send_reminder":
      return { success: true, sent: 24, message: "Reminder sent." };
    default:
      return { success: true, message: `${name} completed.` };
  }
}

/** Judge one trace against what the golden said should happen. */
function judge(expect, { calls, hitCap, iterations, outputs }) {
  const problems = [];
  const names = calls.map((c) => c.name);
  const firstOf = (n) => calls.find((c) => c.name === n)?.args ?? null;

  for (const n of expect.mustCall ?? []) {
    if (!names.includes(n)) problems.push(`never called ${n}`);
  }
  for (const n of expect.mustNotCall ?? []) {
    if (names.includes(n)) problems.push(`called ${n}, which it should not have`);
  }

  // Asked-for, not executed. The replay cache stops a second EXECUTION, so
  // counting executions would hide a model that keeps asking — and every ask
  // is another billed turn.
  for (const n of expect.once ?? []) {
    const n_ = names.filter((x) => x === n).length;
    if (n_ > 1) problems.push(`asked for ${n} ${n_} times`);
  }

  for (const [tool, wanted] of Object.entries(expect.args ?? {})) {
    const got = firstOf(tool);
    if (!got) { problems.push(`no ${tool} call to check arguments on`); continue; }
    for (const [k, v] of Object.entries(wanted)) {
      if (!argMatches(v, got[k])) problems.push(`${tool}.${k}=${JSON.stringify(got[k]) ?? "missing"} (wanted ${v})`);
    }
  }

  if (expect.finishes && hitCap) problems.push(`hit the ${iterations}-turn cap instead of finishing`);
  if (expect.maxTurns && iterations > expect.maxTurns) {
    problems.push(`took ${iterations} turns, budget was ${expect.maxTurns}`);
  }

  // The dangerous failure: claiming work that did not happen.
  const said = outputs.map((o) => o.text ?? "").join(" ").toLowerCase();
  for (const phrase of expect.saysNothingOf ?? []) {
    if (said.includes(String(phrase).toLowerCase())) problems.push(`claimed "${phrase}" after the tool failed`);
  }

  return problems;
}

export const agentSuite = {
  key: "agent",
  title: "Agent loop",
  purpose:
    "Put the model in the real task loop with tools that answer back — does it finish the job? " +
    "Routing checks one decision; this checks the whole run: acting on what a lookup returned, " +
    "not doing the work twice, reporting a failure instead of inventing success, and stopping.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  // Multi-turn, so a case is several calls rather than one.
  estimatedCalls: DATA.cases.reduce((n, c) => n + Math.min(c.expect?.maxTurns ?? 4, 4), 0),
  cases: DATA.cases.map((c) => ({
    key: c.key,
    name: c.name,
    async run({ model, userId }) {
      const tools = getToolsForTaskType(c.taskType ?? "general");
      const toolDefs = tools.map((t) => ({
        type: "function",
        function: { name: t.definition.name, description: t.definition.description, parameters: t.definition.input_schema },
      }));

      const calls = [];
      const res = await runAgentLoop({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(AGENT, COURSE) },
          { role: "user",   content: `Task: ${c.title}\n\n${c.description}` },
        ],
        toolDefs,
        // The one seam. Nothing here touches the database, sends a
        // notification, or spends a coin.
        callTool: async (name, args) => {
          calls.push({ name, args });
          return stubResult(name, args, c.stubs?.[name]);
        },
        // Half the production cap: a case that needs ten turns has already
        // failed its budget, and paying for twenty proves nothing further.
        maxIterations: 10,
        maxTokens: 1200,
        meta: { __feature: "eval", __userId: userId, __payer: "platform" },
      });

      const problems = judge(c.expect ?? {}, res);
      const trace = res.calls.map((x) => x.name).join(" → ") || "no tools";

      return {
        passed: problems.length === 0,
        expected: describe(c.expect ?? {}),
        actual: `${trace} · ${res.iterations} turn${res.iterations === 1 ? "" : "s"}${res.hitCap ? " · hit cap" : ""}`,
        detail: problems.length ? problems.join("; ") : "completed as asked",
      };
    },
  })),
};

/** The golden, in one line, so a failure reads without opening the JSON. */
function describe(e) {
  const bits = [];
  if (e.mustCall?.length)    bits.push(e.mustCall.join(" + "));
  if (e.mustNotCall?.length) bits.push(`no ${e.mustNotCall.join("/")}`);
  if (e.once?.length)        bits.push(`${e.once.join("/")} once`);
  if (e.maxTurns)            bits.push(`≤${e.maxTurns} turns`);
  return bits.join(", ") || "finishes";
}
