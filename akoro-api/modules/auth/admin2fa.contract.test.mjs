import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");

test("admins must set up 2FA; learners and other portals stay optional", () => {
  assert.match(routes, /const twoFactorGate = \(user\) => \{/, "one gate function");
  assert.match(routes, /user\.role === "admin"[\s\S]{0,80}twoFactorSetupRequired: true, setupToken: signSetupChallenge/, "admins without 2FA are sent to setup");
  assert.match(routes, /twoFactorRequired: true, challengeToken: signChallenge/, "enabled 2FA challenges on every login");
  assert.match(routes, /return null;/, "non-admin accounts without 2FA proceed normally");
  assert.match(routes, /const signChallenge = \(userId, type = "2fa_challenge"\)/, "setup challenge has its own type");
});

test("the setup challenge can set up and finish a session, but cannot disable 2FA", () => {
  assert.match(routes, /const authenticateSetup = \(req, res, next\)/, "setup-token middleware");
  assert.match(routes, /router\.post\("\/2fa\/setup",\s+authenticateSetup/, "setup accepts the challenge");
  assert.match(routes, /router\.post\("\/2fa\/enable",\s+strictLimit, authenticateSetup/, "enable accepts the challenge");
  assert.match(routes, /router\.post\("\/2fa\/disable", strictLimit, authenticateToken/, "disable still requires a session");
  assert.match(routes, /if \(req\.setupFlow\)[\s\S]{0,220}issueTokenPair/, "enable finishes the admin session");
});

test("Google can never mint an admin session", () => {
  assert.match(routes, /if \(portal === "admin"\) \{[\s\S]{0,220}admin_2fa_required/, "Google admin sign-in is redirected to password + 2FA");
});
