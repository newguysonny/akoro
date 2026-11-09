import assert from "node:assert/strict";
import test from "node:test";
import { assembleResourceDoc, COMPACT_TEMPLATE_RULE } from "./contentScaffold.js";

test("fills kind/tone/layout a content-only draft omits", () => {
  const out = assembleResourceDoc({
    title: "Fractions",
    summary: "One sentence.",
    highlights: [{ label: "Period", value: "40 minutes" }],
    entries: [{
      title: "Common Misconception",
      sections: [
        { label: "Common Misconception", body: "Plants get food from soil." },
        { label: "Fix Strategies", items: ["Weigh soil before and after", "Compare with a control"] },
        { label: "Materials", items: [{ label: "Board", value: "Chalk" }] },
      ],
    }],
  });
  const e = out.entries[0];
  assert.equal(e.layout, "stack", "layout defaulted when omitted");
  assert.deepEqual(e.sections.map((s) => s.kind), ["text", "list", "fields"], "kind inferred from fields");
  assert.equal(e.sections[0].tone, "danger", "tone derived from the label");
});

test("the compact rule instructs the model to omit kind/tone/layout", () => {
  assert.match(COMPACT_TEMPLATE_RULE, /Omit "kind", "tone" and "layout"/);
  assert.match(COMPACT_TEMPLATE_RULE, /"sections":\[SECTION\]/);
});
