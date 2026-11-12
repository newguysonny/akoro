import test from "node:test";
import assert from "node:assert/strict";
import { userFacingMessage } from "./userFacingError.js";

test("database text never reaches the user", () => {
  const fallback = "We couldn't complete that request. Please check the details and try again.";
  assert.equal(userFacingMessage("Invalid schema: vouchers"), fallback);
  assert.equal(userFacingMessage("duplicate key value violates unique constraint users_email_key"), "That record already exists.");
  assert.equal(userFacingMessage("insert or update on table \"tasks\" violates foreign key constraint"), "That item is still in use, so it can't be removed yet.");
  assert.equal(userFacingMessage("invalid input syntax for type uuid: \"x\""), "One of those details isn't valid. Please check and try again.");
  assert.equal(userFacingMessage("new row violates row-level security policy"), "You don't have access to that.");
});

test("human validation messages pass through", () => {
  assert.equal(userFacingMessage("Password must be at least 8 characters"), "Password must be at least 8 characters");
  assert.equal(userFacingMessage("Code required"), "Code required");
  assert.equal(userFacingMessage(""), "We couldn't complete that request. Please check the details and try again.");
});

test("the global JSON guard is mounted before the routers", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /res\.json = \(body\) =>/);
  assert.match(app, /userFacingMessage\(clean\[key\], fallback\)/);
  assert.ok(app.indexOf("res.json = (body)") < app.indexOf('app.use("/api"'));
});
