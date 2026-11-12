import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");

test("validation errors are friendly, structured and do not echo values", () => {
  assert.match(src, /code: "validation_failed"/);
  assert.match(src, /return \{ field, message: msg \}/);
  assert.doesNotMatch(src, /errors: errors\.array\(\{ onlyFirstError: true \}\)/, "raw validator objects are not returned");
  assert.match(src, /withMessage\("Enter a valid email address\."\)/);
  assert.match(src, /withMessage\("Password must be at least 8 characters\."\)/);
});
