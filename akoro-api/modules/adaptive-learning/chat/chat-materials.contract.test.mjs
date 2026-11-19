import assert from "node:assert/strict";
import test from "node:test";
import { materialsFrom } from "./chat-materials.js";

/* The study_output card: title, href and sub are shaped here from the tool
   result — never from the model's prose. A platform-tier build (Discover
   free notes copied into the learner's Library) carries its provenance in
   the sub, because the agent's reply text proved it will not say it. */

const HREF = "/library?record=702f38c5-0153-4891-a837-e4eac1db2870&artifact=4a6e79a3-5174-49ec-b9be-e4058bfb8a43";

test("own-Library build: the sub is the count, exactly as before", () => {
  const [m] = materialsFrom("make_study_material", { made: true, tool: "quiz", name: "Cell notes.pdf", count: 5, href: HREF });
  assert.equal(m.kind, "study_output");
  assert.equal(m.title, "Quiz · Cell notes.pdf");
  assert.equal(m.sub, "5 questions");
  assert.equal(m.href, HREF);
});

test("platform build: the card names Discover and the owner", () => {
  const [m] = materialsFrom("make_study_material", {
    made: true, tool: "quiz", name: "Properties of Matter - Class Notes", count: 5, href: HREF,
    source: "platform", sourceName: "Properties of Matter - Class Notes", sourceOwner: "Adaeze",
  });
  assert.equal(m.sub, "5 questions · from Adaeze's free notes in Discover");
});

test("platform build without an owner name: still names Discover", () => {
  const [m] = materialsFrom("make_study_material", {
    made: true, tool: "flashcards", name: "Notes", count: 8, href: HREF, source: "platform", sourceOwner: null,
  });
  assert.equal(m.sub, "8 cards · from free notes in Discover");
});

test("platform podcast: being-made line plus provenance", () => {
  const [m] = materialsFrom("make_study_material", {
    made: true, tool: "podcast", name: "Notes", href: HREF, source: "platform", sourceOwner: "Adaeze",
  });
  assert.equal(m.sub, "Being made — ready in a minute or two · from Adaeze's free notes in Discover");
});

test("deduped platform build: provenance still shows (it is the same card)", () => {
  const [m] = materialsFrom("make_study_material", {
    made: true, deduped: true, tool: "summary", name: "Notes", count: 6, href: HREF, source: "platform", sourceOwner: "Adaeze",
  });
  assert.equal(m.sub, "6 points · from Adaeze's free notes in Discover");
});

test("a choice is not a build: no provenance, no sub", () => {
  const out = materialsFrom("make_study_material", {
    needsChoice: true, tool: "quiz",
    records: [{ recordId: "a", name: "Algebra notes.pdf", ownerName: "Adaeze" }],
  });
  assert.equal(out[0].kind, "choice");
  assert.equal(out[0].sub, undefined);
});
