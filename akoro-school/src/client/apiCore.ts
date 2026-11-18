// GENERATED from design-system/client/apiCore.ts — edit it there, then run: node design-system/sync.mjs
// The shared HTTP core for Akoro's four frontends (Grand Plan Phase 19 step 5).
//
// One source: design-system/client/ → copied into each app's src/client/ by
// `node design-system/sync.mjs` (copy-and-check, same method as the UI kit).
// A contract test fails if a copy differs.
//
// Everything here already existed in two or four copies and must behave the
// same everywhere: cookies-only auth with the portal header, one deduped
// refresh per tab, refresh-before-the-herd when the expiry is known, a single
// user-facing error shape, and connection state for the banner.
//
// Each app keeps what is its own: endpoint functions, the learner's offline
// cache/queue and SSE streaming, the school portal's hand-off tokens.
//
// TypeScript from day one (Phase 20 Part B step 3). Erasable syntax only.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiCoreOptions {
  /** Canonical API origin, e.g. https://api.akoro.name.ng */
  apiBase: string;
  /**
   * Sent as X-Akoro-Portal; it decides which session the API reads. The school
   * app passes a getter because it serves two portals (school admin and the
   * public site chat) from one build.
   */
  portalId: string | (() => string);
  /**
   * Adjust the transport per request — the school app uses it to switch from
   * cookies to a tenant-site bearer token (which must omit credentials).
   */
  authorize?: (init: RequestInit) => RequestInit;
  /** localStorage key holding the signed-in user (default akoro_user). */
  sessionUserKey?: string;
  /** localStorage key holding the access-token expiry the API reported. */
  expiryKey?: string;
  /** Where a dead session sends the browser (default /signin?error=session_expired). */
  signInPath?: string;
  /** Per-request deadline in ms; 0/undefined leaves the request unbounded. */
  timeoutMs?: number;
  /**
   * Deadline for the refresh itself, covering the body read too (a hung
   * refresh would otherwise pin every request behind it open). 0/undefined
   * leaves it unbounded. The learner passes 15s.
   */
  refreshTimeoutMs?: number;
  /** Overrides the redirect when a session is genuinely over. */
  onSessionEnd?: () => void;
  /**
   * Replaces the cookie refresh when it returns a promise (the school build
   * refreshes a tenant bearer token, which needs credentials omitted and the
   * token in the body). Returning null keeps the cookie refresh.
   */
  refresh?: () => Promise<RefreshResult> | null;
}

export interface RequestOptions {
  timeout?: number;
  /** Skip the expiry pre-check (the auth endpoints do their own). */
  skipPreRefresh?: boolean;
}

export interface RefreshResult {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ClientError extends Error {
  status?: number;
  path?: string;
  method?: string;
  /** For logs only, never for users. */
  detail?: string;
  isNetwork?: boolean;
  offline?: boolean;
  code?: string | null;
  body?: unknown;
}

export interface ConnectionState {
  ok: boolean;
  offline: boolean;
}

export interface ApiCore {
  readonly API: string;
  /** Record the expiry the API returned (ms epoch) and pass the payload through. */
  rememberExpiry<T>(json: T): T;
  accessExpired(): boolean;
  /** ONE refresh per tab, whoever asks. */
  refreshSession(): Promise<RefreshResult>;
  /** Clear the stored session and send the browser to sign-in. */
  endSession(): void;
  /** fetch + one transparent refresh-and-retry on 401. */
  authedFetch(url: string, init?: RequestInit & { timeout?: number }): Promise<Response>;
  request(method: HttpMethod, path: string, body?: unknown, opts?: RequestOptions): Promise<unknown>;
  apiGet(path: string, opts?: RequestOptions): Promise<unknown>;
  apiPost(path: string, body?: unknown, opts?: RequestOptions): Promise<unknown>;
  apiPut(path: string, body?: unknown, opts?: RequestOptions): Promise<unknown>;
  apiPatch(path: string, body?: unknown, opts?: RequestOptions): Promise<unknown>;
  apiDelete(path: string, opts?: RequestOptions): Promise<unknown>;
  /** Turn a failed response into the error every call site shows. */
  errorFor(res: Response, method: string, path: string): Promise<ClientError>;
  onConnectionChange(fn: (state: ConnectionState) => void): () => void;
}

/* ── Errors users can act on ─────────────────────────────────────────────
   Every call site shows err.message somewhere — a toast, a form, a page. So
   what we throw IS the user-facing copy, and "POST /api/self-study -> 500" is
   not copy. The server's own message wins when there is one; otherwise the
   status becomes a sentence. The technical detail stays on the error object
   (err.status, err.path, err.method, err.detail) for logs and branching. */
const STATUS_COPY: Record<number, string> = {
  400: "Something in that request wasn't right. Check the details and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that — it may have been deleted.",
  409: "That conflicts with something that already exists.",
  413: "That file is too large.",
  422: "Some of those details are not valid. Please check them.",
  429: "That's a lot of requests — please wait a moment and try again.",
  500: "Something went wrong on our side. Please try again.",
  502: "Akoro is having trouble right now. Please try again in a moment.",
  503: "Akoro is temporarily unavailable. Please try again in a moment.",
  504: "That took too long to respond. Please try again.",
};

const isAbort = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";

const trimBase = (url: string): string => url.replace(/\/+$/, "");

export function createApiCore(options: ApiCoreOptions): ApiCore {
  const API = trimBase(options.apiBase);
  const resolvePortal = (): string =>
    typeof options.portalId === "function" ? options.portalId() : options.portalId;
  const userKey = options.sessionUserKey ?? "akoro_user";
  const expiryKey = options.expiryKey ?? "akoro_access_exp";
  const signInPath = options.signInPath ?? "/signin?error=session_expired";
  const defaultTimeout = options.timeoutMs ?? 0;

  let refreshing: Promise<RefreshResult> | null = null;

  function rememberExpiry<T>(json: T): T {
    const payload = json as { accessExpiresAt?: unknown; data?: { accessExpiresAt?: unknown } } | null;
    const exp = payload?.accessExpiresAt ?? payload?.data?.accessExpiresAt;
    if (!exp) return json;
    try { localStorage.setItem(expiryKey, String(exp)); } catch { /* private mode */ }
    return json;
  }

  function accessExpired(): boolean {
    try {
      const at = Number(localStorage.getItem(expiryKey) || 0);
      // 0 = we've never been told; let the request go and 401 if it must.
      return at > 0 && at <= Date.now() + 5000;   // 5s skew for a slow request
    } catch { return false; }
  }

  function forgetExpiry(): void {
    try { localStorage.removeItem(expiryKey); } catch { /* private mode */ }
  }

  function refreshSession(): Promise<RefreshResult> {
    if (!refreshing) {
      const custom = options.refresh?.() ?? null;
      if (custom) {
        refreshing = custom.finally(() => { refreshing = null; });
        return refreshing;
      }
      // One deadline for connection AND body: a refresh whose response stalls
      // mid-body must not pin every request behind it open.
      const refreshTimeout = options.refreshTimeoutMs ?? 0;
      const ctrl = refreshTimeout > 0 ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), refreshTimeout) : null;
      refreshing = fetch(`${API}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Akoro-Portal": resolvePortal() },
        body: "{}",
        signal: ctrl?.signal,
      }).then(async (r) => {
        const json = r.ok ? await r.json().catch(() => null) : null;
        if (json) rememberExpiry(json);
        // The STATUS, not just ok: a 429 or a 502 means we never got an answer,
        // and bouncing someone to /signin for that throws away a live session.
        return { ok: r.ok, status: r.status, json };
      }).catch(() => ({ ok: false, status: 0, json: null }))
        .finally(() => { if (timer) clearTimeout(timer); refreshing = null; });
    }
    return refreshing;
  }

  function endSession(): void {
    forgetExpiry();
    try { localStorage.removeItem(userKey); } catch { /* private mode */ }
    if (options.onSessionEnd) { options.onSessionEnd(); return; }
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/signin")) {
      window.location.href = signInPath;
    }
  }

  /* ── Connection state ──────────────────────────────────────────────────
     Reads that pages choose to swallow still tell us something: whether the
     API is reachable at all. One banner explains an outage that would
     otherwise render as "you have nothing". */
  const connListeners = new Set<(state: ConnectionState) => void>();
  let connOk = true;

  function reportConnection(ok: boolean, offline = false): void {
    if (ok === connOk) return;              // only announce transitions
    connOk = ok;
    connListeners.forEach((fn) => { try { fn({ ok, offline }); } catch { /* a bad listener must not break fetch */ } });
  }

  /* A thrown fetch means the request never reached us — offline, DNS, CORS, a
     dead API. "Failed to fetch" tells the user nothing, so name the likely
     cause and mark it so callers can offer Retry rather than treat it as a bug. */
  function networkError(cause: unknown, method: string, path: string): ClientError {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const err = new Error(offline
      ? "You're offline. Reconnect and try again."
      : "Couldn't reach Akoro. Check your connection and try again.") as ClientError;
    err.isNetwork = true;
    err.offline = offline;
    err.path = path;
    err.method = method;
    err.detail = (cause as { message?: string } | null)?.message || "network error";
    return err;
  }

  async function errorFor(res: Response, method: string, path: string): Promise<ClientError> {
    let serverMsg = "";
    let body: unknown = null;
    try {
      body = await res.json();
      const j = body as { error?: string; message?: string };
      serverMsg = j.error || j.message || "";
    } catch { /* HTML error page or empty body — fall through to the status copy */ }

    const err = new Error(
      serverMsg ||
      STATUS_COPY[res.status] ||
      (res.status >= 500
        ? "Something went wrong on our side. Please try again."
        : "That did not work. Please try again."),
    ) as ClientError;
    err.status = res.status;
    err.path = path;
    err.method = method;
    err.detail = `${method} ${path} -> ${res.status}`;   // for logs, never for users
    err.body = body;
    return err;
  }

  async function fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
    if (!timeout) return fetch(url, init);
    const controller = new AbortController();
    const outer = init.signal;
    const onOuterAbort = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", onOuterAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (isAbort(err)) {
        const timedOut = !outer?.aborted;
        const e = new Error(timedOut
          ? "The server took too long. Please try again."
          : "Request cancelled.") as ClientError;
        e.isNetwork = true;
        e.path = url;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  async function authedFetch(url: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const authed = options.authorize ? options.authorize(init) : init;
    const method = String(authed.method || "GET").toUpperCase();
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const timeout = init.timeout ?? defaultTimeout;

    // Known-expired token: refresh once up front instead of letting every
    // request in this batch discover it independently.
    if (accessExpired()) await refreshSession();

    let res: Response;
    try { res = await fetchWithTimeout(url, authed, timeout); }
    catch (e) {
      reportConnection(false, typeof navigator !== "undefined" && navigator.onLine === false);
      throw e instanceof Error && (e as ClientError).isNetwork ? e : networkError(e, method, path);
    }
    reportConnection(true);

    if (res.status !== 401) return res;
    // Never recurse on the auth endpoints themselves.
    if (url.includes("/api/auth/")) return res;

    const r2 = await refreshSession();
    // Only end the session when the server actually rejected the refresh. A
    // network drop, a rate limit or a gateway error leaves a valid refresh
    // cookie in place — retrying later is right; signing out is not.
    if (!r2.ok) {
      if (r2.status === 401 || r2.status === 403) endSession();
      return res;
    }
    try { return await fetchWithTimeout(url, authed, timeout); }
    catch (e) {
      reportConnection(false, typeof navigator !== "undefined" && navigator.onLine === false);
      throw e instanceof Error && (e as ClientError).isNetwork ? e : networkError(e, method, path);
    }
  }

  async function request(method: HttpMethod, path: string, body?: unknown, opts: RequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { "X-Akoro-Portal": resolvePortal() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await authedFetch(`${API}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: opts.timeout,
    });
    if (!res.ok) throw await errorFor(res, method, path);
    return res.json();
  }

  return {
    API,
    rememberExpiry,
    accessExpired,
    refreshSession,
    endSession,
    authedFetch,
    request,
    apiGet: (path, opts) => request("GET", path, undefined, opts),
    apiPost: (path, body, opts) => request("POST", path, body, opts),
    apiPut: (path, body, opts) => request("PUT", path, body, opts),
    apiPatch: (path, body, opts) => request("PATCH", path, body, opts),
    apiDelete: (path, opts) => request("DELETE", path, undefined, opts),
    errorFor,
    onConnectionChange: (fn) => {
      connListeners.add(fn);
      fn({ ok: connOk, offline: typeof navigator !== "undefined" && navigator.onLine === false });
      return () => { connListeners.delete(fn); };
    },
  };
}
