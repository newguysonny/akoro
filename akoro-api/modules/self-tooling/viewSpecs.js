/**
 * modules/self-tooling/viewSpecs.js — validation for Data View specs that
 * live in edu.self_tool_views (the data-driven registry, 2026-11-18).
 *
 * A spec is the same declarative shape views.js uses in code — { description,
 * keywords, scope, source: { schema, table, owner }, fields } with fields in
 * the resolved format ({ type, filter, sort, aggregate? }) — stored as jsonb.
 * Two gates before a spec may go active:
 *   1. validateViewShape      (pure) — the spec is well-formed and safe by
 *      construction: known schema, owner scoping present, no sensitive
 *      column names, nothing that needs relationship knowledge.
 *   2. validateViewAgainstSchema (pure, given the table's real columns) —
 *      every named column exists and its database type matches the field
 *      type the spec claims.
 * fetchTableColumns reads the live columns through the
 * edu.self_tool_table_columns SQL function installed by the migration.
 *
 * v1 limits (code-only features): no `embed`, no `ownerPath`, no field
 * `path`/`person` — those need PostgREST relationship knowledge a stored
 * spec cannot be validated against with information_schema alone.
 */
import db from "../../db.js";
import { BUILTIN_DATA_VIEWS } from "./views.js";
import { AREAS } from "../agent-capabilities/examples.js";

export const VIEW_SCHEMAS = ["public", "edu", "content"];
export const VIEW_FIELD_TYPES = ["string", "number", "integer", "timestamp", "date", "boolean"];

const NAME_RE = /^[a-z][a-z0-9_]{2,47}$/;
const IDENT_RE = /^[a-z][a-z0-9_]*$/;

/** Columns a stored spec may never expose, however it is asked for. */
const SENSITIVE_RE = /(^|_)(email|e_mail|password|passwd|pwd|token|secret|hash|phone|mobile|address|api_key|apikey|otp|session|stripe|card|cvv|iban|bank|payment|credential|private_key|access_key)($|_)/i;

const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const isScalar = (x) => x === null || ["string", "number", "boolean"].includes(typeof x);

/** PURE: is this name/column identifier safe and well-formed? */
export function sensitiveName(name) {
  return SENSITIVE_RE.test(String(name || ""));
}

/**
 * PURE: validate the shape of a proposed spec. Returns { ok, errors }.
 * Does NOT touch the database — column existence is the schema gate below.
 */
export function validateViewShape(name, spec) {
  const errors = [];
  if (!NAME_RE.test(String(name || ""))) errors.push("name must be snake_case, 3–48 chars, starting with a letter");
  if (name in BUILTIN_DATA_VIEWS) errors.push(`"${name}" is a built-in view — database views are additions only and cannot shadow it`);
  if (!isObj(spec)) return { ok: false, errors: [...errors, "spec must be an object"] };

  if (typeof spec.description !== "string" || spec.description.length < 10 || spec.description.length > 400)
    errors.push("description must be 10–400 characters");
  if (!Array.isArray(spec.keywords) || spec.keywords.length < 1 || spec.keywords.length > 12
    || spec.keywords.some((k) => typeof k !== "string" || k.length < 2 || k.length > 30))
    errors.push("keywords must be 1–12 short words or phrases");
  if (!["self", "public"].includes(spec.scope)) errors.push('scope must be "self" or "public"');
  if (spec.audience !== undefined && !["learner", "instructor"].includes(spec.audience))
    errors.push('audience must be "learner" or "instructor"');
  if (spec.area !== undefined && !(spec.area in AREAS)) errors.push(`area must be one of: ${Object.keys(AREAS).join(", ")}`);
  if (spec.embed !== undefined) errors.push("embed is not supported in stored specs (v1) — single-table projections only");
  if (spec.ref !== undefined && !IDENT_RE.test(spec.ref)) errors.push("ref must be a column name");

  const src = spec.source;
  if (!isObj(src)) errors.push("source must be an object { schema, table, owner }");
  else {
    if (!VIEW_SCHEMAS.includes(src.schema)) errors.push(`source must name one of the known namespaces: ${VIEW_SCHEMAS.join(", ")}`);
    if (!IDENT_RE.test(String(src.table || ""))) errors.push("source.table must be a table name");
    if (src.ownerPath !== undefined) errors.push("source.ownerPath is not supported in stored specs (v1)");
    const owners = [src.owner].flat().filter(Boolean);
    if (spec.scope === "self") {
      if (!owners.length || owners.length > 2 || owners.some((o) => !IDENT_RE.test(String(o))))
        errors.push('a "self" view needs source.owner: the owner column (or two) that scopes rows to the viewer');
      for (const o of owners) if (sensitiveName(o)) errors.push(`owner "${o}" looks sensitive — refused`);
    }
    if (src.where !== undefined) {
      if (!isObj(src.where) || Object.keys(src.where).length > 6 || Object.values(src.where).some((v) => !isScalar(v)))
        errors.push("source.where must be a flat object of up to 6 scalar equalities");
      for (const k of Object.keys(src.where || {})) if (sensitiveName(k)) errors.push(`where key "${k}" looks sensitive — refused`);
    }
    if (spec.scope === "public" && (!isObj(src.where) || !Object.keys(src.where).length))
      errors.push('a "public" view needs a fixed source.where (e.g. { status: "published" }) — unscoped public reads are refused');
  }

  const fields = spec.fields;
  if (!isObj(fields) || !Object.keys(fields).length || Object.keys(fields).length > 24) {
    errors.push("fields must name 1–24 columns");
  } else {
    const owners = [src?.owner].flat().filter(Boolean);
    for (const [fname, fdef] of Object.entries(fields)) {
      if (!IDENT_RE.test(fname)) { errors.push(`field "${fname}" must be a column name`); continue; }
      if (sensitiveName(fname)) errors.push(`field "${fname}" looks sensitive — refused`);
      if (owners.includes(fname)) errors.push(`field "${fname}" is the owner column — it scopes the view and is never exposed as a field`);
      if (!isObj(fdef) || !VIEW_FIELD_TYPES.includes(fdef.type))
        errors.push(`field "${fname}" needs a type, one of: ${VIEW_FIELD_TYPES.join(", ")}`);
      else {
        if (fdef.path !== undefined || fdef.person !== undefined)
          errors.push(`field "${fname}": path/person (joined fields) are not supported in stored specs (v1)`);
        for (const b of ["filter", "sort", "aggregate"]) if (fdef[b] !== undefined && typeof fdef[b] !== "boolean")
          errors.push(`field "${fname}": ${b} must be a boolean`);
      }
    }
  }
  return { ok: !errors.length, errors };
}

/** Postgres information_schema data_type → the view field types it can back. */
const TYPE_COMPAT = {
  string: ["character varying", "text", "character", "uuid", "citext"],
  integer: ["integer", "bigint", "smallint"],
  number: ["numeric", "double precision", "real", "integer", "bigint", "smallint"],
  timestamp: ["timestamp with time zone", "timestamp without time zone"],
  date: ["date"],
  boolean: ["boolean"],
};

/**
 * PURE: validate a shape-valid spec against a table's real columns
 * ([{ column_name, data_type }] from information_schema). Every field, the
 * owner column(s), the ref and every where key must exist, and each field's
 * claimed type must be compatible with the column's real type.
 */
export function validateViewAgainstSchema(spec, columns) {
  const errors = [];
  const cols = new Map((columns || []).map((c) => [c.column_name, c.data_type]));
  if (!cols.size) return { ok: false, errors: ["the chosen source was not found"] };
  const need = (col, what) => { if (!cols.has(col)) errors.push(`${what} "${col}" does not exist on the chosen source`); };
  for (const o of [spec.source.owner].flat().filter(Boolean)) need(o, "owner");
  if (spec.ref) need(spec.ref, "ref");
  for (const k of Object.keys(spec.source.where || {})) need(k, "where key");
  for (const [fname, fdef] of Object.entries(spec.fields || {})) {
    need(fname, "field");
    const real = cols.get(fname);
    if (real && !(TYPE_COMPAT[fdef.type] || []).includes(real))
      errors.push(`field "${fname}" claims type ${fdef.type} but the real type is ${real}`);
  }
  return { ok: !errors.length, errors };
}

/** The canonical spec to store/serve: field defaults filled, unknown keys dropped. */
export function normalizeViewSpec(spec) {
  const fields = {};
  for (const [fname, fdef] of Object.entries(spec.fields || {})) {
    fields[fname] = {
      type: fdef.type,
      filter: fdef.filter !== false,
      sort: fdef.sort !== false,
      ...(fdef.aggregate ? { aggregate: true } : {}),
    };
  }
  const out = {
    description: spec.description,
    keywords: spec.keywords,
    scope: spec.scope,
    source: {
      schema: spec.source.schema,
      table: spec.source.table,
      ...([spec.source.owner].flat().filter(Boolean).length ? { owner: spec.source.owner } : {}),
      ...(spec.source.where ? { where: spec.source.where } : {}),
    },
    fields,
  };
  if (spec.audience) out.audience = spec.audience;
  if (spec.area) out.area = spec.area;
  if (spec.ref) out.ref = spec.ref;
  return out;
}

/** The live columns of a table, via the migration's introspection function. */
export async function fetchTableColumns(schema, table) {
  const { data, error } = await db.schema("edu").rpc("self_tool_table_columns", { p_schema: schema, p_table: table });
  if (error) throw new Error(`column lookup failed for ${schema}.${table}: ${error.message}`);
  return data || [];
}

/** Full activation gate: shape, then the live schema. Returns { ok, errors, spec } with the normalized spec when ok. */
export async function validateViewForActivation(name, spec) {
  const shape = validateViewShape(name, spec);
  if (!shape.ok) return { ok: false, errors: shape.errors };
  const normalized = normalizeViewSpec(spec);
  const columns = await fetchTableColumns(normalized.source.schema, normalized.source.table);
  const against = validateViewAgainstSchema(normalized, columns);
  if (!against.ok) return { ok: false, errors: against.errors };
  return { ok: true, errors: [], spec: normalized };
}
