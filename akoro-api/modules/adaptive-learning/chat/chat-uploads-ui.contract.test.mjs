/*
 * chat-uploads-ui.contract.test.mjs — the learner chat's upload rendering
 * (2026-11-16, from Matt's live screenshots): a sent file's tile must leave
 * the composer when the send commits (not when the reply lands), and one
 * upload renders its steps + card under ONE message even though both the
 * turn's reply and the server's "filed" post carry the ingest id. The
 * server's completion post is idempotent against client retries.
 */
import "../../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tab = readFileSync(new URL("../../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../materials/routes.js", import.meta.url), "utf8");
const filingDb = readFileSync(new URL("../../materials/filingDb.js", import.meta.url), "utf8");

test("sent tiles leave the composer at send-commit, before the turn runs", () => {
  const commit = tab.indexOf("their tiles leave the\n    // box NOW, as the send commits");
  const payload = tab.indexOf("const payload");
  assert.ok(commit > 0, "the send-commit removal is present");
  assert.ok(payload === -1 || commit < payload + 4000, "removal sits with the send path, not the end of the routine");
  // …and the end-of-turn block no longer filters attachments (only revokes URLs).
  assert.equal(tab.match(/setAttachments\(\(prev\) => prev\.filter\(\(a\) => !sentIds\.has\(a\.id\)\)\)/g)?.length, 1,
    "exactly one attachment filter remains — the send-commit one");
});

test("one upload, one card: the first carrier message claims the ingest", () => {
  assert.match(tab, /const ingestClaims = /);
  assert.match(tab, /ingestClaims\.get\(msg\.id\)\|\|\[\]/);
  // neither render spot reads the raw per-message ingest ids any more
  assert.equal(tab.match(/msg\.ingestIds\|\|\(msg\.ingestId\?\[msg\.ingestId\]:\[\]\)\)\.some/g)?.length ?? 0, 0);
});

test("there is no completion post any more — the agent narrates its own filing", () => {
  assert.equal((routes + filingDb).match(/from\("chat_messages"\)\.insert/g)?.length ?? 0, 0, "zero server posts");
  assert.doesNotMatch(tab, /postStructure|structureIngest/, "the client never drives a structure call or posts its result");
  assert.match(tab, /const pollTurnIngests = /, "the card's state is polled while the agent's tools work");
  assert.match(tab, /Read my upload again/, "Read it again is an agent turn now");
});
