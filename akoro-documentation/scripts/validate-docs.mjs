#!/usr/bin/env node
/**
 * Phase 1 documentation validator.
 *
 * Checks the foundation that will become CI:
 *   - JSON/YAML parse;
 *   - documentation-index paths and capability IDs resolve;
 *   - capability-registry docs/API references resolve;
 *   - OpenAPI internal $refs resolve;
 *   - local Markdown links resolve.
 *
 * Run from the repository root:
 *   node akoro-documentation/scripts/validate-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve("akoro-documentation");
const require = createRequire(path.resolve("akoro-api/package.json"));
const YAML = require("yaml");

const errors = [];
const rel = (p) => path.relative(root, p);
const exists = (p) => {
  if (!fs.existsSync(p)) errors.push(`missing file: ${rel(p)}`);
  return fs.existsSync(p);
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
}

function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
}

const index = readJson("documentation-index.json");
const registry = readYaml("capability-registry.yaml");
const openapi = readYaml("02-api/openapi.yaml");

if (index) {
  for (const [feature, value] of Object.entries(index.features || {})) {
    for (const doc of value.docs || []) exists(path.join(root, doc));
  }
}

const capabilityIds = new Set((registry?.capabilities || []).map((c) => c.id));
if (index) {
  for (const [feature, value] of Object.entries(index.features || {})) {
    for (const id of value.capabilities || []) {
      if (!capabilityIds.has(id)) errors.push(`documentation-index: ${feature} references unknown capability ${id}`);
    }
  }
}

const STATUSES = new Set(["implemented", "beta", "planned", "deprecated", "disabled"]);
for (const capability of registry?.capabilities || []) {
  if (!STATUSES.has(capability.status)) errors.push(`capability ${capability.id}: invalid status ${capability.status}`);
  for (const doc of capability.documentation || []) exists(path.join(root, doc));
  for (const ref of capability.api_reference || []) exists(path.join(root, ref));
}

const refs = [];
function walk(value, at = "") {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) refs.push({ ref: value.$ref, at });
  for (const [key, child] of Object.entries(value)) walk(child, `${at}/${key}`);
}
walk(openapi);
for (const { ref } of refs) {
  let current = openapi;
  for (const part of ref.slice(2).split("/")) current = current?.[part];
  if (!current) errors.push(`openapi: unresolved $ref ${ref}`);
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

for (const file of markdownFiles(root)) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)) {
    const target = match[1].split("#")[0].replace(/^<|>$/g, "");
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) errors.push(`broken link: ${rel(file)} -> ${target}`);
  }
}

if (errors.length) {
  console.error(`Documentation validation failed (${errors.length}):`);
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Documentation validation passed: ${Object.keys(index?.features || {}).length} features, ` +
  `${capabilityIds.size} capabilities, ${Object.keys(openapi?.paths || {}).length} OpenAPI paths, ` +
  `${markdownFiles(root).length} Markdown files.`,
);
