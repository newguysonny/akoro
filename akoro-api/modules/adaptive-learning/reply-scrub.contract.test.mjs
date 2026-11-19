import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ensureNotTaughtOpener, promisedTeachTopic, scrubInternalIds } from "./reply-scrub.js";

const chat = await readFile(new URL("./chat/turn-answer.js", import.meta.url), "utf8");

test("internal ids the model saw in tool results never reach the learner", () => {
  assert.equal(scrubInternalIds("Done! I'll message you here in 10 minutes (request req_1c3838ef)."), "Done! I'll message you here in 10 minutes.");
  assert.equal(scrubInternalIds("Scheduled — request id req_1c3838ef. See you soon."), "Scheduled. See you soon.");
  assert.equal(scrubInternalIds("Yes, you have notes:\n\n- **Title:** Mitochondria notes\n- **Record ID:** `77d17a49-7615-411e-a07c-595a9479b16d`\n\nWould you like to view them?"),
    "Yes, you have notes:\n\n- **Title:** Mitochondria notes\n\nWould you like to view them?");
  assert.equal(scrubInternalIds("Your record 77d17a49-7615-411e-a07c-595a9479b16d is saved."), "Your record is saved.");
  const plain = "Osmosis is the movement of water, e.g. in root_hair cells — see page 3.";
  assert.equal(scrubInternalIds(plain), plain, "ordinary text is untouched");
});

test("wired into every Agent Chat reply before it is shown or saved", () => {
  assert.match(chat, /reply = scrubInternalIds\(stripToolCallMarkup\(stripDsmlMarkup\(reply\)\)\);\n\s*if \(!stopped\(\)\) reply = ensureNotTaughtOpener\(reply, prepared\.toolExecutions\);\n[\s\S]{0,1500}?\n\s*if \(!reply\.trim\(\)\)/);
});

test("Teach me given: the reply opens by saying it wasn't taught, unless it already does", () => {
  const asked = [{ tool: "ask_to_be_taught", success: true, input: { topic: "Photosynthesis", subject: "Basic Science" }, result: { asked: true, topic: "Photosynthesis" } }];
  assert.equal(ensureNotTaughtOpener("The **Teach me** button is below.", asked), "You haven't taught me Photosynthesis yet!\n\nThe **Teach me** button is below.");
  const already = "You haven't taught me photosynthesis yet! Tap Teach me.";
  assert.equal(ensureNotTaughtOpener(already, asked), already);
  assert.equal(ensureNotTaughtOpener("I wasn't taught that one yet — tap Teach me.", asked), "I wasn't taught that one yet — tap Teach me.");
  assert.equal(ensureNotTaughtOpener("Here are your tasks.", [{ tool: "list_tasks", success: true }]), "Here are your tasks.");
  assert.equal(ensureNotTaughtOpener("x", [{ tool: "ask_to_be_taught", success: false, input: { topic: "Osmosis" } }]), "x");
});

test("a reply that promises Teach me without calling the tool gets the button for the topic it named", () => {
  assert.equal(promisedTeachTopic("You haven't taught me about photosynthesis yet — so I can't.\n- **Teach me first** — tap the Teach me button below."), "photosynthesis");
  assert.equal(promisedTeachTopic("You haven't taught me the Krebs cycle yet. Tap the Teach me button."), "Krebs cycle");
  assert.equal(promisedTeachTopic("You haven't taught me photosynthesis yet!"), null, "no button promised");
  assert.equal(promisedTeachTopic("Tap the Teach me button for osmosis."), null, "no topic it said it wasn't taught");
  assert.equal(promisedTeachTopic("You haven't taught me this yet — tap the Teach me button."), null, "no named topic");
  assert.match(chat, /promisedTeachTopic\(reply\)[\s\S]{0,400}tool: "ask_to_be_taught", success: true, backfilled: true/);
});
