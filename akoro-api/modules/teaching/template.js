/**
 * The teaching-tool RESULT TEMPLATE — one structure for every tool.
 *
 * Before this, each tool answered in its own shape (cards of blocks, flashcards,
 * a transcript, a list of grades), so each had its own renderer and its own
 * look. Every tool now returns the same thing:
 *
 *   {
 *     version: 2,
 *     tool, title, summary,
 *     meta:       { subject, class, topic }              // filled by the server from the request
 *     highlights: [{ label, value }]                     // up to 4 quick facts ("Period" "40 minutes")
 *     entries: [{                                        // the cards
 *       title, tag?, layout?: "stack" | "split" | "compact",
 *       sections: [ Section ]
 *     }]
 *   }
 *
 *   Section (a labelled block inside an entry):
 *     { kind: "text",   label?, tone?, body }                          a paragraph, **bold** allowed
 *     { kind: "list",   label?, tone?, ordered?, items: [string] }     bullets, or numbered steps
 *     { kind: "chips",  label?, tone?, items: [string] }               short tags (materials, careers)
 *     { kind: "fields", label?, items: [{ label, value }] }            "Expected outcome: …"
 *     { kind: "script", label?, turns: [{ speaker, text }] }           a dialogue (the podcast)
 *     { kind: "scores", label?, items: [{ criterion, score, outOf, comment }] }   a mark breakdown
 *
 *   tone: danger | success | info | idea | accent | warn | teal | neutral — the colour of the label.
 *   Left out, it is chosen from the label ("Clarification" → success).
 *
 * The model produces this (TEMPLATE_RULE is its shape card); normalizeResult()
 * makes whatever came back safe to render; toMarkdown() and toLegacy() derive the
 * readable text and the older per-tool shapes (the school portal's copy of the
 * workbench still reads those); fromLegacy() lifts results saved before this
 * template into it, so old Library items look like new ones.
 */

export const TONES = ["danger", "success", "info", "idea", "accent", "warn", "teal", "neutral"];
export const LAYOUTS = ["stack", "split", "compact"];
export const SECTION_KINDS = ["text", "list", "chips", "fields", "script", "scores"];

const MAX = { entries: 40, sections: 14, items: 40, highlights: 4, turns: 80, text: 2400, label: 80, title: 200 };

/* The shape card every tool's prompt carries. */
export const TEMPLATE_RULE = `Return ONLY valid JSON in this template — no markdown fences, no commentary:
{"title":string,"summary":string,"highlights":[{"label":string,"value":string}],"entries":[{"title":string,"tag":string,"layout":"stack"|"split"|"compact","sections":[SECTION]}]}
SECTION is exactly one of:
{"kind":"text","label":string,"tone":TONE,"body":string}
{"kind":"list","label":string,"tone":TONE,"ordered":boolean,"items":[string]}
{"kind":"chips","label":string,"tone":TONE,"items":[string]}
{"kind":"fields","items":[{"label":string,"value":string}]}
{"kind":"script","turns":[{"speaker":string,"text":string}]}
{"kind":"scores","items":[{"criterion":string,"score":number,"outOf":number,"comment":string}]}
TONE is one of danger, success, info, idea, accent, warn, teal, neutral.
"title" is a specific heading for this result (the topic, not the tool's name). "summary" is one sentence. "highlights" is 0-4 quick facts (e.g. {"label":"Period","value":"40 minutes"}). "tag" is a short label such as "Hook 2" (or "" for none). "layout" is "stack" by default, "split" to put a text section beside a chips section, "compact" for small term-style cards.
Write **bold** around key terms inside text and list items. Keep each paragraph under 70 words and each numbered step under 45 words — entries are read at a glance, not studied. For numbered steps use "ordered":true and end a step with its time in brackets, e.g. "Ask the question (2 min)". Leave out any section or field you have nothing real to put in.`;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const str = (v, max = MAX.text) => String(v ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);
const strs = (v, max = MAX.items) => (Array.isArray(v) ? v : []).map((x) => str(typeof x === "object" && x ? x.text ?? x.value ?? "" : x, 400)).filter(Boolean).slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* A label the model chose freely still gets a sensible colour. */
const TONE_BY_LABEL = [
  [/misconception|watch for|struggle|warning|mistake/i, "danger"],
  [/clarification|correct|truth|strength|good looks like|answer/i, "success"],
  [/why|because|reason|context|connection|overview/i, "info"],
  [/fix|strateg|tip|support|extension|bridge|memory|idea/i, "idea"],
  [/profession|career|job|differentiation/i, "accent"],
  [/example|activity|try this|application|materials|timing|time|homework/i, "warn"],
  [/step|implementation|process|how to/i, "accent"],
  [/objective|outcome|goal|by the end|question|check|score|mark/i, "teal"],
];
export const toneFor = (label) => TONE_BY_LABEL.find(([re]) => re.test(label || ""))?.[1] || "neutral";

/* ── normalizeResult ─────────────────────────────────────────────────────── */

function section(raw) {
  if (!raw || typeof raw !== "object") return null;
  // The model sometimes names the kind by its content key (older blocks did).
  const kind = SECTION_KINDS.includes(raw.kind) ? raw.kind
    : Array.isArray(raw.turns) ? "script"
    : Array.isArray(raw.chips) ? "chips"
    : Array.isArray(raw.bullets) ? "list"
    : Array.isArray(raw.items) && raw.items.some((x) => x && typeof x === "object" && "criterion" in x) ? "scores"
    : Array.isArray(raw.items) && raw.items.some((x) => x && typeof x === "object" && "value" in x) ? "fields"
    : Array.isArray(raw.items) ? "list"
    : "text";
  const label = str(raw.label, MAX.label);
  const base = { kind, ...(label ? { label } : {}) };
  const tone = TONES.includes(raw.tone) ? raw.tone : (kind === "script" || kind === "scores" || kind === "fields") ? undefined : toneFor(label);
  const withTone = (o) => (tone ? { ...o, tone } : o);

  if (kind === "text") {
    const body = str(raw.body ?? raw.text);
    return body ? withTone({ ...base, body }) : null;
  }
  if (kind === "list") {
    const items = strs(raw.items ?? raw.bullets);
    return items.length ? withTone({ ...base, ...(raw.ordered ? { ordered: true } : {}), items }) : null;
  }
  if (kind === "chips") {
    const items = strs(raw.items ?? raw.chips);
    return items.length ? withTone({ ...base, items }) : null;
  }
  if (kind === "fields") {
    const src = raw.items ?? (raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? Object.entries(raw.fields).map(([label, value]) => ({ label, value })) : []);
    const items = (Array.isArray(src) ? src : []).map((f) => ({ label: str(f?.label, MAX.label), value: str(f?.value, 800) })).filter((f) => f.label && f.value).slice(0, MAX.items);
    return items.length ? { ...base, items } : null;
  }
  if (kind === "script") {
    const turns = (Array.isArray(raw.turns) ? raw.turns : []).map((t) => ({ speaker: str(t?.speaker, 60) || "Speaker", text: str(t?.text, 800) })).filter((t) => t.text).slice(0, MAX.turns);
    return turns.length ? { ...base, turns } : null;
  }
  if (kind === "scores") {
    const items = (Array.isArray(raw.items) ? raw.items : []).map((s) => {
      const score = num(s?.score), outOf = num(s?.outOf);
      return { criterion: str(s?.criterion, MAX.label), score, outOf, comment: str(s?.comment, 500) };
    }).filter((s) => s.criterion && s.score !== null).slice(0, MAX.items);
    return items.length ? { ...base, items } : null;
  }
  return null;
}

function entry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map(section).filter(Boolean).slice(0, MAX.sections);
  if (!sections.length) return null;
  const tag = str(raw.tag, 40);
  return {
    title: str(raw.title ?? raw.heading, MAX.title),
    ...(tag ? { tag } : {}),
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : "stack",
    sections,
  };
}

/**
 * Make any model answer (or a legacy saved shape) a valid v2 result.
 * @param raw   parsed JSON
 * @param ctx   { tool: { key, name, output }, input: { subject, class, topic } }
 */
export function normalizeResult(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return { version: 2, tool: ctx.tool?.key || "", title: "", summary: "", meta: {}, highlights: [], entries: [] };
  const v2 = Array.isArray(raw.entries) ? raw : fromLegacy(raw, ctx.tool?.output);
  const input = ctx.input || {};
  const meta = {
    ...(str(input.subject || v2.meta?.subject || raw.subject, 80) ? { subject: str(input.subject || v2.meta?.subject || raw.subject, 80) } : {}),
    ...(str(input.class || v2.meta?.class || raw.class, 60) ? { class: str(input.class || v2.meta?.class || raw.class, 60) } : {}),
    ...(str(input.topic || v2.meta?.topic || raw.topic, 160) ? { topic: str(input.topic || v2.meta?.topic || raw.topic, 160) } : {}),
  };
  return {
    version: 2,
    tool: ctx.tool?.key || str(v2.tool, 40),
    title: str(v2.title, MAX.title) || str(input.topic, MAX.title) || ctx.tool?.name || "",
    summary: str(v2.summary ?? v2.subtitle, 400),
    meta,
    highlights: (Array.isArray(v2.highlights) ? v2.highlights : []).map((h) => ({ label: str(h?.label, 40), value: str(h?.value, 60) })).filter((h) => h.label && h.value).slice(0, MAX.highlights),
    entries: (Array.isArray(v2.entries) ? v2.entries : []).map(entry).filter(Boolean).slice(0, MAX.entries),
  };
}

/* ── Legacy → template (results saved before the template) ───────────────── */

export function fromLegacy(d, output) {
  if (Array.isArray(d.turns)) {   // podcast
    return { title: d.title, summary: d.summary, entries: [{ title: "Transcript", layout: "stack", sections: [{ kind: "script", turns: d.turns }] }] };
  }
  if (Array.isArray(d.grades)) {  // essay grader
    return {
      title: d.title || "Essay grades",
      entries: d.grades.map((g) => ({
        title: g.label, tag: Number.isFinite(Number(g.score)) ? `${g.score}/${g.outOf ?? "?"}` : "",
        sections: [
          { kind: "scores", label: "Mark breakdown", items: g.breakdown || [] },
          { kind: "list", label: "Strengths", tone: "success", items: g.strengths || [] },
          { kind: "list", label: "To improve", tone: "warn", items: g.improvements || [] },
          { kind: "text", label: "Feedback to the student", tone: "info", body: g.feedback },
        ],
      })),
    };
  }
  const cards = Array.isArray(d.cards) ? d.cards : [];
  if (cards.length && cards[0] && "term" in cards[0]) {   // vocabulary
    return {
      title: d.title, summary: d.summary,
      highlights: [{ label: "Terms", value: String(cards.length) }],
      entries: cards.map((c) => ({
        title: c.term, layout: "compact",
        sections: [
          { kind: "text", label: "Definition", body: c.definition },
          { kind: "text", label: "Example", tone: "neutral", body: c.example },
          { kind: "text", label: "Memory tip", tone: "idea", body: c.tip },
        ],
      })),
    };
  }
  // doc: cards of labelled blocks
  return {
    title: d.title, summary: d.subtitle,
    entries: cards.map((c) => ({
      title: c.heading,
      sections: (c.blocks || []).map((b) => (Array.isArray(b.chips) && b.chips.length ? { kind: "chips", label: b.label, items: b.chips }
        : Array.isArray(b.bullets) && b.bullets.length ? { kind: "list", label: b.label, items: b.bullets }
        : { kind: "text", label: b.label, body: b.text })),
    })),
  };
}

/* ── Template → readable markdown (copy, print, "send to chat") ──────────── */

export function toMarkdown(r) {
  const out = [];
  if (r.title) out.push(`# ${r.title}`);
  if (r.summary) out.push(r.summary);
  const meta = [r.meta?.subject, r.meta?.class].filter(Boolean).join(" · ");
  if (meta) out.push(`*${meta}*`);
  if (r.highlights?.length) out.push(r.highlights.map((h) => `- **${h.label}:** ${h.value}`).join("\n"));
  for (const e of r.entries || []) {
    out.push(`## ${e.title}${e.tag ? ` (${e.tag})` : ""}`);
    for (const s of e.sections) {
      const lab = s.label ? `**${s.label}**\n` : "";
      if (s.kind === "text") out.push(`${lab}${s.body}`);
      else if (s.kind === "list") out.push(`${lab}${s.items.map((x, i) => (s.ordered ? `${i + 1}. ${x}` : `- ${x}`)).join("\n")}`);
      else if (s.kind === "chips") out.push(`${s.label ? `**${s.label}:** ` : ""}${s.items.join(" · ")}`);
      else if (s.kind === "fields") out.push(s.items.map((f) => `**${f.label}:** ${f.value}`).join("\n"));
      else if (s.kind === "script") out.push(s.turns.map((t) => `**${t.speaker}:** ${t.text}`).join("\n\n"));
      else if (s.kind === "scores") out.push(`${lab}${s.items.map((x) => `- ${x.criterion}: ${x.score}/${x.outOf ?? "?"}${x.comment ? ` — ${x.comment}` : ""}`).join("\n")}`);
    }
  }
  return out.join("\n\n");
}

/* ── Template → the older per-tool shapes (the school portal still reads them) ── */

const stepText = (s) => s;
export function toLegacy(r, output) {
  const entries = r.entries || [];
  if (output === "script") {
    return { title: r.title, summary: r.summary, turns: entries.flatMap((e) => e.sections.filter((s) => s.kind === "script").flatMap((s) => s.turns)) };
  }
  if (output === "grades") {
    return {
      title: r.title,
      grades: entries.map((e) => {
        const sc = e.sections.find((s) => s.kind === "scores");
        const items = sc?.items || [];
        return {
          label: e.title,
          score: items.reduce((a, x) => a + (x.score || 0), 0),
          outOf: items.reduce((a, x) => a + (x.outOf || 0), 0),
          breakdown: items,
          strengths: e.sections.find((s) => /strength/i.test(s.label || ""))?.items || [],
          improvements: e.sections.find((s) => /improv/i.test(s.label || ""))?.items || [],
          feedback: e.sections.find((s) => /feedback/i.test(s.label || ""))?.body || "",
        };
      }),
    };
  }
  if (output === "cards") {
    const text = (e, re) => e.sections.find((s) => s.kind === "text" && re.test(s.label || ""))?.body || "";
    return {
      title: r.title,
      cards: entries.map((e) => ({
        term: e.title,
        definition: text(e, /definition|meaning/i) || e.sections.find((s) => s.kind === "text")?.body || "",
        example: text(e, /example/i), tip: text(e, /tip|memory/i),
      })),
    };
  }
  // doc
  return {
    title: r.title, subtitle: r.summary,
    cards: entries.map((e) => ({
      heading: e.title,
      blocks: e.sections.flatMap((s) => {
        if (s.kind === "text") return [{ label: s.label || "", text: s.body }];
        if (s.kind === "list") return [{ label: s.label || "", bullets: s.items.map(stepText) }];
        if (s.kind === "chips") return [{ label: s.label || "", chips: s.items }];
        if (s.kind === "fields") return [{ label: s.label || "Details", bullets: s.items.map((f) => `**${f.label}:** ${f.value}`) }];
        return [];
      }),
    })),
  };
}
