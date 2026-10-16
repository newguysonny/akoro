/**
 * modules/self-tooling/builder.js — the tool builder (plan §7.4, decision S3).
 *
 * A separate model call with a FIXED prompt, given only the registry slice
 * schema_lookup found for the goal. It proposes a definition in one stage's
 * format plus sample inputs; code then validates and verifies it. Its output
 * is never trusted or executed as code.
 */
import { openai } from "../../lib/aiModel.js";
import { DATA_VIEWS, describeView } from "./views.js";
import { CAPABILITIES } from "./capabilities.js";

export const BUILDER_MODEL = () => process.env.AKORO_SELF_TOOLING_MODEL || "gpt-4o-mini";

const COMMON = `You build ONE small read-only data tool for a learner on Akoro, as JSON DATA (never code).
Rules:
- Use ONLY the views and capabilities listed below, and only their listed fields.
- Every view is already limited to this learner's own data (or published content) — never add an owner filter.
- Filter ops: eq neq lt lte gt gte in contains startsWith isNull notNull within ("30d","12h","6m","1y") year (a year number or "this") month ("2026-03" or "this").
- Never hard-code dates: "this year" is {"op":"year","value":"this"} (or "$year" from a param), "this month" is {"op":"month","value":"this"}.
- Use only the steps you need; every step must be used by a from or join.
- compute: { as, fn, a, b } with fn divide|multiply|add|subtract|round|percent|minutesBetween|daysBetween; a/b are field names or numbers.
- group: { by: [field | {field, bucket: day|week|month|year}] (ALWAYS a list), count, sum:[fields], avg:[fields], min:[fields], max:[fields] } → output fields: the by-fields (a bucketed one is named <field>_<bucket>, e.g. started_at_month), count, sum_<f>, avg_<f>, min_<f>, max_<f>.
- sort: { by, dir: asc|desc }. limit ≤ 100. Use "$paramName" to use a declared param.
- Also give 2 realistic sample inputs ("samples": [ {…}, {…} ]) matching the params.
- If it truly can't be built from what's listed, answer {"notExpressible": "<why, one sentence>"}.
Answer with ONE JSON object only.`;

const SPEC_FORMAT = `Format (a SPEC — one view):
{"definition": {"kind":"spec","from":"<view>","where":[{"field","op","value"}],"compute":[…],"group":{…},"sort":[{"by","dir"}],"limit":20,"select":[…]}, "samples":[{…},{…}]}
Example — past-question accuracy per subject this year:
{"definition":{"kind":"spec","from":"my_past_questions","where":[{"field":"created_at","op":"within","value":"1y"}],"group":{"by":["subject"],"sum":["attempted","correct"]},"compute":[],"sort":[{"by":"sum_attempted","dir":"desc"}]},"samples":[{},{}]}`;

const RECIPE_FORMAT = `Format (a RECIPE — up to 4 steps, then ops):
{"definition":{"kind":"recipe","steps":[{"id":"a","view":"<view>","where":[…]},{"id":"b","cap":"<capability>","args":{…},"rows":"<path to the list in its result>"}],
 "then":[{"op":"from","ref":"a"},{"op":"join","right":"b","on":["subject"],"type":"inner"},{"op":"compute",…},{"op":"group",…},{"op":"filter","where":[…]},{"op":"sort",…},{"op":"limit","n":20},{"op":"pick","fields":[…]}]}, "samples":[{…},{…}]}
Example — weak topics in subjects where past-question accuracy is under $maxAccuracy:
{"definition":{"kind":"recipe","steps":[{"id":"weak","view":"my_weak_topics","where":[{"field":"confidence","op":"lt","value":0.5}]},{"id":"pq","view":"my_past_questions"}],
 "then":[{"op":"from","ref":"pq"},{"op":"group","by":["subject"],"sum":["attempted","correct"]},{"op":"compute","as":"accuracy","fn":"divide","a":"sum_correct","b":"sum_attempted"},{"op":"filter","where":[{"field":"accuracy","op":"lt","value":"$maxAccuracy"}]},{"op":"save","as":"acc"},
 {"op":"from","ref":"weak"},{"op":"join","right":"acc","on":["subject"]},{"op":"sort","by":"confidence","dir":"asc"},{"op":"pick","fields":["subject","topic","confidence","accuracy"]}]},"samples":[{"maxAccuracy":0.6},{"maxAccuracy":0.9}]}
How rows flow: "from" makes a step's (or saved table's) rows current; ops change the current rows; "save" names them; "join" joins the current rows with "right".
Capability steps: "rows" is the path to the list inside its result (see "returns", e.g. "bySubject" for "bySubject[].x").`;

/** The registry slice the builder may use: views (with fields) + capabilities (with returns). */
export function registrySlice(lookup, hint = {}) {
  const viewNames = new Set([...(lookup?.views || []).map((v) => v.name), ...[].concat(hint.views || []).filter((v) => v in DATA_VIEWS)]);
  const capNames = new Set([...(lookup?.capabilities || []).filter((c) => c.status === "available").map((c) => c.name), ...[].concat(hint.capabilities || []).filter((c) => c in CAPABILITIES)]);
  return {
    views: [...viewNames].map((n) => describeView(n, DATA_VIEWS[n])),
    capabilities: [...capNames].filter((n) => CAPABILITIES[n]?.kind === "read").map((n) => ({ name: n, does: CAPABILITIES[n].description, returns: CAPABILITIES[n].returns })),
  };
}

/**
 * Ask for a definition in `stage` ("recipe" | "spec"). `feedback` carries the
 * previous attempt's validation/verification errors for one repair.
 * → { definition?, samples?, notExpressible?, raw }
 */
export async function buildDefinition({ stage, goal, params, slice, feedback = null, learnerId, platformPays = false }) {
  const messages = [
    { role: "system", content: `${COMMON}\n\n${stage === "spec" ? SPEC_FORMAT : RECIPE_FORMAT}` },
    { role: "user", content: JSON.stringify({ goal, params: params || {}, available: slice }) },
  ];
  if (feedback) messages.push({ role: "user", content: `Your previous attempt failed: ${feedback}\nFix it and answer again with ONE JSON object.` });
  const resp = await openai.chat.completions.create({
    model: BUILDER_MODEL(), temperature: 0, max_tokens: 1200,
    response_format: { type: "json_object" },
    messages,
    __feature: "self_tooling", ...(platformPays ? { __payer: "platform" } : { __userId: learnerId }),
  });
  const raw = resp.choices?.[0]?.message?.content || "";
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return { raw, notExpressible: null, error: "the builder didn't answer with JSON" }; }
  return { raw, definition: parsed.definition || null, samples: Array.isArray(parsed.samples) ? parsed.samples.slice(0, 3) : [], notExpressible: parsed.notExpressible || null };
}
