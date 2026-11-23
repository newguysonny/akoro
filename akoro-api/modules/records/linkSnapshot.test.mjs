// Links are fetched by the server, so both halves need pinning: the SSRF
// guard and the readable-text extraction.
import assert from "node:assert/strict";
import test from "node:test";
import { extractReadable, privateAddress } from "./linkSnapshot.js";

test("private and reserved addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.4", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.ok(privateAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "104.18.0.1"]) assert.equal(privateAddress(ip), null, ip);
  assert.ok(privateAddress("::1"));
  assert.ok(privateAddress("fe80::1"));
  assert.ok(privateAddress("fd00::1"));
  assert.ok(privateAddress("::ffff:127.0.0.1"));
});

test("readable text drops chrome and keeps headings/paragraphs", () => {
  const html = `<!doctype html><html><head>
    <title>Akoro — Learn</title>
    <meta property="og:title" content="Akoro: AI proteges" />
    <meta name="description" content="Teach your AI agent." />
    <meta property="og:image" content="/cover.png" />
    </head><body>
    <nav>Home Pricing Login</nav>
    <header>Site header</header>
    <article>
      <h1>Teach your AI agent</h1>
      <p>A personal AI learner that you teach.</p>
      <ul><li>For learners</li><li>For instructors</li></ul>
      <script>alert('x')</script>
    </article>
    <footer>© Akoro</footer></body></html>`;
  const out = extractReadable(html, "https://akoro.ng/");
  assert.equal(out.title, "Akoro: AI proteges");
  assert.equal(out.description, "Teach your AI agent.");
  assert.equal(out.image, "https://akoro.ng/cover.png");
  assert.match(out.text, /Teach your AI agent/);
  assert.match(out.text, /- For learners/);
  assert.doesNotMatch(out.text, /Pricing|Site header|alert|© Akoro/);
});

test("plain text pages pass through", () => {
  const text = "Line one.\nLine two.\n";
  const out = extractReadable(text, "https://example.com/notes.txt");
  assert.match(out.text, /Line one/);
});

test("hostnames are resolved, not treated as IP literals", async () => {
  const { fetchPage } = await import("./linkSnapshot.js");
  await assert.rejects(fetchPage("http://localhost:9/secret"), /not public/);
  await assert.rejects(fetchPage("http://10.0.0.5/secret"), /not public/);
  await assert.rejects(fetchPage("http://169.254.169.254/latest/meta-data"), /not public/);
});
