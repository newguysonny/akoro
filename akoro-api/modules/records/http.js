/**
 * modules/records/http.js — Express response helpers shared by the records
 * routes and their services. No behaviour of its own: each helper writes the
 * same envelope the router has always returned.
 */

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const res200 = (res, data) => res.status(200).json({ success: true, data });
export const res201 = (res, data) => res.status(201).json({ success: true, data });
export const res400 = (res, msg)  => res.status(400).json({ success: false, message: msg });
export const res403 = (res, msg)  => res.status(403).json({ success: false, message: msg });
export const res404 = (res, msg)  => res.status(404).json({ success: false, message: msg });
export const res422 = (res, msg)  => res.status(422).json({ success: false, message: msg });
export const res500 = (res, msg)  => res.status(500).json({ success: false, message: msg || "Something went wrong." });
export const res503 = (res, msg)  => res.status(503).json({ success: false, message: msg || "File storage is not configured on this deployment — set the R2_* variables." });

export const okExtract = (res, data) => res.json({ success: true, data });
