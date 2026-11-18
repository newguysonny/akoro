import { API } from '../config/urls.js';
import { createApiCore } from '../client/apiCore';

/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend; credentials:
 * 'include' sends them on every request, and no token ever touches JS memory.
 *
 * The session rules themselves live in the shared core
 * (design-system/client/apiCore.ts → src/client): one deduped refresh per tab,
 * refresh-before-the-herd when the expiry is known, a 401 replay, the single
 * error shape and connection state. This file only names the admin portal.
 */

const core = createApiCore({ apiBase: API, portalId: 'admin' });

export { API };

export const {
  rememberExpiry,
  refreshSession,
  onConnectionChange,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
} = core;
