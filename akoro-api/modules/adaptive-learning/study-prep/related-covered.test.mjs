import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { relatedCoveredFrom } = await import("./read-tools.js");

const edges = [
  { before: "plant-cells", after: "photosynthesis", beforeLabel: "Plant cells" },
  { before: "the-cell", after: "plant-cells", beforeLabel: "The cell" },
  { before: "energy", after: "photosynthesis", beforeLabel: "Energy" },
];

test("before photosynthesis: covered prerequisites and topics sharing its ideas, prerequisites first", () => {
  const r = relatedCoveredFrom({ topic: "Photosynthesis", edges, covered: [
    { label: "Plant cells", mastery: 0.85 }, { label: "The cell", mastery: 0.3 }, { label: "Photosynthesis in algae", mastery: 0.6 }, { label: "Fractions", mastery: 0.9 },
  ] });
  assert.deepEqual(r.related.map((x) => [x.topic, x.relation, x.held]), [
    ["Plant cells", "prerequisite", "well"], ["The cell", "prerequisite", "weakly"], ["Photosynthesis in algae", "shares_ideas", "partly"],
  ]);
  assert.deepEqual(r.prerequisitesNotCovered, ["Energy"], "an uncovered prerequisite is named");
  assert.match(r.next, /one step lower/);
  assert.ok(!r.related.some((x) => x.topic === "Fractions"), "unrelated topics stay out");
});

test("nothing related: start from the basics; all held well: build on the strongest", () => {
  assert.match(relatedCoveredFrom({ topic: "Photosynthesis", covered: [], edges: [] }).next, /basics/);
  assert.match(relatedCoveredFrom({ topic: "Photosynthesis", covered: [{ label: "Plant cells", mastery: 0.9 }], edges: [edges[0]] }).next, /Build on/);
});

test("wiring: a planning read, in the tool list, and the planner is told to use it", async () => {
  const [wiring, registry, doc] = await Promise.all([
    readFile(new URL("./wiring.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/registry.js", import.meta.url), "utf8"),
    readFile(new URL("../../../akoro-agent/reasoning/PLANNING.md", import.meta.url), "utf8"),
  ]);
  assert.match(wiring, /"concept\.get_prerequisites", "topic\.related_covered"\]/);
  assert.match(registry, /name: "topic\.related_covered", level: "read"/);
  assert.match(doc, /topic\.related_covered lists them/);
});
