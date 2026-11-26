#!/usr/bin/env node
/**
 * Public docs validation:
 *   - every local /docs link resolves to an MDX page or generated OpenAPI operation;
 *   - public/llms.txt paths resolve;
 *   - changelog JSON parses;
 *   - openapi/akoro.yaml matches the internal source when it is present;
 *   - every /api/... path mentioned in the content is an operation in
 *     openapi/akoro.yaml or an explicit ALLOWLIST entry (public-surface
 *     allow-list check; see docs/audits/security-review-public-docs-2026-11-26.md).
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

// --- API allow-list check ---------------------------------------------------
// The public site documents the Tier-1 API in openapi/akoro.yaml. Any other
// /api/... path mentioned in the content is unpublished-surface drift: route
// maps or internals of surfaces the public allow-list excludes (the public
// surface is auth, the published catalogue, blog/careers, contact, pilot
// intake, and authenticated Library/course access). A mention passes only
// when it matches an OpenAPI operation path (after normalising {param} and
// :param segments) or is an explicit ALLOWLIST entry below. Keep the
// allow-list at zero if you can; every entry needs its justification
// reviewed like a finding.
const ALLOWLIST = new Map([
  // Planned canonical prefix discussed in the versioning docs; a base path,
  // not an endpoint (start/versioning.mdx, reference/api.mdx,
  // start/getting-started.mdx).
  ['/api/v1', 'planned version prefix, not an endpoint'],
  // Browser-redirect OAuth endpoints in the authentication guide. They are
  // not JSON API operations, so they are not modelled in the OpenAPI
  // contract (start/authentication.mdx).
  ['/api/auth/google', 'Google OAuth start, browser redirect'],
  ['/api/auth/google/callback', 'Google OAuth callback, browser redirect'],
  // The unified Paystack webhook: documented in the internal Tier-1 API docs
  // (akoro-documentation/02-api/webhooks.md) and the subject of
  // build/webhooks.mdx. Inbound provider callbacks are authenticated by the
  // Paystack signature, not a user session, and are not modelled as OpenAPI
  // operations.
  ['/api/webhooks/paystack', 'documented Paystack webhook, signature-authenticated'],
  // Mount points of registry-backed beta learner surfaces whose Learn pages
  // document relative paths under the mount. Only the mount itself is
  // named; the endpoints are not Tier-1 and must not be spelled out.
  ['/api/adaptive/study-prep', 'Study Prep mount (learn/study-prep.mdx)'],
  ['/api/adaptive/exam-prep', 'Exam Prep mount (learn/exam-prep.mdx)'],
  ['/api/self-study', 'Self-study mount (learn/self-study.mdx)'],
  ['/api/communities', 'Communities mount (learn/communities.mdx)'],
]);

function normaliseApiPath(p) {
  return p
    .split('/')
    .map((seg) => (/^\{.*\}$/.test(seg) || /^:[A-Za-z_][\w]*$/.test(seg) ? '{}' : seg))
    .join('/');
}

const operationPaths = new Set(
  Object.keys(openapi?.paths || {}).map((p) => normaliseApiPath(`/api${p}`)),
);

for (const file of walk('content/docs')) {
  const text = read(file);
  const seen = new Set();
  for (const match of text.matchAll(/\/api\/[A-Za-z0-9._~{}:%-]+(?:\/[A-Za-z0-9._~{}:%-]+)*/g)) {
    const mention = match[0].replace(/[.:]$/, '');
    if (seen.has(mention)) continue;
    seen.add(mention);
    if (operationPaths.has(normaliseApiPath(mention))) continue;
    if (ALLOWLIST.has(mention)) continue;
    errors.push(`${file}: API path not in the public OpenAPI or ALLOWLIST: ${mention}`);
  }
}

if (errors.length) {
  console.error(`Public docs validation failed (${errors.length}):`);
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Public docs validation passed: ${routes.size} routes checked.`);
