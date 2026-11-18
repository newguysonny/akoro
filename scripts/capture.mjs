#!/usr/bin/env node
// Captures an authenticated screenshot of the Akoro learner app using a demo
// account and saves it to docs/screenshots/. Used for the preview workflow:
// make a change -> capture -> push to the preview branch -> review on GitHub.
//
// Usage:
//   node scripts/capture.mjs <route> [outputName] [viewportWidth]
//   node scripts/capture.mjs /app learner-dashboard 1280
//
// Env overrides:
//   AKORO_APP_URL, AKORO_DEMO_EMAIL, AKORO_DEMO_PASSWORD, AKORO_OUT_DIR
//
// AKORO_OUT_DIR=/artifacts/screenshots keeps previews out of the repo: the
// platform auto-commits and pushes the worktree, and the branch auto-deploys,
// so a screenshot written under docs/ ships to production.
//
// Requires Playwright + Chromium once per sandbox:
//   npm i playwright && npx playwright install chromium

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.AKORO_APP_URL || 'https://app.akoro.ng';
const EMAIL = process.env.AKORO_DEMO_EMAIL || 'stu.jss11@demo.akoro.app';
const PASSWORD = process.env.AKORO_DEMO_PASSWORD || 'Priya2026';

const route = process.argv[2] || '/';
const name = process.argv[3] || 'preview';
const width = Number(process.argv[4] || 1280);

const outDir = (process.env.AKORO_OUT_DIR || 'docs/screenshots').replace(/\/+$/, '');
const out = `${outDir}/${name}.png`;
mkdirSync(outDir, { recursive: true });

const target = APP + (route.startsWith('/') ? route : `/${route}`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 800 }, ignoreHTTPSErrors: true });

async function signedIn() {
  return page.evaluate(() => {
    try { return !!localStorage.getItem('akoro_user'); } catch { return false; }
  });
}

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForTimeout(2000);

if (page.url().includes('/signin') || !(await signedIn())) {
  if (!page.url().includes('/signin')) {
    await page.goto(`${APP}/signin`, { waitUntil: 'domcontentloaded', timeout: 40000 });
  }
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(5000);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(4000);
}

await page.screenshot({ path: out, fullPage: false });
console.log(`captured: ${out} -> ${page.url()}`);
await browser.close();
