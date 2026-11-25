#!/usr/bin/env node
/**
 * Phase 3 documentation search.
 *
 * Offline, deterministic keyword search over documentation-index.json,
 * capability-registry.yaml and tool-registry.yaml. It prints matching
 * features, capabilities, tools and documents.
 *
 * Usage:
 *   node scripts/search-docs.mjs "records ask"
 *   node scripts/search-docs.mjs --json "assessment"
 *   node scripts/search-docs.mjs --limit 5 "auth"
 *
 * No network access. Reference failures are reported and make the command exit
 * non-zero, so the same script can be used as a link guard.
 */
import fs from "node:fs";
import path from "node:path";
import {
  docRoot as root,
  isNonEmptyString,
  isPlainObject,
  loadYamlModule,
  readJsonFile,
  readYamlFile,
} from "./lib.mjs";
import { collectToolRegistryErrors } from "./validate-tool-registry.mjs";

function usage() {
  return [
    "Usage: node scripts/search-docs.mjs [--json] [--limit N] \"query\"",
    "",
    "Searches documentation-index.json, capability-registry.yaml and",
    "tool-registry.yaml. All query terms must match. No network access.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { json: false, help: false, limit: 20, words: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json" || arg === "-j") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--limit" || arg === "-n") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${arg} requires a positive integer`);
      }
      options.limit = value;
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit requires a positive integer");
      }
      options.limit = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      options.words.push(arg);
    }
  }
  return options;
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "").trim();
}

function readTitle(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatter) {
      const title = frontmatter[1].match(/^title:\s*(.+?)\s*$/m);
      if (title) return stripQuotes(title[1]);
    }
    const heading = text.match(/^#\s+(.+?)\s*$/m);
    if (heading) return stripQuotes(heading[1]);
  } catch {
    // Missing files are reported by the reference checks.
  }
  return null;
}

function occurrences(haystack, term) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(term, index)) !== -1) {
    count += 1;
    index += term.length;
  }
  return count;
}

function score(haystack, phrase, terms) {
  const text = haystack.toLowerCase();
  if (!terms.every((term) => text.includes(term))) return 0;
  let total = 0;
  for (const term of terms) total += occurrences(text, term);
  if (text.includes(phrase)) total += 10;
  return total;
}

function rank(entries, sortKey) {
  return entries
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a[sortKey]).localeCompare(String(b[sortKey])));
}

const argv = process.argv.slice(2);
let options;
try {
  options = parseArgs(argv);
} catch (err) {
  console.error(err.message);
  console.error(usage());
  process.exit(2);
}

if (options.help) {
  console.log(usage());
  process.exit(0);
}

const query = options.words.join(" ").trim();
if (!query) {
  console.error(usage());
  process.exit(2);
}

const phrase = query.toLowerCase();
const terms = phrase.split(/\s+/).filter(Boolean);
const YAML = loadYamlModule();
const refErrors = new Set();

const readFailures = [];
const indexDoc = readJsonFile(root, "documentation-index.json", readFailures);
const registryDoc = readYamlFile(root, "capability-registry.yaml", readFailures, YAML);
const toolRegistryDoc = readYamlFile(root, "tool-registry.yaml", readFailures, YAML);
const openapiDoc = readYamlFile(root, "02-api/openapi.yaml", readFailures, YAML);
for (const failure of readFailures) refErrors.add(failure);

function checkRef(ref, label) {
  if (!isNonEmptyString(ref)) {
    refErrors.add(`${label}: empty reference`);
    return;
  }
  if (path.isAbsolute(ref) || ref.split(/[\\/]/).includes("..")) {
    refErrors.add(`${label}: unsafe reference ${ref}`);
    return;
  }
  if (!fs.existsSync(path.join(root, ref))) refErrors.add(`${label}: missing file ${ref}`);
}

const capabilityIds = new Set(
  (registryDoc?.capabilities || [])
    .map((capability) => capability?.id)
    .filter(isNonEmptyString),
);

const featureByCapability = new Map();
for (const [featureId, feature] of Object.entries(indexDoc?.features || {})) {
  for (const capabilityId of feature?.capabilities || []) {
    if (!featureByCapability.has(capabilityId)) featureByCapability.set(capabilityId, new Set());
    featureByCapability.get(capabilityId).add(featureId);
  }
}

const docMap = new Map();
function addDoc(ref, { features = [], capabilities = [] } = {}) {
  if (!isNonEmptyString(ref)) return;
  if (!docMap.has(ref)) {
    docMap.set(ref, {
      path: ref,
      title: readTitle(path.join(root, ref)),
      features: new Set(),
      capabilities: new Set(),
    });
  }
  const entry = docMap.get(ref);
  for (const feature of features) entry.features.add(feature);
  for (const capability of capabilities) entry.capabilities.add(capability);
}

for (const [featureId, feature] of Object.entries(indexDoc?.features || {})) {
  for (const doc of feature?.docs || []) {
    checkRef(doc, `documentation-index.json: feature ${featureId}`);
    addDoc(doc, { features: [featureId] });
  }
  for (const capabilityId of feature?.capabilities || []) {
    if (!capabilityIds.has(capabilityId)) {
      refErrors.add(
        `documentation-index.json: feature ${featureId} references unknown capability ${capabilityId}`,
      );
    }
  }
}

for (const capability of registryDoc?.capabilities || []) {
  for (const doc of capability?.documentation || []) {
    checkRef(doc, `capability ${capability.id}`);
    addDoc(doc, {
      features: [...(featureByCapability.get(capability.id) || [])],
      capabilities: [capability.id],
    });
  }
  for (const ref of capability?.api_reference || []) {
    checkRef(ref, `capability ${capability.id}`);
  }
}

for (const tool of Array.isArray(toolRegistryDoc?.tools) ? toolRegistryDoc.tools : []) {
  for (const doc of tool?.documentation || []) {
    if (!isNonEmptyString(tool?.capability)) continue;
    checkRef(doc, `tool ${tool.id}`);
    addDoc(doc, {
      features: [...(featureByCapability.get(tool.capability) || [])],
      capabilities: [tool.capability],
    });
  }
}

const toolValidation = collectToolRegistryErrors({
  root,
  YAML,
  index: indexDoc,
  registry: registryDoc,
  openapi: openapiDoc,
  toolRegistry: toolRegistryDoc,
});
for (const error of toolValidation.errors) refErrors.add(error);

const features = Object.entries(indexDoc?.features || {}).map(([id, feature]) => {
  const haystack = [
    id,
    feature?.description,
    feature?.status,
    `tier ${feature?.tier}`,
    ...(feature?.capabilities || []),
    ...(feature?.docs || []),
  ].join(" ");
  return {
    id,
    description: feature?.description || "",
    status: feature?.status || "",
    tier: feature?.tier,
    capabilities: feature?.capabilities || [],
    docs: feature?.docs || [],
    score: score(haystack, phrase, terms),
  };
});

const capabilities = (registryDoc?.capabilities || []).map((capability) => {
  const haystack = [
    capability?.id,
    capability?.name,
    capability?.category,
    capability?.status,
    capability?.description,
    ...(capability?.documentation || []),
    ...(capability?.api_reference || []),
  ].join(" ");
  return {
    id: capability?.id || "",
    name: capability?.name || "",
    category: capability?.category || "",
    status: capability?.status || "",
    description: capability?.description || "",
    documentation: capability?.documentation || [],
    api_reference: capability?.api_reference || [],
    score: score(haystack, phrase, terms),
  };
});

const tools = (Array.isArray(toolRegistryDoc?.tools) ? toolRegistryDoc.tools : []).map(
  (tool) => {
    const endpoints = (tool?.api_reference || [])
      .filter(isPlainObject)
      .map((ref) => `${String(ref.method).toUpperCase()} ${ref.path}`);
    const haystack = [
      tool?.id,
      tool?.name,
      tool?.description,
      tool?.capability,
      tool?.execution_mode,
      ...(tool?.documentation || []),
      ...endpoints,
    ].join(" ");
    return {
      id: tool?.id || "",
      name: tool?.name || "",
      description: tool?.description || "",
      capability: tool?.capability || "",
      execution_mode: tool?.execution_mode || "",
      documentation: tool?.documentation || [],
      endpoints,
      score: score(haystack, phrase, terms),
    };
  },
);

const docs = [...docMap.values()].map((doc) => {
  const haystack = [
    doc.path,
    doc.title,
    ...doc.features,
    ...doc.capabilities,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    path: doc.path,
    title: doc.title,
    features: [...doc.features].sort(),
    capabilities: [...doc.capabilities].sort(),
    score: score(haystack, phrase, terms),
  };
});

const matches = {
  features: rank(features, "id").slice(0, options.limit),
  capabilities: rank(capabilities, "id").slice(0, options.limit),
  tools: rank(tools, "id").slice(0, options.limit),
  docs: rank(docs, "path").slice(0, options.limit),
};

const referenceErrors = [...refErrors].sort();

if (options.json) {
  console.log(
    JSON.stringify(
      {
        query,
        options: { limit: options.limit },
        matches,
        references: { ok: referenceErrors.length === 0, errors: referenceErrors },
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Query: "${query}" (limit ${options.limit} per section)`);
  console.log("");

  console.log(`Features (${matches.features.length})`);
  for (const feature of matches.features) {
    console.log(
      `  ${feature.id} — ${feature.description} [${feature.status}, tier ${feature.tier}]`,
    );
    if (feature.capabilities.length) {
      console.log(`    capabilities: ${feature.capabilities.join(", ")}`);
    }
    console.log(`    docs: ${feature.docs.length}`);
  }
  if (!matches.features.length) console.log("  (none)");

  console.log("");
  console.log(`Capabilities (${matches.capabilities.length})`);
  for (const capability of matches.capabilities) {
    console.log(`  ${capability.id} — ${capability.name} [${capability.status}]`);
  }
  if (!matches.capabilities.length) console.log("  (none)");

  console.log("");
  console.log(`Tools (${matches.tools.length})`);
  for (const tool of matches.tools) {
    console.log(
      `  ${tool.id} — ${tool.name} (${tool.capability}, ${tool.execution_mode})`,
    );
    for (const endpoint of tool.endpoints) console.log(`    ${endpoint}`);
  }
  if (!matches.tools.length) console.log("  (none)");

  console.log("");
  console.log(`Documents (${matches.docs.length})`);
  for (const doc of matches.docs) {
    const title = doc.title ? ` — ${doc.title}` : "";
    console.log(`  ${doc.path}${title}`);
    if (doc.capabilities.length) {
      console.log(`    capabilities: ${doc.capabilities.join(", ")}`);
    }
  }
  if (!matches.docs.length) console.log("  (none)");

  console.log("");
  if (referenceErrors.length) {
    console.error(`Reference validation failed (${referenceErrors.length}):`);
    for (const error of referenceErrors) console.error(`- ${error}`);
  } else {
    console.log(`References: OK (${docMap.size} indexed documents).`);
  }
}

process.exit(referenceErrors.length ? 1 : 0);
