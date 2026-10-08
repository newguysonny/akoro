// cf/cron-ticker/src/worker.js
//
// The edge clock. Cloudflare fires `scheduled` on each cron below; the
// worker pokes the API's internal tick endpoint with the same shared
// secret every internal seam uses. It carries NO business logic — the
// API owns what each tick does; this only owns when it happens.
//
// Benefits over in-process node-cron: ticks fire on time across API
// deploys/restarts, they wake a sleeping free-tier Render instance,
// and they never drift with server timezone.

const TICKS = {
  // cron expression (UTC) → tick name registered in akoro-api lib/cronTicks.js
  "20 2 * * *": "ladder-prewarm",      // LADDER_PREWARM_CRON default
  "0 3 * * *":  "decay-scheduler",     // nightly forgetting-curve pass
  "30 3 * * *": "pilot-expiry-check",  // pilot cohort expiry sweep
};

export default {
  async scheduled(event, env, ctx) {
    const name = TICKS[event.cron];
    if (!name) {
      console.warn(`[cron-ticker] no tick registered for cron "${event.cron}"`);
      return;
    }
    const base = String(env.API_BASE_URL || "").replace(/\/+$/, "");
    if (!base || !env.INTERNAL_SECRET) {
      console.error("[cron-ticker] API_BASE_URL / INTERNAL_SECRET not set — cannot fire");
      return;
    }
    const res = await fetch(`${base}/api/internal/ticks/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": env.INTERNAL_SECRET },
    });
    const body = await res.json().catch(() => ({}));
    console.log(`[cron-ticker] ${event.cron} → ${name}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  },
};
