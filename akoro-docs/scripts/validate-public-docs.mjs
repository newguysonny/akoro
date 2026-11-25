#!/usr/bin/env node
/**
 * Public docs validation:
 *   - every local /docs link resolves to an MDX page or generated OpenAPI operation;
 *   - public/llms.txt paths resolve;
 *   - changelog JSON parses;
 *   - openapi/akoro.yaml matches the internal source when it is present.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const errors = [];
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.mdx')) out.push(rel);
  }
  return out;
}

const routes = new Set();
for (const file of walk('content/docs')) {
  const rel = file.replace(/^content\/docs\//, '').replace(/\.mdx$/, '');
  if (rel === 'index') routes.add('/docs');
  else if (rel.endsWith('/index')) routes.add(`/docs/${rel.slice(0, -6)}`);
  else routes.add(`/docs/${rel}`);
}

let openapi;
try {
  openapi = YAML.parse(read('openapi/akoro.yaml'));
} catch (err) {
  errors.push(`openapi/akoro.yaml: ${err.message}`);
}
for (const operations of Object.values(openapi?.paths || {})) {
  for (const operation of Object.values(operations)) {
    if (operation?.operationId) routes.add(`/docs/api-reference/${operation.operationId}`);
  }
}

function checkLink(from, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/docs')) return;
  if (!routes.has(clean.replace(/\/$/, ''))) errors.push(`${from}: broken docs link ${href}`);
}

for (const file of walk('content/docs')) {
  const text = read(file);
  for (const match of text.matchAll(/\]\((\/docs[^)\s]+)\)/g)) checkLink(file, match[1]);
}

if (exists('public/llms.txt')) {
  for (const line of read('public/llms.txt').split('\n')) {
    const match = line.match(/^- (\/[^\s]+)$/);
    if (match) {
      const href = match[1];
      if (href.startsWith('/docs') && !routes.has(href)) errors.push(`public/llms.txt: broken docs link ${href}`);
    }
  }
}

try {
  const entries = JSON.parse(read('content/changelog.json'));
  if (!Array.isArray(entries) || entries.length === 0) errors.push('content/changelog.json: expected a non-empty array');
} catch (err) {
  errors.push(`content/changelog.json: ${err.message}`);
}

try {
  const internal = path.resolve('../akoro-documentation/02-api/openapi.yaml');
  if (fs.existsSync(internal) && fs.readFileSync(internal, 'utf8') !== read('openapi/akoro.yaml')) {
    errors.push('openapi/akoro.yaml is stale; run npm run sync:openapi');
  }
} catch {
  // deploy roots may not include the internal source; the committed copy is used
}

if (errors.length) {
  console.error(`Public docs validation failed (${errors.length}):`);
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Public docs validation passed: ${routes.size} routes checked.`);
