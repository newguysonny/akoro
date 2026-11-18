// The shared HTTP core for Akoro's four frontends (Grand Plan Phase 19 step 5).
//
// One source: design-system/client/ → copied into each app's src/client/ by
// `node design-system/sync.mjs` (copy-and-check, same method as the UI kit).
// A contract test fails if a copy differs.
//
// Scope is deliberately small — the part that was copied four times and must
// behave identically:
//   · the API base URL
//   · cookies-only auth (no token in JS memory) with the portal header
//   · one transparent refresh-and-replay on 401, deduped across parallel calls
//   · a per-request deadline, and one error shape (ApiError)
//
// Each app keeps what is its own: endpoint functions, offline cache/queue
// (learner), SSE streaming, hand-off tokens (school).
//
// TypeScript from day one (Phase 20 Part B step 3). Erasable syntax only.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiCoreOptions {
  /** Canonical API origin, e.g. https://api.akoro.name.ng */
  apiBase: string;
  /** Sent as X-Akoro-Portal; decides which session the API reads. */
  portalId: "student" | "admin" | "instructor" | "school";
  /** Per-request deadline. Default 30s: a stalled mobile request never rejects on its own. */
  timeoutMs?: number;
  /** localStorage key holding the signed-in user (default akoro_user). */
  userStorageKey?: string;
  /** Called once when the session is genuinely over, after a failed refresh. */
  onSessionEnd?: (reason: string) => void;
}

export interface RequestOptions {
  timeout?: number;
  signal?: AbortSignal;
  /** Set false for endpoints that must not trigger a refresh (e.g. the refresh route itself). */
  retryOn401?: boolean;
}

export type ApiErrorBody = { message?: string; error?: string; code?: string } & Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  code: string | null;
  body: ApiErrorBody | null;
  path: string;

  constructor(status: number, message: string, path: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? null;
    this.body = body;
    this.path = path;
  }
}

export interface ApiCore {
  readonly API: string;
  request<T = unknown>(method: HttpMethod, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** Spend the refresh cookie once; resolves true when a new access cookie is set. */
  refreshSession(): Promise<boolean>;
  /** Server-reported access-token expiry (ms epoch, 0 when unknown). */
  accessExpiresAt(): number;
  /** Record the expiry the API returned in a sign-in / refresh response. */
  rememberExpiry(json: unknown): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const trimBase = (url: string): string => url.replace(/\/+$/, "");

function toApiError(res: Response, body: ApiErrorBody | null, path: string): ApiError {
  const fallback =
    res.status === 401 ? "Your session expired — please sign in again."
    : res.status === 403 ? "You do not have access to that."
    : res.status === 429 ? "Too many requests — please wait a moment."
    : res.status >= 500 ? "Something went wrong on our side. Please try again."
    : `Request failed (${res.status}).`;
  return new ApiError(res.status, body?.message || body?.error || fallback, path, body);
}

export function createApiCore(options: ApiCoreOptions): ApiCore {
  const API = trimBase(options.apiBase);
  const portalId = options.portalId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userKey = options.userStorageKey ?? "akoro_user";

  let refreshing: Promise<boolean> | null = null;
  let expiresAt = 0;
  let sessionEnded = false;

  const endSession = (reason: string): void => {
    if (sessionEnded) return;
    sessionEnded = true;
    expiresAt = 0;
    try { localStorage.removeItem(userKey); } catch { /* private mode */ }
    if (options.onSessionEnd) options.onSessionEnd(reason);
  };

  const isAbort = (err: unknown): boolean =>
    typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";

  async function fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
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
        const reason = outer?.aborted ? "cancelled" : "timeout";
        throw new ApiError(0, reason === "timeout" ? "The server took too long. Please try again." : "Request cancelled.", url, null);
      }
      throw new ApiError(0, "You appear to be offline. Check your connection.", url, null);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  async function refreshSession(): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const res = await fetchWithTimeout(`${API}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Akoro-Portal": portalId },
        }, timeoutMs);
        if (!res.ok) return false;
        const json = await res.json().catch(() => null);
        rememberExpiry(json);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function rememberExpiry(json: unknown): void {
    const expiresIn = (json as { data?: { expiresIn?: unknown } } | null)?.data?.expiresIn;
    if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
      expiresAt = Date.now() + expiresIn * 1000;
    }
  }

  async function once(method: HttpMethod, path: string, body: unknown, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { "X-Akoro-Portal": portalId };
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return fetchWithTimeout(`${API}${path}`, {
      method,
      headers,
      body: payload,
      credentials: "include",
      signal: opts.signal,
    }, opts.timeout ?? timeoutMs);
  }

  async function request<T>(method: HttpMethod, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    let res = await once(method, path, body, opts);

    if (res.status === 401 && opts.retryOn401 !== false) {
      const refreshed = await refreshSession();
      if (refreshed) {
        res = await once(method, path, body, opts);
      }
      if (!refreshed || res.status === 401 || res.status === 403) {
        endSession("expired");
        throw toApiError(res, await res.json().catch(() => null), path);
      }
    }

    const json = await res.json().catch(() => null) as (ApiErrorBody & { data?: unknown }) | null;
    if (!res.ok) throw toApiError(res, json, path);

    // The API wraps payloads as { success, data }; keep the unwrapping rule here.
    if (json && typeof json === "object" && "data" in json) return json.data as T;
    return json as T;
  }

  return {
    API,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, opts) => request("DELETE", path, undefined, opts),
    refreshSession,
    accessExpiresAt: () => expiresAt,
    rememberExpiry,
  };
}
