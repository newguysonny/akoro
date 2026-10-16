/**
 * modules/self-tooling/builder.js — the tool builder (plan §7.4, decision S3).
 *
 * A separate model call with a FIXED prompt, given only the registry slice
 * schema_lookup found for the goal. It proposes a definition in one stage's
 * format plus sample inputs; code then validates and verifies it. Its output
 * is never trusted or executed as code.
 */
import { openai } from "../../lib/aiModel.js";
import { DATA_VIEWS, describeView, audienceOf } from "./views.js";
import { CAPABILITIES, capAudience } from "./capabilities.js";

export const BUILDER_MODEL = () => process.env.AKORO_SELF_TOOLING_MODEL || "gpt-4.1-mini";
// Code is the hardest stage (and the rarest): a stronger model writes it.
export const CODE_MODEL = () => process.env.AKORO_SELF_TOOLING_CODE_MODEL || "gpt-4.1";

const COMMON = `You build ONE small data tool for a learner or an instructor on Akoro, as JSON DATA.
Rules:
- Use ONLY the views and capabilities listed below, and only their listed fields.
- Every view is already limited to the caller's own data (a learner's own rows, or an instructor's own classes and activities) or published content — never add an owner filter.
- Filter ops: eq neq lt lte gt gte in contains startsWith isNull notNull within ("30d","12h","6m","1y") year (a year number or "this") month ("2026-03" or "this").
- Never hard-code dates: "this year" is {"op":"year","value":"this"} (or "$year" from a param), "this month" is {"op":"month","value":"this"}.
- Use only the steps you need; every step must be used by a from or join.
- compute: { as, fn, a, b } with fn divide|multiply|add|subtract|round|percent|minutesBetween|daysBetween; a/b are field names or numbers (never nested — chain computes: first minutesBetween as "minutes", then divide "minutes" by 60).
- Declared params you don't need can be ignored; never filter on a param just because it exists.
- In a group, count:true gives "count" (every row). To count only rows that HAVE a value — e.g. graded students — use counts:["grade"], which gives "count_grade". avg/sum/min/max already ignore missing values.
- group: { by: [field | {field, bucket: day|week|month|year}] (ALWAYS a list), count, counts:[fields], sum:[fields], avg:[fields], min:[fields], max:[fields] } → output fields: the by-fields (a bucketed one is named <field>_<bucket>, e.g. started_at_month), count, count_<f>, sum_<f>, avg_<f>, min_<f>, max_<f>.
- sort: { by, dir: asc|desc }. limit ≤ 100. Use "$paramName" to use a declared param.
- Also give 2 realistic sample inputs ("samples": [ {…}, {…} ]) matching the params.
- A recipe or spec can only filter, compute per row, group, sort and join rows that EXIST. If the goal asks to make something new from them — a plan or schedule over dates, spreading items across days, "N per day", "skip Sundays", rules that depend on earlier choices — a recipe/spec can't do it: answer {"notExpressible": "needs scheduling logic"} rather than returning the rows unchanged.
- If it truly can't be built from what's listed, answer {"notExpressible": "<why, one sentence>"}. Every view holds only THIS learner's own rows: if the goal needs other learners' data and nothing listed holds it, that is notExpressible — never present the learner's own numbers as other people's.
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
Changing data (only when "writes" are listed and the goal asks to DO something, e.g. "mark my overdue tasks done"): end the recipe with {"op":"write","cap":"<write name>"} on rows still from its onRowsOf view (filter/sort/limit/pick them — never group). It changes NOTHING when the tool runs: the learner is shown exactly those rows and confirms. Pick the rows precisely (filter by the goal's conditions); a write never touches rows the filter didn't keep.
How rows flow: "from" makes a step's (or saved table's) rows current; ops change the current rows; "save" names them; "join" joins the current rows with "right".
Capability steps: "rows" is the path to the list inside its result (see "returns", e.g. "bySubject" for "bySubject[].x").`;

const CODE_FORMAT = `Format (CODE — only when a recipe or spec can't express it: scheduling, spreading items over days, multi-step rules):
{"definition":{"kind":"code","steps":[{"id":"weak","view":"my_weak_topics","where":[…]}],"source":"function run(input, data, akoro) { … return rows; }"}, "samples":[{…},{…}]}
- "steps" declare what to read (views/capabilities, as in a recipe). The code gets them as data.<id> (arrays of rows). It CANNOT read anything else and cannot call Akoro.
- input = the declared params; akoro = { today: "YYYY-MM-DD" (Africa/Lagos), now: ISO time, timezone }.
- Plain JavaScript (ES2020) only. NOT allowed: eval, Function, import, require, this, globalThis, prototypes/constructor, async/await, timers, network, template literals with \${…} (join with +). Under 8 KB; must finish fast.
- Return an array of flat objects (the rows the learner sees), at most 100.
- Dates: work FORWARD from akoro.today. An end date ("until my exam on X") is exclusive — nothing on or after it. Compare dates as "YYYY-MM-DD" strings or UTC Date objects; getUTCDay() 0 is Sunday. Put dates the learner gives in params (e.g. $examDate) when the goal allows; otherwise use the date from the goal.
- Sort data yourself inside run() when order matters (steps don't sort).
Example — spread my weakest topics over the days until $examDate, $perDay a day, weakest first, skipping Sundays:
{"definition":{"kind":"code","steps":[{"id":"weak","view":"my_weak_topics"}],"source":"function run(input, data, akoro) {\n  var topics = data.weak.slice().sort(function (a, b) { return a.confidence - b.confidence; });\n  var day = new Date(akoro.today + 'T00:00:00Z'), end = new Date(input.examDate + 'T00:00:00Z'), out = [], i = 0;\n  while (i < topics.length && day < end) {\n    if (day.getUTCDay() !== 0) { for (var k = 0; k < input.perDay && i < topics.length; k++, i++) out.push({ date: day.toISOString().slice(0, 10), subject: topics[i].subject, topic: topics[i].topic }); }\n    day.setUTCDate(day.getUTCDate() + 1);\n  }\n  return out;\n}"},"samples":[{"examDate":"2026-12-01","perDay":2},{"examDate":"2026-11-20","perDay":1}]}`;

const FORMATS = { spec: SPEC_FORMAT, recipe: RECIPE_FORMAT, code: CODE_FORMAT };

/** The registry slice the builder may use: views (with fields) + capabilities (with returns). */
export function registrySlice(lookup, hint = {}, audience = "learner") {
  // Hints can't reach across audiences: an instructor's tool never gets learner views, and vice versa.
  const viewNames = new Set([...(lookup?.views || []).map((v) => v.name), ...[].concat(hint.views || []).filter((v) => v in DATA_VIEWS && audienceOf(DATA_VIEWS[v]) === audience)]);
  const capNames = new Set([...(lookup?.capabilities || []).filter((c) => c.status === "available").map((c) => c.name), ...[].concat(hint.capabilities || []).filter((c) => c in CAPABILITIES && capAudience(CAPABILITIES[c]) === audience)]);
  // Write capabilities the lookup found ON (granted) and that a tool can target (S6).
  const writeNames = [...capNames].filter((n) => CAPABILITIES[n]?.kind === "write" && CAPABILITIES[n].target);
  for (const n of writeNames) viewNames.add(CAPABILITIES[n].target);
  return {
    views: [...viewNames].map((n) => describeView(n, DATA_VIEWS[n])),
    capabilities: [...capNames].filter((n) => CAPABILITIES[n]?.kind === "read").map((n) => ({ name: n, does: CAPABILITIES[n].description, returns: CAPABILITIES[n].returns })),
    ...(writeNames.length ? { writes: writeNames.map((n) => ({ name: n, does: CAPABILITIES[n].description, onRowsOf: CAPABILITIES[n].target })) } : {}),
  };
}

/**
 * Ask for a definition in `stage` ("recipe" | "spec"). `feedback` carries the
 * previous attempt's validation/verification errors for one repair.
 * → { definition?, samples?, notExpressible?, raw }
 */
export async function buildDefinition({ stage, goal, params, slice, feedback = null, learnerId, platformPays = false }) {
  const messages = [
    { role: "system", content: `${COMMON}\n\n${FORMATS[stage] || RECIPE_FORMAT}` },
    { role: "user", content: JSON.stringify({ goal, params: params || {}, available: slice }) },
  ];
  if (feedback) messages.push({ role: "user", content: `Your previous attempt failed: ${feedback}\nFix it and answer again with ONE JSON object.` });
  const resp = await openai.chat.completions.create({
    model: stage === "code" ? CODE_MODEL() : BUILDER_MODEL(), temperature: 0, max_tokens: stage === "code" ? 2000 : 1200,
    response_format: { type: "json_object" },
    messages,
    __feature: "self_tooling", ...(platformPays ? { __payer: "platform" } : { __userId: learnerId }),
  });
  const raw = resp.choices?.[0]?.message?.content || "";
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return { raw, notExpressible: null, error: "the builder didn't answer with JSON" }; }
  return { raw, definition: parsed.definition || null, samples: Array.isArray(parsed.samples) ? parsed.samples.slice(0, 3) : [], notExpressible: parsed.notExpressible || null };
}
