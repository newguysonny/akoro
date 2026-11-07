/**
 * Settings groups — the Account tab is a list of these cards; each opens its own page (/settings/<key>) with just
 * that group's options. `title` falls back to the English text when a language file lacks the key.
 */
export const SETTINGS_GROUPS = [
  { key: 'profile',         icon: 'ti-user',         titleKey: 'settings.profile',         title: 'Profile',                       sub: 'Name, username, contact and location' },
  { key: 'learn',           icon: 'ti-school',       titleKey: 'settings.learn_study',     title: 'Learn & Study',                 sub: 'Study level, teaching guide, school and subjects' },
  { key: 'personalization', icon: 'ti-palette',      titleKey: 'settings.personalization', title: 'Personalization & Appearance',  sub: 'Language, display mode and accent colour' },
  { key: 'notifications',   icon: 'ti-bell',         titleKey: 'settings.notifications',   title: 'Notifications',                 sub: 'Channels, reminders and alarm sound' },
  { key: 'plan',            icon: 'ti-coin',         titleKey: 'settings.plan_usage',      title: 'Plan & Usage',                  sub: 'Credit balance, plan and usage' },
  { key: 'security',        icon: 'ti-shield-lock',  titleKey: 'settings.privacy',         title: 'Privacy & Security',            sub: 'Account details, password, two-factor, deactivate or delete' },
  { key: 'help',            icon: 'ti-help-circle',  titleKey: 'settings.help_about',      title: 'Help & About',                  sub: 'Support, terms, privacy policy and version' },
];

/** The Agent tab's groups — pages at /settings/agent/<name>. */
export const AGENT_GROUPS = [
  { key: 'agent/profile',  icon: 'ti-robot',     titleKey: 'settings.agent_profile',  title: 'Agent profile',          sub: 'Name, personality, colour and card background' },
  { key: 'agent/study',    icon: 'ti-school',    titleKey: 'settings.study_profile',  title: 'Study profile',          sub: 'Study level, year, exam board and subjects' },
  { key: 'agent/goals',    icon: 'ti-flag',      titleKey: 'settings.goals',          title: 'Goals',                  sub: 'Goals your agent works towards with you' },
  { key: 'agent/focus',    icon: 'ti-target',    titleKey: 'settings.learning_goal',  title: 'Learning goal',          sub: 'Your main reason for studying' },
  { key: 'agent/autonomy', icon: 'ti-bolt',      titleKey: 'settings.autonomy',       title: 'Autonomy',               sub: 'What your agent does on its own, and when' },
  { key: 'agent/memory',   icon: 'ti-brain',     titleKey: 'settings.memory',         title: 'Memory',                 sub: 'What your agent remembers about you' },
  { key: 'agent/tools',    icon: 'ti-tools',     titleKey: 'settings.my_tools',       title: 'My tools & permissions', sub: 'Tools your agent has and the permissions it asked for' },
  { key: 'agent/network',  icon: 'ti-affiliate', titleKey: 'settings.agent_network',  title: 'Agent network',          sub: 'Agents it talks to, blocked agents, practice' },
];
/** Every group with its translation key for the one-line description. */
const withSub = (g) => ({ ...g, subKey: `settings.gsub.${g.key.replace('agent/', 'agent_')}` });
export const ACCOUNT_CARDS = SETTINGS_GROUPS.map(withSub);
export const AGENT_CARDS = AGENT_GROUPS.map(withSub);
/** t(key) with the English text when the key (or its language) is missing. */
export const tr = (t, key, fallback) => { const v = t(key); return !v || v === key ? fallback : v; };
export const groupOf = (key) => [...SETTINGS_GROUPS, ...AGENT_GROUPS].find((g) => g.key === key) || null;
export const isAgentGroup = (g) => !!g && g.key.startsWith('agent/');
