/**
 * Shared HTTP shape for the profiles routes. The services answer through these
 * helpers so status codes and JSON bodies stay identical to the single-file
 * router they were split from.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
export const res201 = (res, data)            => res.status(201).json({ success: true,  data });
export const res204 = (res)                  => res.status(204).send();
export const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
export const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
export const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

export const now = () => new Date().toISOString();
