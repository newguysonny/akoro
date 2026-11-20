/**
 * lib/httpHardening.js — the API's HTTP hardening layer (Phase 19 step 4).
 *
 * app.js is the composition root: it creates the express app, mounts the
 * routers in their contract-pinned order, and calls these two functions around
 * the body parsers. Keeping the order here explicit matters:
 *
 *   applyHttpHardening   helmet → cors → cookies → egress meter → compression
 *   (app.js)             body parsers → requestLogger → JSON redaction
 *   applyRequestGuards   load shedder → tenant quota → passport → static files
 *
 * The egress meter is returned because /health and /internal/egress report it.
 */
import path                          from "path";
import { fileURLToPath }             from "url";
import express                       from "express";
import cors                          from "cors";
import helmet                        from "helmet";
import compression                   from "compression";
import cookieParser                  from "cookie-parser";
import passport                      from "passport";
import config                        from "../config/index.js";
import { createLoadShedder }         from "../middleware/loadShedder.js";
import { createTenantQuotaMiddleware } from "../middleware/tenantQuota.js";
import { SITE_BASE_DOMAINS, isTenantHost } from "../modules/school/tenant.js";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build the CORS policy once at boot. Socket.io consumes the same predicate,
 * so a tenant school site is allowed to call the API but never credentialed —
 * its own admin can put arbitrary script in its pages.
 */
export function createCorsPolicy() {
  // Support comma-separated list: CORS_ORIGIN=https://akoro.app,https://instructor.akoro.app
  const allowedOrigins = config.server.corsOrigin === '*'
    ? '*'
    : config.server.corsOrigin.split(',').map(s => s.trim()).filter(Boolean);

  // Beyond the explicit list, also allow the apex, www, and EVERY subdomain of
  // the wildcard base domain(s) — so www.<domain> and every tenant school site
  // (<slug>.<domain>) can call the API without being listed one by one.
  const originHost = (o) => { try { return new URL(o).hostname.toLowerCase(); } catch { return ''; } };
  const stripWww = (h) => h.replace(/^www\./, '');
  // The platform's OWN front-ends. These are configured as env URLs and are not
  // tenant sites, so they belong in the credentialed set even when CORS_ORIGIN
  // doesn't spell them out. Missing them is what broke the AI-chat hand-off: the
  // school portal sits at a subdomain of the base domain, so the wildcard matched
  // it for access but the credentials rule — correctly — did not.
  const PLATFORM_APP_URLS = [
    process.env.FRONTEND_URL, process.env.MAIN_SITE_URL,
    process.env.SCHOOL_FRONTEND_URL, process.env.INSTRUCTOR_FRONTEND_URL,
    process.env.INSTRUCTOR_APP_URL, process.env.ADMIN_FRONTEND_URL,
    process.env.AGENT_FRONTEND_URL, process.env.BUSINESS_FRONTEND_URL,
    process.env.VOUCHERS_FRONTEND_URL,
  ].filter(Boolean);

  // Hostnames are no longer guessed. isTenantHost() answers from the actual
  // school slugs and verified custom domains, so any subdomain of the base domain
  // that ISN'T a school is one of our apps — whatever it happens to be named.
  // The cache is warmed at boot and refreshed in the background.

  const listedHosts = new Set(
    allowedOrigins === '*' ? [] :
    [...allowedOrigins, ...PLATFORM_APP_URLS].map(originHost).filter(Boolean).map(stripWww)
  );
  function isAllowedOrigin(origin) {
    if (!origin) return true;                 // curl / mobile / same-origin
    const bare = stripWww(originHost(origin));
    if (!bare) return false;
    if (listedHosts.has(bare)) return true;                                        // explicitly listed (± www)
    if (SITE_BASE_DOMAINS.some((b) => bare === b || bare.endsWith(`.${b}`))) return true; // apex/any subdomain of base
    return false;
  }
  const corsOriginFn = (origin, cb) => isAllowedOrigin(origin)
    ? cb(null, true)
    : cb(new Error(`CORS: origin ${origin} not allowed`));

  // CREDENTIALS are granted only to the explicitly listed portal origins.
  //
  // Tenant school sites (<slug>.<base domain>) are allowed to call the API, but
  // WITHOUT cookies. They must not be credentialed: a school admin can put
  // arbitrary <script> in header_scripts/footer_scripts and page HTML on their
  // own site, so a credentialed wildcard would let that script call the API as
  // ANY signed-in visitor — a parent, a teacher, or an admin of another school —
  // and read the response. School sites only need public endpoints, so this
  // costs them nothing.
  const isListedOrigin = (origin) => {
    if (!origin) return true;                       // curl / mobile / same-origin
    const bare = stripWww(originHost(origin));
    if (!bare) return false;
    if (listedHosts.has(bare)) return true;         // explicitly configured
    if (isTenantHost(bare)) return false;           // a school's own site — never credentialed
    // Ours: an app on the base domain, under whatever name it is deployed.
    return SITE_BASE_DOMAINS.some((b) => bare === b || bare.endsWith(`.${b}`));
  };
  // One line per origin, the first time it is seen, so a wrongly-classified host
  // shows up in the deploy log instead of only in someone's browser console.
  const seenOrigins = new Set();
  const corsDelegate = (req, cb) => {
    const origin = req.headers.origin;
    if (origin && !seenOrigins.has(origin)) {
      seenOrigins.add(origin);
      const bare = stripWww(originHost(origin));
      console.log(`[cors] ${origin} → allowed=${isAllowedOrigin(origin)} credentials=${isListedOrigin(origin)}` +
        ` (listed=${listedHosts.has(bare)} tenant=${isTenantHost(bare)})`);
    }
    cb(null, {
      origin: allowedOrigins === '*' ? true : isAllowedOrigin(origin),
      credentials: allowedOrigins === '*' ? true : isListedOrigin(origin),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Akoro-Portal", "X-Internal-Secret"],
    });
  };

  return { allowedOrigins, isAllowedOrigin, isListedOrigin, corsOriginFn, corsDelegate };
}

/**
 * First half of the middleware chain: security headers, CORS, cookies, the
 * egress meter and compression. Body parsers stay in app.js because the JSON
 * redaction guard is asserted there and a scoped parser must precede them.
 */
export function applyHttpHardening(app, corsPolicy) {
  app.use(helmet({
    contentSecurityPolicy: false,   // configured separately per-page if needed
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  app.use(cors(corsPolicy.corsDelegate));
  app.use(cookieParser());

  // ── Egress meter ───────────────────────────────────────────────────────────
  // Render meters outbound bandwidth (5 GB/month on Hobby) and the operator's
  // workspace was SUSPENDED for exhausting it in four days with no users —
  // "how is this even possible" had no answer because nothing measured it.
  // This counts the actual bytes each route puts on the wire (after
  // compression — the wrapper sits ahead of it), keeps an hourly ring so the
  // burn PATTERN is visible (a steady 3 a.m. climb means bots or a worker,
  // spikes only during testing means the operator's own traffic), and exposes
  // a public total in /health plus a per-route breakdown behind the internal
  // secret. WebSockets bypass Express and are not counted.
  const egress = { since: new Date().toISOString(), totalBytes: 0, requests: 0, byRoute: new Map(), hours: [] };
  const egressHour = () => Math.floor(Date.now() / 3_600_000);
  function egressTick(hour, bytes) {
    const ring = egress.hours;
    const last = ring[ring.length - 1];
    if (!last || last.hour !== hour) {
      ring.push({ hour, bytes });
      while (ring.length > 24) ring.shift();
    } else {
      last.bytes += bytes;
    }
  }
  app.use((req, res, next) => {
    const route = () => (req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : req.path.split("?")[0]).slice(0, 120);
    let bytes = 0;
    const origWrite = res.write, origEnd = res.end;
    res.write = function (chunk, ...rest) { if (chunk?.length) bytes += chunk.length; return origWrite.call(this, chunk, ...rest); };
    res.end   = function (chunk, ...rest) { if (chunk?.length) bytes += chunk.length; return origEnd.call(this, chunk, ...rest); };
    res.on("finish", () => {
      const key = `${req.method} ${route()}`;
      const row = egress.byRoute.get(key) || { requests: 0, bytes: 0 };
      row.requests++; row.bytes += bytes;
      egress.byRoute.set(key, row);
      egress.totalBytes += bytes; egress.requests++;
      egressTick(egressHour(), bytes);
    });
    next();
  });
  setInterval(() => {
    const mb = (egress.totalBytes / 1e6).toFixed(1);
    const top = [...egress.byRoute.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 3)
      .map(([k, v]) => `${k} ${(v.bytes / 1e6).toFixed(1)}MB`).join(" | ");
    console.log(`[egress] ${mb} MB out since boot; top: ${top || "-"}`);
  }, 60 * 60 * 1000).unref?.();

  // ─── Response compression ──────────────────────────────────────────────────
  // Render's Hobby workspace caps outbound bandwidth at 5 GB/month (April 2026
  // plan change; it used to be 100 GB). Every uncompressed JSON response is
  // billed byte-for-byte, and gzip typically shrinks API JSON 5-10×, so this one
  // middleware is the single biggest egress reduction available. SSE streams are
  // excluded: buffering them would stall token-by-token chat/training streaming,
  // and they are already sent in small chunks. WebSocket traffic (Socket.io)
  // does not pass through Express middleware and is unaffected.
  app.use(compression({
    filter: (req, res) => {
      const type = String(res.getHeader("Content-Type") || "");
      if (type.includes("text/event-stream")) return false;   // never buffer SSE
      return compression.filter(req, res);
    },
  }));

  return { egress };
}

/**
 * Second half of the middleware chain: load shedding, per-tenant quota,
 * passport, robots/uploads and the instance header. Runs after the body
 * parsers and the JSON redaction guard, exactly where app.js called them.
 */
export function applyRequestGuards(app) {
  // Load shedding (plan §3.5): under extreme load, shed low-priority traffic
  // with an honest 503 + Retry-After instead of collapsing. Auth and health are
  // exempt — sessions must stay refreshable while the server is on its knees.
  app.use(createLoadShedder());
  // Per-school quota (plan §3.2): school-site traffic is attributed by Origin
  // and counted against the school's tier quota — one classroom is thirty
  // "users", so per-user limits can't see a noisy school. Fails open.
  app.use(createTenantQuotaMiddleware());
  app.use(passport.initialize());
  // Uploads are served without auth (question images etc.), which makes them the
  // one URL family a crawler or scraper can pull in bulk. Past-question scans are
  // exactly what AI crawlers and exam-pirate scrapers look for, and on the 5 GB
  // Hobby bandwidth cap a few bulk pulls are real money. robots.txt stops the
  // well-behaved ones; X-Robots-Tag keeps them out of indexes even if the file
  // is reached via a direct link.
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });
  app.use("/uploads",
    (_req, res, next) => { res.setHeader("X-Robots-Tag", "noindex, nofollow"); next(); },
    express.static(path.join(API_ROOT, "uploads"), {
      // Files are stored under unique generated names (a re-upload gets a NEW
      // filename), so a URL's content never changes — cache it hard. Without
      // this, a 500 MB lecture video is metered egress on EVERY view; with it,
      // Cloudflare and the browser keep a copy and Render serves a view only
      // when the edge misses.
      maxAge: "30d",
      immutable: true,
    }));
  app.use((_req, res, next) => { res.setHeader("X-Instance-Id", config.instanceId); next(); });
}
