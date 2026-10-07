// lib/messageModel.contract.test.mjs
//
// Contract tests for the billing Messages pure model (plan §4.6 Phase 4).
// The strings are prototype-exact — reference/Admin-Tiers & Credits
// prototype page.md (openMessage/sendMessage/applyMsgTemplate) is the
// source of truth; if these fail, the admin modal's toasts and the
// server's 400 messages have drifted apart.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_LABELS, AUDIENCE_LABELS, CUSTOMER_TEMPLATES, SCHOOL_TEMPLATES,
  fillTemplate, validateMessage, subjectVisible,
} from "./messageModel.js";

/* ── labels ─────────────────────────────────────────────────────────────── */

test("channel and audience labels are prototype-exact", () => {
  assert.deepEqual(CHANNEL_LABELS, { email: "Email", sms: "SMS", inapp: "In-app notice" });
  assert.deepEqual(AUDIENCE_LABELS, {
    admins: "School administrators", instructors: "Instructors",
    students: "Students", all: "Everyone at the school",
  });
});

test("template lists match the prototype's two contexts", () => {
  assert.deepEqual(CUSTOMER_TEMPLATES, [["payment", "Payment reminder"], ["trial", "Trial ending"], ["general", "General note"]]);
  assert.deepEqual(SCHOOL_TEMPLATES, [["pilot-end", "Pilot ending"], ["cap", "Credit usage update"], ["general", "General note"]]);
});

/* ── templates + fill ───────────────────────────────────────────────────── */

test("fillTemplate fills every placeholder and leaves nothing behind", () => {
  const t = fillTemplate("payment", { parent: "Mrs. Bello", learner: "Ada" });
  assert.equal(t.subject, "Payment reminder for Ada");
  assert.equal(t.body, "Hi Mrs. Bello, we could not process the latest payment for Ada's Akoro plan. Please update your payment details so learning is not interrupted. Thank you.");
  assert.ok(!t.subject.includes("{") && !t.body.includes("{"), "no unfilled placeholders");
});

test("fillTemplate covers school templates ({school}/{end}) and returns null for unknown", () => {
  const t = fillTemplate("pilot-end", { school: "Greenfield Academy", end: "2026-10-15" });
  assert.equal(t.subject, "The Akoro pilot for Greenfield Academy ends on 2026-10-15");
  assert.ok(t.body.startsWith("Hello from Akoro. The pilot for Greenfield Academy ends on 2026-10-15."));
  assert.equal(fillTemplate("nope"), null);
});

/* ── validation ─────────────────────────────────────────────────────────── */

test("email needs a subject; SMS does not (prototype rules)", () => {
  const email = validateMessage({ kind: "customer", channel: "email", subject: "", body: "Hi", target: { email: "a@b.co" } });
  assert.deepEqual(email.errors.map((e) => e.message), ["Add a subject"]);

  const sms = validateMessage({ kind: "customer", channel: "sms", subject: "", body: "Hi", target: { phone: "+234..." } });
  assert.equal(sms.errors.length, 0);
  assert.equal(subjectVisible("sms"), false);
  assert.equal(subjectVisible("email"), true);
});

test("an empty body is always rejected with the prototype message", () => {
  for (const channel of ["email", "sms", "inapp"]) {
    const r = validateMessage({ kind: "customer", channel, subject: "S", body: "  ", target: { email: "a@b.co", phone: "+234..." } });
    assert.deepEqual(r.errors.map((e) => e.message), ["Write a message first"], channel);
  }
});

test("customer messages need the contact detail the channel requires", () => {
  const noEmail = validateMessage({ kind: "customer", channel: "email", subject: "S", body: "B", target: { email: "" } });
  assert.deepEqual(noEmail.errors.map((e) => e.message), ["No email on file"]);

  const noPhone = validateMessage({ kind: "customer", channel: "sms", body: "B", target: {} });
  assert.deepEqual(noPhone.errors.map((e) => e.message), ["No phone number on file"]);
});

test("school messages: admins/all email and admins SMS need the admin contact", () => {
  const base = { kind: "school", subject: "S", body: "B", target: {} };
  assert.deepEqual(validateMessage({ ...base, channel: "email", audience: "admins" }).errors.map((e) => e.message), ["No admin contact email on file"]);
  assert.deepEqual(validateMessage({ ...base, channel: "email", audience: "all" }).errors.map((e) => e.message), ["No admin contact email on file"]);
  assert.deepEqual(validateMessage({ ...base, channel: "sms", audience: "admins" }).errors.map((e) => e.message), ["No admin contact phone on file"]);
  // instructors/students email goes to the linked platform users — accepted,
  // resolution honestly reported at delivery.
  assert.equal(validateMessage({ ...base, channel: "email", audience: "instructors" }).errors.length, 0);
  // admin contact present → valid.
  assert.equal(validateMessage({ ...base, channel: "email", audience: "admins", target: { adminEmail: "x@y.co" } }).errors.length, 0);
});

test("school messages require a valid audience; unknown channels are rejected", () => {
  const noAudience = validateMessage({ kind: "school", channel: "email", audience: null, subject: "S", body: "B", target: { adminEmail: "x@y.co" } });
  assert.ok(noAudience.errors.some((e) => e.field === "audience"));

  const badChannel = validateMessage({ kind: "customer", channel: "pigeon", subject: "S", body: "B", target: {} });
  assert.ok(badChannel.errors.some((e) => e.field === "channel"));
});
