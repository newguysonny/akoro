// Think mode runs on the Responses API. Before this, `openai.responses.create`
// fell through the metering proxy untouched: reasoning calls — the most
// expensive in Agent Chat — were neither charged nor recorded. These tests
// drive the metered client against a local stand-in for OpenAI.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";

const events = [
  { type: "response.created", response: { id: "resp_1" } },
  { type: "response.reasoning_summary_text.delta", delta: "Check goals first." },
  { type: "response.output_text.delta", delta: "You have " },
  { type: "response.output_text.delta", delta: "three goals." },
  { type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 1000, output_tokens: 2000, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1500 } } } },
];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const params = JSON.parse(body || "{}");
    if (!params.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "resp_2", output: [], output_text: "ok", usage: { input_tokens: 10, output_tokens: 20 } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, resolve));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => server.close());

const { openai, responsesUsageToChat } = await import("./aiModel.js");
const { usdCost } = await import("./aiPricing.js");

// Every model call writes one AI_CALL line to stdout; capture them.
async function captureCalls(fn) {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (text.includes('"AI_CALL"')) { lines.push(JSON.parse(text)); return true; }
    return write(chunk, ...rest);
  };
  try { await fn(); } finally { process.stdout.write = write; }
  return lines;
}

test("Responses usage converts to the priced chat shape (reasoning tokens bill as output)", () => {
  assert.deepEqual(
    responsesUsageToChat({ input_tokens: 1000, output_tokens: 2000, input_tokens_details: { cached_tokens: 200 } }),
    { prompt_tokens: 1000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 200 } },
  );
  assert.equal(responsesUsageToChat(null), null);
});

test("reasoning models are priced at their own rate, not the gpt-4o-mini fallback", () => {
  assert.ok(usdCost("o4-mini", 1_000_000, 0) > usdCost("gpt-4o-mini", 1_000_000, 0));
});

test("a streamed Think call passes every event through and is recorded with its real usage", async () => {
  const seen = [];
  const calls = await captureCalls(async () => {
    const stream = await openai.responses.create({ model: "o4-mini", input: "hi", stream: true });
    for await (const ev of stream) seen.push(ev.type);
  });
  assert.deepEqual(seen, events.map((ev) => ev.type));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "o4-mini");
  assert.equal(calls[0].tokens_in, 1000);
  assert.equal(calls[0].tokens_out, 2000);
  assert.equal(calls[0].streamed, true);
  assert.equal(calls[0].cost_usd, usdCost("o4-mini", 1000, 2000));
});

test("a stopped Think stream is still recorded — an estimate, never free", async () => {
  const calls = await captureCalls(async () => {
    const stream = await openai.responses.create({ model: "o4-mini", input: "hi", stream: true });
    for await (const ev of stream) { if (ev.type === "response.output_text.delta") break; }
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].tokens_out >= 300, "the floor covers hidden reasoning tokens");
});

test("a non-streamed Think call is recorded too", async () => {
  const calls = await captureCalls(async () => {
    const resp = await openai.responses.create({ model: "o4-mini", input: "hi" });
    assert.equal(resp.output_text, "ok");
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tokens_out, 20);
});

test("a payer is charged through the same wallet path as chat completions", async () => {
  const source = await readFile(new URL("./aiModel.js", import.meta.url), "utf8");
  const metered = source.slice(source.indexOf("async function meteredResponses"), source.indexOf("// Metered embeddings"));
  assert.match(metered, /coinsAvailable\(\{ userId, billTo, min: 1 \}\)/);
  assert.match(metered, /throw new InsufficientCoins/);
  assert.match(metered, /chargeForAI\(\{ userId, feature, model, usage, ref, billTo \}\)/);
  assert.match(source, /if \(prop === "responses"\) return \{ create: meteredResponses \};/);
});
