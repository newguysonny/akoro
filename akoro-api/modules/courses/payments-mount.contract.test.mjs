/** Phase 15 item 2: the payments router is mounted once (its paths carry their own /payments prefix). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("one mount, and the old doubled webhook path only as a logged alias", () => {
  const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.doesNotMatch(index, /router\.use\("\/payments",\s*paymentsRouter\)/);
  assert.equal((index.match(/router\.use\(paymentsRouter\)/g) || []).length, 1);
  const payments = readFileSync(new URL("./payments.js", import.meta.url), "utf8");
  assert.match(payments, /router\.post\("\/payments\/verify",\s+paymentHandlers\.verifyWebhook\)/);
  assert.match(payments, /router\.post\("\/payments\/payments\/verify", \(req, _res, next\) => \{ console\.warn\(/);
});
