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
import { UI_COMPONENTS } from "./uiCatalogue.js";

// Code is the hardest stage (and the rarest): a stronger model writes it.

const COMMON = `You build ONE small data tool for a learner or an instructor on Akoro, as JSON DATA.
Rules:
- Use ONLY the views and capabilities listed below, and only their listed fields.
- Every view is already limited to the caller's own data (a learner's own rows, or an instructor's own classes and activities) or published content — never add an owner filter.
- Filter ops: eq neq lt lte gt gte in contains startsWith isNull notNull within ("30d","12h","6m","1y") year (a year number or "this") month ("2026-03" or "this").
- Never hard-code dates: "this year" is {"op":"year","value":"this"} (or "$year" from a param), "this month" is {"op":"month","value":"this"}.
- Never hard-code a value that picks out ONE specific row (a title or name taken from the goal) in a filter. That row's identity belongs in a param: filter with "$paramName" (e.g. {"field":"title","op":"eq","value":"$title"}). If no declared param holds it, still use a $param named for the field — it will be declared for you. A tool that hard-codes one row's name can never be reused for another row.
- Use only the steps you need; every step must be used by a from or join.
- compute: { as, fn, a, b } with fn divide|multiply|add|subtract|round|percent|minutesBetween|daysBetween; a/b are field names or numbers (never nested — chain computes: first minutesBetween as "minutes", then divide "minutes" by 60).
- Declared params you don't need can be ignored; never filter on a param just because it exists.
- In a group, count:true gives "count" (every row). To count only rows that HAVE a value — e.g. graded students — use counts:["grade"], which gives "count_grade". avg/sum/min/max already ignore missing values.
- group: { by: [field | {field, bucket: day|week|month|year}] (ALWAYS a list), count, counts:[fields], sum:[fields], avg:[fields], min:[fields], max:[fields], percentOf:[{field, is, as}] } → output fields: the by-fields (a bucketed one is named <field>_<bucket>, e.g. started_at_month), count, count_<f>, sum_<f>, avg_<f>, min_<f>, max_<f>, and per percentOf entry <as>, <as>_count, <as>_total.
- PERCENTAGES OF ROWS: for any "what percentage / share of <rows> are <condition>" goal, use ONE group with percentOf — the interpreter counts the matching rows and all the rows itself, so the part and the whole can never be mixed up. by: [] gives one overall figure. NEVER assemble a row percentage from two separate counts, from a group-by-the-condition-field (each group comes out 100% of itself), or from a per-row percent compute. compute fn "percent" is ONLY for a ratio of two numeric fields on the SAME row (e.g. a score out of its total marks). Do not put a where filter for the condition on the same step — percentOf does the matching; a step filter is for OTHER conditions (e.g. this year).
- sort: { by, dir: asc|desc }. limit ≤ 100. Use "$paramName" to use a declared param.
- Also give 2 realistic sample inputs ("samples": [ {…}, {…} ]) matching the params.
- A recipe or spec can only filter, compute per row, group, sort and join rows that EXIST. If the goal asks to make something new from them — a plan or schedule over dates, spreading items across days, "N per day", "skip Sundays", rules that depend on earlier choices — a recipe/spec can't do it: answer {"notExpressible": "needs scheduling logic"} rather than returning the rows unchanged.
- If it truly can't be built from what's listed, answer {"notExpressible": "<why, one sentence>"}. Every view holds only THIS learner's own rows: if the goal needs other learners' data and nothing listed holds it, that is notExpressible — never present the learner's own numbers as other people's.
Answer with ONE JSON object only.`;

const SPEC_FORMAT = `Format (a SPEC — one view):
{"definition": {"kind":"spec","from":"<view>","where":[{"field","op","value"}],"compute":[…],"group":{…},"sort":[{"by","dir"}],"limit":20,"select":[…]}, "samples":[{…},{…}]}
Example — past-question accuracy per subject this year:
{"definition":{"kind":"spec","from":"my_past_questions","where":[{"field":"created_at","op":"within","value":"1y"}],"group":{"by":["subject"],"sum":["attempted","correct"]},"compute":[],"sort":[{"by":"sum_attempted","dir":"desc"}]},"samples":[{},{}]}
Example — what percentage of my goals are completed (for goals, "completed" is status "achieved"):
{"definition":{"kind":"spec","from":"my_goals","group":{"by":[],"count":true,"percentOf":[{"field":"status","is":"achieved","as":"completed_pct"}]},"select":["completed_pct_count","count","completed_pct"]},"samples":[{},{}]}
Example — per group, how many rows HAVE a value vs all rows (e.g. graded vs assigned):
{"definition":{"kind":"spec","from":"<view>","group":{"by":["<label field>"],"count":true,"counts":["<value field>"],"avg":["<value field>"]},"select":["<label field>","count","count_<value field>","avg_<value field>"]},"samples":[{},{}]}`;

const RECIPE_FORMAT = `Format (a RECIPE — up to 4 steps, then ops):
{"definition":{"kind":"recipe","steps":[{"id":"a","view":"<view>","where":[…]},{"id":"b","cap":"<capability>","args":{…},"rows":"<path to the list in its result>"}],
 "then":[{"op":"from","ref":"a"},{"op":"join","right":"b","on":["subject"],"type":"inner"},{"op":"compute",…},{"op":"group",…},{"op":"filter","where":[…]},{"op":"sort",…},{"op":"limit","n":20},{"op":"pick","fields":[…]}]}, "samples":[{…},{…}]}
Example — weak topics in subjects where past-question accuracy is under $maxAccuracy:
{"definition":{"kind":"recipe","steps":[{"id":"weak","view":"my_weak_topics","where":[{"field":"confidence","op":"lt","value":0.5}]},{"id":"pq","view":"my_past_questions"}],
 "then":[{"op":"from","ref":"pq"},{"op":"group","by":["subject"],"sum":["attempted","correct"]},{"op":"compute","as":"accuracy","fn":"divide","a":"sum_correct","b":"sum_attempted"},{"op":"filter","where":[{"field":"accuracy","op":"lt","value":"$maxAccuracy"}]},{"op":"save","as":"acc"},
 {"op":"from","ref":"weak"},{"op":"join","right":"acc","on":["subject"]},{"op":"sort","by":"confidence","dir":"asc"},{"op":"pick","fields":["subject","topic","confidence","accuracy"]}]},"samples":[{"maxAccuracy":0.6},{"maxAccuracy":0.9}]}
Changing data (only when "writes" are listed and the goal asks to DO something, e.g. "mark my overdue tasks done"): end the recipe with {"op":"write","cap":"<write name>"} on rows still from its onRowsOf view (filter/sort/limit/pick them — never group). A write that lists "args" needs them: {"op":"write","cap":"<write name>","args":{…}} — the value the goal gives (a new due date, a priority); use "$paramName" if the learner should choose it each time. It changes NOTHING when the tool runs: the learner is shown exactly those rows and confirms. Pick the rows precisely (filter by the goal's conditions — when the goal names one specific row and a param carries its title/name, select by that param, never by the literal name); a write never touches rows the filter didn't keep.
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

/**
 * The UI catalogue, generated from uiCatalogue.js so the builder prompt,
 * akoro_inspect and the client renderer can never drift apart. A
 * presentation is DATA (components + bindings), never code.
 */
const UI_SECTION = `UI — the tool's tab (OPTIONAL for spec/recipe/code, REQUIRED for mode):
Add "presentation": {"v":1,"slot":"tool.tab","body":[ …components ]} — the screen the learner sees in this tool's own tab, rendered from the tool's data.
A string starting with $ binds to data: $state.<key> (a mode tool's state), $rows (a data tool's result rows), $tool.label, $params.<name>. In a list's "item" map, title/sub name FIELDS of each item, not $ paths.
Components:
${Object.entries(UI_COMPONENTS).map(([t, c]) => `- ${t}: ${c.does} Props: ${JSON.stringify(c.props)}`).join("\n")}
Keep it small (≤ 8 components): a hero or a title line, the 2–4 facts that matter, one list, one cta. Bind only state keys / row fields that exist in YOUR definition — an unresolvable binding fails the build's UI check and the presentation is dropped.`;

const MODE_FORMAT = `Format (a MODE — an interactive session or protocol the learner runs WITH the agent in chat; it answers nothing from rows):
{"definition": {"kind":"mode","steer":"…","state":{…},"actions":[…]}, "presentation": {…}, "samples":[{…},{…}]}
- steer: the behaviour contract the agent follows while this mode is live, second person ("You are…"), ≤ 4000 chars. Say exactly what the agent does step by step, what it must NEVER do, and when it calls each action. The steer is the whole protocol — write it so a careful agent could run the session from it alone.
- state: the tool's initial state document (small JSON) — everything its tab shows and its actions move: a phase field, coverage/checklist items (objects with a "title" and a "state" field: todo|partial|done, or hidden for not-yet-revealed items), counters, logs (arrays). A value may reference a declared param as "$paramName" (filled from the run's values when the session first starts). Content the session TEACHES is authored by you into the state (key points, each with a short "content" field) — a mode tool never reads files or views, so if the points aren't in the state, the session has nothing to teach from.
- actions (≤ 10): the named steps the agent calls to move the state. Each: {"name": snake_case, "description": "when the agent calls this", "params": {"p": {"type": "string|number|integer|boolean|array|object", "required": true?}}, "effects": […]}. Effects apply to the state in order and are the ONLY way state changes:
  {"op":"set","path":"phase","value":…} · {"op":"inc","path":"sessions","by":1} · {"op":"append","path":"questions","value":{"text":"$question","open":true}} · {"op":"mark","path":"coverage","matchField":"title","matchFrom":"title","set":{"state":"done"}} (update list items whose matchField equals the named param) · {"op":"flip","path":"keyPoints","field":"state","from":"hidden","to":"missed"} (change a field on every list item holding "from").
  Effect values may use "$paramName", "$today", "$now". A path's first segment must be a state key.
- samples: 2 example run inputs (values for the declared params, e.g. the topic the learner named).
Example — a teach-your-protégé session over a topic the learner names:
{"definition":{"kind":"mode","steer":"You are Ako, the learner's eager protégé. The learner teaches YOU the topic in $topic… (the full protocol: restate each explanation in your own words, ask a question whenever a step is unclear or has no example, call mark_covered only after a definition AND an example, log every question you ask).","state":{"topic":"$topic","phase":"teaching","coverage":[{"title":"Core idea","state":"todo"},{"title":"Worked example","state":"todo"}],"questions":[]},"actions":[{"name":"mark_covered","description":"Call when the learner has covered one coverage item (definition and example heard).","params":{"title":{"type":"string","required":true}},"effects":[{"op":"mark","path":"coverage","matchField":"title","matchFrom":"title","set":{"state":"done"}}]},{"name":"log_question","description":"Call every time you ask the learner a question.","params":{"question":{"type":"string","required":true}},"effects":[{"op":"append","path":"questions","value":{"text":"$question","open":true}}]}]},"presentation":{"v":1,"slot":"tool.tab","body":[{"type":"hero","title":"$state.topic","sub":"You are teaching Ako"},{"type":"list","title":"Coverage","items":"$state.coverage","item":{"title":"title","stateField":"state"}},{"type":"list","title":"Ako's questions","items":"$state.questions","item":{"title":"text"}},{"type":"cta","label":"Continue teaching","message":"Let's continue my teaching session."}]},"samples":[{"topic":"Newton's laws"},{"topic":"Photosynthesis"}]}`;

const FORMATS = { spec: SPEC_FORMAT, recipe: RECIPE_FORMAT, code: CODE_FORMAT, mode: MODE_FORMAT };

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
    ...(writeNames.length ? { writes: writeNames.map((n) => ({ name: n, does: CAPABILITIES[n].description, onRowsOf: CAPABILITIES[n].target,
      ...(CAPABILITIES[n].args ? { args: Object.fromEntries(Object.entries(CAPABILITIES[n].args).map(([k, t]) => [k, Array.isArray(t) ? `one of ${t.join(" | ")}` : 'YYYY-MM-DD | "today" | "tomorrow" | "+3d" | a weekday like "monday"'])) } : {}) })) } : {}),
  };
}

/**
 * Ask for a definition in `stage` ("recipe" | "spec"). `feedback` carries the
 * previous attempt's validation/verification errors for one repair.
 * → { definition?, samples?, notExpressible?, raw }
 */
export async function buildDefinition({ stage, goal, params, slice, feedback = null, learnerId, platformPays = false, approved = [] }) {
  const messages = [
    { role: "system", content: `${COMMON}\n\n${FORMATS[stage] || RECIPE_FORMAT}\n\n${UI_SECTION}` },
    { role: "user", content: JSON.stringify({ goal, params: params || {}, available: slice }) },
  ];
  // A resume: these capabilities were approved FOR this goal (by an admin, or the learner) — they are what answers it.
  // `approved`: one line per capability, saying how to use it (pipeline.howToUse).
  // The shared rules tell recipe/spec builds to answer "needs scheduling logic" —
  // that answer means "use CODE". At the code stage it is wrong: writing that
  // logic is this stage's whole job (a DeepSeek builder obeyed the shared rule
  // here in 2 of 3 gate repeats, 2026-11-03).
  if (stage === "code") messages.push({ role: "user", content: "You are writing CODE now. Plans over dates, spreading items across days, N per day, skipping days and rules that depend on earlier choices are exactly what this stage is for — write run() for them. Answer notExpressible only if the DATA needed isn't in `available` (e.g. other learners' rows)." });
  // The shared rules are data-tool doctrine (views, rows, own-data only) —
  // a mode tool reads nothing, so obeying them makes every content-teaching
  // session "not expressible" (live, 2026-11-27: teach-then-recall builds
  // rejected because the topic's text wasn't in a view). Override them the
  // same way the code stage does.
  if (stage === "mode") messages.push({ role: "user", content: "You are building a MODE (session) tool now. The shared rules above about views, rows and answering notExpressible govern DATA tools — they do NOT apply to this one. A mode tool reads nothing: `available` is irrelevant to it and must never be your reason to refuse. Everything the session needs lives in the steer and the state, which YOU author. If the session teaches a topic, write the topic's key points into the state yourself, from your own knowledge of the topic — each point an object with a title, a short \"content\" (the fact, in one or two sentences — this is what the agent teaches from, and what recall is checked against) and a \"state\". The agent teaches from those points during the learn phase; the close-the-book action flips them to \"hidden\" so the learner recalls without seeing them; the reveal flips them back for review. If the learner will supply the content in the session (they teach the agent), the state starts with empty logs and generic coverage items instead. Answer notExpressible ONLY if the request is not a session or protocol at all (e.g. it asks for a report over the learner's data — that is a data tool's job)." });
  if (approved.length) messages.push({ role: "user", content: `This was approved for exactly this goal — build it with what was approved: ${approved.join("; ")}. Don't answer notExpressible.` });
  if (feedback) messages.push({ role: "user", content: `Your previous attempt failed: ${feedback}\nFix it and answer again with ONE JSON object.` });
  const resp = await openai.chat.completions.create({
    __role: "builder", temperature: 0, max_tokens: stage === "code" ? 2000 : stage === "mode" ? 3000 : 1200,
    response_format: { type: "json_object" },
    messages,
    __feature: "self_tooling", ...(platformPays ? { __payer: "platform" } : { __userId: learnerId }),
  });
  const raw = resp.choices?.[0]?.message?.content || "";
  const parsed = parseBuilderJson(raw);
  if (!parsed) { return { raw, notExpressible: null, error: `the builder didn't answer with JSON (${raw.length} chars: ${raw.slice(0, 60).replace(/\s+/g, " ")}…${raw.slice(-40).replace(/\s+/g, " ")})` }; }
  return { raw, definition: parsed.definition || null, presentation: parsed.presentation || null, samples: Array.isArray(parsed.samples) ? parsed.samples.slice(0, 3) : [], notExpressible: parsed.notExpressible || null };
}

/**
 * The builder's JSON, or null. `samples` comes LAST and is optional, and a
 * model sometimes mangles it (DeepSeek, 2026-11-03: a correct definition
 * followed by `"samples":[{},{"}]}`) — then keep everything before it rather
 * than throwing away a good build. The definition is still fully validated
 * and verified after this, so nothing unchecked gets through.
 */
export function parseBuilderJson(raw) {
  const text = String(raw || "").trim();
  try { return JSON.parse(text); } catch { /* try the salvage below */ }
  const cut = text.lastIndexOf(',"samples"');
  if (cut > 0) {
    try { return JSON.parse(text.slice(0, cut) + "}"); } catch { /* not salvageable */ }
  }
  return null;
}
