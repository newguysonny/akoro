# Golden-path tests

Exercises the three MVP journeys — battle, task, self study — against a REAL
API, a REAL Postgres and a REAL Redis. Not mocks: these caught two migration
failures that only appear on a fresh database, and a `POST /api/self-study`
that was a guaranteed 500 in production.

## Why it needs a local stack

The API talks PostgREST, not Postgres. So the stack is:

    app.js  →  shim :3998 (adds /rest/v1)  →  PostgREST :3999  →  Postgres :5433

## Setup

    apt-get install -y postgresql-16-pgvector
    curl -sL https://github.com/PostgREST/PostgREST/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz \
      | tar -xJ -C /usr/local/bin

    redis-server --daemonize yes
    initdb -D /tmp/pg -U postgres --auth=trust
    pg_ctl -D /tmp/pg -o '-p 5433 -c unix_socket_directories=/tmp/pgsock' -l /tmp/pg.log start
    createdb -h localhost -p 5433 -U postgres akoro

Supabase provides four things a bare Postgres doesn't. Add them before migrating:

    CREATE EXTENSION pgcrypto SCHEMA extensions;   -- schema-qualified, as Supabase has it
    CREATE EXTENSION vector;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;

Then:

    DATABASE_URL=postgresql://postgres@localhost:5433/akoro node scripts/apply-migrations.mjs --group=all

## Running

Boot the API against the shim, then:

    node scripts/golden-path/gp-battle.mjs
    node scripts/golden-path/gp-all.mjs      # task + self study

## Note

Logins are rate limited to 5 per 15 minutes per IP — which is the limiter
working, since it was inert until recently. Restart the API between full runs;
the store is in-process.

## Battle fields — what the endpoints actually require

Taken from the routes, not from the tool's own claims. gp-chat-battle.mjs
asserts both halves of this table.

| Field            | Class battle | Learners (in a class) | Course battle | Study review |
|------------------|--------------|-----------------------|---------------|--------------|
| `title`          | required     | required              | required      | required     |
| `audience`       | required     | required              | required      | required     |
| `className`      | required     | required              | —             | required     |
| `subject`        | **required** | **required**          | optional      | **required** |
| `usernames`      | —            | two or more           | —             | exactly one  |
| `courseId`       | —            | —                     | required*     | —            |
| `topic`          | optional†    | optional†             | optional‡     | optional†    |
| `difficulty`     | intermediate | intermediate          | intermediate  | intermediate |
| `totalQuestions` | 15           | 15                    | 15            | 15           |
| `durationMinutes`| 15           | 15                    | 15            | 15           |
| `xpPrize`        | 200          | 200                   | 200           | 200          |
| `questionSource` | auto         | auto                  | auto          | auto         |
| `scheduledFor`   | now          | now                   | now           | now          |

\* or the course the task is attached to.
† recorded, and steers AI generation, but does NOT narrow the past-questions
bank — that is searched by SUBJECT, which is why subject is the mandatory one.
‡ FILTERS the course's own bank, so a topic that course has no questions for
comes back empty.

At least 5 questions must be findable or creation is refused. `questionSource`
'bank' refuses rather than generating; 'ai' generates the lot and costs coins.

## If gp-tools reports "Connection error"

That is the stand-in model being down, not a regression — every AI path fails
at once and the message comes from the OpenAI client, not from our code. Check
it before reading anything into the failures:

    curl -s localhost:4900/v1/models >/dev/null && echo up || echo down

## AI-backed paths (gp-tools.mjs)

Needs a stand-in model, since these paths would otherwise call OpenAI:

    node scripts/golden-path/mock-openai.mjs &
    export OPENAI_BASE_URL=http://127.0.0.1:4900/v1
    export ENABLE_TASK_WORKER=true
    export INTERNAL_API_URL=http://127.0.0.1:4800
    export RATE_LIMIT_AI=500 RATE_LIMIT_STANDARD=2000 RATE_LIMIT_STRICT=100

What the mock DOES prove: routing, tool selection plumbing, argument
validation, DB writes, coin charging, artifact persistence, every failure
branch. What it CANNOT prove: whether a real model picks the right tool or
writes good questions. That needs a live key.

Coins are real. A run costs a few, and a wallet at zero fails every AI test
with "Insufficient coin balance" — top up the test accounts, don't chase it as
a bug.
