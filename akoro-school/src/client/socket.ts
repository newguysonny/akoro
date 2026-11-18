// GENERATED from design-system/client/socket.ts — edit it there, then run: node design-system/sync.mjs
// The shared socket setup for Akoro's frontends (Grand Plan Phase 19 step 5).
//
// One source: design-system/client/ → copied into each app's src/client/ by
// `node design-system/sync.mjs` (copy-and-check, same method as the UI kit).
// A contract test fails if a copy differs.
//
// The session is an HttpOnly cookie, so the socket must carry credentials and
// name the portal whose session it reads. Everything else is the caller's
// choice: only the three options that ever differed between the apps are
// exposed, so the object socket.io-client receives stays the same shape
// everywhere.
//
// Dependency-free and erasable (interfaces only, no enum/namespace) so Node's
// type stripping can import it directly in tests.

export interface SocketOptionsInput {
  portal: string;
  reconnectionDelayMax?: number;
  transports?: string[];
}

export interface SocketOptions {
  withCredentials: true;
  transports: string[];
  auth: { portal: string };
  reconnectionDelayMax?: number;
}

const DEFAULT_TRANSPORTS = ['websocket', 'polling'];

/**
 * Build the options passed to `io(WS_URL, …)`.
 *
 * - `withCredentials` is always true: the JWT lives in an HttpOnly cookie.
 * - `auth.portal` is always the caller's portal, so the server reads the
 *   right session.
 * - `transports` defaults to websocket-then-polling.
 * - `reconnectionDelayMax` is only present when the caller sets it, so the
 *   socket.io-client default applies elsewhere.
 */
export function socketOptions(input: SocketOptionsInput): SocketOptions {
  const options: SocketOptions = {
    withCredentials: true,
    transports: [...(input.transports ?? DEFAULT_TRANSPORTS)],
    auth: { portal: input.portal },
  };
  if (input.reconnectionDelayMax !== undefined) {
    options.reconnectionDelayMax = input.reconnectionDelayMax;
  }
  return options;
}
