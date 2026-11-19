/**
 * auth/service-common.js — request/response plumbing shared by the auth
 * service splits. Pure formatting; no database, no token logic.
 */

import { userFacingMessage } from "../../lib/userFacingError.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const safe = (message) => userFacingMessage(message);
const res400 = (res, message)         => res.status(400).json({ success: false, message: safe(message) });
const res401 = (res, message, code)   => res.status(401).json({ success: false, message: safe(message), ...(code ? { code } : {}) });
const res403 = (res, message)         => res.status(403).json({ success: false, message: safe(message) });
const res404 = (res, message)         => res.status(404).json({ success: false, message: safe(message) });

export { asyncHandler, res200, res201, res400, res401, res403, res404 };
