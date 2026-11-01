// lib/evals/routing.js
//
// Given what a teacher types, does the model reach for the right tool?
//
// gp-commands.mjs already asserts that a phrasing lands on the right TASK TYPE
// — but that is keyword matching in extractIntent, no model involved. What
// happens after is the model choosing among the tools that type exposes, and
// nothing has ever checked it. The golden-path README is explicit that its
// stand-in model cannot: it returns a fixed reply regardless of the prompt, so
// "the right tool was called" there means the plumbing worked, not that the
// judgement did.
//
// This is the suite that guards a model swap. Tool selection is exactly the
// capability that degrades first on a cheaper tier, and it degrades quietly —
// a battle created instead of a review looks like a working feature.
//
// The cases are the ones in docs/CHAT-COMMANDS.md, so what is documented and
// what is tested cannot drift apart.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openai } from "../aiModel.js";
import { getToolsForTaskType } from "../../modules/tasks/tools/index.js";
import { extractIntent } from "../../modules/tasks/lib/context.js";
import { argMatches } from "./match.js";

// Goldens live in data/routing.json — data, not code, so a case can be added
// without a deploy and the diff reads as a change of intent. Each case: what a
// teacher types, and the tool that must be chosen. `args` names arguments that
// must be present and correct — a tool call with the right name and the wrong
// class is not a success.
const DATA  = JSON.parse(readFileSync(fileURLToPath(new URL("./data/routing.json", import.meta.url)), "utf8"));
const CASES = DATA.cases;

export const routingSuite = {
  key: "routing",
  title: "Tool routing",
  purpose:
    "Given what a teacher types, does the model call the right tool with the right arguments? " +
    "gp-commands checks the keyword router; this checks the model's judgement after it — the " +
    "capability that degrades first, and most quietly, on a cheaper tier.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  estimatedCalls: CASES.length,
  cases: CASES.map((c, i) => ({
    key: `route-${i + 1}`,
    name: c.text.length > 58 ? c.text.slice(0, 55) + "…" : c.text,
    async run({ model, userId }) {
      // The same tool set the worker would offer for this request, so the
      // model is choosing from exactly what it would see in production.
      const { taskType } = await extractIntent(c.text, "", "instructor");
      const tools = (await getToolsForTaskType(taskType)).map((t) => ({
        type: "function",
        function: { name: t.definition.name, description: t.definition.description, parameters: t.definition.input_schema },
      }));

      const resp = await openai.chat.completions.create({
        model, max_tokens: 700, temperature: 0,   // 0: this is a judgement, not a draft
        __feature: "eval", __userId: userId, __payer: "platform",
        tools,
        // Nudged toward acting, because a model that asks a clarifying question
        // instead of calling a tool is a different (also real) failure, and
        // conflating the two would make the result unreadable.
        tool_choice: "required",
        messages: [
          { role: "system", content: "You are a teaching assistant on Akoro. Call exactly one tool to carry out the teacher's request. Use only what they actually said — do not invent a class, subject or learner they did not name." },
          { role: "user", content: c.text },
        ],
      });

      const call = resp.choices?.[0]?.message?.tool_calls?.[0];
      const chosen = call?.function?.name ?? null;
      if (chosen !== c.tool) {
        return {
          passed: false, expected: c.tool, actual: chosen ?? "no tool called",
          detail: chosen ? `called ${chosen} instead` : "answered with prose instead of calling a tool",
        };
      }

      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); }
      catch { return { passed: false, expected: c.tool, actual: chosen, detail: "arguments were not valid JSON" }; }

      const wrong = Object.entries(c.args ?? {})
        .filter(([k, v]) => !argMatches(v, args[k]))
        .map(([k, v]) => `${k}=${JSON.stringify(args[k]) ?? "missing"} (wanted ${v})`);

      return {
        passed: wrong.length === 0,
        expected: `${c.tool}(${Object.keys(c.args ?? {}).join(", ")})`,
        actual: `${chosen}(${Object.keys(args).join(", ")})`,
        detail: wrong.length ? wrong.join("; ") : "right tool, right arguments",
      };
    },
  })),
};
