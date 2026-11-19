// lib/evals/learnerTools.js
//
// The learner's Agent Chat: for each of its tools, a learner-style request —
// does the agent call the right tool with the right arguments, and (for
// read-only tools) does that tool actually run for a real learner?
//
// What it checks, case by case:
//   1. CHOICE  the model, offered exactly the learner tool catalogue the chat
//              offers (getLearnerChatTools), calls the expected tool.
//   2. ARGS    the arguments the request plainly gave are there and right.
//   3. RUN     read-only tools only ("run": true in the goldens): the tool is
//              executed for the TEST LEARNER chosen on the Evals page and must
//              come back without an error. Tools that change things —
//              challenges, messages, tasks, blogs, goals — are never executed.
//
// A tool switched off on this server (a feature flag) is skipped and says so;
// it is not in the catalogue, so there is nothing to choose.
//
// Goldens: data/learner-tools.json (data, not code — add a case without a deploy).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openai } from "../aiModel.js";
import { argMatches } from "./match.js";

const DATA  = JSON.parse(readFileSync(fileURLToPath(new URL("./data/learner-tools.json", import.meta.url)), "utf8"));
const CASES = DATA.cases;

// chat.js is large; load it on the first case, not when the registry loads.
let chatModule = null;
const chat = async () => (chatModule ||= await import("../../modules/adaptive-learning/index.js"));

const SYSTEM =
  "You are a learner's personal study agent on Akoro (a learning app for Nigerian secondary-school students). " +
  "Call exactly one tool to carry out what the learner asks. Use only what they actually said — never invent " +
  "names, ids or details they did not give. Pass ids, usernames and numbers exactly as the learner wrote them.";

export const learnerToolsSuite = {
  key: "learner-tools",
  title: "Learner chat tools",
  purpose:
    "One learner request per Agent Chat tool: does the agent pick the right tool with the right arguments — " +
    "and do the read-only tools actually run for the test learner? Tools that change things are checked for " +
    "the choice only, never executed.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  estimatedCalls: CASES.length,
  costFactor: 2,   // ~10k tokens of tool catalogue in every call
  // The page asks for a test learner: read-only tools run as them.
  needsLearner: true,
  cases: CASES.map((c, i) => ({
    key: `learner-tool-${i + 1}`,
    name: `${c.tool} — ${c.text.length > 48 ? c.text.slice(0, 45) + "…" : c.text}`,
    async run({ model, userId, options = {} }) {
      const { getLearnerChatTools, executeChatTool } = await chat();
      const catalogue = getLearnerChatTools();
      if (!catalogue.some((t) => t.name === c.tool)) {
        return { passed: true, expected: c.tool, actual: "skipped", detail: "Switched off on this server (feature flag) — not offered to learners, so nothing to test." };
      }
      const tools = catalogue.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

      const resp = await openai.chat.completions.create({
        model, max_tokens: 500, temperature: 0,
        __feature: "eval", __userId: userId, __payer: "platform",
        tools, tool_choice: "required",
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: c.text }],
      });

      const call = resp.choices?.[0]?.message?.tool_calls?.[0];
      const chosen = call?.function?.name ?? null;
      if (chosen !== c.tool) {
        return { passed: false, expected: c.tool, actual: chosen ?? "no tool called",
          detail: chosen ? `called ${chosen} instead` : "answered with prose instead of calling a tool" };
      }

      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); }
      catch { return { passed: false, expected: c.tool, actual: chosen, detail: "arguments were not valid JSON" }; }

      const wrong = Object.entries(c.args ?? {})
        .filter(([k, v]) => !argMatches(v, args[k] ?? null))
        .map(([k, v]) => `${k}=${JSON.stringify(args[k]) ?? "missing"} (wanted ${JSON.stringify(v)})`);
      const expected = `${c.tool}(${Object.keys(c.args ?? {}).join(", ")})`;
      const actual = `${chosen}(${Object.keys(args).join(", ")})`;
      if (wrong.length) return { passed: false, expected, actual, detail: wrong.join("; ") };

      // Read-only tools: actually run it for the test learner.
      if (!c.run) return { passed: true, expected, actual, detail: "right tool, right arguments (changes data — choice checked, not executed)" };
      if (!options.learnerId) return { passed: true, expected, actual, detail: "right tool, right arguments (not executed — no test learner chosen)" };
      let out;
      try { out = await executeChatTool(c.tool, args, options.learnerId, { role: "student", channel: "eval" }); }
      catch (e) { return { passed: false, expected, actual, detail: `ran, but threw: ${String(e?.message || e).slice(0, 240)}` }; }
      if (out && typeof out === "object" && (out.error || out.success === false)) {
        return { passed: false, expected, actual, detail: `ran, but returned an error: ${String(out.error || out.message || "failed").slice(0, 240)}` };
      }
      const shape = out && typeof out === "object" ? Object.keys(out).slice(0, 6).join(", ") : typeof out;
      return { passed: true, expected, actual, detail: `right tool, ran for ${options.learnerName || "the test learner"} → {${shape}}${out?.needsClarification ? " (asked a clarifying question)" : ""}` };
    },
  })),
};
