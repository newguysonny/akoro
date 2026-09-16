# Fortizo Backend — Build Plan

Scope: the backend that powers the Fortizo document viewer + study tools
(Chat/Copilot, Summary, Quiz, Flashcards, Podcast, Video, Notes). Document
parsing is **not** built from scratch — it's the vendored Hanji engine
(`hanji-main/`), called as an internal service. This doc is written to be
handed to Claude Code as the implementation brief.

---

## 1. Where Hanji fits

Hanji replaces the "Python document worker" layer entirely. It already gives
us: PDF/PPTX/DOCX/image parsing, layout-grounded chunks (bbox + page + type),
an async batch lane (Postgres + S3 + worker + webhooks), and grounded schema
extraction with citation verification. We do **not** reimplement any of that.

What Hanji does **not** do, and what our own API owns instead:

- Long-term storage of materials/chunks (Hanji's Postgres is just batch-job
  bookkeeping — results are meant to be pulled once and persisted by us)
- Embeddings / vector search
- Everything generative: chat replies, summaries, quiz questions, flashcards,
  podcast/video scripts
- Auth, users, notes, chat history
- Serving the original file to the frontend for PDF.js rendering

```
┌───────────────────┐
│   Frontend (React) │  Fortizo viewer + tools panel (already built)
└─────────┬──────────┘
          │ REST (+ SSE for streaming chat)
          ▼
┌───────────────────────────┐        ┌──────────────────────────┐
│   Fortizo API (Node)      │──HTTP─▶│  Hanji (vendored, as-is) │
│   Express + Postgres      │◀─webhook│  FastAPI + Postgres+S3   │
│   + pgvector               │        │  (its own batch lane)    │
└─────────┬──────────────────┘        └──────────────┬───────────┘
          │                                            │
          ▼                                            ▼
   materials / chunks /                         parse-model endpoint
   embeddings / chat /                          (hanji-parse-4b, see §5)
   generated_artifacts
          │
          ▼
   Object storage (original files — can be the same bucket
   Hanji's batch lane already provisions, or a separate one)
```

Two Postgres databases (or at least two schemas), not one:

- **`hanji` DB** — Hanji's own batch-job tables (`migrations/0001...sql`,
  `0002...sql`). Ephemeral, don't build anything on top of it.
- **`fortizo` DB** — our real data: materials, chunks, embeddings, chat,
  generated tool output, notes. This is the one Claude Code builds.

---

## 2. Repo layout

```
fortizo/
├── hanji/                 # vendored, unmodified — a plain copy committed
│                           # into this repo (see note below), not a submodule
├── api/                   # our Node/Express backend (new)
│   ├── src/
│   │   ├── routes/        # materials, chat, tools, notes, webhooks
│   │   ├── services/      # hanji-client, embeddings, llm, storage
│   │   ├── db/            # migrations + query layer
│   │   └── workers/       # embedding worker, tool-generation worker
│   └── package.json
└── docker-compose.yml     # extends hanji's compose: adds our api + our db
```

**Why a plain copy, not a git submodule:** a submodule points at
`YouLearn-AI/hanji` on GitHub and assumes that remote keeps existing. Hanji
(the company) is no longer active — the repo could disappear, go private, or
just stop being reachable with no warning. We already have the code; commit
it directly into this repo as a normal folder. It's Apache-2.0 licensed, so
we're free to fork and maintain it ourselves indefinitely. We get zero
future upstream fixes either way, so a submodule buys us nothing here and
adds a failure mode a plain copy doesn't have.

---

## 3. Data model (`fortizo` DB)

```sql
create extension if not exists vector;

create table materials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  title           text not null,
  file_path       text not null,        -- our object storage key for the original
  mime_type       text not null,
  page_count      int,
  status          text not null default 'uploading',
    -- uploading | processing | ready | failed
  hanji_batch_id  text,                 -- Hanji's batch id, for the webhook to match on
  error           text,
  created_at      timestamptz not null default now()
);

create table material_pages (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  page_number     int not null,
  width           numeric,              -- PDF points — needed to map bbox -> viewer overlay
  height          numeric,
  unique (material_id, page_number)
);

create table material_chunks (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  page_number     int not null,
  chunk_index     int not null,         -- reading order within the material
  chunk_type      text not null,        -- text | table | image | kv  (mirrors Hanji's ChunkType)
  bbox            numeric[4],           -- [x0, y0, x1, y1], PDF points — straight from Hanji
  text            text not null default '',
  table_cells     jsonb,                -- present only for chunk_type = 'table'
  confidence      real,
  embedding       vector(1536),         -- null until the embedding worker runs
  created_at      timestamptz not null default now()
);
create index on material_chunks using ivfflat (embedding vector_cosine_ops);
create index on material_chunks (material_id, page_number);

create table chat_threads (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table chat_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references chat_threads(id) on delete cascade,
  role            text not null,        -- user | assistant
  text            text not null,
  citations       jsonb,                -- [{ page, bbox, chunk_id }]
  attachment_name text,
  created_at      timestamptz not null default now()
);

-- One generic table for every generative tool, instead of a table per tool.
create table generated_artifacts (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  tool_type       text not null,        -- summary | quiz | flashcards | podcast | video
  params          jsonb not null,       -- the form values (focus, length, difficulty, ...)
  status          text not null default 'pending', -- pending | ready | failed
  content         jsonb,                -- tool-specific shape, see §6
  created_page    int,
  created_at      timestamptz not null default now()
);

create table notes (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  page_number     int,
  content         text not null default '',
  updated_at      timestamptz not null default now()
);
```

---

## 4. Ingestion flow

1. `POST /materials` — client sends filename + mime type. We create a
   `materials` row (`status='uploading'`), return a presigned upload URL to
   our own bucket (not Hanji's — we want the original file under our own
   storage regardless of how parsing goes).
2. Client uploads the file directly to storage.
3. `POST /materials/:id/process` — client confirms upload finished. We call
   Hanji's **async batch** lane, not the sync `/v1/parse` route:
   - `POST {HANJI_URL}/v1/files` → presigned slot on Hanji's own uploads bucket
   - upload the file there (or pass our own file's signed URL if Hanji
     supports parsing by URL for batch — check `docs/batch.md` for the
     exact request shape at implementation time)
   - `POST {HANJI_URL}/v1/batches` with `chunking=semantic`, our webhook URL,
     and the file reference
   - store the returned batch id on `materials.hanji_batch_id`, set
     `status='processing'`
   - **Why async, not sync `/v1/parse/file`:** sync is fine for a 2-page
     invoice; a 300-page textbook needs the batch lane so the request
     doesn't hang. Use sync only as a fast path for small materials
     (page_count below some threshold, e.g. 5 pages) if we want snappier
     UX for short documents — Claude Code's call, but batch-by-default is
     the safer starting point.
4. `POST /webhooks/hanji` — Hanji calls this when the batch completes
   (signature verification per `docs/webhooks.md`). On success:
   - fetch the batch result (chunks)
   - insert rows into `material_pages` and `material_chunks` verbatim from
     Hanji's output (page_number ← `page_no`, bbox ← `bbox`, etc.)
   - enqueue the embedding worker for this material
   - set `materials.status='processing_embeddings'`, then `'ready'` once
     the embedding worker finishes
   - on failure: `status='failed'`, store `error`
5. Frontend polls `GET /materials/:id` (or we add SSE/websocket later) until
   `status='ready'`.

---

## 5. The parse-model dependency (decide before starting)

Hanji's `/v1/parse*` and the batch worker both require `PARSE_MODEL_URL` —
it is **not optional**, unlike Gemini.

**Checked just now:** `hanji-dev/hanji-parse-4b` is still live on Hugging
Face (`huggingface.co/hanji-dev/hanji-parse-4b`), with activity from one of
Hanji's former founders within the last couple weeks. So the weights are
reachable *today*. That's independent of whether hanji.dev the product is
still running — Hanji-the-company being defunct means there's no one left
maintaining that Hugging Face org either, so this can go away without
warning the same way the GitHub repo could have. Don't build a permanent
dependency on it being there next month.

**Step 0, before anything else in this section: mirror the weights.**
Download `hanji-dev/hanji-parse-4b` now and re-upload it to storage we
control — our own Hugging Face org (private or public), or straight into
our own S3/GCS bucket. This is a five-minute job today and possibly
impossible later. Every option below should then point at *our* copy, not
`hanji-dev/hanji-parse-4b` directly.

Once we have our own copy of the weights, three ways to serve them, in
order of how fast Claude Code can get something running:

1. **Hosted deployment (fastest to start with).** `serving/baseten-truss-config.yaml`
   is already in the repo — point it at our mirrored weights and deploy on
   Baseten, then set `PARSE_MODEL_URL` / `PARSE_MODEL_API_KEY` to that
   endpoint. No GPU ops.
2. **Self-host** via `docker compose --profile gpu` (needs a GPU with
   ~12 GB+ VRAM), pointing `MODEL_PATH` at our mirrored copy instead of
   `hanji-dev/hanji-parse-4b`. Not realistic for a normal dev sandbox;
   revisit once there's real usage to justify the ops cost.
3. ~~Hosted API directly from hanji.dev~~ — not an option; the company's
   no longer operating it.

Pick one and put it in `.env` before Claude Code starts on §4 — nothing in
the ingestion flow works without it.

`GEMINI_API_KEY` is also needed if we ever use Hanji's `/v1/extract/schema`
route (see §6, optional use for flashcards term extraction) — this one's a
normal live Google Cloud dependency, not affected by Hanji's shutdown.

---

## 6. Study tools — what each one actually calls

All of these read from `material_chunks` (already embedded) rather than
re-parsing anything. They're standard LLM generation calls, not Hanji calls
— Hanji's job ended at ingestion.

- **Chat / Copilot** — `POST /materials/:id/chat`. Body: `{ text, selection?
  }` where `selection` is `{ page, text, chunk_ids? }` when the message came
  from the selection popover ("Explain: ..."). Flow: embed the user's
  message → pgvector similarity search over `material_chunks` for that
  material → build a context window from top-k chunks (+ the selected
  chunks directly, if present, pinned regardless of similarity rank) → call
  the LLM → store the reply in `chat_messages` with `citations` pointing at
  the chunk ids/pages actually used → stream the response back (SSE) so the
  frontend's typing-indicator UX has something real to show progress for.
- **Summary** — `POST /materials/:id/tools/summary` with `{ depth, page? }`.
  Pull chunks for the given page (or whole document), one LLM call, store
  bullet points in `generated_artifacts.content`.
- **Quiz** — `{ focus?, count, difficulty }`. LLM call constrained to return
  structured JSON (question + 4 options + correct index) — use the LLM
  provider's structured-output / JSON-schema mode so the frontend doesn't
  need to parse free text.
- **Flashcards** — `{ count }`. Same structured-output approach, array of
  `{ front, back }`. *Optional accelerant:* Hanji's `/v1/extract/schema`
  with `auto_schema=true` can pull a grounded list of key terms/definitions
  first, which the flashcard LLM call then elaborates on — gives citations
  for free. Not required for v1; plain generation is fine to start.
- **Podcast / Video** — these are two-stage: (1) LLM generates a script from
  the chunks, stored immediately so the UI can show progress; (2) a
  separate async job turns the script into audio (TTS) or a video (script +
  slides/TTS), updates `generated_artifacts.status` to `ready` with the
  final asset URL when done. Pick TTS/video vendors later — not blocking for
  the rest of the plan.
- **Notes** — plain CRUD against the `notes` table, no LLM involved.

Every generative call above should log which `material_chunks` it used, so
"click a citation → jump the viewer to that page/bbox" works the same way
for tool output as it does for chat.

---

## 7. API surface (Fortizo → frontend)

```
POST   /materials                       start upload, returns presigned URL
POST   /materials/:id/process           confirm upload, kicks off Hanji batch
GET    /materials/:id                   status + metadata
GET    /materials/:id/file              signed URL to the original (PDF.js source)
GET    /materials/:id/chunks            paginated chunks (viewer uses this for selection→chunk mapping)

POST   /materials/:id/chat              send a chat message (SSE response)
GET    /materials/:id/chat              thread history

POST   /materials/:id/tools/:toolType   generate summary|quiz|flashcards|podcast|video
GET    /materials/:id/tools             list generated artifacts for this material
GET    /artifacts/:id                   poll a single artifact until status='ready'

GET    /materials/:id/notes
PUT    /materials/:id/notes             upsert by page_number

POST   /webhooks/hanji                  internal — Hanji batch-completion callback
```

---

## 8. Build phases (sequenced for Claude Code)

1. **Scaffold** — Express app, `fortizo` DB + migrations from §3, storage
   client, env config. No Hanji integration yet.
2. **Ingestion** — §4 end to end against a real deployed Hanji instance
   (needs §5 decided first). Verify a real PDF goes upload → processing →
   `material_chunks` populated, by hand via curl before touching the
   frontend.
3. **Embeddings** — worker that embeds any `material_chunks` row where
   `embedding is null`, triggered after ingestion completes.
4. **Chat** — similarity search + LLM + citations + SSE streaming.
5. **Tools** — summary first (simplest), then quiz/flashcards (structured
   output), then notes (no LLM, quick win), then podcast/video last (extra
   vendor integration for TTS/video).
6. **Wire up the existing frontend** — swap Fortizo's mocked chat/tool
   responses for real calls to this API.

Auth is intentionally not in this plan — decide whether Fortizo needs
multi-user accounts before Claude Code builds `materials.user_id` handling,
or stub it with a single hardcoded user for now and add real auth later.

---

## 9. Open decisions before Claude Code starts

- [ ] **Mirror `hanji-dev/hanji-parse-4b` to storage we control — do this
      first, today, independent of everything else** (§5)
- [ ] Parse-model hosting choice (§5)
- [ ] LLM provider for chat/tools (and whether it's the same provider as
      Hanji's Gemini dependency or separate)
- [ ] Object storage provider (S3 / Supabase Storage / R2)
- [ ] Sync-vs-batch threshold for small documents (§4 step 3)
- [ ] TTS/video vendor for the Podcast/Video tools
- [ ] Auth approach (real accounts vs. stub for now)
