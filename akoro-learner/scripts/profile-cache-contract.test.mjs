import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');

test('the signed-in profile is not eligible for the stale catalog cache', () => {
  const personalProfileRule = source.indexOf("url.pathname.startsWith('/api/profiles/me')");
  const catalogRule = source.indexOf('// Stable CATALOG reads');

  assert.ok(personalProfileRule >= 0, 'expected a dedicated /api/profiles/me runtime-cache rule');
  assert.ok(catalogRule >= 0, 'expected the public catalog runtime-cache rule');
  assert.ok(personalProfileRule < catalogRule, 'the personal-profile rule must precede the catalog rule');

  const rule = source.slice(personalProfileRule - 500, catalogRule);
  assert.match(rule, /handler: 'NetworkOnly'/);
});
