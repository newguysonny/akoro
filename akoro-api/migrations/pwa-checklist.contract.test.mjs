import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import test from "node:test";

/**
 * PWA checklist contract — reference/PWA_checklist.md, the four things it
 * asks of the learner app:
 *
 *   install      — native one-tap where beforeinstallprompt exists, and the
 *                  exact manual steps per browser where it doesn't; a
 *                  manifest that Android can clip (dedicated maskable icon)
 *   notifications — Web Push subscribe helpers + a SW that renders pushes
 *                  with vibrate/actions and badges the app icon
 *   wake lock     — the screen stays on while a study session runs
 *   offline       — the Workbox service worker precaches the shell and
 *                  runtime-caches reads, so the app opens with no network
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const dir = "../../akoro-learner/";
const [hook, banner, sheet, siteChrome, manifestRaw, html, pushSw, pushApi, wakeLock, teachModal, decayModal, viteConfig, updatePrompt] = await Promise.all([
  read(dir + "src/hooks/usePwaInstall.js"),
  read(dir + "src/components/common/InstallBanner.jsx"),
  read(dir + "src/components/common/InstallInstructionsSheet.jsx"),
  read(dir + "src/components/SiteChrome.jsx"),
  read(dir + "public/manifest.json"),
  read(dir + "index.html"),
  read(dir + "public/push-sw.js"),
  read(dir + "src/services/pushApi.js"),
  read(dir + "src/hooks/useWakeLock.js"),
  read(dir + "src/components/teaching/TeachAgentModal.jsx"),
  read(dir + "src/components/teaching/DecaySessionModal.jsx"),
  read(dir + "vite.config.js"),
  read(dir + "src/components/common/UpdatePrompt.jsx"),
]);
const manifest = JSON.parse(manifestRaw);

test("install: the hook catches beforeinstallprompt and knows the platform", () => {
  assert.ok(hook.includes("addEventListener('beforeinstallprompt', onPrompt)"), "stashes beforeinstallprompt");
  assert.ok(hook.includes("e.preventDefault(); setDeferred(e);"), "keeps Chrome's mini-infobar down");
  assert.ok(hook.includes("addEventListener('appinstalled', onInstalled)"), "learns when the app is installed");
  assert.ok(hook.includes("(display-mode: standalone)") && hook.includes("window.navigator.standalone === true"),
    "detects already-running-installed (Chrome + iOS Safari)");
  for (const p of ["ios", "android-chrome", "android-firefox", "android-samsung", "desktop", "unknown"]) {
    assert.ok(hook.includes(`'${p}'`), `platform detected: ${p}`);
  }
  assert.ok(hook.includes("await deferred.prompt();") && hook.includes("deferred.userChoice"),
    "install() drives the native prompt and reports the outcome");
  assert.ok(hook.includes("const canInstall = !!deferred && !installed;"), "canInstall gates on not-yet-installed");
  assert.ok(hook.includes("setDeferred(null);   // the prompt object can only be used once"), "the prompt is single-use");
});

test("install: prompt-less browsers get their exact manual steps, not a dead button", () => {
  assert.ok(sheet.includes("const INSTALL_INSTRUCTIONS = {"), "per-platform instruction table");
  for (const p of ["ios:", "'android-chrome':", "'android-firefox':", "'android-samsung':", "desktop:", "unknown:"]) {
    assert.ok(sheet.includes(p), `instructions exist for ${p}`);
  }
  assert.ok(sheet.includes("Google Play Protect warning"), "Samsung Internet warns about Play Protect");
  assert.ok(sheet.includes("Works in Safari only"), "iOS note says which browsers can install");
  assert.ok(sheet.includes("INSTALL_INSTRUCTIONS[platform] || INSTALL_INSTRUCTIONS.unknown"), "an unknown platform still gets generic steps");
  assert.ok(sheet.includes('role="dialog"') && sheet.includes('aria-modal="true"'), "the sheet is a dialog");
  assert.ok(sheet.includes("if (e.target === e.currentTarget) onClose();"), "backdrop tap closes the sheet");
  assert.ok(sheet.includes("Install on {PLATFORM_LABELS[platform]"), "steps are titled with the learner's own platform");
  assert.ok(sheet.includes("{i + 1}"), "steps are numbered");
  // Both install surfaces share the ONE sheet — the steps tables never fork.
  assert.ok(banner.includes("InstallInstructionsSheet"), "the in-app banner uses the shared sheet");
  assert.ok(banner.includes('if (canPrompt) { const r = await promptInstall(); if (r === \'accepted\') dismiss(); return; }'),
    "one tap installs where the native prompt exists");
  assert.ok(banner.includes("setSheetOpen(true);   // no native prompt on this browser"), "otherwise the steps sheet opens");
  assert.ok(siteChrome.includes("InstallInstructionsSheet"), "the landing-page header button uses the same sheet");
  assert.ok(siteChrome.includes("setSheetOpen(true);"), "its no-native-prompt fallback opens the sheet");
  assert.ok(!siteChrome.includes("Add Akoro to your Home Screen"), "the old tiny popover is gone");
});

test("install: the manifest is installable and Android-clippable", async () => {
  assert.equal(manifest.name, "Akoro");
  assert.ok(manifest.short_name, "short_name for the home screen label");
  assert.ok(manifest.id, "stable id");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.start_url, "start_url");
  assert.equal(manifest.background_color, "#0B0818");
  assert.equal(manifest.theme_color, "#6C3BFF");
  const purposes = Object.fromEntries(manifest.icons.filter((i) => i.purpose.includes("any")).map((i) => [i.sizes, i.purpose]));
  assert.ok(purposes["192x192"], "192 any icon");
  assert.ok(purposes["512x512"], "512 any icon");
  const maskable = manifest.icons.find((i) => i.purpose === "maskable");
  assert.ok(maskable && maskable.src === "/favicon-512-maskable.png", "a DEDICATED maskable 512 (not any+maskable on one asset)");
  // The maskable asset exists and is really a full-bleed 512×512 PNG.
  const png = new URL(dir + "public/favicon-512-maskable.png", import.meta.url);
  accessSync(png);
  const bytes = await readFile(png);
  assert.equal(bytes.readUInt32BE(16), 512, "maskable icon is 512 wide");
  assert.equal(bytes.readUInt32BE(20), 512, "maskable icon is 512 tall");
  assert.ok(html.includes('<link rel="manifest" href="/manifest.json" />'), "manifest linked from the document");
  assert.ok(html.includes('name="theme-color"'), "theme-color meta");
  assert.ok(html.includes('rel="apple-touch-icon"') && html.includes('name="apple-mobile-web-app-capable"'), "iOS touch icon + standalone meta");
});

test("notifications: subscribe, render, and badge", () => {
  // Client: VAPID key → Uint8Array → PushManager.subscribe (checklist recipe).
  assert.ok(pushApi.includes("function urlBase64ToUint8Array(base64)"), "VAPID key decoder");
  assert.ok(pushApi.includes("userVisibleOnly: true") && pushApi.includes("applicationServerKey:"), "subscribes with the server key");
  // Service worker: render the push, vibrate, offer actions, badge the icon.
  assert.ok(pushSw.includes("self.addEventListener('push'") && pushSw.includes("self.registration.showNotification"),
    "push → showNotification");
  assert.ok(pushSw.includes("vibrate") && pushSw.includes("[100, 50, 100]"), "vibration pattern");
  assert.ok(pushSw.includes("{ action: 'view',    title: 'View' }") && pushSw.includes("{ action: 'dismiss', title: 'Dismiss' }"),
    "View / Dismiss actions");
  assert.ok(pushSw.includes("navigator.setAppBadge") && pushSw.includes("navigator.clearAppBadge"), "app badge set and cleared");
  assert.ok(pushSw.includes("w.visibilityState === 'visible'"), "badges only while no window shows the app");
  assert.ok(pushSw.includes("self.addEventListener('notificationclick'"), "clicks handled");
  assert.ok(pushSw.includes("if (event.action === 'dismiss')"), "Dismiss closes without navigating");
});

test("wake lock: the screen stays on for every kind of session", () => {
  assert.ok(wakeLock.includes("navigator.wakeLock.request('screen')"), "requests a screen wake lock");
  assert.ok(wakeLock.includes("'wakeLock' in navigator"), "feature-detected — unsupported browsers no-op");
  assert.ok(wakeLock.includes("addEventListener('release'"), "notices browser-initiated releases");
  assert.ok(wakeLock.includes("'visibilitychange'"), "re-acquires when the learner returns to the tab");
  assert.ok(wakeLock.includes("lockRef.current?.release()"), "releases on unmount");
  // Checklist: "for sessions e.g adaptive, video course, teaching,
  // continuation, revision" — TeachAgentModal covers teaching/adaptive/
  // continuation/agent sessions; DecaySessionModal is revision.
  assert.ok(teachModal.includes("useWakeLock();"), "teaching sessions hold the wake lock");
  assert.ok(decayModal.includes("useWakeLock();"), "revision (decay) sessions hold the wake lock");
});

test("offline: the Workbox SW precaches the shell and serves reads offline", () => {
  assert.ok(viteConfig.includes("VitePWA("), "vite-plugin-pwa generates the service worker");
  assert.ok(viteConfig.includes("globPatterns:"), "the app shell is precached — opens with no connection");
  assert.ok(viteConfig.includes("importScripts: ['/push-sw.js']"), "push handlers ride inside the Workbox SW");
  assert.ok(viteConfig.includes("runtimeCaching:"), "reads are runtime-cached");
  assert.ok(viteConfig.includes("handler: 'NetworkFirst'") && viteConfig.includes("handler: 'StaleWhileRevalidate'"),
    "documents prefer the network, catalogs serve instantly");
  assert.ok(viteConfig.includes("skipWaiting: true") && viteConfig.includes("clientsClaim: true")
    && viteConfig.includes("cleanupOutdatedCaches: true"), "new versions take over instead of sticking");
  assert.ok(updatePrompt.includes("registerSW") && updatePrompt.includes("onNeedRefresh"),
    "the app registers the SW and prompts on new versions");
});

test("screenshots: the richer install dialog gets rule-abiding captures", async () => {
  // Checklist screenshot rules: PNG/JPEG only, 320–3840px, max dimension
  // ≤ 2.3× min, same form_factor shares an aspect ratio, narrow = mobile /
  // wide = desktop. (Current captures are branded placeholders — swap the
  // two files in public/screenshots/ for real ones; the rules stay.)
  const shots = manifest.screenshots || [];
  assert.ok(shots.length >= 2 && shots.length <= 8, "at least one capture per form factor, never over the browser cap");
  const byFactor = {};
  for (const s of shots) {
    assert.ok(s.form_factor === "narrow" || s.form_factor === "wide", "form_factor is narrow or wide");
    assert.equal(s.type, "image/png", "PNG format");
    assert.ok(s.label, "each capture is labelled");
    const png = new URL(dir + "public" + s.src, import.meta.url);
    const bytes = await readFile(png);
    assert.equal(bytes.readUInt32BE(0), 0x89504e47, `${s.src} is a real PNG`);
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    const [sw, sh] = s.sizes.split("x").map(Number);
    assert.ok(w >= 320 && h >= 320 && w <= 3840 && h <= 3840, `${s.src} within 320–3840px`);
    assert.equal(w, sw, `${s.src} declared width matches the actual file`);
    assert.equal(h, sh, `${s.src} declared height matches the actual file`);
    assert.ok(Math.max(w, h) / Math.min(w, h) <= 2.3, `${s.src} aspect ratio within the 2.3× rule`);
    if (s.form_factor === "narrow") assert.ok(h > w, "narrow captures are portrait (mobile)");
    else assert.ok(w > h, "wide captures are landscape (desktop)");
    (byFactor[s.form_factor] ||= []).push(`${w}/${h}`);
  }
  for (const [factor, ratios] of Object.entries(byFactor)) {
    assert.ok(new Set(ratios).size === 1, `all ${factor} captures share one aspect ratio`);
  }
});
