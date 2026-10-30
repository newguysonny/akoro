# Email templates — reference

The redesigned auth emails live in `akoro-api/modules/auth/emails.js` (one `render*` function and one
`send*` wrapper per email; `npm run test:emails` in `akoro-api`). Their images are in
`akoro-learner/public/email/` and are served from `EMAIL_ASSET_BASE` / `FRONTEND_URL`.

## Inspiration: the Notable email template pack (UI8, Figma)

| File | What it is |
| --- | --- |
| `notable-overview.png` | The pack's own preview: Onboarding, Verification and Transactional emails, each in light and dark. |
| `notable-image-grid.png` | A grid of the 33 images embedded in the Figma file (stock photos, a laptop mock-up, map screenshots, a purple gradient). |

**Reference only.** The photos and screenshots in the pack are third-party stock; do not copy them into
the product. What we borrowed is structure: a small header, a hero image, step cards, tinted detail
panels, a row of code boxes, a receipt table, and a full dark version of every email.

## What we ship instead

- **Hero art:** custom purple illustrations (welcome uses the same cards over a photo). Sources in
  `hero-source/` — `illustrations.mjs` writes the SVGs, `photo-hero.js` composes the photo hero with
  Playwright. Render at 1040×420 and save as JPEG (email clients can't show SVG).
- **Welcome photo:** a placeholder from Pexels (free licence), photo ID 5940713. Replace it with a
  generated or our own photo when we have one, and update this line.
- **Logo:** `akoro-learner/public/email/mark.png` (the logo v2 mark, from `assets/logo-v2/`).

## Not built yet

Sign-in code, receipt and "new device" emails are designed in the mock-ups but have no sender in the
app yet. The receipt and gift emails in other modules still use their own HTML.
