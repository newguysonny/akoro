import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Pilot login contract — approving (or adding) a pilot school provisions a
 * real login: a school_admin account, a school_profiles row in the new
 * 'pilot' stage, a set-password email on the forgot-password token flow,
 * and the generated starter password kept on the roster row so the admin
 * Credentials panel can always show it.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, pilots, authRoutes, adminRoutes, page, schoolsPage] = await Promise.all([
  read("../../migrations/2026-pilot-login.sql"),
  read("../../migrations/manifest.json"),
  read("pilotSchools.js"),
  read("../auth/routes.js"),
  read("routes.js"),
  read("../../../akoro-admin/src/pages/PilotSchoolsPage.jsx"),
  read("../../../akoro-admin/src/pages/SchoolsPage.jsx"),
]);

test("migration: the pilot stage and the kept credential", () => {
  // 'pilot' joins the verification stages, between pending and verified.
  assert.ok(
    migration.includes("CHECK (verification_status IN ('pending','pilot','verified','rejected'))"),
    "pilot verification stage",
  );
  for (const col of ["login_email", "login_temp_password", "login_provisioned_at"]) {
    assert.ok(migration.includes(`ADD COLUMN IF NOT EXISTS ${col}`), `column ${col}`);
  }
  // The roster schema already anticipated the link; the migration only reads it.
  assert.ok(!migration.includes("school_profile_id uuid"), "link column predates this migration");
});

test("manifest: 2026-pilot-login.sql runs right after the roster tables", () => {
  const schema = JSON.parse(manifest).schema;
  const at = schema.indexOf("2026-pilot-login.sql");
  assert.ok(at >= 0, "listed");
  const roster = schema.indexOf("2026-pilot-schools-cohorts.sql");
  assert.ok(roster >= 0 && at === roster + 1, "runs after the roster migration");
});

test("provisioning: account + pilot-stage profile + set-password email", () => {
  // The school admin account, flagged to change the starter password.
  assert.ok(pilots.includes('role: "school_admin"'), "school_admin account");
  assert.ok(pilots.includes("must_change_password: true"), "starter password flagged");
  assert.ok(pilots.includes("bcrypt.hash(tempPassword, 10)"), "starter password hashed");
  assert.ok(pilots.includes('crypto.randomBytes(8).toString("base64")'), "starter password generated");
  // The school profile lands in the pilot stage and is linked from the roster.
  assert.ok(pilots.includes('verification_status: "pilot"'), "pilot-stage profile");
  assert.ok(pilots.includes("school_profile_id: profile.id"), "roster row links the profile");
  // The set-password email rides the forgot-password token flow.
  assert.ok(pilots.includes('from("password_reset_tokens")'), "reset tokens");
  assert.ok(pilots.includes('sendPasswordResetEmail'), "reset email");
  assert.ok(pilots.includes("SCHOOL_PORTAL_URL}/reset-password?token="), "school-portal reset link");
  // Both creation doors provision: approve an application, add a school.
  assert.ok((pilots.match(/provisionPilotLogin\(/g) || []).length >= 3, "approve + add + credentials all provision");
});

test("api: the credentials endpoint powers the admin Credentials panel", () => {
  assert.ok(pilots.includes('router.post("/pilot-schools/:id/credentials"'), "endpoint");
  // First call provisions; later calls resend. The roster row answers with
  // the credential facts, and the panel gets the portal URL from the server.
  assert.ok(pilots.includes("portal_url: SCHOOL_PORTAL_URL"), "portal url from the server");
  // The roster read carries the credential fields for the detail view.
  assert.ok(pilots.includes("login_email, login_temp_password, login_provisioned_at"), "roster select");
  assert.ok(pilots.includes("login_temp_password: school.login_temp_password ?? null"), "shaped for the panel");
  // Approvals return the provisioning outcome so the admin sees it immediately.
  assert.ok(pilots.includes("login_provisioned: !!login?.provisioned"), "approve/add responses");
});

test("auth: setting a password clears the must-change flag", () => {
  assert.ok(
    authRoutes.includes("must_change_password: false"),
    "reset-password clears the starter-password flag",
  );
});

test("admin: the schools list knows the pilot stage", () => {
  assert.ok(adminRoutes.includes('["pending", "pilot", "verified", "rejected"]'), "api filter");
  assert.ok(schoolsPage.includes("['pending', 'pilot', 'verified', 'rejected', 'all']"), "filter chip");
});

test("admin ui: Credentials sits beside Message school with a provisioning panel", () => {
  assert.ok(page.includes(">Credentials</button>"), "the button");
  assert.ok(page.includes("/credentials`"), "wired to the endpoint");
  assert.ok(page.includes("Login credentials"), "the panel");
  assert.ok(page.includes("Resend set-password email"), "resend action");
  assert.ok(page.includes("Create login & email set-password link"), "create action");
  assert.ok(page.includes("Starter password"), "the visible password");
  // The school admin signs in at the school portal — redirect the admin there mentally.
  assert.ok(page.includes("school portal"), "tells the admin where it lands");
});

/* ── No-emoji guard: the touched admin files render drawn/lucide only ───── */
const EMOJI = /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]/u;

test("admin+api: the pilot-login files render no emoji", () => {
  for (const [name, src] of [[ "pilot page", page ], ["schools page", schoolsPage], ["pilot module", pilots], ["migration", migration]]) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      assert.ok(!EMOJI.test(lines[i]), `${name}:${i + 1} contains an emoji`);
    }
  }
});
