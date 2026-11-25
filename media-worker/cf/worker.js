// cf/worker.js — the Cloudflare edge wrapper.
//
// Routing follows the documented pattern (developers.cloudflare.com/
// containers): the DO binding (env.MEDIA) is the container's namespace,
// and getByName(name) hands each request to one named instance. Distinct
// names (video-<id>-360p, video-<id>-720p, …) are what make Cloudflare
// autoscale up to max_instances; the API coordinator dispatches one
// variant per instance. Without ?instance= the old singleton is kept
// (extract lane, health probes).

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
      MAX_CONCURRENT_JOBS:  env.MAX_CONCURRENT_JOBS ?? "1",
      ENCODE_VARIANT_CONCURRENCY: env.ENCODE_VARIANT_CONCURRENCY ?? "2",
      R2_UPLOAD_CONCURRENCY: env.R2_UPLOAD_CONCURRENCY ?? "8",
    };
  }

  onStart()    { console.log("[media-worker] container started"); }
  onStop()     { console.log("[media-worker] container stopped"); }
  onError(err) { console.error("[media-worker] container error:", err); }

  // An encode runs entirely inside the container: after the 202 there are
  // no more inbound requests, so the 10m idle timer would SIGTERM a long
  // encode. On expiry, ask the container whether a job is still running;
  // if it is, renew the window. When the lane is idle, stop as usual.
  async onActivityExpired() {
    try {
      const res = await this.containerFetch("http://container/jobs", {
        headers: { "x-internal-secret": this.env.INTERNAL_SECRET ?? "" },
      }, this.defaultPort);
      if (res.ok) {
        const { data } = await res.json();
        const running = (data?.jobs || []).some((job) => job.state === "running");
        if (running) {
          console.log("[media-worker] activity expired, but a job is running — staying up");
          this.renewActivityTimeout();
          return;
        }
      }
    } catch (err) {
      console.warn("[media-worker] activity check failed:", err?.message || err);
    }
    await this.stop();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Edge-level health — no container wake-up.
    if (url.pathname === "/edge-health") {
      return Response.json({ ok: true, service: "akoro-media-worker-edge" });
    }

    const instance = (url.searchParams.get("instance") || "singleton")
      .replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "singleton";

    // Starting a container costs money before the container's own auth can
    // reject the request. Check the shared secret at the edge for every job
    // route, and let only the API address non-singleton instances.
    const secret = request.headers.get("x-internal-secret");
    if (url.pathname.startsWith("/jobs") && secret !== env.INTERNAL_SECRET) {
      return Response.json({ ok: false, error: "Bad internal secret" }, { status: 401 });
    }
    if (instance !== "singleton" && secret !== env.INTERNAL_SECRET) {
      return Response.json({ ok: false, error: "Bad internal secret" }, { status: 401 });
    }

    const container = env.MEDIA.getByName(instance);
    return await container.fetch(request);
  },
};
