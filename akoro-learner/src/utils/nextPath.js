// Where to go after sign-in/sign-up: the `?next=` path, only when it is a path
// on this app ("/join/…"), never another origin ("//evil", "/\evil", "https:").
export function nextPath(search) {
  const n = new URLSearchParams(search || '').get('next');
  return typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : null;
}
