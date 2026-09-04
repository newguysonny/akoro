/**
 * LanguageMenu — the flag picker in the site header.
 *
 * It replaced three static emoji (🇺🇸 🇲🇽 🇨🇳) that were decoration: they were
 * not buttons, two of the three were languages the app does not speak, and
 * neither of the languages most of our learners actually use — Yoruba, Igbo,
 * Hausa, Pidgin — was among them. A row of flags implies a choice, and there
 * was none.
 *
 * Flags stand for LANGUAGES here, which is a compromise worth naming: a flag is
 * a country, not a language, and there is no flag for Pidgin, Yoruba, Igbo or
 * Hausa that is not also the flag of Nigeria. So every option carries its
 * language name in its own script beside the flag, and the name is what the
 * choice actually rests on — the flag is a landmark for scanning, not the
 * label.
 */
import { useState, useRef, useEffect } from 'react';
import { useLang, SUPPORTED_LANGUAGES } from '../contexts/LanguageContext.jsx';

/**
 * Flag and endonym per language.
 *
 * Endonyms — the name a language uses for itself — because someone looking for
 * Yoruba is looking for "Yorùbá", and a menu that only says "Yoruba" in English
 * is asking them to read the language they came here to leave.
 */
const LANG_META = {
  English:    { flag: '\u{1F1EC}\u{1F1E7}', native: 'English' },
  Pidgin:     { flag: '\u{1F1F3}\u{1F1EC}', native: 'Naijá' },
  Yoruba:     { flag: '\u{1F1F3}\u{1F1EC}', native: 'Yorùbá' },
  Igbo:       { flag: '\u{1F1F3}\u{1F1EC}', native: 'Ìgbò' },
  Hausa:      { flag: '\u{1F1F3}\u{1F1EC}', native: 'Hausa' },
  French:     { flag: '\u{1F1EB}\u{1F1F7}', native: 'Français' },
  Spanish:    { flag: '\u{1F1EA}\u{1F1F8}', native: 'Español' },
  Portuguese: { flag: '\u{1F1F5}\u{1F1F9}', native: 'Português' },
  Arabic:     { flag: '\u{1F1F8}\u{1F1E6}', native: 'العربية' },
};

/** Menu order: what a Nigerian learner is most likely to want, first. */
const ORDER = ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French', 'Spanish', 'Portuguese', 'Arabic'];

export default function LanguageMenu({ dark = true }) {
  const { language, setLanguage, t } = useLang();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on an outside click or Escape. A menu that can only be dismissed by
  // choosing something traps a visitor who opened it to look.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const codes   = new Set(SUPPORTED_LANGUAGES.map((l) => l.label));
  const options = ORDER.filter((name) => codes.has(name));
  const current = LANG_META[language] ?? LANG_META.English;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('landing.choose_language')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px',
          borderRadius: 6, cursor: 'pointer', fontSize: 13, lineHeight: 1,
          background: dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)',
          border: `1px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}`,
          color: dark ? '#fff' : '#333',
        }}>
        <span style={{ fontSize: 15 }}>{current.flag}</span>
        {/* The name, not just the flag — a flag alone makes the reader guess. */}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{current.native}</span>
        <span style={{ fontSize: 9, opacity: .7 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('landing.choose_language')}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 1000,
            minWidth: 178, maxHeight: '60vh', overflowY: 'auto',
            margin: 0, padding: 4, listStyle: 'none',
            background: '#FFFFFF', color: '#1A1A2E',
            border: '1px solid rgba(0,0,0,.10)', borderRadius: 10,
            boxShadow: '0 10px 28px rgba(0,0,0,.22)',
          }}>
          {options.map((name) => {
            const meta = LANG_META[name];
            const isCurrent = name === language;
            return (
              <li key={name} role="option" aria-selected={isCurrent}>
                <button
                  type="button"
                  onClick={() => { setLanguage(name); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '8px 10px', border: 'none', borderRadius: 7, cursor: 'pointer',
                    textAlign: 'left', fontSize: 13.5,
                    background: isCurrent ? 'rgba(108,59,255,.10)' : 'transparent',
                    fontWeight: isCurrent ? 700 : 500,
                    color: '#1A1A2E',
                  }}>
                  <span style={{ fontSize: 16 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.native}</span>
                  {/* The English name too, in small type: someone who cannot yet
                      read the endonym still needs to find their language. */}
                  {meta.native !== name && (
                    <span style={{ fontSize: 10.5, opacity: .5 }}>{name}</span>
                  )}
                  {isCurrent && <span style={{ color: '#6C3BFF', fontWeight: 800 }}>{'✓'}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
