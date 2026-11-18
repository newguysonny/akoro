// GENERATED from design-system/client/authSession.ts — edit it there, then run: node design-system/sync.mjs
// The auth-refresh policy every app copied (Grand Plan Phase 19 step 5).
//
// The API client knows how to spend the refresh cookie. What to do with the
// result — who is signed in now, and whether a failure is a real rejection or
// just a bad minute — is the same rule in all four apps and used to be copied
// into each AuthContext:
//
//   ok                     → the payload carries the user; store it
//   401 / 403             → the server rejected the refresh: sign out
//   anything else (0/429/5xx) → never got an answer: KEEP the session
//
// Pure and React-free so the contexts can keep their own state, timers and
// redirects. Dependency-free and erasable (Node type stripping).

export interface RefreshOutcome {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface AuthRefreshDeps<T> {
  refreshSession: () => Promise<RefreshOutcome>;
  /** Persist the signed-in user (same store the app renders from). */
  saveUser: (user: T) => void;
  /** Clear the signed-in user. */
  clearUser: () => void;
  /** Optional: log a "could not complete" warning, as the apps did. */
  onSoftFailure?: (status: number) => void;
}

export interface AuthRefreshResult<T> {
  /** A user was refreshed and stored. */
  ok: boolean;
  /** The server rejected the refresh — the app must treat the session as over. */
  rejected: boolean;
  /** The user from the refresh payload, when it carried one. */
  user: T | null;
}

/** The user object in a refresh payload: {data:{user}} or {user}. */
export function userFromRefresh(json: unknown): Record<string, unknown> | null {
  const j = json as { data?: { user?: unknown }; user?: unknown } | null;
  const u = j?.data?.user ?? j?.user;
  return u && typeof u === "object" ? (u as Record<string, unknown>) : null;
}

export async function refreshAuth<T>(deps: AuthRefreshDeps<T>): Promise<AuthRefreshResult<T>> {
  const r = await deps.refreshSession();

  if (r.ok) {
    const user = userFromRefresh(r.json) as T | null;
    if (user) deps.saveUser(user);
    return { ok: true, rejected: false, user };
  }

  // Only a real REJECTION ends a session. A 429, a 502 or a dropped
  // connection means we never got an answer — the 30-day refresh cookie is
  // still valid and the next attempt should use it, so the session stays.
  if (r.status === 401 || r.status === 403) {
    deps.clearUser();
    return { ok: false, rejected: true, user: null };
  }

  deps.onSoftFailure?.(r.status);
  return { ok: false, rejected: false, user: null };
}
