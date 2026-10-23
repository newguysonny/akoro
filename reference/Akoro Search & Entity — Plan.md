# Akoro Search & Entity — Plan

How akoro.name.ng gets understood by Google (and AI answer engines) as one
clear thing: **Akoro: AI proteges for education and learning.**

Status: draft for the owner, 2026-10-23. Nothing here is built yet.

## The identity (use these exact words everywhere)

| | Text |
|---|---|
| Brand | Akoro |
| Title / positioning | Akoro: AI proteges for education and learning |
| Description | Akoro helps students learn by teaching AI agents, building knowledge through conversation, practice, and feedback. |
| One-line entity | Akoro is an education and learning platform built around AI proteges. |
| The concept | An AI protege is a personal AI learner that a student teaches, practises with and develops over time. Teaching it is how the student learns. |
| The difference | You don't just ask your AI to teach you. You teach your AI. |

One spelling, everywhere: **protege** (no accents). The app already writes it
that way, and it is what people type. "Protégé" may appear once, in the body of
the AI protege page and as `alternateName`, so both spellings map to us.

The brief's two descriptions differ by one word ("interactivity,"). Pick one and
never vary it. Recommended: the shorter "conversation, practice, and feedback".

## Is the advice right?

Mostly yes. Checked against Google's own documentation:

| Claim | Verdict |
|---|---|
| Structured data helps Google understand a page but guarantees no feature or AI Overview | True |
| Organization markup with name, url, logo, description, sameAs helps identify the organisation | True. The logo must be crawlable and at least 112×112 px |
| sameAs only for real profiles | True, and important |
| A WebSite entity separate from the Organization | True, and it does more than the brief says: WebSite markup on the homepage (`name`, `alternateName`) is how Google picks the **site name** shown above the result |
| Sitelinks are chosen by Google; you can't create them, only make structure clear | True. There is no markup for them |
| AI Overviews can't be requested; the same fundamentals apply | True. There is no special "AI Overview SEO" |
| People-first content; no mass AI-written articles | True. Scaled low-value content is an explicit spam policy |
| Consistent descriptions across the site and profiles build the "entity" | Reasonable. Knowledge panels come from Google's Knowledge Graph, which draws on consistent, independent sources. No guarantee, and it takes months |
| An FAQ page | Fine for people, but FAQ rich results are now shown only for authoritative government and health sites, so FAQ markup won't add anything for Akoro |
| "Prerendering to static HTML per route would be the next robustness step" | Understated. For Akoro it is **step one**; see below |

What the advice misses is the site itself.

## Where akoro.name.ng stands today (checked live, 2026-10-23)

The public site is the learner app: a client-rendered React app on Vercel.
Every URL returns the same `index.html`:

| URL | What a crawler receives |
|---|---|
| `/`, `/about`, `/pricing`, `/blog`… | 200, title "Akoro — Learn", **no description**, no canonical, no Open Graph, no structured data |
| `/robots.txt` | 200 **HTML** (the app), not a robots file |
| `/sitemap.xml` | 200 **HTML**, not a sitemap |
| `/any-made-up-page` | 200: a soft 404; every typo is a "page" |
| `www.akoro.name.ng/...` | 200, not redirected: two copies of the site |
| `instructors.`, `admin.`, `schools.` subdomains | 200, indexable, titles "Akoro — Instructor" / "Akoro — Admin" / "Akoro — Learn" |

Google does run JavaScript, so it can eventually see each page's text. But:
- every page starts with the same title and no description, so Google writes
  its own;
- the 200-for-everything fallback invites soft-404s and duplicate pages;
- AI crawlers (GPTBot, ClaudeBot, PerplexityBot) and social previews (WhatsApp,
  LinkedIn, X) **do not run JavaScript**: today they see an empty page titled
  "Akoro — Learn". For the AI-answer goal, this matters more than any schema;
- the words "AI protege" appear nowhere on the landing or About page.

The public pages mostly exist already: `/`, `/about`, `/pricing`, `/compare`,
`/contact`, `/careers`, `/blog`, `/blog/:slug`, `/partners`, `/student-info`,
`/instructor-info`, `/school-info`, `/course/:slug`, `/privacy`, `/terms`.

## Phase 0 — Make the site readable (technical, first)

Nothing else pays off until crawlers get real HTML.

1. **Per-route HTML at build.** A build step (`scripts/seo-pages.mjs`)
   writes `dist/<route>/index.html` for every public route. Each gets its own
   `<title>`, meta description, canonical, Open Graph / Twitter tags and
   JSON-LD. Vercel serves real files before its rewrite, so `/about` gets
   `about/index.html`.
2. **Prerender the body of the marketing pages** (render each public page to
   HTML at build), so the text is in the HTML, not only after JavaScript. The
   app still hydrates normally. This is what AI crawlers and link previews read.
3. **Dynamic public pages:** published blog posts and courses are fetched
   from the API at build time and get their own files (`Article` and `Course`
   markup). A post published between deploys falls back to the app until the
   next build. A daily Vercel deploy hook keeps them fresh.
4. **noindex on the fallback.** The catch-all `index.html` (app screens,
   sign-in, unknown URLs) carries `<meta name="robots" content="noindex">`.
   Only the generated public pages are indexable. This ends the soft-404s
   without touching the app's routing.
5. **robots.txt** in `public/` (allow all; `Sitemap:` line). Don't block the
   app routes there: Google must be able to fetch a page to see its noindex.
6. **sitemap.xml**, generated by the same build step: public pages + posts +
   courses, with `lastmod`.
7. **One host.** Redirect `www.akoro.name.ng` → `akoro.name.ng` (a Vercel
   domain setting: owner action).
8. **Consoles out of search.** `instructors.`, `schools.`, `admin.`: noindex in
   their HTML, and a disallow-all `robots.txt` on admin.
9. **Search Console**: verify the domain by DNS (owner action), submit the
   sitemap, then use URL Inspection on `/`, `/about` and `/ai-protege` to see
   the rendered HTML Google gets.

A ui-gate check keeps this honest: for each public route it fetches the raw
HTML (no JavaScript) and checks the title, description, canonical, JSON-LD and
the page's H1. It also checks that `/robots.txt` and `/sitemap.xml` are the
real files and that an unknown URL carries noindex.

## Phase 1 — The entity foundation (content + markup)

| Page | Title | Purpose |
|---|---|---|
| `/` | Akoro: AI proteges for education and learning | The identity, in the H1 area and first paragraph; links to every page below with descriptive anchors |
| `/about` | About Akoro | "Akoro is an education and learning platform built around AI proteges." Who it serves, how it works, the name, the team, real contact details |
| `/ai-protege` (new) | AI Proteges: a new way to learn \| Akoro | The concept page: what an AI protege is, the learning loop (teach → it answers → you correct → practise → feedback), AI tutor vs AI protege, the research on learning by teaching |
| `/how-it-works` (new) | How Akoro Works | The loop in the product: teach, chat, Study Prep, battles, Agent Check, feedback |

Markup (homepage, one `@graph`):
- `Organization` (`@id …/#organization`): name, url, logo, description,
  `sameAs` (real profiles only), contact point.
- `WebSite` (`@id …/#website`): `name: "Akoro"`, `alternateName`, url,
  `publisher → #organization`. This sets the site name.
- Each page gets `WebPage` (its own name and description, `isPartOf → #website`)
  and `BreadcrumbList` where it nests.
- `/ai-protege` gets a `DefinedTerm` ("AI protege") with the definition.

Navigation and footer: the same pages, with descriptive link text ("Learn about
AI proteges", "Akoro for Schools"), never "Click here". This is the structure
Google draws sitelinks from.

## Phase 2 — Product pages

Rename the existing pages to clean URLs and redirect the old ones (301 in
`vercel.json`):

| Today | Becomes | Title |
|---|---|---|
| `/student-info` | `/for-students` | Akoro for Students: learn by teaching AI |
| `/instructor-info` | `/for-teachers` | Akoro for Teachers |
| `/school-info` | `/for-schools` | Akoro for Schools |
| — | `/exam-prep` (new) | Exam Preparation with Akoro (WAEC/NECO/JAMB: syllabus, topics, practice, feedback) |
| `/pricing`, `/compare`, `/partners`, `/blog` | unchanged | each with its own title and description |

Every page has a real job. No near-duplicate pages (`/about-us`, `/company`,
`/who-we-are`) made to chase extra sitelinks.

## Phase 3 — Signals outside the site (owner-led)

The same description, word for word, on profiles that link back:
LinkedIn company page, X, YouTube, GitHub (if public code), startup directories,
founder profiles, school partners' sites, press. Each real profile goes into
`sameAs`. Don't create a Wikipedia or Wikidata entry until independent coverage
exists: they get deleted without it.

## Phase 4 — Authority content (slow, real)

Only content with a reason to exist: the learning-by-teaching method and the
research behind it, real case studies from schools, original data from Akoro's
own learning (anonymised), and exam-prep resources students actually use. A
few strong pieces, not volume.

## How we'll know it's working

- Search Console: pages indexed, impressions and clicks for "akoro" and
  "ai protege", no soft-404 or duplicate warnings.
- The brand result shows "Akoro" as the site name, our title and our
  description.
- A raw fetch of any public page (no JavaScript) shows its real title and text.
- A link pasted into WhatsApp or LinkedIn shows the right title, description
  and image.

Timeline: crawl fixes are visible in days to weeks once deployed. Site name and
sitelinks take weeks to months. A knowledge panel or AI Overview may never
come; it depends on Google and on outside references.

## Decisions for the owner

1. Spelling: "protege" everywhere (recommended), with "protégé" as an alternate
   name?
2. The description: with or without "interactivity,"?
3. Real profile URLs for `sameAs` (LinkedIn, X, YouTube…), and the logo file to
   use (square, at least 112×112).
4. OK to rename `/student-info` → `/for-students` (and the two others) with
   redirects?
5. Owner actions: `www` → apex redirect in Vercel, DNS verification for Search
   Console.
6. Is akoro.name.ng the long-term domain? Moving later is possible (301s carry
   most signals) but resets some trust, so it's cheaper before this work than
   after.
