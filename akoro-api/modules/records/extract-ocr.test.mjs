import assert from "node:assert/strict";
import test from "node:test";
import { parseOcrPage } from "./extractOcr.js";

test("full-width layout tokens become blocks with 0-1000 boxes", () => {
  // The API's real spelling: ｜ref｜ … ｜/ref｜ ｜box｜ [[x,y,x,y]] ｜/box｜ content
  const page = "<｜ref｜>sub_title<｜/ref｜><｜box｜>[[95,65,598,113]]<｜/box｜> # Photosynthesis\n"
    + "<｜ref｜>text<｜/ref｜><｜box｜>[[95,113,465,140]]<｜/box｜> Body line here";
  const out = parseOcrPage(page);
  assert.deepEqual(out.blocks, [
    { bbox_2d: [95, 65, 598, 113], text_content: "# Photosynthesis" },
    { bbox_2d: [95, 113, 465, 140], text_content: "Body line here" },
  ]);
  assert.equal(out.markdown, "# Photosynthesis\n\nBody line here");
});

test("ASCII tokens parse the same way", () => {
  const out = parseOcrPage("<|ref|>text<|/ref|><|box|>[[1,2,3,4]]<|/box|> Hello");
  assert.deepEqual(out.blocks, [{ bbox_2d: [1, 2, 3, 4], text_content: "Hello" }]);
});

test("a label with no content falls back to the label text", () => {
  const out = parseOcrPage("<|ref|>Heading<|/ref|><|box|>[[0,0,10,10]]<|/box|>");
  assert.equal(out.blocks[0].text_content, "Heading");
});

test("plain text (Word/PPT without images) becomes one unboxed block", () => {
  const out = parseOcrPage("Just text\nsecond line");
  assert.deepEqual(out.blocks, [{ bbox_2d: null, text_content: "Just text\nsecond line" }]);
  assert.equal(out.markdown, "Just text\nsecond line");
});
