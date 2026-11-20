// Communities feature — public surface.
//
// A learner's communities: the list and creation page, the community home
// (activity feed, materials rails, New activity sheet), and the settings,
// people, analytics and profile screens. Features only see this file; shared
// code lives in src/{components,contexts,hooks,lib,services,utils,client}.
export { default } from './CommunityPage.jsx';
export { default as CommunityPage } from './CommunityPage.jsx';
export { default as CommunityActivityPage } from './CommunityActivityPage.jsx';
export { default as CommunitySettingsPage } from './CommunitySettingsPage.jsx';
export { default as CommunityPeoplePage } from './CommunityPeoplePage.jsx';
export { default as CommunityAnalyticsPage } from './CommunityAnalyticsPage.jsx';
export { default as CommunityProfilePage } from './CommunityProfilePage.jsx';
export { default as CommunityShell } from './components/CommunityShell.jsx';
export { default as AddToCommunityPage } from './components/AddToCommunityPage.jsx';
export { default as useCommunityHome } from './hooks/useCommunityHome.js';
