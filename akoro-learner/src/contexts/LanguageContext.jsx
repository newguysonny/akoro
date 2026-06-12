/**
 * LanguageContext — lightweight i18n for 7 languages.
 *
 * Usage:
 *   const { t, language } = useLang();
 *   <p>{t('nav.learn')}</p>
 *
 * To add a new string: add it to the `STRINGS` object under each language.
 * Missing keys fall back to English automatically.
 */
import { createContext, useContext, useState, useCallback } from 'react';

export const LS_LANGUAGE = 'akoro_language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en',  label: 'English' },
  { code: 'yo',  label: 'Yoruba' },
  { code: 'ig',  label: 'Igbo' },
  { code: 'ha',  label: 'Hausa' },
  { code: 'pcm', label: 'Pidgin' },
  { code: 'fr',  label: 'French' },
  { code: 'ar',  label: 'Arabic' },
];

export const LANG_NAME_TO_CODE = {
  English: 'en', Yoruba: 'yo', Igbo: 'ig',
  Hausa: 'ha', Pidgin: 'pcm', French: 'fr', Arabic: 'ar',
};

/* ── Translation strings ──────────────────────────────────────── */
const STRINGS = {
  en: {
    /* Navigation */
    'nav.learn':      'Learn',
    'nav.discover':   'Discover',
    'nav.rankings':   'Rankings',
    'nav.battles':    'Battles',
    'nav.agent':      'Agent',
    /* Common */
    'common.save':    'Save',
    'common.cancel':  'Cancel',
    'common.loading': 'Loading…',
    'common.error':   'Something went wrong',
    'common.retry':   'Try again',
    'common.back':    'Back',
    'common.signout': 'Sign Out',
    'common.done':    'Done',
    /* Settings */
    'settings.title':          'Settings',
    'settings.account':        'Account',
    'settings.profile':        'Profile',
    'settings.learn_study':    'Learn & Study',
    'settings.personalization':'Personalization & Appearance',
    'settings.language':       'Language',
    'settings.display_mode':   'Display Mode',
    'settings.theme_accent':   'Theme Accent',
    'settings.notifications':  'Notifications',
    'settings.privacy':        'Privacy & Security',
    'settings.change_password':'Change Password',
    'settings.two_factor':     'Two-Factor Auth',
    'settings.deactivate':     'Deactivate Account',
    'settings.delete':         'Delete Account',
    'settings.logout':         'Log out of Akoro?',
    'settings.logout_sub':     "You'll need to sign back in to continue learning with your AI agent.",
    /* Auth */
    'auth.signin':     'Sign in',
    'auth.signup':     'Sign up',
    'auth.email':      'Email',
    'auth.password':   'Password',
    'auth.fullname':   'Full name',
    'auth.username':   'Username',
    'auth.google':     'Continue with Google',
    /* Sessions */
    'sessions.all':        'All',
    'sessions.live':       'Live',
    'sessions.learn':      'Learn',
    'sessions.empty':      'No sessions yet',
    'sessions.start':      'Start a session',
    /* Agent */
    'agent.my_agent':       'My Agent',
    'agent.level':          'Level',
    'agent.xp':             'XP',
    'agent.sessions_done':  'Sessions Done',
    'agent.total_turns':    'Total Turns',
    /* Battles */
    'battles.title':    'Battles',
    'battles.empty':    'No battles yet',
    /* Rankings */
    'rankings.title':   'Rankings',
    /* Discovery */
    'discovery.title':  'Discover Agents',
    'discovery.search': 'Search agents…',
    'discovery.free':   'Free',
    'discovery.buy':    'Purchase',
    'discovery.use':    'Use',
  },

  yo: {
    'nav.learn':      'Kọ',
    'nav.discover':   'Ṣàwárí',
    'nav.rankings':   'Ìpín',
    'nav.battles':    'Ìjà',
    'nav.agent':      'Aṣojú',
    'common.save':    'Fipamọ́',
    'common.cancel':  'Fagilé',
    'common.loading': 'Ngbàrá…',
    'common.error':   'Ìṣòro kan wà',
    'common.retry':   'Gbìyànjú mọ́',
    'common.back':    'Padà',
    'common.signout': 'Jáde',
    'common.done':    'Parí',
    'settings.title':          'Ètò',
    'settings.account':        'Àkọ́sílẹ̀',
    'settings.profile':        'Àwòrán',
    'settings.language':       'Èdè',
    'settings.display_mode':   'Ọ̀nà Ìfihàn',
    'settings.notifications':  'Ìkìlọ̀',
    'settings.change_password':'Yí Ọ̀rọ̀ Àṣírí Padà',
    'settings.deactivate':     'Paarẹ Àkọ́sílẹ̀ Rẹ Ní Àárọ̀',
    'settings.delete':         'Parí Àkọ́sílẹ̀ Rẹ',
    'settings.logout':         'Jáde kúrò ní Akoro?',
    'settings.logout_sub':     'Ìwọ yóò nílò láti wọlé mọ́ láti tẹ́síwájú kíkọ́.',
    'auth.signin':     'Wọlé',
    'auth.signup':     'Forúkọsílẹ̀',
    'auth.email':      'Ímeèlì',
    'auth.password':   'Ọ̀rọ̀ Àṣírí',
    'sessions.all':    'Gbogbo',
    'sessions.live':   'Àárọ̀',
    'sessions.empty':  'Kò sí ìgbẹ̀kẹ̀ẹ̀jẹ̀ títán',
    'discovery.title': 'Ṣàwárí Aṣojú',
    'discovery.search':'Wá aṣojú…',
    'discovery.free':  'Ọfẹ',
    'discovery.buy':   'Rà',
    'discovery.use':   'Lò',
  },

  ig: {
    'nav.learn':      'Mụọ',
    'nav.discover':   'Chọpụta',
    'nav.rankings':   'Ọkwa',
    'nav.battles':    'Ọgụ',
    'nav.agent':      'Nnọchiteanya',
    'common.save':    'Chekwa',
    'common.cancel':  'Kagbuo',
    'common.loading': 'Na-ebu…',
    'common.error':   'Ihe ọjọọ mere',
    'common.retry':   'Nwaa ọzọ',
    'common.back':    'Laghachi',
    'common.signout': 'Pụọ',
    'common.done':    'Mechaa',
    'settings.title':          'Ntọala',
    'settings.account':        'Akaụntụ',
    'settings.profile':        'Profaịlụ',
    'settings.language':       'Asụsụ',
    'settings.display_mode':   'Ọnọdụ Ngosi',
    'settings.notifications':  'Ọkwa',
    'settings.change_password':'Gbanwee Okwuntughe',
    'settings.deactivate':     'Mechie Akaụntụ',
    'settings.delete':         'Hichapụ Akaụntụ',
    'settings.logout':         'Pụọ na Akoro?',
    'settings.logout_sub':     'Ị ga-achọ ịbanye ọzọ ịga n\'ihu ọmụmụ.',
    'auth.signin':     'Banye',
    'auth.signup':     'Debanye aha',
    'auth.email':      'Ịmêlụ',
    'auth.password':   'Okwuntughe',
    'sessions.all':    'Niile',
    'sessions.live':   'Dị ndụ',
    'sessions.empty':  'Enweghị oge nkuzi',
    'discovery.title': 'Chọpụta Ndị Nnọchiteanya',
    'discovery.search':'Chọọ ndị nnọchiteanya…',
    'discovery.free':  'Efu',
    'discovery.buy':   'Zụta',
    'discovery.use':   'Jiri',
  },

  ha: {
    'nav.learn':      'Koyi',
    'nav.discover':   'Gano',
    'nav.rankings':   'Matsayi',
    'nav.battles':    'Fafatawa',
    'nav.agent':      'Wakili',
    'common.save':    'Adana',
    'common.cancel':  'Soke',
    'common.loading': 'Ana lodi…',
    'common.error':   'An sami matsala',
    'common.retry':   'Sake gwadawa',
    'common.back':    'Koma',
    'common.signout': 'Fita',
    'common.done':    'An gama',
    'settings.title':          'Saiti',
    'settings.account':        'Asusun',
    'settings.profile':        'Bayanin kai',
    'settings.language':       'Harshe',
    'settings.display_mode':   'Yanayin Nunawa',
    'settings.notifications':  'Sanarwa',
    'settings.change_password':'Canza Kalmar Sirri',
    'settings.deactivate':     'Dakatar da Asusun',
    'settings.delete':         'Share Asusun',
    'settings.logout':         'Fita daga Akoro?',
    'settings.logout_sub':     'Za ka buƙaci shiga cikin gida domin ci gaba da koyo.',
    'auth.signin':     'Shiga',
    'auth.signup':     'Yi rijista',
    'auth.email':      'Imel',
    'auth.password':   'Kalmar sirri',
    'sessions.all':    'Duka',
    'sessions.live':   'Kai tsaye',
    'sessions.empty':  'Babu zaman koyarwa',
    'discovery.title': 'Nemo Wakili',
    'discovery.search':'Nemi wakili…',
    'discovery.free':  'Kyauta',
    'discovery.buy':   'Saya',
    'discovery.use':   'Yi amfani',
  },

  pcm: {
    'nav.learn':      'Learn',
    'nav.discover':   'Discover',
    'nav.rankings':   'Rankings',
    'nav.battles':    'Battles',
    'nav.agent':      'Agent',
    'common.save':    'Save am',
    'common.cancel':  'Cancel',
    'common.loading': 'E dey load…',
    'common.error':   'Wahala don happen',
    'common.retry':   'Try again',
    'common.back':    'Go back',
    'common.signout': 'Sign Out',
    'common.done':    'E don do',
    'settings.title':          'Settings',
    'settings.account':        'Account',
    'settings.profile':        'Profile',
    'settings.language':       'Language',
    'settings.display_mode':   'Display Mode',
    'settings.notifications':  'Notification',
    'settings.change_password':'Change Password',
    'settings.deactivate':     'Deactivate Account',
    'settings.delete':         'Delete Account',
    'settings.logout':         'You wan comot for Akoro?',
    'settings.logout_sub':     'You go need sign in again to continue your learning.',
    'auth.signin':     'Sign in',
    'auth.signup':     'Register',
    'auth.email':      'Email',
    'auth.password':   'Password',
    'sessions.all':    'All',
    'sessions.live':   'Live',
    'sessions.empty':  'No session yet',
    'discovery.title': 'Find Agents',
    'discovery.search':'Search agents…',
    'discovery.free':  'Free',
    'discovery.buy':   'Buy',
    'discovery.use':   'Use',
  },

  fr: {
    'nav.learn':      'Apprendre',
    'nav.discover':   'Découvrir',
    'nav.rankings':   'Classements',
    'nav.battles':    'Batailles',
    'nav.agent':      'Agent',
    'common.save':    'Enregistrer',
    'common.cancel':  'Annuler',
    'common.loading': 'Chargement…',
    'common.error':   'Une erreur s\'est produite',
    'common.retry':   'Réessayer',
    'common.back':    'Retour',
    'common.signout': 'Déconnexion',
    'common.done':    'Terminé',
    'settings.title':          'Paramètres',
    'settings.account':        'Compte',
    'settings.profile':        'Profil',
    'settings.learn_study':    'Apprentissage',
    'settings.personalization':'Personnalisation',
    'settings.language':       'Langue',
    'settings.display_mode':   'Mode d\'affichage',
    'settings.theme_accent':   'Couleur d\'accent',
    'settings.notifications':  'Notifications',
    'settings.privacy':        'Confidentialité',
    'settings.change_password':'Changer le mot de passe',
    'settings.two_factor':     'Authentification à deux facteurs',
    'settings.deactivate':     'Désactiver le compte',
    'settings.delete':         'Supprimer le compte',
    'settings.logout':         'Déconnexion d\'Akoro ?',
    'settings.logout_sub':     'Vous devrez vous reconnecter pour continuer à apprendre.',
    'auth.signin':     'Se connecter',
    'auth.signup':     'S\'inscrire',
    'auth.email':      'Courriel',
    'auth.password':   'Mot de passe',
    'sessions.all':    'Tous',
    'sessions.live':   'En direct',
    'sessions.empty':  'Aucune session',
    'discovery.title': 'Découvrir les agents',
    'discovery.search':'Rechercher des agents…',
    'discovery.free':  'Gratuit',
    'discovery.buy':   'Acheter',
    'discovery.use':   'Utiliser',
  },

  ar: {
    'nav.learn':      'تعلّم',
    'nav.discover':   'اكتشف',
    'nav.rankings':   'الترتيب',
    'nav.battles':    'المعارك',
    'nav.agent':      'الوكيل',
    'common.save':    'حفظ',
    'common.cancel':  'إلغاء',
    'common.loading': 'جارٍ التحميل…',
    'common.error':   'حدث خطأ ما',
    'common.retry':   'أعد المحاولة',
    'common.back':    'رجوع',
    'common.signout': 'تسجيل الخروج',
    'common.done':    'تم',
    'settings.title':          'الإعدادات',
    'settings.account':        'الحساب',
    'settings.profile':        'الملف الشخصي',
    'settings.language':       'اللغة',
    'settings.display_mode':   'وضع العرض',
    'settings.notifications':  'الإشعارات',
    'settings.change_password':'تغيير كلمة المرور',
    'settings.deactivate':     'تعطيل الحساب',
    'settings.delete':         'حذف الحساب',
    'settings.logout':         'تسجيل الخروج من Akoro؟',
    'settings.logout_sub':     'ستحتاج إلى تسجيل الدخول مرة أخرى للاستمرار في التعلم.',
    'auth.signin':     'تسجيل الدخول',
    'auth.signup':     'إنشاء حساب',
    'auth.email':      'البريد الإلكتروني',
    'auth.password':   'كلمة المرور',
    'sessions.all':    'الكل',
    'sessions.live':   'مباشر',
    'sessions.empty':  'لا توجد جلسات',
    'discovery.title': 'اكتشف الوكلاء',
    'discovery.search':'ابحث عن وكلاء…',
    'discovery.free':  'مجاني',
    'discovery.buy':   'شراء',
    'discovery.use':   'استخدام',
  },
};

/* ── Translate helper (falls back to English) ─────────────────── */
function translate(strings, langCode, key) {
  return strings[langCode]?.[key] ?? strings.en[key] ?? key;
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem(LS_LANGUAGE) || 'English'
  );

  const langCode = LANG_NAME_TO_CODE[language] || 'en';
  const isRtl    = langCode === 'ar';

  /* Apply HTML lang + direction on every change */
  const applyLang = (lang) => {
    const code = LANG_NAME_TO_CODE[lang] || 'en';
    document.documentElement.lang = code;
    document.documentElement.dir  = code === 'ar' ? 'rtl' : 'ltr';
  };

  // Apply on mount
  applyLang(language);

  const setLanguage = useCallback((lang) => {
    localStorage.setItem(LS_LANGUAGE, lang);
    setLanguageState(lang);
    applyLang(lang);
  }, []);

  const t = useCallback((key) => translate(STRINGS, langCode, key), [langCode]);

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
