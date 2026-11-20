/**
 * modules/self-study/http.js — handler plumbing shared by the router and the
 * service layers. Response shapes are the module's public contract:
 * { success: true, data } or { success: false, error }.
 */

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const ok      = (res, data) => res.json({ success: true, data });
export const bad     = (res, m) => res.status(400).json({ success: false, error: m });
export const denied  = (res, m) => res.status(403).json({ success: false, error: m });
export const missing = (res, m) => res.status(404).json({ success: false, error: m });
