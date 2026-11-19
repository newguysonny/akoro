/**
 * Shared i18n logic (Grand Plan Phase 19 step 5).
 *
 * Only the *mechanism* lives here — language detection, dictionary lookup,
 * fallback and `{var}` interpolation. Every app keeps its own catalogs: this
 * module is dependency-free, framework-free and erasable TypeScript so Node's
 * type stripping can load it directly in tests.
 */

export type Dictionary = Record<string, string>;
export type Dictionaries = Record<string, Dictionary | undefined>;

/** A supported language: a bare code, or a `{ code, label }` entry. */
export type LanguageEntry = string | { code: string; label?: string };

export interface StorageLike {
  getItem(key: string): string | null;
}

export interface DetectLanguageOptions {
  supported: readonly LanguageEntry[];
  fallback?: string;
  storageKey?: string;
  /** Defaults to the global `localStorage` when present; pass `null` to skip. */
  storage?: StorageLike | null;
  /** Overrides the browser's locale list (tests, SSR). */
  languages?: readonly string[];
  /** The learner ignored the browser locale; pass `false` to keep that behaviour. */
  detectBrowser?: boolean;
}

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const entryCode = (entry: LanguageEntry): string =>
  typeof entry === 'string' ? entry : entry.code;

const entryLabel = (entry: LanguageEntry): string | undefined =>
  typeof entry === 'string' ? undefined : entry.label;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function browserLanguages(override?: readonly string[]): readonly string[] {
  if (override) return override;
  if (typeof navigator === 'undefined') return [];
  const nav = navigator as Navigator & { languages?: readonly string[]; language?: string };
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
  return nav.language ? [nav.language] : [];
}

/** Match a code, a display label (`English`), or a primary subtag (`en-US`). */
function matchLanguage(value: string | null | undefined, supported: readonly LanguageEntry[]): string | null {
  if (!value) return null;
  const wanted = String(value).trim().toLowerCase();
  if (!wanted) return null;

  for (const entry of supported) {
    const code = entryCode(entry);
    if (code.toLowerCase() === wanted) return code;
    const label = entryLabel(entry);
    if (label && label.toLowerCase() === wanted) return code;
  }

  const base = wanted.split(/[-_]/)[0];
  if (base && base !== wanted) {
    for (const entry of supported) {
      const code = entryCode(entry);
      if (code.toLowerCase() === base) return code;
    }
  }
  return null;
}

/**
 * Stored preference first, then the browser's locale list, then `fallback`.
 * Anything unrecognised is skipped rather than returned as-is.
 */
export function detectLanguage(options: DetectLanguageOptions): string {
  const {
    supported,
    fallback = 'en',
    storageKey,
    storage,
    languages,
    detectBrowser = true,
  } = options;

  const store = storage === undefined ? defaultStorage() : storage;
  if (storageKey && store) {
    const stored = matchLanguage(store.getItem(storageKey), supported);
    if (stored) return stored;
  }

  if (detectBrowser) {
    for (const tag of browserLanguages(languages)) {
      const hit = matchLanguage(tag, supported);
      if (hit) return hit;
    }
  }

  return matchLanguage(fallback, supported) ?? entryCode(supported[0] ?? fallback) ?? fallback;
}

function interpolateValue(template: string, name: string, vars: Record<string, unknown>): string {
  const value = vars[name];
  return value === undefined || value === null ? `{${name}}` : String(value);
}

/**
 * Replace `{name}` placeholders. A missing variable leaves its placeholder
 * untouched, so callers that pass no vars (the learner's existing keys) see
 * exactly the same text as before.
 */
export function interpolate(template: string, vars?: Record<string, unknown> | null): string {
  if (typeof template !== 'string' || !vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    hasOwn(vars, name) ? interpolateValue(template, name, vars) : match,
  );
}

export interface TranslatorOptions {
  dictionaries: Dictionaries;
  /** Language code to translate into; defaults to `fallback`. */
  language?: string;
  fallback?: string;
}

export interface Translator {
  language: string;
  t(key: string, vars?: Record<string, unknown> | null): string;
  has(key: string): boolean;
}

/**
 * Lookup order: the selected dictionary, then the fallback dictionary, then
 * the key itself. Values are never coerced, so an empty string stays empty.
 */
export function createTranslator(options: TranslatorOptions): Translator {
  const { dictionaries, fallback = 'en' } = options;
  const language = options.language || fallback;
  const primary = dictionaries[language];
  const backup = dictionaries[fallback];

  const lookup = (key: string): string | undefined => {
    if (primary && typeof primary[key] === 'string') return primary[key];
    if (backup && typeof backup[key] === 'string') return backup[key];
    return undefined;
  };

  return {
    language,
    has: (key: string) => lookup(key) !== undefined,
    t: (key: string, vars?: Record<string, unknown> | null) => interpolate(lookup(key) ?? key, vars),
  };
}
