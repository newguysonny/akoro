# API Security Hardening Plan

## Objective

Implement a layered API security system capable of withstanding high-volume traffic attacks (100k+ rps). The system must be accurate, globally consistent, and production-safe — without relying on in-memory state or eventually-consistent stores for rate limiting.

---

## Architecture Overview

```
          INTERNET
              ↓
         CLOUDFLARE
   DDoS / CDN / WAF / bot mgmt
   coarse rate limiting at edge
              ↓
           NGINX
   fine-grained rate limiting
   connection limiting / proxy
   real IP restoration
              ↓
        Node.js API
   auth-aware rate limiting
   circuit breakers / queues
   per-tenant quota (Redis)
              ↓
         PostgreSQL
   connection pool guardrails
   PgBouncer (transaction mode)
```

| Layer | Defends Against | Where |
|---|---|---|
| L3/L4 + bulk L7 | Volumetric floods | Cloudflare WAF / DDoS protection |
| Coarse per-IP rate limit | Bot floods, scrapers | Cloudflare Rate Limiting Rule |
| Fine per-IP rate + conn limit | Sustained abuse, slow attacks | NGINX `limit_req` + `limit_conn` |
| Per-route rate limit | Per-user / per-IP abuse | Node.js middleware (Redis-backed) |
| Per-tenant quota | Noisy neighbor | Node.js app logic (Redis-backed) |
| Circuit breakers | Cascading failure | `opossum` resilience library |
| DB pool guardrails | Connection exhaustion | `pg` pool config + PgBouncer |

---

## Phase 1 — Edge Layer (Cloudflare)

### 1.1 WAF + DDoS Rules
- Enable **Cloudflare DDoS L3/L4 protection** (automatic, always-on)
- Configure **WAF Managed Rules**: OWASP Core Ruleset + Cloudflare Managed Ruleset
- Set **Bot Management** to challenge suspicious traffic (JS challenge or CAPTCHA)
- Enable a **coarse Rate Limiting Rule** in the dashboard as a first filter
  - e.g. 1,000 req/min per IP globally — this catches flood traffic before it hits NGINX
- Cache static responses at the edge (`Cache-Control` headers)

### 1.2 Custom Rate Limiting with Workers + Durable Objects (optional)

Only needed if you want **business-logic-aware rate limiting at the edge** (e.g. keying on API tokens or tenant IDs before the request reaches NGINX). Skip if NGINX handles it well enough.

> **Why Durable Objects over KV?**
> KV is eventually consistent (10–50ms lag) — not reliable for strict limits. Durable Objects give globally consistent token-bucket state with ~1,000 rps per object.

**`src/RateLimiter.ts`** — token bucket per user/API key:
- `BUCKET_CAPACITY`: max tokens (e.g. 100)
- `REFILL_RATE`: tokens per second (e.g. 10)
- On each request: refill tokens by elapsed time, consume 1 or reject 429

**`src/index.ts`** — Worker entry:
- Key: `API-Key` header → fall back to `CF-Connecting-IP`
- Assign to DO instance: `env.RATE_LIMITER.idFromName(key)`
- On 429: return `{ error: "rate_limit_exceeded", retryAfter: N }` immediately
- Otherwise: proxy to origin (NGINX)

**Retry-After header**: always include on 429 responses.

### 1.3 Lock NGINX to Cloudflare IPs Only

To prevent attackers from bypassing Cloudflare entirely by hitting your server IP directly:

```nginx
# In your NGINX server block — allowlist Cloudflare IP ranges
# Full list: https://www.cloudflare.com/ips/
# Update this list periodically (or automate via Cloudflare's API)

geo $cloudflare_ip {
  default 0;

  # IPv4
  103.21.244.0/22   1;
  103.22.200.0/22   1;
  103.31.4.0/22     1;
  104.16.0.0/13     1;
  104.24.0.0/14     1;
  108.162.192.0/18  1;
  131.0.72.0/22     1;
  141.101.64.0/18   1;
  162.158.0.0/15    1;
  172.64.0.0/13     1;
  173.245.48.0/20   1;
  188.114.96.0/20   1;
  190.93.240.0/20   1;
  197.234.240.0/22  1;
  198.41.128.0/17   1;

  # IPv6
  2400:cb00::/32    1;
  2606:4700::/32    1;
  2803:f800::/32    1;
  2405:b500::/32    1;
  2405:8100::/32    1;
  2a06:98c0::/29    1;
  2c0f:f248::/32    1;
}

server {
  if ($cloudflare_ip = 0) {
    return 444; # Drop connection silently
  }
  # ...
}
```

---

## Phase 2 — NGINX Layer

### 2.1 Real IP Restoration

NGINX will see **Cloudflare's IPs** as the remote address, not the actual client IP. Fix this first — everything else depends on it.

```nginx
# /etc/nginx/conf.d/cloudflare-real-ip.conf
# Cloudflare sets CF-Connecting-IP with the real visitor IP

set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
# IPv6 ranges omitted for brevity — add from cloudflare.com/ips

real_ip_header CF-Connecting-IP;
```

### 2.2 Rate Limiting Zones

Define zones in `nginx.conf` → `http {}` block (not inside `server {}`):

```nginx
http {
  # Zone 1: General API — 100 req/s per IP (shared 10MB memory)
  limit_req_zone $binary_remote_addr zone=api_general:10m rate=100r/s;

  # Zone 2: Auth endpoints — much stricter (5 req/s per IP)
  limit_req_zone $binary_remote_addr zone=api_auth:10m rate=5r/s;

  # Zone 3: Connection limit — max 50 concurrent connections per IP
  limit_conn_zone $binary_remote_addr zone=connections:10m;

  # Return 429 (not default 503) when limits are exceeded
  limit_req_status 429;
  limit_conn_status 429;
}
```

### 2.3 Apply Limits in Server Block

```nginx
server {
  listen 80;
  server_name api.yourdomain.com;

  # Hide NGINX version from error pages and headers
  server_tokens off;

  # Global connection limit per IP
  limit_conn connections 50;

  # Pass real IP to Node.js so it can key rate limits on actual user IP
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host              $host;

  # ── Auth routes — strictest limits ──────────────────────────────────────
  location ~ ^/api/auth/(login|register|forgot-password) {
    limit_req zone=api_auth burst=5 nodelay;
    proxy_pass http://localhost:3000;
  }

  # ── General API routes ───────────────────────────────────────────────────
  location /api/ {
    limit_req zone=api_general burst=50 nodelay;
    proxy_pass http://localhost:3000;
  }

  # ── Health check — no rate limit ─────────────────────────────────────────
  location /health {
    proxy_pass http://localhost:3000;
  }

  # ── Static assets — serve directly, no Node.js involved ─────────────────
  location /static/ {
    root /var/www/app;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### 2.4 Upstream Keepalive to Node.js

Avoid opening a new TCP connection per request:

```nginx
upstream nodejs_app {
  server 127.0.0.1:3000;
  keepalive 64; # Keep 64 idle connections open
}

# In your proxy_pass: use the upstream name
proxy_pass http://nodejs_app;
proxy_http_version 1.1;
proxy_set_header Connection "";
```

### 2.5 Timeouts + Body Limits

```nginx
# Prevent slow-read attacks and resource exhaustion
client_body_timeout   12s;
client_header_timeout 12s;
send_timeout          10s;
keepalive_timeout     15s;

# Limit request body size (adjust for file upload routes)
client_max_body_size  10m;
```

---

## Phase 3 — Application Layer (Node.js)

### 3.1 Per-Route Rate Limiting (Redis-backed middleware)

Use **`express-rate-limit`** + **`rate-limit-redis`**. NGINX handles IP-level limits; this layer adds **user-aware and route-specific** limits that NGINX cannot see.

```
POST /api/auth/login     → 10 req/15min per IP
POST /api/auth/register  → 5 req/hour per IP
GET  /api/feed           → 200 req/min per user
POST /api/orders         → 30 req/min per user
*    /api/admin/*        → 60 req/min per admin user
```

Middleware order:
1. Auth middleware (populate `req.user`)
2. Rate limit middleware (key on `req.user.id` for auth'd, `req.ip` for public)
3. Route handler

Always set:
- `standardHeaders: true` (sends `RateLimit-*` headers per RFC 6585)
- `legacyHeaders: false`
- `skipFailedRequests: false` (failed attempts count — prevents enumeration)

**Important**: use `req.headers['x-real-ip'] || req.ip` as the key source, since NGINX forwards the real IP via `X-Real-IP`.

### 3.2 Per-Tenant Quota

For multi-tenant products (Crowd, Akoro): enforce tenant-level API quotas in addition to per-user limits.

- Store quota config in DB: `tenants.api_quota_per_minute`
- Track usage in Redis: `quota:tenant:{id}` with 60s TTL
- Middleware checks tenant quota before hitting route handler
- Return `429` with `X-Quota-Limit`, `X-Quota-Remaining`, `X-Quota-Reset` headers

### 3.3 Bounded Queues + Backpressure

For async job processing (emails, AI inference, notifications):
- Use a queue with a **max concurrency** cap (e.g. BullMQ `concurrency: 5`)
- Set **queue size limits** — reject enqueue when queue is full
- Implement **backpressure**: if queue depth > threshold, return `503` with `Retry-After`

### 3.4 Circuit Breakers

Use **`opossum`** on external calls (payment providers, AI APIs, email services):

```js
{
  timeout: 3000,                  // fail fast if > 3s
  errorThresholdPercentage: 50,   // open after 50% failures
  resetTimeout: 10000             // retry after 10s
}
```

Emit metrics on state changes (closed → open → half-open) to your observability stack.

### 3.5 Load Shedding

When under extreme load:
- Monitor memory usage and event loop lag
- If memory > 85% or event loop lag > 500ms: shed low-priority traffic
- Priority order: auth flows > payment flows > read APIs > analytics
- Return `503` with `Retry-After` — never silently drop

### 3.6 DB Connection Pool Guardrails

```js
// pg pool config
{
  max: 10,                      // per app instance
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
}
```

- Monitor active connections via `pg_stat_activity`
- Configure **PgBouncer** in Transaction mode to multiplex connections across instances

---

## Traps to Avoid

| ❌ Trap | ✅ Fix |
|---|---|
| NGINX sees Cloudflare IPs, not real client IPs | Use `real_ip_header CF-Connecting-IP` |
| Attackers bypass Cloudflare by hitting server IP directly | Allowlist Cloudflare IPs in NGINX; drop everything else (`return 444`) |
| `limit_req` without `burst` drops legitimate spikes | Set a reasonable `burst` value; use `nodelay` for auth routes |
| In-memory `Map` for rate limiting in Workers | Use Durable Objects |
| Workers KV for strict rate limits | KV is eventually consistent — use DO |
| IP address as sole key for auth'd routes in Node.js | Key on user ID / API key |
| Node.js not trusting `X-Real-IP` from NGINX | Set `app.set('trust proxy', 1)` in Express |
| Unbounded job queues | Set max size + reject when full |
| No `Retry-After` header on 429/503 | Always include it |
| Default DB pool sizes | Set explicit limits per instance |
| NGINX `limit_req_zone` defined inside `server {}` | Must be in the `http {}` block |

---

## Implementation Order

1. **Cloudflare WAF rules + bot management** (dashboard config, no code)
2. **NGINX real IP restoration** (`cloudflare-real-ip.conf`)
3. **NGINX IP allowlist** (block non-Cloudflare traffic at `return 444`)
4. **NGINX rate limiting zones + location rules** (`nginx.conf`)
5. **NGINX upstream keepalive + timeout config**
6. **Redis-backed app-level rate limiting** (Express middleware)
7. **Circuit breakers on external calls** (`opossum`)
8. **Cloudflare Workers + Durable Objects rate limiter** (optional, if edge auth-awareness needed)
9. **Per-tenant quota system** (DB + Redis)
10. **Load shedding + backpressure on job queues** (BullMQ config)
11. **DB pool guardrails + PgBouncer**

---

## Files to Create / Modify

```
cloudflare/
  worker/
    src/
      index.ts                  ← Worker entry, proxies to DO
      RateLimiter.ts            ← Durable Object token bucket
    wrangler.toml

nginx/
  conf.d/
    cloudflare-real-ip.conf     ← Restore real client IP from CF headers
  sites-available/
    api.conf                    ← Server block: rate limits, proxy, upstreams

server/
  middleware/
    rateLimiter.ts              ← Per-route Redis-backed limits
    tenantQuota.ts              ← Per-tenant quota enforcement
    loadShedder.ts              ← Memory/lag-based shedding
  lib/
    circuitBreakers.ts          ← opossum instances per external service
  config/
    dbPool.ts                   ← Explicit pg pool config
```

---

## Notes for Agent

- Stack: Node.js / Express, PostgreSQL, Redis
- NGINX sits between Cloudflare and Node.js — not optional in this architecture
- Express must trust the proxy: `app.set('trust proxy', 1)` — otherwise `req.ip` returns NGINX's loopback IP
- Use `req.headers['x-real-ip'] || req.ip` when keying rate limits in Node.js
- All 429 and 503 responses must be JSON: `{ error: string, retryAfter?: number }`
- Log every rate limit hit to your observability tool (include: layer hit, route, key type)
- NGINX logs rate limit events too — aggregate both in your monitoring stack
- Cloudflare IP ranges change — automate updates via their API or check quarterly
- Do not expose internal rate limit keys in response headers
