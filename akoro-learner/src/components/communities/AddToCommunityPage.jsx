// Compatibility path: the component moved to features/communities (Phase 19
// step 6). The pharmd and course-details lanes still import this path, so it
// re-exports the feature copy until those lanes pick up the new one.
export { default } from '../../features/communities/components/AddToCommunityPage.jsx';
