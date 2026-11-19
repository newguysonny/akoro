/*
 * agent-uploads.contract.test.mjs — the agent-driven upload pipeline
 * (Matt, 2026-11-16): the chat-upload process as tools the agent calls
 * itself, grouped in their own "uploads" area. Upload + extraction stay
 * in the composer; the agent reads the extraction state, reads the
 * content from the database, retries a failed extraction, looks at the
 * folders, and files from its own decision. The server posts nothing.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
const turnPrepare = readFileSync(new URL("./chat/turn-prepare.js", import.meta.url), "utf8");
const network = readFileSync(new URL("./chat/handlers-network-study.js", import.meta.url), "utf8");
const toolCatalogue = readFileSync(new URL("./chat/tool-catalogue-rest.js", import.meta.url), "utf8");
const tools = readFileSync(new URL("../materials/uploadTools.js", import.meta.url), "utf8");
const examples = readFileSync(new URL("../agent-capabilities/examples.js", import.meta.url), "utf8");
const selection = readFileSync(new URL("./toolSelection.js", import.meta.url), "utf8");

test("the four upload tools are defined and executed", () => {
  for (const name of ["read_upload", "retry_extraction", "list_folders", "file_upload"]) {
    assert.match(toolCatalogue, new RegExp(`name: "${name}"`), `${name} is defined`);
    assert.match(network, new RegExp(`async ${name}\\(input`), `${name} is executed`);
  }
  assert.match(tools, /export async function readUploadTool/);
  assert.match(tools, /export async function retryExtractionTool/);
  assert.match(tools, /export async function listFoldersTool/);
  assert.match(tools, /export async function fileUploadTool/);
});

test("the tools form their own area, with keywords", () => {
  assert.match(examples, /uploads: "Uploads from chat"/);
  for (const name of ["read_upload", "retry_extraction", "list_folders", "file_upload"]) {
    assert.match(examples, new RegExp(`${name}: e\\("uploads"`), `${name} is in the uploads area`);
  }
  assert.match(selection, /uploads: \["uploaded", "attach", "attached", "attachment", "extraction", "extract", "filing", "filed"\]/);
});

test("read_upload: state first, a bounded wait, the content from the database", () => {
  assert.match(tools, /const WAIT_MS = 45_000/, "it waits for a running extraction, briefly");
  assert.match(tools, /state: "extracting"/, "still running is a state the agent can report");
  assert.match(tools, /state: "failed"/, "failed is a state the agent can retry from");
  assert.match(tools, /const TEXT_CAP = 12_000/, "the content carries the old injection's cap");
  assert.match(tools, /Call retry_extraction for this upload/, "a failed read names the next tool");
});

test("file_upload files only what was read, once, through the shared filing", () => {
  assert.match(tools, /state: "not_read"/, "no filing before the read");
  assert.match(tools, /state: "already_filed"/, "a filed upload is not filed twice");
  assert.match(tools, /fileIngestFromDecision\(\{ userId, row: row0/, "the mechanics are filingDb's, shared with /structure");
  assert.match(tools, /docKind === "past_paper"/, "past papers keep their question harvest");
});

test("retry_extraction: the server lane inline, scans flagged for the app", () => {
  assert.match(tools, /extractStoredText\(\{ userId, contentKey: record\.file_key/, "text kinds re-extract on the server");
  assert.match(tools, /clientReread: true/, "scans and photos are re-read by the app's lane");
  assert.match(tools, /move\(row, "extracting"\)/, "a failed upload re-enters extracting");
});

test("filingDb exports everything its importers name (the 2026-11-16 deploy crash)", () => {
  // routes.js imported `withFiling` from filingDb.js, but the extraction
  // left it unexported (an arrow const, missed by the function pass) — the
  // API crashed at boot and the deploy never flipped. Pin every named
  // import from filingDb against its real exports.
  const filingDb = readFileSync(new URL("../materials/filingDb.js", import.meta.url), "utf8");
  const exported = new Set([...filingDb.matchAll(/export (?:async function|function|const) (\w+)/g)].map((m) => m[1]));
  const routes = readFileSync(new URL("../materials/routes.js", import.meta.url), "utf8");
  const imported = [...routes.matchAll(/import \{([^}]+)\} from "\.\/filingDb\.js"/g)]
    .flatMap((m) => m[1].split(",").map((n) => n.trim().split(" as ")[0]).filter(Boolean));
  assert.ok(imported.length >= 10, "routes imports the filing machinery");
  assert.deepEqual(imported.filter((n) => !exported.has(n)), [], "every named import is exported");
  for (const name of ["readUploadTool", "retryExtractionTool", "listFoldersTool", "fileUploadTool"]) {
    assert.ok(new RegExp(`export async function ${name}`).test(tools), `${name} is exported for chat.js`);
  }
});

test("the turn: waiting uploads are listed, the first call is forced, nothing is injected", () => {
  assert.match(turnPrepare, /const pendingUploadsP = /, "the session's unfiled uploads join the turn's own");
  assert.match(turnPrepare, /pendingUploads\.length \? "read_upload"/, "read_upload is forced when uploads wait");
  assert.doesNotMatch(turnPrepare, /ingestRecordsContext/, "no extracted-text injection remains");
});

test("the upload tools carry their own trace display — the turn tells the file story", () => {
  const trace = readFileSync(new URL("./chat/chat-trace.js", import.meta.url), "utf8");
  for (const [name, headline] of [["read_upload", "Reading your file"], ["retry_extraction", "Re-reading your file"], ["list_folders", "Checking your folders"], ["file_upload", "Filing your file"]]) {
    assert.match(trace, new RegExp(`${name}:\\s+\\{[^}]*headline: "${headline}"`), `${name} has its own headline, not the fallback`);
  }
  assert.match(trace, /toolResult\.state === "filed"/, "a filing's change row comes from its state");
  assert.match(trace, /chatToolResultLine\(tool, toolResult\)/, "result lines are per-tool, so a read says Read, not a count");
});
