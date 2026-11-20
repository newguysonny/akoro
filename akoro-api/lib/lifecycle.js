/**
 * lib/lifecycle.js — process safety nets and graceful shutdown (Phase 19 step 4).
 *
 * app.js installs these at the same point in boot. Behaviour is unchanged:
 * an un-awaited route promise is logged and served, a synchronous throw exits
 * for Render to restart, and SIGTERM/SIGINT drain the listener and the Redis
 * clients before exiting.
 */

export function installProcessSafety() {
  // Express 4 does NOT forward a rejected promise to the error handler, so a
  // single un-awaited failure in any route would otherwise crash the process
  // (Node's default since v15) and take down every chat surface at once — the
  // exact all-chats-down shape of the Sept 2026 outage. Log it loudly and keep
  // serving; the request that lost its promise times out and retries, everyone
  // else keeps working.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason?.stack || reason);
  });
  // A synchronous throw OUTSIDE Express is different: process state is unknown.
  // Log, then exit — Render's restart policy brings the process back cleanly.
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err?.stack || err);
    process.exit(1);
  });
}

export function installShutdown({ httpServer, redisPub, redisSub, config, stopWorkers, setReady }) {
  const shutdown = async (signal) => {
    setReady(false);
    stopWorkers();
    httpServer.close(async () => {
      await redisPub.quit().catch(() => {});
      await redisSub.quit().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), config.server.shutdownTimeout);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  return shutdown;
}
