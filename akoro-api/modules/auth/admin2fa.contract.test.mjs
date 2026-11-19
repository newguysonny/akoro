import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The router wires the chains; the 2FA decisions live in service-2fa.js and the
// challenge tokens in tokens.js. The Google guard lives with the strategy.
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const routes = read("./routes.js");
const service = read("./service.js");
const twofa = read("./service-2fa.js");
const google = read("./service-google.js");
const tokens = read("./tokens.js");

test("admins must set up 2FA; learners and other portals stay optional", () => {
  assert.match(twofa, /const twoFactorGate = \(user\) => \{/, "one gate function");
  assert.match(twofa, /user\.role === "admin"[\s\S]{0,80}twoFactorSetupRequired: true, setupToken: signSetupChallenge/, "admins without 2FA are sent to setup");
  assert.match(twofa, /twoFactorRequired: true, challengeToken: signChallenge/, "enabled 2FA challenges on every login");
  assert.match(twofa, /return null;/, "non-admin accounts without 2FA proceed normally");
  assert.match(tokens, /const signChallenge = \(userId, type = "2fa_challenge"\)/, "setup challenge has its own type");
});

test("the setup challenge can set up and finish a session, but cannot disable 2FA", () => {
  assert.match(twofa, /const authenticateSetup = \(req, res, next\)/, "setup-token middleware");
  assert.match(routes, /router\.post\("\/2fa\/setup",\s+authenticateSetup/, "setup accepts the challenge");
  assert.match(routes, /router\.post\("\/2fa\/enable",\s+strictLimit, authenticateSetup/, "enable accepts the challenge");
  assert.match(routes, /router\.post\("\/2fa\/disable", strictLimit, authenticateToken/, "disable still requires a session");
  assert.match(twofa, /if \(req\.setupFlow\)[\s\S]{0,220}issueTokenPair/, "enable finishes the admin session");
});

test("Google can never mint an admin session", () => {
  assert.match(google, /if \(portal === "admin"\) \{[\s\S]{0,220}admin_2fa_required/, "Google admin sign-in is redirected to password + 2FA");
});

test("the demo-domain bypass skips the 2FA gate too", () => {
  assert.match(service, /const bypassAuth = emailCodeBypassed\(user\.email\)/);
  assert.match(service, /if \(!bypassAuth\) \{\s+const gate = twoFactorGate\(user\)/, "login skips the admin setup/TOTP gate");
  assert.match(service, /if \(!emailCodeBypassed\(user\.email\)\) \{\s+const gate = twoFactorGate\(user\)/, "verify-login skips it as well");
});
