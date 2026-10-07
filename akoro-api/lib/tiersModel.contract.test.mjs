/**
 * lib/tiersModel.js contract tests (plan §4.6 Phase 1): tier validation,
 * pricing governance (effective_scope), and the public pilot-application
 * rules from reference/Pilot application.md. The model is pure — no env
 * dummies needed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateTierInput, buildTierPatch, validatePilotApplication } from "./tiersModel.js";

const CURRENT_PREMIUM = {
  id: "t1", platform: "learner", name: "Premium", access: "paid",
  price_monthly: 1500, price_annual: 14400, cap: 1000, student_cap: null,
  instructor_cap: null, duration_days: null, gated_features: [], sort_order: 3,
};

/* ── validateTierInput ─────────────────────────────────────────────────────── */

test("validateTierInput: valid learner paid tier normalizes numbers", () => {
  const { errors, values } = validateTierInput({
    platform: "learner", name: " Family ", access: "paid",
    price_monthly: "1200", price_annual: 14400, cap: "800",
    duration_days: "", gated_features: ["Battles"],
  });
  assert.deepEqual(errors, {});
  assert.equal(values.name, "Family");
  assert.equal(values.price_monthly, 1200);
  assert.equal(values.price_annual, 14400);
  assert.equal(values.cap, 800);
  assert.equal(values.duration_days, null);
  assert.deepEqual(values.gated_features, ["Battles"]);
  assert.equal(values.student_cap, null); // learner rows never carry school caps
});

test("validateTierInput: school tier requires student + instructor caps, zeroes prices", () => {
  const { errors, values } = validateTierInput({
    platform: "school", name: "Pilot", access: "free",
    student_cap: 200, instructor_cap: 400, duration_days: 30,
  });
  assert.deepEqual(errors, {});
  assert.equal(values.student_cap, 200);
  assert.equal(values.instructor_cap, 400);
  assert.equal(values.cap, null);
  assert.equal(values.price_monthly, 0);
  assert.equal(values.price_annual, 0);
});

test("validateTierInput: rejects bad platform, empty name, negative caps, bad duration, non-array gated", () => {
  const bad = validateTierInput({ platform: "teacher", name: "  ", access: "paid", price_monthly: -5, duration_days: 0, gated_features: "Battles" });
  for (const field of ["platform", "name", "price_monthly", "duration_days", "gated_features"]) {
    assert.ok(bad.errors[field], `expected error for ${field}`);
  }
  // platform-specific caps are validated per platform
  assert.ok(validateTierInput({ platform: "learner", name: "X", access: "free", cap: -1 }).errors.cap);
  const missingSchoolCaps = validateTierInput({ platform: "school", name: "X", access: "free" });
  assert.ok(missingSchoolCaps.errors.student_cap);
  assert.ok(missingSchoolCaps.errors.instructor_cap);
});

test("validateTierInput: free access ignores submitted prices", () => {
  const { errors, values } = validateTierInput({ platform: "learner", name: "Free2", access: "free", price_monthly: 999, cap: 10 });
  assert.deepEqual(errors, {});
  assert.equal(values.price_monthly, 0);
  assert.equal(values.price_annual, 0);
});

/* ── buildTierPatch — pricing governance ───────────────────────────────────── */

test("buildTierPatch: price change WITHOUT effective_scope is rejected (plan §1 governance)", () => {
  const { error } = buildTierPatch(CURRENT_PREMIUM, { price_monthly: 2000 });
  assert.ok(error);
  assert.equal(error.code, "effective_scope_required");
});

test("buildTierPatch: price change with effective_scope passes and flags priceChanged", () => {
  const { error, patch, priceChanged, effective_scope } = buildTierPatch(CURRENT_PREMIUM, { price_monthly: 2000, effective_scope: "new_only" });
  assert.ok(!error);
  assert.equal(patch.price_monthly, 2000);
  assert.equal(priceChanged, true);
  assert.equal(effective_scope, "new_only");
});

test("buildTierPatch: non-price changes need no effective_scope", () => {
  const { error, patch, priceChanged } = buildTierPatch(CURRENT_PREMIUM, { cap: 1200, gated_features: ["Gradebook"] });
  assert.ok(!error);
  assert.equal(priceChanged, false);
  assert.equal(patch.cap, 1200);
  assert.deepEqual(patch.gated_features, ["Gradebook"]);
  assert.equal(patch.price_monthly, undefined);
});

test("buildTierPatch: identical values produce an empty patch (no spurious saves)", () => {
  const { patch } = buildTierPatch(CURRENT_PREMIUM, { name: "Premium", cap: 1000, price_monthly: 1500, duration_days: null });
  assert.deepEqual(patch, {});
});

test("buildTierPatch: switching to free is a price change (needs effective_scope); null clears duration/caps; invalid values rejected", () => {
  const toFree = buildTierPatch(CURRENT_PREMIUM, { access: "free" });
  assert.ok(toFree.error, "paid → free re-prices existing subscribers, so scope must be chosen");
  assert.equal(toFree.error.code, "effective_scope_required");

  const toFreeScoped = buildTierPatch(CURRENT_PREMIUM, { access: "free", effective_scope: "all" });
  assert.ok(!toFreeScoped.error);
  assert.equal(toFreeScoped.patch.price_monthly, 0);
  assert.equal(toFreeScoped.patch.price_annual, 0);
  assert.equal(toFreeScoped.priceChanged, true);
  assert.equal(toFreeScoped.effective_scope, "all");

  const timeboxed = { ...CURRENT_PREMIUM, duration_days: 14, cap: 1000 };
  const cleared = buildTierPatch(timeboxed, { duration_days: null, cap: null });
  assert.equal(cleared.patch.duration_days, null);
  assert.equal(cleared.patch.cap, null);

  const bad = buildTierPatch(CURRENT_PREMIUM, { price_monthly: -10, cap: -3, duration_days: 0 });
  assert.ok(bad.error);
  assert.equal(bad.error.code, "invalid_tier_fields");
  assert.ok(bad.error.fields.price_monthly);
  assert.ok(bad.error.fields.cap);
  assert.ok(bad.error.fields.duration_days);
});

test("buildTierPatch: gated_features only patched when the set actually changes", () => {
  const same = buildTierPatch(CURRENT_PREMIUM, { gated_features: [] });
  assert.equal(same.patch.gated_features, undefined);
  const freemium = { ...CURRENT_PREMIUM, access: "free", price_monthly: 0, price_annual: 0, cap: 50, gated_features: ["Gradebook", "Battles"] };
  const reordered = buildTierPatch(freemium, { gated_features: ["Battles", "Gradebook"] });
  assert.equal(reordered.patch.gated_features, undefined); // same set, different order
});

/* ── validatePilotApplication — rules from reference/Pilot application.md ──── */

test("validatePilotApplication: valid submission (snake_case and camelCase keys)", () => {
  for (const body of [
    { school_name: "Chrisland College", state_city: "Lagos, Lagos", est_students: 250, contact_name: "Ada Obi", contact_email: " Ada@School.edu.ng ", contact_phone: "0803 123 4567", message: "  " },
    { schoolName: "Chrisland College", stateCity: "Lagos", estStudents: "250", contactName: "Ada", contactEmail: "ada@school.edu.ng", contactPhone: "08031234567", message: "We'd love to join." },
  ]) {
    const { errors, values } = validatePilotApplication(body);
    assert.deepEqual(errors, {});
    assert.equal(values.school_name, "Chrisland College");
    assert.equal(values.contact_email, "ada@school.edu.ng");
    assert.equal(values.est_students, 250);
  }
});

test("validatePilotApplication: every required field validated per the form rules", () => {
  const { errors } = validatePilotApplication({ school_name: "", state_city: "", est_students: 0, contact_name: "", contact_email: "not-an-email", contact_phone: "123" });
  for (const field of ["school_name", "state_city", "est_students", "contact_name", "contact_email", "contact_phone"]) {
    assert.ok(errors[field], `expected error for ${field}`);
  }
  // students must be an integer >= 1
  assert.ok(validatePilotApplication({ school_name: "S", state_city: "L", est_students: 2.5, contact_name: "A", contact_email: "a@b.co", contact_phone: "08031234567" }).errors.est_students);
  // message optional but capped
  assert.ok(!validatePilotApplication({ school_name: "S", state_city: "L", est_students: 1, contact_name: "A", contact_email: "a@b.co", contact_phone: "08031234567" }).errors.message);
  assert.ok(validatePilotApplication({ school_name: "S", state_city: "L", est_students: 1, contact_name: "A", contact_email: "a@b.co", contact_phone: "08031234567", message: "x".repeat(2001) }).errors.message);
});

test("validatePilotApplication: phone accepts local formats >= 7 chars, rejects longer than 30", () => {
  assert.ok(!validatePilotApplication({ school_name: "S", state_city: "L", est_students: 1, contact_name: "A", contact_email: "a@b.co", contact_phone: "0803-123-4567 ext 2" }).errors.contact_phone);
  assert.ok(validatePilotApplication({ school_name: "S", state_city: "L", est_students: 1, contact_name: "A", contact_email: "a@b.co", contact_phone: "x".repeat(31) }).errors.contact_phone);
});
