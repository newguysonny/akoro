-- =============================================================
-- 2026-seed-site.sql
-- Sample Website Builder content for the demo school: a multi-page site
-- (Home + About Us + Admissions + Academics + Contact) plus Primary, Footer
-- and Social menus wired to those pages.
--
-- The 'home' page renders as the landing (builder mode); the others serve at
-- /about-us, /admissions, /academics, /contact wrapped in the site chrome.
--
-- Idempotent: pages are keyed by slug, menus by name; menu locations are only
-- claimed if free. Demo data — not for prod. Run after 2026-site-menus.sql.
-- =============================================================

DO $$
DECLARE
  v_school uuid;
  v_menu uuid; v_foot uuid; v_soc uuid;
  v_home uuid; v_about uuid; v_adm uuid; v_acad uuid; v_contact uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping site seed.'; RETURN; END IF;

  -- ── Pages ────────────────────────────────────────────────────────────────
  INSERT INTO mgmt.site_pages (school_id, title, slug, status, sort_order, content)
  SELECT v_school, 'Home', 'home', 'published', 0, $HTML$
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
</section>$HTML$
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'home');

  INSERT INTO mgmt.site_pages (school_id, title, slug, status, sort_order, content)
  SELECT v_school, 'About Us', 'about-us', 'published', 1, $HTML$
<p>Founded in 1998, <b>Akoro Demo Academy</b> is a co-educational secondary school committed to raising learners who excel academically and lead with integrity.</p>
<h2>Our Mission</h2>
<p>To provide a world-class, values-driven education that equips every child with the knowledge, skills and character to thrive.</p>
<h2>Our Vision</h2>
<p>A generation of confident, compassionate problem-solvers shaping their communities and the world.</p>
<h2>Core Values</h2>
<ul><li>Excellence in all things</li><li>Integrity and discipline</li><li>Curiosity and creativity</li><li>Service to community</li></ul>$HTML$
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'about-us');

  INSERT INTO mgmt.site_pages (school_id, title, slug, status, sort_order, content)
  SELECT v_school, 'Admissions', 'admissions', 'published', 2, $HTML$
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
<p>Questions? Visit our <a href="/contact">Contact page</a> — the admissions office replies within one business day.</p>$HTML$
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'admissions');

  INSERT INTO mgmt.site_pages (school_id, title, slug, status, sort_order, content)
  SELECT v_school, 'Academics', 'academics', 'published', 3, $HTML$
<p>Our curriculum blends the Nigerian national curriculum with enrichment in technology, arts and leadership.</p>
<h2>Junior Secondary (JSS 1–3)</h2>
<p>Mathematics, English, Basic Science &amp; Technology, Social Studies, Creative Arts, French, and Computer Studies.</p>
<h2>Senior Secondary (SSS 1–3)</h2>
<p>Science, Commercial and Arts tracks with electives including Further Mathematics, Accounting, Literature and Government.</p>
<h2>Beyond the Classroom</h2>
<ul><li>STEM &amp; Robotics club</li><li>Debate and press club</li><li>Inter-house sports and music</li></ul>$HTML$
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'academics');

  INSERT INTO mgmt.site_pages (school_id, title, slug, status, sort_order, content)
  SELECT v_school, 'Contact', 'contact', 'published', 4, $HTML$
<h2>Get in Touch</h2>
<p><b>Address:</b> 12 Education Crescent, Ikeja, Lagos</p>
<p><b>Phone:</b> +234 805 000 0000</p>
<p><b>Email:</b> hello@demo.akoro.app</p>
<p><b>Office hours:</b> Monday – Friday, 8:00am – 4:00pm</p>
<h2>Visit Us</h2>
<p>Prospective families are welcome for campus tours every Wednesday — book via the admissions office.</p>$HTML$
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'contact');

  SELECT id INTO v_home    FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'home';
  SELECT id INTO v_about   FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'about-us';
  SELECT id INTO v_adm     FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'admissions';
  SELECT id INTO v_acad    FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'academics';
  SELECT id INTO v_contact FROM mgmt.site_pages WHERE school_id = v_school AND slug = 'contact';

  -- ── Primary menu ─────────────────────────────────────────────────────────
  SELECT id INTO v_menu FROM mgmt.site_menus WHERE school_id = v_school AND name = 'Main Menu';
  IF v_menu IS NULL THEN
    INSERT INTO mgmt.site_menus (school_id, name, location)
    VALUES (v_school, 'Main Menu',
      CASE WHEN EXISTS (SELECT 1 FROM mgmt.site_menus WHERE school_id = v_school AND location = 'primary') THEN NULL ELSE 'primary' END)
    RETURNING id INTO v_menu;
    INSERT INTO mgmt.site_menu_items (school_id, menu_id, label, url, page_id, target, sort_order) VALUES
      (v_school, v_menu, 'Home',       '/',  NULL,      '_self', 0),
      (v_school, v_menu, 'About Us',   NULL, v_about,   '_self', 1),
      (v_school, v_menu, 'Admissions', NULL, v_adm,     '_self', 2),
      (v_school, v_menu, 'Academics',  NULL, v_acad,    '_self', 3),
      (v_school, v_menu, 'Contact',    NULL, v_contact, '_self', 4);
  END IF;

  -- ── Footer menu ──────────────────────────────────────────────────────────
  SELECT id INTO v_foot FROM mgmt.site_menus WHERE school_id = v_school AND name = 'Footer Menu';
  IF v_foot IS NULL THEN
    INSERT INTO mgmt.site_menus (school_id, name, location)
    VALUES (v_school, 'Footer Menu',
      CASE WHEN EXISTS (SELECT 1 FROM mgmt.site_menus WHERE school_id = v_school AND location = 'footer') THEN NULL ELSE 'footer' END)
    RETURNING id INTO v_foot;
    INSERT INTO mgmt.site_menu_items (school_id, menu_id, label, url, page_id, target, sort_order) VALUES
      (v_school, v_foot, 'About Us',   NULL, v_about,   '_self', 0),
      (v_school, v_foot, 'Admissions', NULL, v_adm,     '_self', 1),
      (v_school, v_foot, 'Contact',    NULL, v_contact, '_self', 2);
  END IF;

  -- ── Social menu ──────────────────────────────────────────────────────────
  SELECT id INTO v_soc FROM mgmt.site_menus WHERE school_id = v_school AND name = 'Social Menu';
  IF v_soc IS NULL THEN
    INSERT INTO mgmt.site_menus (school_id, name, location)
    VALUES (v_school, 'Social Menu',
      CASE WHEN EXISTS (SELECT 1 FROM mgmt.site_menus WHERE school_id = v_school AND location = 'social') THEN NULL ELSE 'social' END)
    RETURNING id INTO v_soc;
    INSERT INTO mgmt.site_menu_items (school_id, menu_id, label, url, target, sort_order) VALUES
      (v_school, v_soc, 'Facebook',  'https://facebook.com/akorodemo',  '_blank', 0),
      (v_school, v_soc, 'Instagram', 'https://instagram.com/akorodemo', '_blank', 1),
      (v_school, v_soc, 'YouTube',   'https://youtube.com/@akorodemo',  '_blank', 2);
  END IF;
END $$;
