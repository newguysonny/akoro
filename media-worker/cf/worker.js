// cf/worker.js — the Cloudflare edge wrapper.
//
// Routing follows the documented pattern (developers.cloudflare.com/
// containers): the DO binding (env.MEDIA) is the container's namespace,
// and getByName() hands each request to one running instance. The
// container starts on first request, serves until idle, then sleeps.
//
// Secrets live in the WORKER environment (`wrangler secret put …`) and
// are copied onto the container at start via envVars — the Worker env is
// the only place secrets exist; the container image carries none.

import { Container } from "@cloudflare/containers";

export class MediaContainer extends Container {
  defaultPort = 8080;
  // Idle-down after 10 quiet minutes; the next request cold-starts it
  // (~2–3 s), and /jobs/:id polling keeps it warm while jobs run.
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      INTERNAL_SECRET:      env.INTERNAL_SECRET      ?? "",
      R2_ACCOUNT_ID:        env.R2_ACCOUNT_ID        ?? "",
      R2_ACCESS_KEY_ID:     env.R2_ACCESS_KEY_ID     ?? "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
      R2_BUCKET_NAME:       env.R2_BUCKET_NAME       ?? "",
      R2_PUBLIC_URL:        env.R2_PUBLIC_URL        ?? "",
      API_BASE_URL:         env.API_BASE_URL         ?? "",
      MAX_CONCURRENT_JOBS:  "1",
    };
  }

  onStart()    { console.log("[media-worker] container started"); }
  onStop()     { console.log("[media-worker] container stopped"); }
  onError(err) { console.error("[media-worker] container error:", err); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Edge-level health — no container wake-up.
    if (url.pathname === "/edge-health") {
      return Response.json({ ok: true, service: "akoro-media-worker-edge" });
    }

    // One shared instance for now: encode jobs are heavy and the
    // container's own MAX_CONCURRENT_JOBS lane guard serializes them.
    // To fan out later: getRandom(env.MEDIA, N) from @cloudflare/containers.
    const container = env.MEDIA.getByName("singleton");
    return await container.fetch(request);
  },
};
