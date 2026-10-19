import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scrubInternalIds } from "./reply-scrub.js";

const chat = await readFile(new URL("./chat.js", import.meta.url), "utf8");

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
  assert.match(chat, /reply = scrubInternalIds\(reply\);\n\s*if \(!reply\.trim\(\)\)/);
});
