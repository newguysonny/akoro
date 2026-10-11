// A limiter mounted on a catch-all ("/api") AND a later mount must count a
// request once — triple counting was the "That's a lot at once" 429.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { standardLimit } from "./security.js";

test("standardLimit counts a request once however many mounts it passes", async () => {
  const app = express();
  app.use("/api", standardLimit, express.Router());
  app.use("/api", standardLimit, express.Router());
  app.use("/api/x", standardLimit, (req, res) => res.json({ remaining: req.rateLimit.remaining, limit: req.rateLimit.limit }));
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/x`).then((res) => res.json());
    assert.equal(r.remaining, r.limit - 1);
  } finally { server.close(); }
});
