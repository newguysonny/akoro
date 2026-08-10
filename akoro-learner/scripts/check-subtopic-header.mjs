#!/usr/bin/env node
/**
 * check-subtopic-header.mjs — render the subtopic header and look at it.
 *
 * The ‹ › navigation was written, committed, built and shipped, and then
 * reported as missing. It was in the file the whole time: what was missing was
 * `items` on the block, because the API deploy that would have started sending
 * it had failed on a migration. With no items the header fell back to a single
 * step — so the six-segment progress bar collapsed to one and two dead arrows
 * sat beside it, which looks exactly like a feature that was never built.
 *
 * A build passing proves the file parses. It does not prove anything reaches
 * the screen. This renders the component both ways and checks what comes out.
 *
 *   node scripts/check-subtopic-header.mjs
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import BlockRenderer from "../src/components/sessions/BlockRenderer.jsx";

const fails = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails.push(label);
};

const render = (block) => renderToStaticMarkup(React.createElement(BlockRenderer, { block }));

console.log("\n· A current backend sends the whole ladder");
const full = render({
  type: "subtopic-hdr", topic: "The water cycle", subject: "Basic Science",
  subtopic: "What water is", idx: 0, total: 6,
  items: ["What water is", "What water is made of", "The three states",
          "Evaporation", "Condensation", "The water cycle"],
  map: [{ kind: "foundation", buildsOn: null, whyNow: "Name the substance." },
        { kind: "foundation", buildsOn: 0, whyNow: "x" }, { kind: "mechanism", buildsOn: 1, whyNow: "x" },
        { kind: "mechanism", buildsOn: 2, whyNow: "x" }, { kind: "mechanism", buildsOn: 3, whyNow: "x" },
        { kind: "synthesis", buildsOn: 4, whyNow: "x" }],
});
check("the arrows are rendered", full.includes("Previous objective") && full.includes("Next objective"));
check("one segment per step", (full.match(/aria-label="Objective \d+:/g) || []).length === 6,
  `${(full.match(/aria-label="Objective \d+:/g) || []).length} segments`);
check("the step is named", full.includes("What water is"));
check("its place in the arc is shown", full.includes("Foundation"));
check("and what it unlocks", full.includes("Name the substance."));

console.log("\n· An older backend sends only a position");
const bare = render({ type: "subtopic-hdr", topic: "T", subject: "S", subtopic: "Only one", idx: 2, total: 6 });
// The regression that made this look unbuilt: a six-step bar drawn as one.
check("the progress bar keeps its six segments",
  (bare.match(/aria-label="Step \d+ of \d+"/g) || []).length === 6,
  `${(bare.match(/aria-label="Step \d+ of \d+"/g) || []).length} segments`);
check("no arrows it cannot honour", !bare.includes("Previous objective") && !bare.includes("Next objective"));
check("the current subtopic still reads", bare.includes("Only one"));

console.log("\n· Cards cannot be crushed to a line");
// The blocks list is a flex COLUMN. A flex item whose overflow is anything but
// visible has an automatic minimum size of ZERO, so it can be compressed to
// nothing under vertical pressure — leaving only its border on screen. That is
// what the "drift warning renders as just a red line" report was. Any card that
// clips its own overflow has to opt out of shrinking.
const src = readFileSync("src/components/sessions/BlockRenderer.jsx", "utf8");
const clipping = src.split(/\n/).map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => /overflow:\s*"hidden"/.test(l));
const unguarded = clipping.filter(({ l }) => !/flexShrink:\s*0/.test(l) && !/height:\s*\d/.test(l));
check("every clipping card opts out of flex shrinking",
  unguarded.length === 0,
  unguarded.length ? unguarded.map(u => `line ${u.i}`).join(", ") : `${clipping.length} checked`);

console.log(fails.length ? `\n✗ ${fails.length} failed\n` : "\n✓ subtopic header renders correctly\n");
process.exit(fails.length ? 1 : 0);
