// The in-memory Supabase stand-in behaves like PostgREST where tests rely on it.
import assert from "node:assert/strict";
import test from "node:test";
import { installFakeDb } from "./fakeDb.mjs";

const db = { from() {}, schema() {}, rpc() {} };

test("filters, order, limit, single/maybeSingle, head counts", async () => {
  const f = installFakeDb(db, { "edu.t": [{ id: "a", n: 2, s: "Basic Science" }, { id: "b", n: 1, s: "Maths" }, { id: "c", n: 3, s: "basic science JSS1" }] });
  const { data } = await db.schema("edu").from("t").select("*").ilike("s", "%basic science%").order("n", { ascending: false }).limit(5);
  assert.deepEqual(data.map((r) => r.id), ["c", "a"]);
  assert.equal((await db.schema("edu").from("t").select("*").eq("id", "b").maybeSingle()).data.s, "Maths");
  assert.equal((await db.schema("edu").from("t").select("*").eq("id", "zz").maybeSingle()).data, null);
  assert.equal((await db.schema("edu").from("t").select("*").single()).error.code, "PGRST116");
  assert.equal((await db.schema("edu").from("t").select("*", { count: "exact", head: true }).gte("n", 2)).count, 2);
  f.restore();
});

test("insert/update/delete return rows with .select(); unique conflicts are 23505", async () => {
  const f = installFakeDb(db, {}, { unique: { u: [["k"]] } });
  const ins = await db.from("u").insert({ k: 1, v: "x" }).select("*").single();
  assert.ok(ins.data.id);
  assert.equal((await db.from("u").insert({ k: 1 })).error.code, "23505");
  const up = await db.from("u").update({ v: "y" }).eq("k", 1).select("*").maybeSingle();
  assert.equal(up.data.v, "y");
  const none = await db.from("u").update({ v: "z" }).eq("k", 9).select("*").maybeSingle();
  assert.equal(none.data, null);
  await db.from("u").delete().eq("k", 1);
  assert.equal(f.rows("u").length, 0);
  f.restore();
});

test("rpc stubs and one-shot failures", async () => {
  const f = installFakeDb(db, {}, { rpc: { add: ({ a, b }) => ({ data: a + b }) } });
  assert.equal((await db.rpc("add", { a: 1, b: 2 })).data, 3);
  assert.ok((await db.rpc("missing")).error);
  f.failNext("x", "select", { message: "boom" });
  assert.equal((await db.from("x").select("*")).error.message, "boom");
  assert.equal((await db.from("x").select("*")).error, null);
  f.restore();
});
