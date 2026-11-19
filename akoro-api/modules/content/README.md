# content

## Purpose

Backs the public marketing site's blog and careers pages, and the admin CRUD
that writes them. It owns published blog posts (cards, featured post,
categories, related posts, newsletter subscribers) and the careers board
(departments, open jobs, applications), plus blog image uploads. All data lives
in the isolated `content` schema, not the main application schema.

## Entry points

- `modules/content/routes.js` is imported directly by `app.js` and mounted as
  `app.use("/api/content", standardLimit, contentModule)`. There is no
  `index.js`; the default export is the whole surface.
- Public blog: `GET /blog/posts` (`?category=&search=&limit=&offset=`),
  `GET /blog/posts/featured`, `GET /blog/categories`,
  `GET /blog/posts/:slug`, `POST /blog/subscribe`.
- Public careers: `GET /careers/departments`, `GET /careers/jobs` (`?dept=`),
  `GET /careers/jobs/:id`, `POST /careers/jobs/:id/apply`.
- Admin (role `admin`): `POST /admin/blog/upload`,
  `POST|PATCH|DELETE /admin/blog/posts[/:id]`, `GET /admin/blog/subscribers`,
  `POST|PATCH|DELETE /admin/careers/departments[/:id]`,
  `POST|PATCH|DELETE /admin/careers/jobs[/:id]`,
  `GET /admin/careers/applications` (`?job_id=`).

## How it works

- `contentDb` is a lazy client over `db.schema("content")`. Tables used are
  `blog_posts`, `blog_subscribers`, `job_departments`, `jobs` and
  `job_applications`; the schema comes from
  `migrations/2026-content-schema.sql`.
- Public reads only expose `status = 'published'` posts and `status = 'open'`
  jobs. Listing uses a card projection without the post body; the single-post
  route adds related posts.
- Newsletter signup upserts on `email` with `ignoreDuplicates`, so repeat
  signups are harmless. Job applications verify the job is still open before
  inserting.
- All write routes use `authenticateToken` + `requireRole(["admin"])`
  (`adminOnly`). Blog write validation requires `slug`, `title`, `category` and
  `author`; patches copy only known columns.
- Blog image upload is multer in memory (8 MB cap) and accepts only PNG, JPG,
  WEBP or GIF — SVG/HTML is rejected to avoid stored XSS. `ensureBucket()` and
  `uploadPublicFile()` from the school module put the file in R2 and return a
  public URL.
- After a post is created or updated, `reindexBlogPost(postId)` dynamically
  imports `lib/blogResearch.js` and indexes its passages for the agent's blog
  search. It runs after the response and any failure is swallowed.

## How to extend

- Put another read or write for an existing table in this file. Keep response
  shapes stable: the learner app's blog/careers pages consume the card and
  group shapes directly.
- Add new tables to the `content` schema migration, then use `contentDb` here;
  do not reach into the main schema from these routes.
- For a separate concern, create a sibling router file and mount it from
  `app.js`, since this module has no barrel. Keep files under 600 lines.
- Import another module only through its `index.js` (the upload helpers come
  from `modules/school/index.js`).

## Known limits

- There is no `index.js` and no test file for this module; the public and admin
  endpoints are unverified by CI.
- The `content` schema must be exposed to the REST client, and uploaded images
  need R2 credentials via the school module; without either, the corresponding
  routes fail at request time.
- `reindexBlogPost` is fire-and-forget, so a failed agent index is invisible
  apart from whatever `lib/blogResearch.js` logs.
- `GET /blog/posts` search strips PostgREST-breaking characters but still wraps
  the term in an `ilike`; it has no ranking beyond recency.
- Subscriber and application listings have no pagination; subscriber listing
  returns all rows.
