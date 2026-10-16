#!/usr/bin/env bash
# Local target for the Verification Gate: the REAL API on a disposable stack.
#
#   Postgres 16 (+pgvector) :5432  →  PostgREST :3999  →  shim :3998 (/rest/v1)
#   Redis :6379 · mock OpenAI :4900 (or a real key) · API :4600 with VERIFY_TARGET=local
#
# Idempotent: re-run after a container restart; each piece starts only if it
# isn't already up. First run applies every migration (schema + demo seeds,
# including the 50 testers). Then:
#
#   curl -s -X POST localhost:4600/api/verify/runs -H 'Authorization: Bearer local-console-key' \
#        -H 'Content-Type: application/json' -d '{"suite":"regression","wait":false}'
#
# With the mock model, scenarios that judge the MODEL's tool choice FAIL by
# design (it can't choose); set OPENAI_API_KEY to use a real model instead.
set -euo pipefail
API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="${STACK_DIR:-/tmp/akoro-verify-stack}"
mkdir -p "$STACK/bin"
DB=akoro; PGPW=pg; JWT_SECRET=verify-local-jwt-secret-0123456789abcdef0123
PG="postgresql://postgres:$PGPW@127.0.0.1:5432/$DB"
log() { echo "[local-stack] $*"; }

# 1. Postgres
if ! pg_isready -h 127.0.0.1 -p 5432 -q; then
  ls /usr/share/postgresql/16/extension/vector.control >/dev/null 2>&1 || apt-get install -y -q postgresql-16-pgvector >/dev/null
  pg_ctlcluster 16 main start
  for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 -q && break; sleep 1; done
fi
su postgres -c "psql -qtAc \"ALTER USER postgres PASSWORD '$PGPW'\"" >/dev/null
if ! PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
  log "creating database $DB"
  PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -qc "CREATE DATABASE $DB"
  PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -d $DB -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'auth'; GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
SQL
  PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -qc "ALTER DATABASE $DB SET search_path = public, extensions"
fi
log "migrating (schema + demo)"
( cd "$API_DIR" && MIGRATION_DATABASE_URL="$PG" node scripts/apply-migrations.mjs --group=all ) > "$STACK/migrate.log" 2>&1 || { tail -5 "$STACK/migrate.log"; exit 1; }
tail -1 "$STACK/migrate.log"
SCHEMAS=$(PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -d $DB -Atc "select string_agg(nspname, ',') from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema','extensions','auth')")
PGPASSWORD=$PGPW psql -h 127.0.0.1 -U postgres -d $DB -qc "GRANT USAGE ON SCHEMA ${SCHEMAS} TO service_role, anon" >/dev/null

# 2. PostgREST + shim
[ -x "$STACK/bin/postgrest" ] || curl -sL https://github.com/PostgREST/PostgREST/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$STACK/bin"
cat > "$STACK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:auth@127.0.0.1:5432/$DB"
db-schemas = "$SCHEMAS"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = 3999
CONF
curl -s --max-time 5 -o /dev/null http://127.0.0.1:3999/ || (cd "$STACK" && nohup bin/postgrest postgrest.conf > postgrest.log 2>&1 &)
curl -s --max-time 5 -o /dev/null http://127.0.0.1:3998/ || (nohup node "$API_DIR/scripts/verify/pgrest-shim.mjs" > "$STACK/shim.log" 2>&1 &)
SERVICE_JWT=$(cd "$API_DIR" && node -e "console.log(require('jsonwebtoken').sign({role:'service_role',iss:'supabase'},'$JWT_SECRET',{expiresIn:'30d'}))")

# 3. Redis + model
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --port 6379 >/dev/null
if [ -z "${OPENAI_API_KEY:-}" ]; then
  curl -s --max-time 5 -o /dev/null http://127.0.0.1:4900/ || (cd "$API_DIR" && MOCK_PORT=4900 nohup node scripts/golden-path/mock-openai.mjs > "$STACK/mock.log" 2>&1 &)
  MODEL_ENV="OPENAI_API_KEY=mock
OPENAI_BASE_URL=http://127.0.0.1:4900/v1"
else
  MODEL_ENV="OPENAI_API_KEY=$OPENAI_API_KEY"
fi

# 4. API
cat > "$STACK/api.env" <<ENV
SUPABASE_URL=http://127.0.0.1:3998
SUPABASE_SERVICE_KEY=$SERVICE_JWT
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_JWT
DATABASE_URL=$PG
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=local-jwt-secret
PORT=4600
HOST=127.0.0.1
$MODEL_ENV
AGENT_CONSOLE_KEY=${AGENT_CONSOLE_KEY:-local-console-key}
RENDER_GIT_COMMIT=$(cd "$API_DIR" && git rev-parse HEAD 2>/dev/null || echo local)
VERIFY_TARGET=local
ENABLE_TASK_WORKER=false
AKORO_SELF_TOOLING_ENABLED=true
GOOGLE_CLIENT_ID=d
GOOGLE_CLIENT_SECRET=d
REDIRECT_URI_GOOGLE=http://localhost
ZOOM_CLIENT_ID=d
ZOOM_CLIENT_SECRET=d
REDIRECT_URI_ZOOM=http://localhost
TEAMS_CLIENT_ID=d
TEAMS_CLIENT_SECRET=d
REDIRECT_URI_TEAMS=http://localhost
ENV
# Free :4600 (a stale API from before a container restart can hold it and never answer).
if [ "${RESTART_API:-1}" = 1 ]; then
  for pid in $(pgrep -f "^node app.js" || true); do kill "$pid" 2>/dev/null || true; done
  command -v fuser >/dev/null && fuser -k 4600/tcp >/dev/null 2>&1 || true
  sleep 1
fi
curl -s --max-time 5 -o /dev/null http://127.0.0.1:4600/health || (cd "$API_DIR" && set -a && . "$STACK/api.env" && set +a && nohup node app.js --verify-local > "$STACK/api.log" 2>&1 &)
for i in $(seq 1 60); do curl -s --max-time 5 -o /dev/null http://127.0.0.1:4600/health && break; sleep 1; done
curl -s --max-time 5 http://127.0.0.1:4600/health | STACK="$STACK" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log(`[local-stack] API up · build ${h.build?.git} · logs ${process.env.STACK}/api.log`)})'
