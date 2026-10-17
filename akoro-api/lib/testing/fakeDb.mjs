/**
 * lib/testing/fakeDb.mjs — an in-memory stand-in for the Supabase client, for
 * seam tests of modules that import `db.js` directly (no network, no flags).
 *
 *   const fake = installFakeDb(db, { "edu.study_prep_sessions": [...rows] }, {
 *     unique: { "edu.study_prep_events": [["session_id", "sequence"]] },
 *     rpc: { coin_debit: (args) => ({ data: 98 }) },
 *   });
 *   ...                     // code under test calls db.from / db.schema / db.rpc
 *   fake.rows("edu.study_prep_sessions"); fake.calls; fake.restore();
 *
 * Supports what this codebase uses: select (columns ignored; nested embeds are
 * stored on the row), insert / update / upsert / delete (+ .select()),
 * eq / neq / in / is / like / ilike / gt / gte / lt / lte / not(col,'is',null)
 * / or (equality pairs only), order, limit, range, single, maybeSingle,
 * { count: "exact", head: true }, and a unique-constraint error 23505.
 */
import { randomUUID } from "node:crypto";

const likeToRegex = (pattern, flags) => new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);

class Query {
  constructor(store, table) {
    this.store = store; this.table = table;
    this.op = "select"; this.filters = []; this.orders = []; this.max = null; this.offset = 0;
    this.payload = null; this.returning = false; this.mode = null; this.countOpt = null; this.head = false;
    this.upsertOn = null;
  }
  select(_cols, opts = {}) { if (this.op === "select") { this.countOpt = opts.count || null; this.head = !!opts.head; } else this.returning = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.upsertOn = opts.onConflict ? String(opts.onConflict).split(",").map((s) => s.trim()) : null; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  #f(fn) { this.filters.push(fn); return this; }
  eq(c, v) { return this.#f((r) => r[c] === v); }
  neq(c, v) { return this.#f((r) => r[c] !== v); }
  in(c, list) { return this.#f((r) => list.includes(r[c])); }
  is(c, v) { return this.#f((r) => (v === null ? r[c] == null : r[c] === v)); }
  like(c, p) { const re = likeToRegex(p, ""); return this.#f((r) => re.test(String(r[c] ?? ""))); }
  ilike(c, p) { const re = likeToRegex(p, "i"); return this.#f((r) => re.test(String(r[c] ?? ""))); }
  gt(c, v) { return this.#f((r) => r[c] > v); }
  gte(c, v) { return this.#f((r) => r[c] >= v); }
  lt(c, v) { return this.#f((r) => r[c] < v); }
  lte(c, v) { return this.#f((r) => r[c] <= v); }
  not(c, op, v) { return op === "is" && v === null ? this.#f((r) => r[c] != null) : this.#f((r) => r[c] !== v); }
  or(expr) {
    const alts = String(expr).split(",").map((part) => { const [c, op, ...rest] = part.split("."); return { c, op, v: rest.join(".") }; });
    return this.#f((r) => alts.some(({ c, op, v }) => (op === "eq" ? String(r[c]) === v : op === "is" && v === "null" ? r[c] == null : false)));
  }
  contains(c, v) { return this.#f((r) => Array.isArray(r[c]) && [].concat(v).every((x) => r[c].includes(x))); }
  order(c, { ascending = true } = {}) { this.orders.push({ c, ascending }); return this; }
  limit(n) { this.max = n; return this; }
  range(from, to) { this.offset = from; this.max = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.#run()).then(resolve, reject); }

  #matches() { return this.store.table(this.table).filter((r) => this.filters.every((f) => f(r))); }
  #shape(rows) {
    let out = rows;
    for (const { c, ascending } of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c] ? 1 : -1) * (ascending ? 1 : -1)));
    }
    if (this.offset) out = out.slice(this.offset);
    if (this.max != null) out = out.slice(0, this.max);
    return out;
  }
  #finish(rows, { count = null } = {}) {
    const copy = rows.map((r) => structuredClone(r));
    if (this.mode === "single") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { code: "PGRST116", message: `expected one row, got ${copy.length}` } };
    if (this.mode === "maybe") return copy.length > 1 ? { data: null, error: { code: "PGRST116", message: "more than one row" } } : { data: copy[0] ?? null, error: null };
    return { data: copy, error: null, ...(count != null ? { count } : {}) };
  }
  #conflict(row, ignoreRow = null) {
    for (const cols of this.store.uniqueFor(this.table)) {
      const clash = this.store.table(this.table).find((r) => r !== ignoreRow && cols.every((c) => r[c] != null && r[c] === row[c]));
      if (clash) return clash;
    }
    return null;
  }
  #run() {
    this.store.calls.push({ table: this.table, op: this.op });
    const fail = this.store.failNext.get(`${this.table}:${this.op}`);
    if (fail) { this.store.failNext.delete(`${this.table}:${this.op}`); return { data: null, error: fail }; }
    const rows = this.store.table(this.table);
    if (this.op === "select") {
      const matched = this.#matches();
      if (this.head) return { data: null, error: null, count: matched.length };
      return this.#finish(this.#shape(matched), { count: this.countOpt ? matched.length : null });
    }
    if (this.op === "insert" || this.op === "upsert") {
      const written = [];
      for (const raw of this.payload) {
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...this.store.defaults(this.table), ...structuredClone(raw) };
        const key = this.upsertOn;
        const existing = this.op === "upsert" ? (key ? rows.find((r) => key.every((c) => r[c] === row[c])) : rows.find((r) => r.id === raw.id)) : null;
        if (existing) { Object.assign(existing, structuredClone(raw)); written.push(existing); continue; }
        if (this.#conflict(row)) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${this.table}` } };
        rows.push(row);
        written.push(row);
      }
      return this.returning || this.mode ? this.#finish(written) : { data: null, error: null };
    }
    if (this.op === "update") {
      const matched = this.#matches();
      for (const r of matched) {
        const next = { ...r, ...structuredClone(this.payload) };
        if (this.#conflict(next, r)) return { data: null, error: { code: "23505", message: "duplicate key on update" } };
        Object.assign(r, structuredClone(this.payload));
      }
      return this.returning || this.mode ? this.#finish(matched) : { data: null, error: null };
    }
    if (this.op === "delete") {
      const matched = this.#matches();
      this.store.tables.set(this.table, rows.filter((r) => !matched.includes(r)));
      return this.returning || this.mode ? this.#finish(matched) : { data: null, error: null };
    }
    return { data: null, error: { message: `unsupported op ${this.op}` } };
  }
}

class Store {
  constructor(seed, { unique = {}, defaults = {}, rpc = {} }) {
    this.tables = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
    this.uniques = unique; this.defaultRows = defaults; this.rpcs = rpc;
    this.calls = []; this.rpcCalls = []; this.failNext = new Map();
  }
  table(name) { if (!this.tables.has(name)) this.tables.set(name, []); return this.tables.get(name); }
  uniqueFor(name) { return this.uniques[name] || []; }
  defaults(name) { return typeof this.defaultRows[name] === "function" ? this.defaultRows[name]() : (this.defaultRows[name] || {}); }
}

const qualified = (schema, table) => (schema === "public" ? table : `${schema}.${table}`);

/**
 * Point `db` (the imported singleton) at an in-memory store until restore().
 * `seed`: { "table" | "schema.table": rows[] }.
 */
export function installFakeDb(db, seed = {}, options = {}) {
  const store = new Store(seed, options);
  const saved = { from: db.from, schema: db.schema, rpc: db.rpc };
  const rpc = async (name, args) => {
    store.rpcCalls.push({ name, args });
    const fn = store.rpcs[name];
    if (!fn) return { data: null, error: { message: `rpc ${name} not stubbed` } };
    const out = await fn(args, store);
    return out && ("data" in out || "error" in out) ? { data: out.data ?? null, error: out.error ?? null } : { data: out ?? null, error: null };
  };
  db.from = (table) => new Query(store, qualified("public", table));
  db.schema = (schema) => ({ from: (table) => new Query(store, qualified(schema, table)), rpc });
  db.rpc = rpc;
  return {
    rows: (name) => store.table(name),
    get calls() { return store.calls; },
    get rpcCalls() { return store.rpcCalls; },
    /** Make the next `op` on `table` return this error once. */
    failNext: (table, op, error) => store.failNext.set(`${table}:${op}`, error),
    restore: () => Object.assign(db, saved),
  };
}
