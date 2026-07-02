/**
 * siteRenderer.js — public school landing page renderer.
 *
 * Two modes (school_website.mode):
 *   'template' → the school's active full-HTML template, run through a tiny
 *                mustache-style engine ({{var}}, {{#if}}, {{#each}}).
 *   'theme'    → a built-in themed layout assembled from the structured
 *                Website settings fields.
 *
 * The template engine is deliberately small and safe: no eval, HTML-escaped
 * variable output by default (use {{{var}}} for raw), and block helpers for
 * conditionals and section loops so a template can define its own markup for
 * each course / teacher / class and we fill the list.
 */

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const truthy = (v) => !(v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0) || v === 0);
const lookup = (ctx, key) => {
  if (key === "this") return ctx.this !== undefined ? ctx.this : ctx;
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
};

/**
 * Render a mustache-ish template. Supports:
 *   {{ key }}         escaped value
 *   {{{ key }}}       raw (unescaped) value
 *   {{#if key}}…{{/if}}
 *   {{#each list}}…{{/each}}   ({{this}} / {{field}} inside)
 * Blocks may nest. Unknown keys render as empty string.
 */
export function renderMiniTemplate(tmpl, ctx) {
  if (!tmpl) return "";
  const src = String(tmpl);
  let out = "";
  let i = 0;

  while (i < src.length) {
    const open = src.indexOf("{{", i);
    if (open === -1) { out += src.slice(i); break; }
    out += src.slice(i, open);

    // Raw triple-brace {{{ ... }}}
    if (src.startsWith("{{{", open)) {
      const close = src.indexOf("}}}", open + 3);
      if (close === -1) { out += src.slice(open); break; }
      out += lookup(ctx, src.slice(open + 3, close).trim()) ?? "";
      i = close + 3;
      continue;
    }

    const close = src.indexOf("}}", open + 2);
    if (close === -1) { out += src.slice(open); break; }
    const tag = src.slice(open + 2, close).trim();
    const afterTag = close + 2;

    const block = tag.match(/^#(if|each)\s+(.+)$/);
    if (block) {
      const [, kind, key] = [block[0], block[1], block[2].trim()];
      const bodyStart = afterTag;
      const closeOpen = findMatchingClose(src, bodyStart, kind); // index of the matching {{/kind}}
      const body = src.slice(bodyStart, closeOpen);
      const closeEnd = src.indexOf("}}", closeOpen);
      i = closeEnd === -1 ? src.length : closeEnd + 2;

      if (kind === "if") {
        if (truthy(lookup(ctx, key))) out += renderMiniTemplate(body, ctx);
      } else {
        const list = lookup(ctx, key);
        if (Array.isArray(list)) {
          for (const item of list) {
            const itemCtx = (item && typeof item === "object")
              ? { ...ctx, ...item, this: item }
              : { ...ctx, this: item };
            out += renderMiniTemplate(body, itemCtx);
          }
        }
      }
      continue;
    }

    // Plain (escaped) variable — ignore stray close tags.
    if (!tag.startsWith("/")) out += escapeHtml(lookup(ctx, tag));
    i = afterTag;
  }
  return out;
}

// Given the index just after a block-open tag, return the start index ("{{")
// of the matching close tag, honoring nested same-kind blocks.
function findMatchingClose(src, start, kind) {
  let depth = 1, p = start;
  const openRe = new RegExp(`^#${kind}\\s`);
  while (p < src.length) {
    const next = src.indexOf("{{", p);
    if (next === -1) return src.length;
    const c = src.indexOf("}}", next + 2);
    if (c === -1) return src.length;
    const t = src.slice(next + 2, c).trim();
    if (openRe.test(t)) depth++;
    else if (t === `/${kind}`) { depth--; if (depth === 0) return next; }
    p = c + 2;
  }
  return src.length;
}

/* ── Theme-mode layout ───────────────────────────────────────────────────── */
const SECTION_RENDERERS = {
  hero: (w, c) => `
    <section class="hero" ${w.hero_image_url ? `style="background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url('${escapeHtml(w.hero_image_url)}');background-size:cover;background-position:center;color:#fff"` : ""}>
      <div class="wrap">
        <h1>${escapeHtml(w.hero_title || c.school_name)}</h1>
        <p>${escapeHtml(w.hero_subtitle || "")}</p>
        ${c.portal?.apply ? `<a class="btn" href="/apply">Apply for Admission</a> ` : ""}
        <a class="btn${c.portal?.apply ? " btn-outline" : ""}" href="/login">Parent / Student Login</a>
      </div>
    </section>`,
  about: (w) => w.about_text ? `
    <section class="about" id="about"><div class="wrap">
      <h2>About Us</h2><p>${escapeHtml(w.about_text)}</p>
    </div></section>` : "",
  notices: (w, c) => (c.notices || []).length ? `
    <section class="notices" id="notices"><div class="wrap">
      <h2>Notice Board</h2>
      <div class="cards">
        ${c.notices.map((n) => `
        <div class="card">
          ${n.pinned ? `<span class="tag">Pinned</span>` : ""}
          <h3>${escapeHtml(n.title)}</h3>
          ${n.date ? `<small>${escapeHtml(n.date)}</small>` : ""}
          ${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}
        </div>`).join("")}
      </div>
    </div></section>` : "",
  events: (w, c) => (c.events || []).length ? `
    <section class="events" id="events"><div class="wrap">
      <h2>Upcoming Events</h2>
      <div class="cards">
        ${c.events.map((e) => `
        <div class="card">
          ${e.type ? `<span class="tag">${escapeHtml(e.type)}</span>` : ""}
          <h3>${escapeHtml(e.title)}</h3>
          ${e.date ? `<small>${escapeHtml(e.date)}</small>` : ""}
          ${e.description ? `<p>${escapeHtml(e.description)}</p>` : ""}
        </div>`).join("")}
      </div>
    </div></section>` : "",
  gallery:  () => "",
  contact:  (w, c) => `
    <section class="contact" id="contact"><div class="wrap">
      <h2>Contact</h2>
      <p>${escapeHtml(c.school_address || "")}</p>
      ${c.contact_email ? `<p>Email: <a href="mailto:${escapeHtml(c.contact_email)}">${escapeHtml(c.contact_email)}</a></p>` : ""}
      ${c.contact_phone ? `<p>Phone: ${escapeHtml(c.contact_phone)}</p>` : ""}
    </div></section>`,
  stats: (w, c) => `
    <section class="stats"><div class="wrap stats-grid">
      <div><b>${c.stats.courses}</b><span>Courses</span></div>
      <div><b>${c.stats.teachers}</b><span>Teachers</span></div>
      <div><b>${c.stats.classes}</b><span>Classes</span></div>
    </div></section>`,
};

export function renderThemePage(website, ctx) {
  const w = website;
  const sections = Array.isArray(w.sections) ? w.sections : [];
  const body = sections
    .filter((s) => s.on)
    .map((s) => (SECTION_RENDERERS[s.key] ? SECTION_RENDERERS[s.key](w, ctx) : ""))
    .join("\n");

  const social = Object.entries(ctx.social_links || {})
    .filter(([, url]) => url)
    .map(([k, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(k)}</a>`)
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(w.meta_title || ctx.school_name)}</title>
<meta name="description" content="${escapeHtml(w.meta_description || "")}">
<meta name="keywords" content="${escapeHtml(w.meta_keywords || "")}">
${w.og_image_url ? `<meta property="og:image" content="${escapeHtml(w.og_image_url)}">` : ""}
<style>
  :root{--primary:${escapeHtml(w.primary_color || "#1a56db")};--secondary:${escapeHtml(w.secondary_color || "#6b7280")};--accent:${escapeHtml(w.accent_color || "#f59e0b")};}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a2e;background:${w.bg_mode === "Dark" ? "#0f172a" : "#fff"};}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px;}
  nav{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #eee;}
  nav .logo{font-size:22px;font-weight:900;color:var(--primary);display:flex;align-items:center;gap:10px;}
  nav .logo img{height:34px;}
  section{padding:64px 0;}
  .hero{text-align:center;background:linear-gradient(160deg,#eef2ff,#fff);}
  .hero h1{font-size:44px;font-weight:900;margin-bottom:14px;}
  .hero p{font-size:18px;color:var(--secondary);max-width:620px;margin:0 auto 28px;}
  .btn{display:inline-block;padding:14px 30px;border-radius:50px;font-weight:700;text-decoration:none;background:var(--primary);color:#fff;}
  .btn-outline{background:transparent;color:var(--primary);border:2px solid var(--primary);}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;}
  .card{border:1px solid #e7e7ef;border-radius:12px;padding:20px;background:#fff;}
  .card h3{font-size:17px;margin:6px 0 4px;color:#1a1a2e;}
  .card small{color:var(--secondary);}
  .card p{font-size:14px;color:#444;margin-top:8px;}
  .tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);}
  nav .links a{color:#1a1a2e;text-decoration:none;font-weight:600;margin-right:18px;font-size:14px;}
  h2{font-size:28px;font-weight:800;margin-bottom:16px;color:var(--primary);}
  .stats-grid{display:flex;gap:32px;justify-content:center;flex-wrap:wrap;text-align:center;}
  .stats-grid b{display:block;font-size:38px;color:var(--accent);}
  footer{background:#1a202c;color:#cbd5e1;padding:32px 24px;text-align:center;font-size:14px;}
  footer a{color:#fff;text-decoration:none;}
  ${w.custom_css || ""}
</style>
${w.header_scripts || ""}
</head>
<body>
<nav>
  <div class="logo">${ctx.school_logo ? `<img src="${escapeHtml(ctx.school_logo)}" alt="">` : ""}${escapeHtml(ctx.school_name)}</div>
  <div class="links">
    ${ctx.portal?.apply ? `<a href="/apply">Admissions</a>` : ""}
    ${ctx.portal?.pay ? `<a href="/pay">Pay Fees</a>` : ""}
    ${ctx.portal?.results ? `<a href="/results">Check Result</a>` : ""}
    <a href="/login" style="color:var(--primary);font-weight:700;">Login</a>
  </div>
</nav>
${body}
<footer>
  <p>&copy; ${ctx.year} ${escapeHtml(ctx.school_name)}. All Rights Reserved.</p>
  ${social ? `<p style="margin-top:8px;">${social}</p>` : ""}
</footer>
${w.footer_scripts || ""}
</body>
</html>`;
}

/* ── Variable context assembled from the school's real data ──────────────── */
export function buildContext(school, website, data) {
  return {
    school_name: school.name,
    school_acronym: school.acronym || "",
    school_logo: school.logo_url || "",
    principal_name: school.principal_name || "",
    school_address: school.address || "",
    contact_email: data.email || "",
    contact_phone: school.phone || "",
    hero_title: website.hero_title || school.name,
    hero_subtitle: website.hero_subtitle || "",
    about_text: website.about_text || "",
    meta_title: website.meta_title || school.name,
    meta_description: website.meta_description || "",
    primary_color: website.primary_color,
    secondary_color: website.secondary_color,
    accent_color: website.accent_color,
    social_links: website.social_links || {},
    year: data.year,
    // Section loops — real data the school already has.
    courses: data.courses || [],
    teachers: data.teachers || [],
    classes: data.classes || [],
    notices: data.notices || [],
    events: data.events || [],
    // Public-portal links ({{#if portal.apply}}<a href="{{apply_url}}">…)
    portal: data.portal || { apply: false, pay: false, results: false },
    apply_url: "/apply", pay_url: "/pay", results_url: "/results",
    stats: { courses: (data.courses || []).length, teachers: (data.teachers || []).length, classes: (data.classes || []).length },
  };
}
