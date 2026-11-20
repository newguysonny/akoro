// Compatibility path: the component moved to features/network (Phase 19
// step 6). src/App.jsx mounts it and is owned by the app shell, so this
// re-export keeps the shell's import stable without touching the route file.
export { default } from '../../features/network/components/PresenceHeartbeat.jsx';
