// Every module that calls assertQueueCapacity imports it. Three didn't (since
// Sept 29): scheduling a chat follow-up always failed with a ReferenceError,
// and a task's autonomy check-in was silently never queued.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const files = ["../modules/admin/evals.js", "../modules/adaptive-learning/learner/learner-autonomy.js", "../modules/adaptive-learning/chat/chat-follow-ups.js"];
test("assertQueueCapacity is imported wherever it is called", async () => {
  for (const f of files) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    if (src.includes("assertQueueCapacity(")) assert.match(src, /import \{[^}]*assertQueueCapacity[^}]*\} from "[^"]*queueGuard\.js"/, f);
  }
});
