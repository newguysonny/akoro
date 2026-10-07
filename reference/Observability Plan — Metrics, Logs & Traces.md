# Observability Plan — Metrics, Logs & Traces

## Objective

Implement full-stack observability across the entire request path — from Cloudflare edge
to PostgreSQL — using Grafana Cloud as the single managed backend. No self-hosted
infrastructure required until you outgrow the free tier.

---

## Architecture Overview

```
          INTERNET
              ↓
         CLOUDFLARE  ──────────────────────────── Cloudflare Analytics (built-in)
              ↓
           NGINX  ──────────── nginx-prometheus-exporter → Alloy → Mimir (metrics)
              ↓                NGINX access/error logs   → Alloy → Loki  (logs)
         Node.js API ─────────── OpenTelemetry SDK  ────→ Alloy → Tempo  (traces)
              ↓                  Pino structured logs ──→ Alloy → Loki   (logs)
          Redis  ──────────────── redis_exporter    ────→ Alloy → Mimir  (metrics)
              ↓
         PostgreSQL ──────────── postgres_exporter  ────→ Alloy → Mimir  (metrics)
                                 pg slow query logs ────→ Alloy → Loki   (logs)

All collectors funnel through Grafana Alloy (OpenTelemetry-native agent)
into a single Grafana Cloud stack (LGTM: Loki · Grafana · Tempo · Mimir)
```

| Pillar | What | Tool | Destination |
|---|---|---|---|
| Metrics | System, NGINX, Redis, PG, Node.js | Node Exporter + exporters + OTel | Mimir (Prometheus-compatible) |
| Logs | App logs, NGINX access, PG slow queries | Pino + Loki file target | Loki |
| Traces | End-to-end request traces | OpenTelemetry SDK (auto-instrument) | Tempo |

---

## Phase 0 — Grafana Cloud Setup (Start Here)

### 0.1 Create a Free Account
- Sign up at **grafana.com/products/cloud** (no credit card required)
- Free tier: 10k metric series · 50 GB logs · 50 GB traces · 14-day retention · 3 users

### 0.2 Collect Your Endpoints from Grafana Cloud
After creating your stack, note these from the Grafana Cloud portal:

```env
# Add to your server .env or secrets manager
GRAFANA_CLOUD_STACK_ID=<your-stack-id>

# Prometheus / Mimir (metrics)
PROMETHEUS_REMOTE_WRITE_URL=https://<your-instance>.grafana.net/api/prom/push
PROMETHEUS_USER=<prometheus-user-id>

# Loki (logs)
LOKI_PUSH_URL=https://logs-prod-<region>.grafana.net/loki/api/v1/push
LOKI_USER=<loki-user-id>

# Tempo (traces)
TEMPO_OTLP_ENDPOINT=https://tempo-prod-<region>.grafana.net:443

# Shared API key (create one under Cloud → API Keys → Add)
GRAFANA_API_KEY=<your-api-key>
```

### 0.3 Install Grafana Alloy on Your Server

Alloy is the unified collector — it receives metrics, logs, and traces and
forwards them to Grafana Cloud. One agent replaces Prometheus Agent, Promtail,
and OpenTelemetry Collector.

```bash
# Ubuntu / Debian
sudo apt-get install -y apt-transport-https software-properties-common wget
wget -q -O - https://apt.grafana.com/gpg.key | sudo apt-key add -
echo "deb https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt-get update && sudo apt-get install alloy -y

# Start and enable
sudo systemctl enable alloy --now
```

---

## Phase 1 — Infrastructure Metrics

### 1.1 Node Exporter (System Metrics)

```bash
# Install
sudo apt-get install prometheus-node-exporter -y
sudo systemctl enable prometheus-node-exporter --now
# Runs on :9100 by default
```

Metrics collected:
- **CPU**: utilization (user/system/iowait), load average, context switches
- **Memory**: used/available, swap, page faults
- **Disk**: usage %, IOPS, throughput (MB/s), I/O latency (await), iowait
- **Network**: inbound/outbound throughput, connection states (TIME_WAIT / CLOSE_WAIT), packet drops

### 1.2 NGINX Prometheus Exporter

```bash
# First: enable the stub_status endpoint in NGINX (inside server block)
# nginx/sites-available/api.conf
location /nginx_status {
  stub_status;
  allow 127.0.0.1;  # local only
  deny all;
}

# Install the exporter
docker run -d \
  --name nginx-exporter \
  --restart unless-stopped \
  -p 9113:9113 \
  nginx/nginx-prometheus-exporter \
  --nginx.scrape-uri=http://localhost/nginx_status
```

Metrics collected: active connections, requests per second, reading/writing/waiting states.

### 1.3 Redis Exporter

```bash
docker run -d \
  --name redis-exporter \
  --restart unless-stopped \
  -p 9121:9121 \
  oliver006/redis_exporter \
  --redis.addr=redis://localhost:6379
```

Key metrics: connected clients, memory used, evicted keys, keyspace hits/misses (cache hit ratio),
commands per second, replication lag.

### 1.4 PostgreSQL Exporter

```bash
# Create a read-only monitoring user in PG first
psql -U postgres -c "
  CREATE USER monitoring WITH PASSWORD 'strong-password';
  GRANT pg_monitor TO monitoring;
"

docker run -d \
  --name postgres-exporter \
  --restart unless-stopped \
  -p 9187:9187 \
  -e DATA_SOURCE_NAME="postgresql://monitoring:strong-password@localhost:5432/postgres?sslmode=disable" \
  prometheuscommunity/postgres-exporter
```

Key metrics:
- Active/idle/waiting connections vs `max_connections`
- `pg_stat_user_tables`: dead tuple ratio, last autovacuum/autoanalyze
- Cache hit ratio (`pg_stat_bgwriter`)
- Transaction wraparound age (`pg_database_age`)
- Replication lag (seconds behind primary)
- Lock wait time + deadlock count
- QPS / TPS

### 1.5 Wire All Exporters into Alloy

```hcl
# /etc/alloy/config.alloy

// ── Scrape targets ───────────────────────────────────────────────────────────
prometheus.scrape "node" {
  targets = [{ "__address__" = "localhost:9100" }]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.scrape "nginx" {
  targets = [{ "__address__" = "localhost:9113" }]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.scrape "redis" {
  targets = [{ "__address__" = "localhost:9121" }]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.scrape "postgres" {
  targets = [{ "__address__" = "localhost:9187" }]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

// ── Remote write to Grafana Cloud Mimir ──────────────────────────────────────
prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = env("PROMETHEUS_REMOTE_WRITE_URL")
    basic_auth {
      username = env("PROMETHEUS_USER")
      password = env("GRAFANA_API_KEY")
    }
  }
}
```

---

## Phase 2 — Logs (Loki)

### 2.1 Node.js — Structured Logging with Pino

Use **Pino** for structured JSON logs. Never use `console.log` in production —
unstructured logs are impossible to query in Loki.

```bash
npm install pino pino-pretty
```

```typescript
// src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'api',          // appears as a label in Loki
    env: process.env.NODE_ENV,
  },
  // In production: write JSON to stdout → Alloy tails it
  // In development: pretty-print to terminal
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
```

### 2.1.1 Request ID Middleware (bind to async context)

Use Node's built-in `AsyncLocalStorage` to make the request ID available
everywhere in a request's call stack — no need to thread `req` through every
function.

```bash
npm install uuid
```

```typescript
// src/lib/requestContext.ts
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface RequestContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string =>
  requestContext.getStore()?.requestId ?? 'no-context';
```

```typescript
// src/middleware/requestId.ts
import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../lib/requestContext';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Use the ID NGINX generated, or create one if NGINX isn't in the path
  const requestId =
    (req.headers['x-request-id'] as string) ?? crypto.randomUUID();

  // Return it to the client on every response
  res.setHeader('X-Request-ID', requestId);

  // Run the rest of the request inside the async context
  requestContext.run({ requestId }, next);
}
```

```typescript
// src/server.ts — register FIRST, before all other middleware
import { requestIdMiddleware } from './middleware/requestId';

app.use(requestIdMiddleware); // ← must be first
app.use(authMiddleware);
app.use(rateLimiter);
// ... routes
```

```typescript
// Usage in Express middleware
import { logger } from './lib/logger';
import { getRequestId } from './lib/requestContext';

// Request logging — requestId flows in automatically
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      requestId: getRequestId(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      user_id: req.user?.id,
      tenant_id: req.user?.tenantId,
    });
  });
  next();
});

// Error logging
app.use((err, req, res, next) => {
  logger.error(
    { err, requestId: getRequestId(), path: req.path, method: req.method },
    'Unhandled error'
  );
  res.status(500).json({ error: 'internal_server_error', requestId: getRequestId() });
});
```

### 2.2 NGINX Access + Error Logs

Configure NGINX to emit JSON logs — easier to parse in Loki:

```nginx
# nginx/nginx.conf → http {} block
log_format json_combined escape=json
  '{'
    '"time":"$time_iso8601",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"bytes_sent":$bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_response_time":"$upstream_response_time",'
    '"remote_addr":"$remote_addr",'
    '"http_user_agent":"$http_user_agent",'
    '"request_id":"$request_id"'
  '}';

access_log /var/log/nginx/access.log json_combined;
error_log  /var/log/nginx/error.log warn;
```

**Forward the request ID to Node.js** so both layers share the same ID:

```nginx
# In each proxy location block (api.conf)
location /api/ {
  # ... existing rate limit + proxy_pass ...

  # NGINX generates $request_id automatically — pass it upstream
  # Node.js reads this as req.headers['x-request-id']
  proxy_set_header X-Request-ID $request_id;

  # Return it to the client too — useful for support tickets / debugging
  add_header X-Request-ID $request_id always;
}
```

### 2.3 PostgreSQL Slow Query Log

```sql
-- postgresql.conf (or set via ALTER SYSTEM)
log_min_duration_statement = 500   -- log queries taking > 500ms
log_statement = 'none'             -- don't log everything, just slow ones
log_line_prefix = '%t [%p] %u@%d ' -- timestamp, PID, user, database
```

### 2.4 Wire Logs into Alloy → Loki

```hcl
# Add to /etc/alloy/config.alloy

// ── Node.js logs (stdout/file) ────────────────────────────────────────────────
loki.source.file "nodejs" {
  targets = [
    { __path__ = "/var/log/app/api.log", service = "api" },
  ]
  forward_to = [loki.write.grafana_cloud.receiver]
}

// ── NGINX logs ────────────────────────────────────────────────────────────────
loki.source.file "nginx" {
  targets = [
    { __path__ = "/var/log/nginx/access.log", service = "nginx", log_type = "access" },
    { __path__ = "/var/log/nginx/error.log",  service = "nginx", log_type = "error"  },
  ]
  forward_to = [loki.write.grafana_cloud.receiver]
}

// ── PostgreSQL logs ───────────────────────────────────────────────────────────
loki.source.file "postgres" {
  targets = [
    { __path__ = "/var/log/postgresql/postgresql-*.log", service = "postgres" },
  ]
  forward_to = [loki.write.grafana_cloud.receiver]
}

// ── Remote write to Grafana Cloud Loki ───────────────────────────────────────
loki.write "grafana_cloud" {
  endpoint {
    url = env("LOKI_PUSH_URL")
    basic_auth {
      username = env("LOKI_USER")
      password = env("GRAFANA_API_KEY")
    }
  }
}
```

---

## Phase 3 — Traces (Tempo)

### 3.1 Instrument Node.js with OpenTelemetry

Auto-instrumentation covers Express routes, HTTP clients, and PostgreSQL queries
with zero changes to business logic.

```bash
npm install \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/sdk-metrics
```

```typescript
// src/instrumentation.ts  ← must be the FIRST import in your entry point
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'api',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.TEMPO_OTLP_ENDPOINT}/v1/traces`,
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.LOKI_USER}:${process.env.GRAFANA_API_KEY}`
      ).toString('base64')}`,
    },
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => sdk.shutdown());
```

```typescript
// src/server.ts  ← entry point
import './instrumentation'; // must be first
import express from 'express';
// ... rest of your app
```

What gets traced automatically:
- Every Express route (method, path, status code, duration)
- Every outbound HTTP request (`node-fetch`, `axios`, `http.request`)
- Every PostgreSQL query via `pg` (query text, duration)
- Every Redis command via `ioredis`

### 3.2 Add Custom Spans for Business Logic

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('api');

async function processOrder(orderId: string) {
  return tracer.startActiveSpan('processOrder', async (span) => {
    span.setAttribute('order.id', orderId);
    try {
      const result = await db.query('SELECT ...', [orderId]);
      span.setAttribute('order.status', result.rows[0]?.status);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

### 3.3 Propagate Trace IDs into Logs (Logs ↔ Traces correlation)

This lets you click a log line in Grafana and jump directly to the full trace:

```typescript
// src/lib/logger.ts — final version (replaces the earlier draft)
import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { getRequestId } from './requestContext';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'api',
      env: process.env.NODE_ENV,
    },
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  // Mixin: auto-inject requestId + traceId + spanId into every log line
  // This is the single source of truth — never call pino() anywhere else
  {
    mixin() {
      const fields: Record<string, string> = {
        requestId: getRequestId(), // from AsyncLocalStorage
      };

      const span = trace.getActiveSpan();
      if (span) {
        const { traceId, spanId } = span.spanContext();
        fields.traceId = traceId; // links to Tempo trace in Grafana
        fields.spanId = spanId;
      }

      return fields;
    },
  }
);
```

Every log line now carries three correlation IDs:
- `requestId` — ties NGINX log + Node.js log + error response together
- `traceId` — links to the full distributed trace in Tempo
- `spanId` — identifies exactly which span in the trace this log belongs to

In Grafana, you can: query Loki by `requestId` to find all logs for one request,
then click `traceId` to jump to the full trace waterfall showing every DB query and Redis call timed individually.

---

## Phase 4 — Alerting

Set up alert rules in **Grafana Cloud → Alerting → Alert Rules** using these thresholds:

### Infrastructure Alerts

| Metric | Warning | Critical |
|---|---|---|
| CPU Utilization | > 80% | > 95% |
| Memory Utilization | > 85% | > 95% |
| Disk Usage | > 80% | > 90% |
| Swap Usage | > 0% | — (any swap = alert) |

### Database Alerts

| Metric | Warning | Critical |
|---|---|---|
| Cache Hit Ratio | < 95% | < 90% |
| Active Connections / max_connections | > 70% | > 90% |
| Replication Lag | > 10s | > 60s |
| Dead Tuples ratio | > 20% | > 50% |
| Transaction Wraparound remaining | < 500M | < 200M |
| Deadlocks per minute | > 0 | — (any deadlock = alert) |

### API Alerts

| Metric | Warning | Critical |
|---|---|---|
| 5xx Error Rate | > 1% | > 5% |
| P95 Response Time | > 500ms | > 2s |
| P99 Response Time | > 1s | > 5s |
| Rate-limited requests/min | > 100 | > 500 |

### Recommended Alert Channels
- **PagerDuty / OpsGenie** for critical (wake someone up)
- **Slack** for warnings (visible but not urgent)

Configure in Grafana → Alerting → Contact Points.

---

## Phase 5 — Dashboards

Create one dashboard per layer in Grafana. Each can be imported from the
**Grafana Dashboard library** (grafana.com/grafana/dashboards) by ID.

| Dashboard | Import ID | What it shows |
|---|---|---|
| Node Exporter Full | 1860 | CPU, memory, disk, network |
| NGINX Prometheus Exporter | 12708 | Requests/s, connection states, errors |
| Redis Dashboard | 763 | Memory, hit ratio, commands/s |
| PostgreSQL Overview | 9628 | Connections, QPS, cache, vacuum |
| Node.js App (custom) | — | P50/P95/P99 latency, RPS, error rate |

For the Node.js dashboard, create custom panels using these PromQL queries:

```promql
# P95 response time per route
histogram_quantile(0.95,
  sum(rate(http_request_duration_ms_bucket[5m])) by (le, route)
)

# 5xx error rate
sum(rate(http_requests_total{status=~"5.."}[5m]))
/ sum(rate(http_requests_total[5m])) * 100

# Rate-limited requests per minute (from NGINX)
increase(nginx_http_requests_total{status="429"}[1m])

# Active PG connections vs limit
pg_stat_activity_count{state="active"} / pg_settings_max_connections * 100
```

---

## Implementation Order

1. **Grafana Cloud signup** — get stack credentials (5 min, no card)
2. **Install Grafana Alloy** on your server
3. **Node Exporter** — system metrics flowing immediately
4. **NGINX JSON logs** — update log_format, wire into Alloy
5. **postgres_exporter + redis_exporter** — DB and cache metrics
6. **PG slow query log** — tail into Loki
7. **Pino structured logging** — replace any console.log in Node.js
8. **OpenTelemetry auto-instrumentation** — traces with zero business logic changes
9. **Log ↔ Trace correlation** — inject traceId into Pino logs
10. **Import Grafana dashboards** (IDs above)
11. **Configure alerting** — thresholds table above, routed to Slack + PagerDuty

---

## Files to Create / Modify

```
server/
  src/
    instrumentation.ts      ← OTel SDK init (imported first in entry point)
    lib/
      logger.ts             ← Pino logger with requestId + traceId + spanId mixin
      requestContext.ts     ← AsyncLocalStorage store for request-scoped context
    middleware/
      requestId.ts          ← reads X-Request-ID from NGINX, binds to async context
  server.ts                 ← import order: instrumentation → requestId → auth → routes

nginx/
  nginx.conf                ← add json_combined log_format in http {} block
  sites-available/
    api.conf                ← add /nginx_status location block

alloy/
  config.alloy              ← scrape configs + log sources + remote writes

infra/
  docker-compose.exporters.yml   ← nginx-exporter, redis-exporter, postgres-exporter
  .env.observability             ← Grafana Cloud endpoints + API key

postgres/
  postgresql.conf           ← log_min_duration_statement = 500
```

---

## Notes for Agent

- Stack: Node.js / Express, PostgreSQL, Redis, NGINX, Cloudflare
- **Grafana Cloud free tier is sufficient** to start — 10k metric series covers the full
  stack above with room to spare for a small app
- `requestIdMiddleware` must be registered **before** all other Express middleware — it
  sets up the async context that every subsequent logger call depends on
- `instrumentation.ts` must be the **first import** in the entry point before any other
  module — otherwise auto-instrumentation patches won't take effect
- All logs must be **structured JSON** (not plain strings) for Loki to parse and index them
- The `traceId` field in logs is what powers Grafana's Loki → Tempo correlation feature —
  don't skip Phase 3.3
- If NGINX writes logs as root, Alloy needs read permission: `sudo usermod -aG adm alloy`
- postgres_exporter connects with a **read-only monitoring role** — never use the superuser
- Cloudflare metrics (edge requests, firewall events, bandwidth) live in the Cloudflare
  dashboard — they can be pulled into Grafana via the Cloudflare Grafana plugin
  (grafana.com/grafana/plugins/cloudflare-app)
