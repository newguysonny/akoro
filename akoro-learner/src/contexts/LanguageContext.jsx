/**
 * LanguageContext — app-wide i18n.
 *
 * Usage:
 *   const { t, language } = useLang();
 *   <p>{t('nav.learn')}</p>
 *
 * Source of truth is the English (`en`) catalog below. Every other language
 * provides as many keys as it can; any missing key falls back to English.
 */
import { createContext, useContext, useState, useCallback } from 'react';
import { EN } from './i18n/en.js';
import { TRANSLATIONS } from './i18n/index.js';

export const LS_LANGUAGE = 'akoro_language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en',  label: 'English' },
  { code: 'es',  label: 'Spanish' },
  { code: 'pt',  label: 'Portuguese' },
  { code: 'fr',  label: 'French' },
  { code: 'yo',  label: 'Yoruba' },
  { code: 'ig',  label: 'Igbo' },
  { code: 'ha',  label: 'Hausa' },
  { code: 'pcm', label: 'Pidgin' },
  { code: 'ar',  label: 'Arabic' },
];

export const LANG_NAME_TO_CODE = {
  English: 'en', Spanish: 'es', Portuguese: 'pt', French: 'fr',
  Yoruba: 'yo', Igbo: 'ig', Hausa: 'ha', Pidgin: 'pcm', Arabic: 'ar',
};

const STRINGS = { en: EN, ...TRANSLATIONS };

const RTL_CODES = new Set(['ar']);

/* ── Translate helper (falls back to English, then to the key) ─── */
function translate(langCode, key) {
  return STRINGS[langCode]?.[key] ?? STRINGS.en[key] ?? key;
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem(LS_LANGUAGE) || 'English'
  );

  const langCode = LANG_NAME_TO_CODE[language] || 'en';
  const isRtl    = RTL_CODES.has(langCode);

  /* Apply HTML lang + direction on every change */
  const applyLang = (lang) => {
    const code = LANG_NAME_TO_CODE[lang] || 'en';
    document.documentElement.lang = code;
    document.documentElement.dir  = RTL_CODES.has(code) ? 'rtl' : 'ltr';
  };

  // Apply on mount
  applyLang(language);

  const setLanguage = useCallback((lang) => {
    localStorage.setItem(LS_LANGUAGE, lang);
    setLanguageState(lang);
    applyLang(lang);
  }, []);

  const t = useCallback((key) => translate(langCode, key), [langCode]);

  return (
    <LanguageContext.Provider value={{ language, langCode, isRtl, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used inside LanguageProvider');
  return ctx;
}
