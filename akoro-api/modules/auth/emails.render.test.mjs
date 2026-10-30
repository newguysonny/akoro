import assert from "node:assert/strict";
import test from "node:test";

process.env.EMAIL_ASSET_BASE = "https://assets.example";
const m = await import("./emails.js");

const all = () => ({
  welcome: m.renderWelcomeEmail({ name: "Amara", loginUrl: "https://akoro.app/signin" }),
  alert: m.renderLoginAlertEmail({
    name: "Amara", ip: "1.2.3.4", signinUrl: "https://akoro.app/forgot-password",
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
  }),
  reset: m.renderPasswordResetEmail({ name: "Amara", resetUrl: "https://akoro.app/reset-password?token=abc" }),
  changed: m.renderPasswordChangedEmail({ name: "Amara", ip: "1.2.3.4", signinUrl: "https://akoro.app/signin" }),
});

test("every email has a subject, a plain-text part and the shared layout", () => {
  for (const [k, e] of Object.entries(all())) {
    assert.ok(e.subject, `${k} subject`);
    assert.ok(e.text.length > 20, `${k} text`);
    assert.match(e.html, /assets\.example\/email\/mark\.png/, `${k} logo`);
    assert.match(e.html, /prefers-color-scheme:dark/, `${k} dark mode`);
    assert.match(e.html, /\/privacy/, `${k} footer links`);
    assert.doesNotMatch(e.html, /Unsubscribe/i, `${k} must not carry a dead unsubscribe link`);
  }
});

test("each email uses its own hero image", () => {
  const e = all();
  assert.match(e.welcome.html, /email\/hero-welcome\.jpg/);
  assert.match(e.alert.html, /email\/hero-security\.jpg/);
  assert.match(e.reset.html, /email\/hero-reset\.jpg/);
  assert.match(e.changed.html, /email\/hero-security\.jpg/);
});

test("the sign-in alert names the device in plain words and escapes user input", () => {
  assert.match(all().alert.html, /Chrome on Android/);
  const evil = m.renderLoginAlertEmail({ name: "<b>x</b>", ip: "<script>1</script>", signinUrl: "https://x", userAgent: null });
  assert.doesNotMatch(evil.html, /<script>1<\/script>/);
  assert.match(evil.html, /&lt;script&gt;/);
});

test("the welcome email follows the role", () => {
  const i = m.renderWelcomeEmail({ name: "Ade", loginUrl: "https://x", role: "instructor" });
  assert.match(i.html, /Create your first course/);
  assert.doesNotMatch(i.html, /Tell your tutor your exam/);
});
