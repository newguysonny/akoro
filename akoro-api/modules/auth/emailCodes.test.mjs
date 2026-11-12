import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

test("ports opt in explicitly; the default is off", async () => {
  const previous = process.env.AUTH_EMAIL_CODES;
  const cases = [["", false, false], ["off", false, false], ["on", true, true], ["student", true, false], ["student,admin", true, true]];
  try {
    for (let i = 0; i < cases.length; i++) {
      const [flag, student, admin] = cases[i];
      process.env.AUTH_EMAIL_CODES = flag;
      const mod = await import(`./emailCodes.js?flag=${i}`);
      assert.equal(mod.emailCodesEnabled("student"), student, `student with '${flag}'`);
      assert.equal(mod.emailCodesEnabled("admin"), admin, `admin with '${flag}'`);
    }
  } finally {
    if (previous === undefined) delete process.env.AUTH_EMAIL_CODES;
    else process.env.AUTH_EMAIL_CODES = previous;
  }
});

test("emails are normalised and the TTL is sane", async () => {
  const { normaliseEmail, CODE_TTL_MINUTES } = await import("./emailCodes.js?plain=1");
  assert.equal(normaliseEmail("  Ada@Example.COM "), "ada@example.com");
  assert.ok(CODE_TTL_MINUTES >= 3 && CODE_TTL_MINUTES <= 30);
});
