-- =============================================================
-- 2026-seed-site.sql
-- Seeds a sample multi-page website as an INSTALLED TEMPLATE ("Classic School
-- Site") for the demo school — it appears in Website Builder → Template, and
-- the school activates it from the UI:
--   • "Activate & import into builder" → creates the Home / About Us /
--     Admissions / Academics / Contact pages + a Primary menu (editable).
--   • "Activate as-is" → serves the bundled landing HTML untouched.
-- Nothing is added to Pages/Menus until the school clicks Activate.
--
-- An earlier version of this seed inserted the pages/menus directly; the
-- cleanup block below removes those — it runs ONLY on the first run of this
-- version (guarded by the template row), so pages the school later imports
-- or edits are never touched by redeploys.
--
-- Idempotent. Demo data. Run after 2026-template-import.sql.
-- =============================================================

DO $$
DECLARE
  v_school uuid;
  v_home text; v_about text; v_adm text; v_acad text; v_contact text;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping site template seed.'; RETURN; END IF;

  -- Already seeded this version? Then do nothing (protects imported pages).
  IF EXISTS (SELECT 1 FROM edu.school_website_templates WHERE school_id = v_school AND name = 'Classic School Site') THEN
    RETURN;
  END IF;

  -- ── One-time cleanup of the earlier direct-seeded pages/menus ────────────
  -- DANGER: this used to unconditionally DELETE the school's home/about/etc
  -- pages. It only ran when the 'Classic School Site' template row was absent —
  -- but 2026-reset-site-templates.sql used to delete that very row, making this
  -- fire on normal redeploys and wipe an ACTIVE template's imported home page.
  -- The legacy direct-seeded pages this was meant to remove are long gone, so
  -- the destructive page/menu deletes are removed. Never delete live pages from
  -- a seed. (reset-site-templates.sql no longer deletes the sentinel template.)

  -- ── Page contents (imported into the builder on activation) ──────────────
  v_home := $HTML$
<section style="text-align:center;padding:72px 24px;background:linear-gradient(160deg,#eef2ff,#fff)">
  <h1 style="font-size:42px;font-weight:900;margin-bottom:14px">Welcome to Akoro Demo Academy</h1>
  <p style="font-size:18px;color:#6b7280;max-width:640px;margin:0 auto 26px">Nurturing curious minds and confident leaders — excellence in learning, character and service since 1998.</p>
  <a href="/admissions" style="display:inline-block;padding:14px 30px;border-radius:50px;font-weight:700;text-decoration:none;background:#1a56db;color:#fff">Apply for Admission</a>
</section>
<section style="max-width:1000px;margin:0 auto;padding:56px 24px">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px">
    <div style="border:1px solid #e7e7ef;border-radius:12px;padding:22px"><h3 style="margin:0 0 8px">🏆 Proven Results</h3><p style="color:#555;line-height:1.7;margin:0">A decade of 95%+ WAEC distinction rates and national quiz championships.</p></div>
    <div style="border:1px solid #e7e7ef;border-radius:12px;padding:22px"><h3 style="margin:0 0 8px">🔬 Modern Facilities</h3><p style="color:#555;line-height:1.7;margin:0">Science and ICT laboratories, a 12,000-volume library, and sports grounds.</p></div>
    <div style="border:1px solid #e7e7ef;border-radius:12px;padding:22px"><h3 style="margin:0 0 8px">❤️ Caring Community</h3><p style="color:#555;line-height:1.7;margin:0">Small class sizes, dedicated counsellors and a vibrant parent partnership.</p></div>
  </div>
</section>$HTML$;

  v_about := $HTML$
<p>Founded in 1998, <b>Akoro Demo Academy</b> is a co-educational secondary school committed to raising learners who excel academically and lead with integrity.</p>
<h2>Our Mission</h2>
<p>To provide a world-class, values-driven education that equips every child with the knowledge, skills and character to thrive.</p>
<h2>Our Vision</h2>
<p>A generation of confident, compassionate problem-solvers shaping their communities and the world.</p>
<h2>Core Values</h2>
<ul><li>Excellence in all things</li><li>Integrity and discipline</li><li>Curiosity and creativity</li><li>Service to community</li></ul>$HTML$;

  v_adm := $HTML$
<p>We welcome applications into <b>JSS 1 – SSS 2</b> for the coming academic session.</p>
<h2>How to Apply</h2>
<ol>
  <li>Complete the <a href="/apply">online application form</a>.</li>
  <li>Pay the admission fee online or at the school bursary.</li>
  <li>Sit the entrance assessment (dates are emailed to applicants).</li>
  <li>Successful candidates receive an admission letter within two weeks.</li>
</ol>
<h2>Requirements</h2>
<ul><li>Birth certificate</li><li>Last academic report card</li><li>Two passport photographs</li></ul>
<p>Questions? Visit our <a href="/contact">Contact page</a> — the admissions office replies within one business day.</p>$HTML$;

  v_acad := $HTML$
<p>Our curriculum blends the Nigerian national curriculum with enrichment in technology, arts and leadership.</p>
<h2>Junior Secondary (JSS 1–3)</h2>
<p>Mathematics, English, Basic Science &amp; Technology, Social Studies, Creative Arts, French, and Computer Studies.</p>
<h2>Senior Secondary (SSS 1–3)</h2>
<p>Science, Commercial and Arts tracks with electives including Further Mathematics, Accounting, Literature and Government.</p>
<h2>Beyond the Classroom</h2>
<ul><li>STEM &amp; Robotics club</li><li>Debate and press club</li><li>Inter-house sports and music</li></ul>$HTML$;

  v_contact := $HTML$
<h2>Get in Touch</h2>
<p><b>Address:</b> 12 Education Crescent, Ikeja, Lagos</p>
<p><b>Phone:</b> +234 805 000 0000</p>
<p><b>Email:</b> hello@demo.akoro.app</p>
<p><b>Office hours:</b> Monday – Friday, 8:00am – 4:00pm</p>
<h2>Visit Us</h2>
<p>Prospective families are welcome for campus tours every Wednesday — book via the admissions office.</p>$HTML$;

  -- ── Install the template (import payload = pages + primary menu) ─────────
  INSERT INTO edu.school_website_templates (school_id, name, description, html, is_active, import_payload)
  VALUES (
    v_school,
    'Classic School Site',
    'Sample 5-page school website — activate & import to add the pages and menu',
    -- "Activate as-is" landing (standalone document; {{school_name}} supported)
    $HTML$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{school_name}}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a2e}</style>
</head>
<body>
<nav style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #eee">
  <b style="font-size:20px;color:#1a56db">{{school_name}}</b>
  <span><a href="/apply" style="margin-right:16px;color:#1a1a2e;text-decoration:none;font-weight:600">Admissions</a><a href="/login" style="color:#1a56db;text-decoration:none;font-weight:700">Login</a></span>
</nav>
<section style="text-align:center;padding:80px 24px;background:linear-gradient(160deg,#eef2ff,#fff)">
  <h1 style="font-size:42px;font-weight:900;margin-bottom:14px">Welcome to {{school_name}}</h1>
  <p style="font-size:18px;color:#6b7280;max-width:640px;margin:0 auto 26px">Nurturing curious minds and confident leaders — excellence in learning, character and service.</p>
  <a href="/apply" style="display:inline-block;padding:14px 30px;border-radius:50px;font-weight:700;text-decoration:none;background:#1a56db;color:#fff">Apply for Admission</a>
</section>
<footer style="background:#1a202c;color:#cbd5e1;padding:28px 24px;text-align:center;font-size:14px">&copy; {{year}} {{school_name}}. All Rights Reserved.</footer>
</body>
</html>$HTML$,
    false,
    jsonb_build_object(
      'pages', jsonb_build_array(
        jsonb_build_object('slug', 'home',       'title', 'Home',       'content', v_home),
        jsonb_build_object('slug', 'about-us',   'title', 'About Us',   'content', v_about),
        jsonb_build_object('slug', 'admissions', 'title', 'Admissions', 'content', v_adm),
        jsonb_build_object('slug', 'academics',  'title', 'Academics',  'content', v_acad),
        jsonb_build_object('slug', 'contact',    'title', 'Contact',    'content', v_contact)
      ),
      'menu', jsonb_build_array(
        jsonb_build_object('label', 'Home',       'url', '/'),
        jsonb_build_object('label', 'About Us',   'slug', 'about-us'),
        jsonb_build_object('label', 'Admissions', 'slug', 'admissions'),
        jsonb_build_object('label', 'Academics',  'slug', 'academics'),
        jsonb_build_object('label', 'Contact',    'slug', 'contact')
      )
    )
  );
END $$;
