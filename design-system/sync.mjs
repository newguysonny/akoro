#!/usr/bin/env node
/**
 * sync.mjs — copies the UI kit (design-system/ui/) into each app that uses it,
 * as src/ui/. Run after editing the kit:
 *
 *   node design-system/sync.mjs
 *
 * Each copy starts with a "generated" line; a contract test
 * (akoro-api/modules/console-ui-kit.contract.test.mjs) fails if a copy
 * differs from the kit. Why copies, not imports: each app deploys from its own
 * folder (reference/Akoro Console Rebuild — Plan.md).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(HERE, 'ui');
const CLIENT = path.join(HERE, 'client');
const PAGES = path.join(HERE, 'pages');
export const TARGETS = ['akoro-instructor'];
// One shared HTTP core for all four apps (Grand Plan Phase 19 step 5).
export const CLIENT_TARGETS = ['akoro-learner', 'akoro-school', 'akoro-instructor', 'akoro-admin'];
// Shared pages carried identically by the console apps (Grand Plan Phase 19 step 5).
export const PAGE_TARGETS = ['akoro-admin', 'akoro-school'];

export function banner(file, group = 'ui') {
  const line = `GENERATED from design-system/${group}/${file} — edit it there, then run: node design-system/sync.mjs`;
  return file.endsWith('.css') ? `/* ${line} */\n` : `// ${line}\n`;
}
export const kitFiles = () => readdirSync(KIT).filter((f) => /\.(js|jsx|css)$/.test(f)).sort();
export const copyOf = (file) => banner(file) + readFileSync(path.join(KIT, file), 'utf8');
export const clientFiles = () => readdirSync(CLIENT).filter((f) => /\.(ts|tsx|js|css)$/.test(f)).sort();
export const clientCopyOf = (file) => banner(file, 'client') + readFileSync(path.join(CLIENT, file), 'utf8');
export const pageFiles = () => readdirSync(PAGES).filter((f) => /\.(js|jsx|css)$/.test(f)).sort();
export const pageCopyOf = (file) => banner(file, 'pages') + readFileSync(path.join(PAGES, file), 'utf8');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const app of TARGETS) {
    const dir = path.join(HERE, '..', app, 'src', 'ui');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const f of kitFiles()) writeFileSync(path.join(dir, f), copyOf(f));
    console.log(`${app}/src/ui ← ${kitFiles().length} files`);
  }
  for (const app of CLIENT_TARGETS) {
    const dir = path.join(HERE, '..', app, 'src', 'client');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const f of clientFiles()) writeFileSync(path.join(dir, f), clientCopyOf(f));
    console.log(`${app}/src/client ← ${clientFiles().length} files`);
  }
  for (const app of PAGE_TARGETS) {
    const dir = path.join(HERE, '..', app, 'src', 'pages');
    mkdirSync(dir, { recursive: true });
    for (const f of pageFiles()) writeFileSync(path.join(dir, f), pageCopyOf(f));
    console.log(`${app}/src/pages ← ${pageFiles().length} shared pages`);
  }
}
