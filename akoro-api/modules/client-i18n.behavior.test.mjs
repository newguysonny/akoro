// Behaviour of the shared i18n core (Grand Plan Phase 19 step 5): detection
// precedence, dictionary fallback and `{var}` interpolation. The module is
// dependency-free TypeScript that Node 24 loads by stripping the types.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTranslator,
  detectLanguage,
  interpolate,
} from "../../design-system/client/i18n.ts";

function stubStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return map;
}

function stubNavigator(languages) {
  Object.defineProperty(globalThis, "navigator", {
    value: { languages, language: languages[0] },
    configurable: true,
  });
}

const SUPPORTED = ['en', 'es', 'fr', 'ar'];
const detect = (overrides = {}) => detectLanguage({
  supported: SUPPORTED,
  fallback: 'en',
  storageKey: 'akoro_language',
  ...overrides,
});

test("detection: stored wins over browser, browser wins over fallback", () => {
  stubNavigator(['fr-FR', 'fr']);
  stubStorage({ akoro_language: 'es' });
  assert.equal(detect(), 'es', "the stored preference is first");

  stubStorage({});
  assert.equal(detect(), 'fr', "the browser locale is second");
});

test("detection: unknown stored/browser values fall through to the fallback", () => {
  stubNavigator(['de-DE']);
  stubStorage({ akoro_language: 'klingon' });
  assert.equal(detect(), 'en', "unknown values are skipped, never returned");

  stubStorage({});
  assert.equal(detect({ fallback: 'es' }), 'es', "the caller's fallback is used");

  assert.equal(detect({ detectBrowser: false }), 'en', "browser detection can be off");
});

test("detection matches codes, display labels and primary subtags", () => {
  stubStorage({ akoro_language: 'English' });
  assert.equal(
    detect({ supported: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }] }),
    'en',
    "the learner stores language names",
  );

  stubStorage({ akoro_language: 'pt-BR' });
  assert.equal(
    detect({ supported: [{ code: 'pt', label: 'Portuguese' }], detectBrowser: false }),
    'pt',
    "a regional tag falls back to its primary subtag",
  );

  stubStorage({ akoro_language: 'EN' });
  assert.equal(detect(), 'en', "matching is case-insensitive");
});

test("t falls back to English, then to the key", () => {
  const translator = createTranslator({
    language: 'fr',
    fallback: 'en',
    dictionaries: {
      en: { only_en: 'English only', shared: 'Shared' },
      fr: { shared: 'Partagé', empty: '' },
    },
  });

  assert.equal(translator.t('shared'), 'Partagé');
  assert.equal(translator.t('only_en'), 'English only', "missing French keys fall back to English");
  assert.equal(translator.t('nowhere'), 'nowhere', "a key in neither catalog is returned as-is");
  assert.equal(translator.t('empty'), '', "an empty translation stays empty");
  assert.equal(translator.language, 'fr');
  assert.equal(translator.has('only_en'), true, "has sees the English fallback");
  assert.equal(translator.has('nowhere'), false);
});

test("t interpolates {vars} and keeps placeholders that have no value", () => {
  const translator = createTranslator({
    dictionaries: { en: { greeting: 'Hi {name}, {n} new', bare: '{n} picked' } },
  });

  assert.equal(translator.t('greeting', { name: 'Ada', n: 3 }), 'Hi Ada, 3 new');
  assert.equal(translator.t('greeting', { name: 'Ada' }), 'Hi Ada, {n} new', "missing vars are left alone");
  assert.equal(translator.t('bare'), '{n} picked', "no vars means unchanged text");
  assert.equal(interpolate('{a}/{b}', { a: 0, b: 1 }), '0/1', "zero is a value");
});

test("the shared module is framework-free", () => {
  const src = readFileSync(
    new URL("../../design-system/client/i18n.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(src, /from\s+["']react["']/, "no React import");
  assert.doesNotMatch(src, /\bReact\b/, "no React references");
  assert.doesNotMatch(src, /^\s*import\s/m, "no imports at all");
});
