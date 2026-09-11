import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The admin + instructor consoles are designed for tablet/desktop. Phones get
// a full-page gate (Adalat-style) instead of a cramped app — and a gated phone
// mounts nothing, so it cannot burn DB commands on background polling.

const gate = async (app) => readFile(
  new URL(`../../${app}/src/components/MobileGate.jsx`, import.meta.url), "utf8",
);
const main = async (app) => readFile(
  new URL(`../../${app}/src/main.jsx`, import.meta.url), "utf8",
);
const [instructorGate, adminGate, instructorMain, adminMain, learnerMain, learnerApp] = await Promise.all([
  gate("akoro-instructor"), gate("akoro-admin"),
  main("akoro-instructor"), main("akoro-admin"),
  main("akoro-learner"),
  readFile(new URL("../../akoro-learner/src/App.jsx", import.meta.url), "utf8").catch(() => ""),
]);

test("both consoles gate phones with a full-page notice", () => {
  for (const [name, src] of [["instructor", instructorGate], ["admin", adminGate]]) {
    assert.match(src, /PHONE_QUERY = '\(max-width: 767px\)'/, `${name}: phones only — tablets keep the full app`);
    assert.match(src, /sessionStorage\.setItem\(BYPASS_KEY/, `${name}: escape hatch is per-tab`);
    assert.match(src, /if \(!phone || bypassed\) return children;/, `${name}: gating mounts NOTHING (no API calls)`);
    assert.match(src, /bringing the .* to mobile browsers soon/, `${name}: friendly copy`);
    assert.match(src, /Continue to the full app anyway/, `${name}: discreet continue link`);
  }
});

test("the gate wraps the app root in admin and instructor — and spares the learner app", () => {
  assert.match(instructorMain, /<MobileGate product="instructor console">/);
  assert.match(adminMain, /<MobileGate product="admin console">/);
  assert.doesNotMatch(learnerMain, /MobileGate/);
  assert.doesNotMatch(learnerApp, /MobileGate/);
});
