/**
 * modules/school/service-site.js — public multi-tenant site rendering and the
 * gated AI-chat sign-in hand-off.
 *
 * Tenants resolve by slug (/site/:slug) or hostname (wildcard subdomains and
 * verified custom domains). The renderer is shared by the public routes and
 * the authenticated live previews in service-website.js.
 */

import bcrypt from "bcrypt";
import { createHash } from "node:crypto";
import { issueTokenPair, signHandoff, verifyHandoff } from "../auth/index.js";
import {
  renderMiniTemplate, renderThemePage, renderSitePage, renderThemeDocument, buildContext,
} from "./siteRenderer.js";
import { resolveSchoolByHost, getSchoolGateway } from "./tenant.js";
import { urlFor } from "../../lib/urls.js";
import * as store from "./store.js";
import * as siteStore from "./store-site.js";
import { isFullDocument, templateColorStyle } from "./rules.js";
import { getPortalSettings, classroomIds } from "./service.js";

export async function getWebsiteConfig(schoolId) {
  const { data } = await siteStore.websiteBySchool(schoolId);
  if (data) return data;
  const { data: created } = await siteStore.websiteCreate(schoolId);
  return created;
}

// Resolve the school's Website Builder menus into { primary, footer, social },
// each an ordered list of { label, href, target }. Page items resolve to the
// published page's /slug; unresolved links fall back to "#".
export async function buildSiteMenus(schoolId) {
  const empty = { primary: [], footer: [], social: [] };
  const { data: menuRows } = await siteStore.menusWithLocation(schoolId);
  if (!menuRows?.length) return empty;
  const byLoc = {};
  for (const m of menuRows) byLoc[m.location] = m.id;
  const { data: items } = await siteStore.menuItemsByMenus(menuRows.map((m) => m.id));
  const pageIds = [...new Set((items || []).map((i) => i.page_id).filter(Boolean))];
  const slugOf = {};
  if (pageIds.length) {
    const { data: pgs } = await siteStore.pagesByIds(pageIds);
    for (const p of pgs || []) slugOf[p.id] = (p.status === "published" && !p.deleted_at && p.slug) ? `/${p.slug}` : null;
  }
  const byMenu = {};
  for (const it of items || []) {
    const href = it.page_id ? (slugOf[it.page_id] || "#") : (it.url || "#");
    (byMenu[it.menu_id] ||= []).push({ label: it.label, href, target: it.target });
  }
  return {
    primary: byMenu[byLoc.primary] || [],
    footer: byMenu[byLoc.footer] || [],
    social: byMenu[byLoc.social] || [],
  };
}

// ── AI chat widget (Sync AI Bot) ─────────────────────────────────────────────
// Injected on every rendered site page when website.ai_chat_enabled: a
// floating bubble (bottom-right) that opens a gated login modal
// (student / teacher / admin). Successful login redirects to the school
// portal's AI Chat. Self-contained ES5 — no dependencies, works inside any
// template. Auto-opens on the /ai-chat page.
//
// The sign-in fetch is deliberately NOT credentialed. It sets no cookie: it
// returns a short-lived hand-off token which the portal exchanges for a session
// on its own origin. Asking for credentials from a tenant school domain would
// need the API to grant credentialed CORS to every <slug> subdomain — which is
// exactly the hole that let a script on one school's site call the API as any
// signed-in visitor. Nothing here needs it.
const SCHOOL_PORTAL_URL = urlFor("SCHOOL_FRONTEND_URL");
function aiChatWidgetHtml(apiOrigin) {
  const api = String(apiOrigin || "").replace(/\/$/, "");
  return `
<div id="ak-ai-root"></div>
<script>(function(){
  var API=${JSON.stringify(api)}, PORTAL=${JSON.stringify(SCHOOL_PORTAL_URL)};
  var root=document.getElementById('ak-ai-root'); if(!root) return;
  var css='#ak-ai-btn{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:transparent;padding:0;font-size:40px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s}#ak-ai-btn:hover{transform:scale(1.06)}#ak-ai-ovl{position:fixed;inset:0;z-index:2147483001;background:rgba(10,10,14,.55);display:none;align-items:center;justify-content:center;padding:18px}#ak-ai-ovl.open{display:flex}#ak-ai-card{width:100%;max-width:380px;background:#fff;border-radius:18px;padding:26px 24px;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.35)}#ak-ai-card h3{margin:0 0 4px;font-size:18px;font-weight:800;color:#1A1A2E}#ak-ai-card p{margin:0 0 14px;font-size:12.5px;color:#6B6B80;line-height:1.55}.ak-ai-roles{display:flex;gap:6px;margin-bottom:14px}.ak-ai-roles button{flex:1;padding:8px 4px;border-radius:9px;border:1.5px solid #E5E5EA;background:#fff;font-size:12px;font-weight:700;color:#6B6B80;cursor:pointer;font-family:inherit}.ak-ai-roles button.on{border-color:#E07A2C;background:#FDF3EB;color:#B45A16}.ak-ai-in{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1.5px solid #E5E5EA;font-size:13.5px;margin-bottom:10px;font-family:inherit;outline:none}.ak-ai-in:focus{border-color:#E07A2C}#ak-ai-err{display:none;font-size:12px;color:#DC3545;margin:-2px 0 10px}#ak-ai-go{width:100%;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#E07A2C,#D4651E);color:#fff;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}#ak-ai-x{float:right;border:none;background:none;font-size:18px;color:#9A9AA5;cursor:pointer;margin:-6px -6px 0 0}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  root.innerHTML='<button id="ak-ai-btn" aria-label="AI Chat" title="AI Chat">🤖</button><div id="ak-ai-ovl"><div id="ak-ai-card"><button id="ak-ai-x" aria-label="Close">×</button><h3>AI Study Assistant</h3><p>Sign in to chat with your school’s AI assistant.</p><div class="ak-ai-roles"><button data-r="student" class="on">Student</button><button data-r="parent">Parent</button><button data-r="teacher">Teacher</button><button data-r="admin">Admin</button></div><input class="ak-ai-in" id="ak-ai-em" type="email" placeholder="Email" autocomplete="email"/><input class="ak-ai-in" id="ak-ai-pw" type="password" placeholder="Password" autocomplete="current-password"/><div id="ak-ai-err"></div><button id="ak-ai-go">Sign in → AI Chat</button><div class="ak-ai-guest">Just have questions? <a id="ak-ai-guest-link" href="#">Ask as a guest →</a></div></div></div>';
  var ovl=document.getElementById('ak-ai-ovl');
  function open(){ovl.classList.add('open');}
  function close(){ovl.classList.remove('open');}
  document.getElementById('ak-ai-btn').addEventListener('click',open);
  document.getElementById('ak-ai-x').addEventListener('click',close);
  ovl.addEventListener('click',function(e){if(e.target===ovl)close();});
  var roleBtns=root.querySelectorAll('.ak-ai-roles button');
  for(var i=0;i<roleBtns.length;i++){roleBtns[i].addEventListener('click',function(){for(var j=0;j<roleBtns.length;j++)roleBtns[j].classList.remove('on');this.classList.add('on');});}
  function selectedRole(){for(var k=0;k<roleBtns.length;k++){if(roleBtns[k].classList.contains('on'))return roleBtns[k].getAttribute('data-r');}return 'student';}
  document.getElementById('ak-ai-go').addEventListener('click',function(){
    var em=document.getElementById('ak-ai-em').value.trim(), pw=document.getElementById('ak-ai-pw').value;
    var err=document.getElementById('ak-ai-err'); err.style.display='none';
    if(!em){err.textContent='Enter your email address.';err.style.display='block';return;}
    if(!pw){err.textContent='Enter your password.';err.style.display='block';return;}
    var btn=this; btn.disabled=true; btn.textContent='Signing in…';
    fetch(API+'/api/school/site/ai-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:location.hostname,email:em,password:pw,role:selectedRole()})})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(d){
        if(d&&d.success){
          var first=((d.name||'').split(' ')[0])||'there';
          document.getElementById('ak-ai-card').innerHTML='<div style="text-align:center;padding:18px 6px"><div style="font-size:42px;margin-bottom:10px">✅</div><h3>Welcome, '+first+'!</h3><p style="margin-top:6px">Signed in as '+(d.role||'member')+' · opening your AI assistant…</p></div>';
          setTimeout(function(){window.location.href=d.redirect;},1000);
        } else {
          err.textContent=(d&&d.message)||'Sign-in failed. Please check your details.';err.style.display='block';btn.disabled=false;btn.textContent='Sign in → AI Chat';
        }
      })
      .catch(function(){err.textContent='Could not reach the server. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Sign in → AI Chat';});
  });
  var gl=document.getElementById('ak-ai-guest-link');
  if(gl){gl.addEventListener('click',function(e){e.preventDefault();window.location.href='${SCHOOL_PORTAL_URL}/ai-guest?host='+encodeURIComponent(location.hostname);});}
  if(/^\\/ai-chat\\/?$/.test(window.location.pathname)) open();
})();</script>`;
}

// Content of the auto-created "AI Chat" site page (slug: ai-chat). The
// floating widget is injected at render time like every page and auto-opens
// here, so this page just provides the framing.
const AI_CHAT_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Chat</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#0F0F1E;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.wrap{max-width:560px;text-align:center}.badge{display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(224,122,44,.16);color:#E8945A;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px}h1{font-size:34px;font-weight:900;margin-bottom:12px}p{font-size:15px;color:#B9B9C6;line-height:1.7}a.home{display:inline-block;margin-top:26px;color:#E8945A;font-weight:700;text-decoration:none;font-size:13.5px}</style>
</head><body><div class="wrap">
<span class="badge">AI Study Assistant</span>
<h1>Chat with your school's AI</h1>
<p>Students, teachers and admins can sign in to ask questions, get study help and explore lessons with the school's AI assistant. Use the chat bubble to sign in.</p>
<a class="home" href="/">← Back to home</a>
</div></body></html>`;

// Create or trash the "AI Chat" site page when the Sync AI Bot toggle flips.
export async function syncAiChatPage(schoolId, enabled) {
  const { data: pg } = await siteStore.pageBySlugId(schoolId, "ai-chat");
  if (enabled) {
    const body = { title: "AI Chat", content: AI_CHAT_PAGE_HTML, blocks: [], status: "published", sort_order: 999, deleted_at: null };
    if (pg) await siteStore.pageUpdate(pg.id, body);
    else await siteStore.pageInsert({ ...body, school_id: schoolId, slug: "ai-chat" });
  } else if (pg) {
    await siteStore.pageUpdate(pg.id, { deleted_at: new Date() });
  }
}

// Assemble the full render context (variables, section data, menus, portal
// links) exactly as the live site uses — shared by the public renderer and the
// authenticated live-preview endpoint so previews are pixel-identical.
export async function buildSiteCtx(school, website) {
  // Sync toggle (Website Settings): when on, the website's identity always
  // follows School Settings — freshest profile fields win over the copies
  // stored in the website config, so School Settings edits show up on the
  // site immediately. Mutates `school`/`website` in place because the same
  // objects flow on into the theme renderer (w.hero_title / w.meta_title).
  const today = new Date().toISOString().slice(0, 10);
  // One parallel wave for everything independent; only courses wait on the
  // teacher list. This is the difference between ~10 serialised DB round trips
  // and two, which is most of the render's first-byte time.
  const [profileRes, teacherRes, classRes, admRes, gateway, noticesRes, eventsRes, menus] = await Promise.all([
    website.sync_school_info ? store.schoolProfileFull(school.id) : Promise.resolve({ data: null }),
    store.teacherSiteLinks(school.id),
    store.classroomsBySite(school.id),
    siteStore.admissionEnabled(school.id),
    getSchoolGateway(school.id),
    siteStore.siteNotices(school.id, today),
    siteStore.siteEvents(school.id, today),
    buildSiteMenus(school.id),
  ]);
  let contactEmail = null;
  const full = profileRes?.data;
  if (full) {
    const { admin_user_id, ...profile } = full;
    Object.assign(school, profile);
    website.hero_title = full.name;
    website.meta_title = full.name;
    if (admin_user_id) {
      const { data: admin } = await store.userEmailById(admin_user_id);
      contactEmail = admin?.email || null;
    }
  }
  const teacherLinks = teacherRes?.data;
  const teacherIds = (teacherLinks || []).map((t) => t.users?.id).filter(Boolean);
  const { data: courseRows } = teacherIds.length
    ? await store.coursesForSite(teacherIds)
    : { data: [] };
  const classRows = classRes?.data;
  const adm = admRes?.data;
  const noticeRows = noticesRes?.data;
  const eventRows = eventsRes?.data;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  return buildContext(school, website, {
    email: contactEmail,
    year: new Date().getFullYear(),
    teachers: (teacherLinks || []).map((t) => ({ name: t.users?.full_name })).filter((t) => t.name),
    courses: (courseRows || []).map((c) => ({ title: c.title, subject: c.subject, level: c.level, price: c.is_free ? "Free" : `₦${Number(c.price || 0).toLocaleString("en-NG")}` })),
    classes: (classRows || []).map((c) => ({ name: c.name })),
    notices: (noticeRows || []).filter((n) => !n.publish_on || n.publish_on <= today)
      .map((n) => ({ title: n.title, body: n.body || "", date: fmtDate(n.publish_on), pinned: !!n.pinned })),
    events: (eventRows || []).map((e) => ({ title: e.title, description: e.description || "", type: e.event_type || "", date: fmtDate(e.starts_on) })),
    menus,
    portal: { apply: !!adm?.enabled, pay: !!gateway.ok, results: true },
  });
}

// Public origin of THIS API (scheme + host), for absolute URLs inside
// injected widgets. Derived from the request, so it needs no extra env.
const apiOriginOf = (req) => `${(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0]}://${req.get("host")}`;

export async function renderSchoolSiteHtml(school, { preview = false, path = "/", apiOrigin = "" } = {}) {
  // Independent reads: fetch them together instead of stacking round trips.
  const [website, portalSettings] = await Promise.all([
    getWebsiteConfig(school.id),
    getPortalSettings(school.id).catch(() => null),
  ]);
  // Public visitors only see a published site; preview mode (admin "Preview
  // Website" button) renders it even while unpublished, with a notice banner.
  if (!website.enabled && !preview) return { status: 404, html: "<h1>This school website is not published yet.</h1>" };

  // Maintenance Mode (Settings → Privacy & Security) shows a banner on the site.
  const maintenance = !!portalSettings?.security?.maintenanceMode;

  const addBanner = (raw) => {
    // Full documents skip the theme chrome, so Appearance's tracking scripts
    // and custom CSS are injected here — they apply to template pages too.
    let html = raw;
    if (isFullDocument(html)) {
      const headBits = [
        templateColorStyle(website.template_colors),
        website.custom_css ? `<style>${website.custom_css}</style>` : "",
        website.header_scripts || "",
      ].filter(Boolean).join("\n");
      if (headBits) html = html.includes("</head>") ? html.replace("</head>", `${headBits}\n</head>`) : `${headBits}\n${html}`;
      if (website.footer_scripts) html = html.includes("</body>") ? html.replace("</body>", `${website.footer_scripts}\n</body>`) : html + website.footer_scripts;
    }
    // Sync AI Bot: floating gated-chat widget on every page.
    if (website.ai_chat_enabled) {
      const w = aiChatWidgetHtml(apiOrigin);
      html = html.includes("</body>") ? html.replace("</body>", `${w}\n</body>`) : html + w;
    }
    // Maintenance banner on the live public site.
    if (maintenance) {
      const mb = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#B45309;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:9px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">🛠️ This website is undergoing scheduled maintenance — some information may be temporarily unavailable.</div>`;
      html = html.includes("</body>") ? html.replace("</body>", `${mb}</body>`) : html + mb;
    }
    if (!(preview && !website.enabled)) return html;
    const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1A1A2E;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:9px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">👁️ Preview mode — this website is not published yet. Turn it on in Website Settings to go live.</div>`;
    return html.includes("</body>") ? html.replace("</body>", `${banner}</body>`) : html + banner;
  };

  const ctx = await buildSiteCtx(school, website);

  // Page routing: a non-root path is a published-page slug (e.g. /about-us).
  const slug = String(path || "/").split("?")[0].replace(/^\/+|\/+$/g, "");
  if (slug) {
    const { data: page } = await siteStore.pageBySlug(school.id, slug);
    if (page && page.status === "published" && !page.deleted_at) {
      // Full self-contained documents (e.g. gallery templates) render raw;
      // block/fragment pages get wrapped in the builder chrome.
      const html = isFullDocument(page.content) ? page.content : renderSitePage(website, ctx, page, { hideTitle: slug === "home" });
      return { status: 200, html: addBanner(html) };
    }
    return { status: 404, html: renderThemeDocument(website, ctx, `<section class="page"><div class="wrap" style="text-align:center"><h1 style="font-size:34px;color:var(--primary)">Page not found</h1><p style="margin-top:10px"><a href="/" style="color:var(--primary);font-weight:700">← Back to home</a></p></div></section>`) };
  }

  // Landing page.
  let html;
  if (website.mode === "template") {
    const { data: tpl } = await siteStore.activeTemplateHtml(school.id);
    html = tpl?.html
      ? renderMiniTemplate(tpl.html, ctx)
      : renderThemePage(website, ctx); // fall back to theme if no active template
  } else {
    // Builder mode: a published "home" page (e.g. imported from a template)
    // overrides the theme sections as the landing — fully editable in Pages.
    const { data: home } = await siteStore.homePage(school.id);
    html = (home && home.status === "published" && !home.deleted_at)
      ? (isFullDocument(home.content) ? home.content : renderSitePage(website, ctx, home, { hideTitle: true }))
      : renderThemePage(website, ctx);
  }
  return { status: 200, html: addBanner(html) };
}

// Branded 404 for hostnames that resolve to no school (unknown wildcard
// subdomains, unverified custom domains). A real page, not a bare string,
// so stray/typo'd subdomains never look broken or fall into the main app.
// The "Go to Akoro" link reuses the main-site URL Railway already defines.
const MAIN_SITE_URL = urlFor("MAIN_SITE_URL");
const schoolNotFoundHtml = (host) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>School not found — Akoro</title><meta name="robots" content="noindex">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F7F7F9;color:#1A1A2E;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:460px;text-align:center;background:#fff;border:1px solid #E5E5EA;border-radius:20px;padding:48px 36px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
  .code{font-size:52px;font-weight:900;color:#E07A2C;letter-spacing:-2px}
  h1{font-size:20px;font-weight:800;margin:10px 0 8px}
  p{font-size:14px;color:#6B6B80;line-height:1.65}
  .host{display:inline-block;margin:14px 0 4px;padding:6px 14px;border-radius:999px;background:#F1F1F4;font-size:12.5px;font-weight:700;color:#44444F;word-break:break-all}
  a.btn{display:inline-block;margin-top:22px;padding:12px 26px;border-radius:999px;background:linear-gradient(135deg,#E07A2C,#D4651E);color:#fff;font-size:13.5px;font-weight:800;text-decoration:none}
</style></head><body>
<div class="card">
  <div class="code">404</div>
  <h1>No school website here</h1>
  <span class="host">${String(host || "").replace(/[<>&"]/g, "")}</span>
  <p>This address isn't connected to any school on Akoro. The school may not have published its website yet, or the address may be misspelt.</p>
  <a class="btn" href="${MAIN_SITE_URL}">Go to Akoro</a>
</div></body></html>`;

// ── GET /api/school/site/by-host  (PUBLIC — tenant from hostname) ────────────
// The frontend forwards its hostname (?host=…); direct hits fall back to the
// request's own forwarded host. Must be registered BEFORE /site/:slug.
// Public tenant HTML is identical for every visitor of a host+path, and a
// render costs ~10 DB round trips. A short in-process cache plus CDN headers
// turns repeat loads (and link previews) from seconds into milliseconds.
const SITE_HTML_TTL_MS = 30_000;
const SITE_HTML_MAX = 240;
const siteHtmlCache = new Map();
const siteHtmlInFlight = new Map();
const cacheKeyOf = (host, path, apiOrigin) => `${host}|${path}|${apiOrigin}`;
function siteCacheGet(key) {
  const hit = siteHtmlCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { siteHtmlCache.delete(key); return null; }
  return hit;
}
function siteCacheSet(key, value) {
  if (siteHtmlCache.size >= SITE_HTML_MAX) {
    const oldest = siteHtmlCache.keys().next().value;
    if (oldest) siteHtmlCache.delete(oldest);
  }
  siteHtmlCache.set(key, { ...value, expires: Date.now() + SITE_HTML_TTL_MS });
}

export async function siteByHost(req, res) {
  try {
    const host = String(req.query.host || req.headers["x-forwarded-host"] || req.hostname || "").toLowerCase();
    const path = String(req.query.path || "/");
    const preview = req.query.preview === "1" || req.query.preview === "true";
    const apiOrigin = apiOriginOf(req);
    const key = cacheKeyOf(host, path, apiOrigin);
    const cached = preview ? null : siteCacheGet(key);
    let out = cached;
    if (!out) {
      const pending = preview ? null : siteHtmlInFlight.get(key);
      if (pending) out = await pending;
      else {
        const work = (async () => {
          const school = await resolveSchoolByHost(host);
          if (!school) return { status: 404, html: schoolNotFoundHtml(host), missing: true };
          return renderSchoolSiteHtml(school, { preview, path, apiOrigin });
        })();
        if (!preview) siteHtmlInFlight.set(key, work);
        try { out = await work; } finally { if (!preview) siteHtmlInFlight.delete(key); }
        if (!preview && out.status === 200) siteCacheSet(key, out);
      }
    }
    const etag = '"' + createHash("sha1").update(String(out.html)).digest("hex").slice(0, 24) + '"';
    res.set("ETag", etag);
    res.set("Vary", "Accept-Encoding");
    if (preview) res.set("Cache-Control", "no-store");
    else {
      res.set("Cache-Control", "public, max-age=20, s-maxage=120, stale-while-revalidate=600");
      res.set("CDN-Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    }
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.status(out.status).type("html").send(out.html);
  } catch (e) {
    console.error("[site render by-host]", e);
    res.status(500).type("html").send("<h1>Something went wrong rendering this page.</h1>");
  }
}

// ── POST /api/school/site/ai-login  (PUBLIC — gated AI-chat sign-in) ─────────
// The website's floating AI bot signs a visitor in ONLY if they belong to the
// school whose site they're on. Returns clear, role-aware messages so the
// widget can tell the visitor exactly what went wrong. On success it issues
// the shared session cookie and every role opens the SAME school AI chat
// (the school portal's /chat).
const roleLabel = { admin: "an admin", teacher: "a teacher", student: "a student", parent: "a parent" };
export async function aiLogin(req, res) {
  try {
    const { host, email, password, role: wantRole } = req.body || {};
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).json({ success: false, code: "no_school", message: "This website isn't connected to a school yet." });

    const { data: user } = await store.userByEmailFull(String(email || "").toLowerCase().trim());
    // Single generic message for both unknown-email and wrong-password so this
    // public endpoint can't be used to enumerate which emails have accounts.
    const badCreds = () => res.status(401).json({ success: false, code: "bad_credentials", message: "Incorrect email or password." });
    if (!user) { await bcrypt.compare(String(password || ""), "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin"); return badCreds(); }

    const ok = await bcrypt.compare(String(password || ""), user.password_hash || "");
    if (!ok) return badCreds();

    if (user.deleted_at) return res.status(403).json({ success: false, code: "inactive", message: "This account has been deleted." });
    if (!user.is_active)  return res.status(403).json({ success: false, code: "inactive", message: "This account is deactivated. Sign in on the portal to reactivate it." });

    // Membership in THIS school decides the actual role.
    let actualRole = null;
    if (user.id === school.admin_user_id) actualRole = "admin";
    if (!actualRole) {
      const { data: t } = await store.teacherLink(school.id, user.id);
      if (t) actualRole = "teacher";
    }
    if (!actualRole) {
      const cids = await classroomIds(school.id);
      if (cids.length) {
        const { data: cs } = await store.classroomStudentAny(user.id, cids);
        if (cs) actualRole = "student";
      }
    }
    // Parent: their email is a guardian on a student in this school. Verify the
    // match EXACTLY (ilike can over-match on _/% metacharacters in an email).
    if (!actualRole) {
      const target = String(user.email || email || "").toLowerCase().trim();
      const { data: kids } = await store.sisGuardianKids(school.id, target);
      if ((kids || []).some((k) => String(k.guardian_email || "").toLowerCase().trim() === target && target)) actualRole = "parent";
    }
    if (!actualRole) {
      return res.status(403).json({ success: false, code: "not_member", message: `This account isn't a student, teacher, admin or parent at ${school.name}. Only members of the school can use its AI assistant.` });
    }

    // If they picked a tab that doesn't match their membership, say so.
    if (wantRole && wantRole !== actualRole) {
      return res.status(403).json({ success: false, code: "role_mismatch", message: `That email is registered as ${roleLabel[actualRole]} at ${school.name}, not ${roleLabel[wantRole] || "that role"}. Switch the tab and try again.` });
    }

    // Two-factor accounts can't complete the short widget flow.
    if (user.two_factor_enabled && user.two_factor_secret) {
      return res.status(403).json({ success: false, code: "twofa", message: "This account uses two-factor authentication. Please sign in on the portal instead." });
    }

    // Redirect to the AI chat, carrying a short-lived hand-off token that the
    // destination exchanges for a session on its own origin (survives cross-site
    // cookie blocking).
    //
    // Chat host: defaults to the portal (SCHOOL_PORTAL_URL). When the chat is
    // served UNDER the school's own website domain (a dedicated /ai-chat build
    // proxied by the tenant deployment), set SCHOOL_CHAT_SAME_DOMAIN=true and the
    // redirect stays on the school's domain instead of the platform app.
    const handoff = signHandoff(user.id);
    const cleanHost = String(host || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const chatBase = (process.env.SCHOOL_CHAT_SAME_DOMAIN === "true" && cleanHost)
      ? `https://${cleanHost}`
      : SCHOOL_PORTAL_URL;
    const redirect = `${chatBase}/ai-chat?ai=${encodeURIComponent(handoff)}`;
    console.log(`[ai-login] ok school=${school.slug} role=${actualRole} origin=${req.headers.origin || "-"} redirect=${chatBase}/ai-chat`);
    res.json({ success: true, role: actualRole, name: user.full_name || user.email, redirect });
  } catch (e) {
    console.error("[ai-login]", e);
    res.status(500).json({ success: false, code: "error", message: "Something went wrong. Please try again." });
  }
}

// ── POST /api/school/site/ai-login/exchange  (PUBLIC — hand-off → session) ──
// Called by the school portal from its OWN origin with the hand-off token from
// the AI-chat login redirect. Verifies it and issues the real session cookie.
export async function aiLoginExchange(req, res) {
  try {
    const origin = req.headers.origin || "-";
    const userId = verifyHandoff(String(req.body?.token || ""));
    if (!userId) {
      console.warn(`[ai-login exchange] REJECTED bad/expired token origin=${origin} portal=${req.headers["x-akoro-portal"] || "-"}`);
      return res.status(401).json({ success: false, message: "This sign-in link expired. Please sign in again." });
    }
    const { data: user } = await store.userByIdFull(userId);
    if (!user || user.deleted_at || !user.is_active) return res.status(403).json({ success: false, message: "Account unavailable." });
    // Issue the SCHOOL-portal session cookie (akoro_access_school) — the school
    // app reads with X-Akoro-Portal: school. Without the portal arg this
    // defaulted to the student cookie, so the app never found its session and
    // bounced to /signin.
    const pair = await issueTokenPair(res, user, "site");
    console.log(`[ai-login exchange] ok user=${user.id} origin=${origin} portal=${req.headers["x-akoro-portal"] || "-"}`);
    // The tokens go back in the BODY as well as in cookies.
    //
    // When SCHOOL_CHAT_SAME_DOMAIN is on, the chat is served from the school's
    // own domain — a tenant origin, which is deliberately not granted
    // credentialed CORS, because a school admin can put arbitrary script on
    // that page. So the cookie never arrives there and the page authenticates
    // with a bearer token instead. A bearer has to be handed over; a cookie
    // rides along on its own, which is precisely the difference that matters.
    res.json({ success: true, accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  } catch (e) {
    console.error("[ai-login exchange]", e);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

// ── GET /api/school/site/:slug  (PUBLIC — the rendered landing page) ─────────
// No auth: this is the school's public website. Serves theme OR template mode.
export async function siteBySlug(req, res) {
  try {
    const slug = (req.params.slug || "").toLowerCase();
    const { data: school } = await store.schoolProfileBySlug(slug);
    if (!school) return res.status(404).type("html").send(schoolNotFoundHtml(`${slug} (site link)`));
    const preview = req.query.preview === "1" || req.query.preview === "true";
    const { status, html } = await renderSchoolSiteHtml(school, { preview, path: req.query.path || "/", apiOrigin: apiOriginOf(req) });
    res.status(status).type("html").send(html);
  } catch (e) {
    console.error("[site render]", e);
    res.status(500).type("html").send("<h1>Something went wrong rendering this page.</h1>");
  }
}
