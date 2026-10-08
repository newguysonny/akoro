// cf/worker.js — the Cloudflare edge wrapper.
//
// A tiny Worker whose only job is to route requests into the Container
// (cloudflare.com/products/containers). The container is started on
// demand and allowed to idle down; jobs themselves are serialized
// INSIDE the container (MAX_CONCURRENT_JOBS), so scaling means more
// container instances, not bigger boxes.
//
// Secrets live in the WORKER environment (wrangler secret put) and are
// handed to the container as start env — the container image itself
// carries none.

import { Container, getContainer } from "cloudflare:workers";

export class MediaContainer extends Container {
  defaultPort = 8080;
  // Idle-down after 10 quiet minutes; a new request cold-starts it.
  sleepAfter = "10m";
  // A crashed/suspended instance restarts on the next request.
  restartPolicy = "on-failure";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Edge-level health — no container wake-up.
    if (url.pathname === "/edge-health") {
      return Response.json({ ok: true, service: "akoro-media-worker-edge" });
    }

    // One shared instance per account: encode jobs are heavy, and the
    // container's own lane guard keeps them serialized. Fan out later by
    // hashing job ids onto instances — not needed until encode volume does.
    const container = getContainer(env.MEDIA);
    return container.fetch(request);
  },
};
