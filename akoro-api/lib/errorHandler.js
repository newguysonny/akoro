/**
 * lib/errorHandler.js — the 404 and global error contract (Phase 19 step 4).
 *
 * app.js mounts this last, after every router, exactly where the two handlers
 * used to sit. The contract is unchanged: a failure the CALLER caused or can
 * fix is a 4xx carrying a stable machine-readable `code`; a failure inside the
 * server is a 500 that reveals nothing but the instance id.
 */
import { MulterError }        from "multer";
import config                 from "../config/index.js";
import { userFacingMessage }  from "./userFacingError.js";

export function installErrorHandlers(app) {
  // ─── 404 ────────────────────────────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found", code: "not_found" }));

  // ─── Global error handler ───────────────────────────────────────────────────
  // Body-parser faults (bad JSON, oversized body, weird charset) and multer
  // upload errors are client payload problems — reporting them as 500 sends
  // frontends down the "server is broken, retry or give up" path for bodies the
  // CLIENT must fix. Postgres unique violations are the client's conflict to
  // resolve, but their messages name constraints (schema reconnaissance), so
  // the response stays generic.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof MulterError)
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}`, code: err.code });
    if (err?.type === "entity.parse.failed")
      return res.status(400).json({ success: false, message: "Request body is not valid JSON", code: "invalid_json" });
    if (err?.type === "entity.too.large")
      return res.status(413).json({ success: false, message: "Request body is too large", code: "payload_too_large" });
    if (err?.type === "charset.unsupported")
      return res.status(415).json({ success: false, message: "Request body charset is not supported", code: "unsupported_charset" });
    if (err?.code === "23505")
      return res.status(409).json({ success: false, message: "That record already exists", code: "conflict" });
    // Deliberate, typed fail-fast (plan §3.3/§3.4): breaker open or queue full.
    // These carry their own status + Retry-After AND a stable `code` — the code
    // requirement is what separates OUR typed errors from library errors that
    // merely follow the http-errors expose convention (body-parser etc., all
    // classified above). 503, never 500: nothing is broken; the client's correct
    // move is to retry after the window.
    if (err?.expose === true && err?.code && Number.isInteger(err?.statusCode) && err.statusCode >= 400) {
      if (err.retryAfterSec) res.setHeader("Retry-After", String(err.retryAfterSec));
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        code: err.code,
      });
    }
    console.error(`[${config.instanceId.slice(0, 8)}] [ERROR]`, err?.stack || err?.message || err);
    res.status(500).json({
      success: false, message: "Internal server error", code: "internal_error", instance: config.instanceId,
      ...(config.isDev && { stack: err?.stack }),
    });
  });
}
