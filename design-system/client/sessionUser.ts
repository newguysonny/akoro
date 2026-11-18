// The safe user object in localStorage (Grand Plan Phase 19 step 5).
//
// Every app cached the signed-in user the same way: JSON in a localStorage key
// called akoro_user, read defensively on boot. This is that logic once. The
// copies are generated into each app's src/client/ by `node design-system/sync.mjs`.
//
// Only the SAFE USER OBJECT is cached here — id, name, role, onboarding flags,
// the fields the UI renders. Tokens never touch JavaScript: the access and
// refresh tokens stay in HttpOnly cookies set by the API. Nothing in this
// module ever reads or writes a token.
//
// Storage may be unavailable (Safari private mode, blocked third-party
// storage, a quota error). Every method is best-effort and never throws: a
// failed read is null, a failed write is a no-op, so auth flows keep working
// for the life of the page even when persistence does not.
//
// TypeScript, dependency-free, erasable syntax only (Node type stripping,
// Phase 20 Part B).

export interface SessionUserStore<T = Record<string, unknown>> {
  /** The cached user, or null when absent, malformed, or storage is blocked. */
  read(): T | null;
  /** Cache the user and hand it back (storage failure is not an error). */
  save(user: T): T;
  /** Remove only this store's key (never throws). */
  clear(): void;
}

export function createSessionUser<T = Record<string, unknown>>(
  options: { userKey?: string } = {},
): SessionUserStore<T> {
  const userKey = options.userKey ?? "akoro_user";

  function read(): T | null {
    try {
      const raw = localStorage.getItem(userKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      // A cached user is always an object; anything else is stale garbage.
      return parsed === null || typeof parsed !== "object" ? null : (parsed as T);
    } catch {
      return null;
    }
  }

  function save(user: T): T {
    try { localStorage.setItem(userKey, JSON.stringify(user)); } catch { /* private mode */ }
    return user;
  }

  function clear(): void {
    try { localStorage.removeItem(userKey); } catch { /* private mode */ }
  }

  return { read, save, clear };
}
