-- =============================================================
-- 2026-seed-school-portal.sql
-- Demo data for the school Settings & Billing / Apps Center pages, applied
-- to the existing demo school ('Akoro Demo Academy', seeded by
-- 2026-seed-school.sql). Safe to re-run (idempotent, guarded by NOT EXISTS).
-- Run AFTER 2026-school-portal-settings.sql.
-- =============================================================

DO $$
DECLARE
  v_school uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'Demo school not found — run 2026-seed-school.sql first. Skipping.';
    RETURN;
  END IF;

  -- ── Profile extras ──────────────────────────────────────────────────────
  UPDATE public.school_profiles
  SET acronym = COALESCE(acronym, 'ADA'),
      principal_name = COALESCE(principal_name, 'Dr. Amara Osei'),
      country = COALESCE(country, 'Nigeria (+234)')
  WHERE id = v_school;

  -- ── Portal settings (System & Formats / Attendance / Security / Integrations) ─
  INSERT INTO edu.school_portal_settings (school_id) VALUES (v_school)
  ON CONFLICT (school_id) DO NOTHING;

  UPDATE edu.school_portal_settings
  SET system_formats = '{"udise":"ADA","affiliatedBy":"W.A.E.C","theme":"Action V2 (Clean)","currency":"Nigerian Naira (₦)","taxLabel":"VAT","taxId":"TIN","receiptPrefix":"ADA"}'::jsonb,
      attendance = '{"geoRestriction":false,"latitude":"6.5244","longitude":"3.3792","radiusMeters":"1000","punchInStart":"07:00","punchInEnd":"08:00","punchOutStart":"14:00","punchOutEnd":"15:00","schoolStartTime":"08:00","gracePeriodMinutes":"15"}'::jsonb,
      security = '{"maintenanceMode":false}'::jsonb,
      personalisation = '{"language":"English","darkMode":false,"accentColour":"#E8884A"}'::jsonb,
      notification_prefs = '{"newStudent":true,"sessionReminder":true,"battleChallenge":true,"taskDeadline":true,"platformUpdates":false,"inAppSound":true,"desktopPush":false}'::jsonb,
      modules = '{"hostel":false,"transport":false}'::jsonb
  WHERE school_id = v_school
    AND system_formats = '{}'::jsonb;  -- only seed if untouched

  -- ── Telegram config row (inactive — needs a real bot token to enable) ────
  INSERT INTO edu.school_telegram_config (school_id, active) VALUES (v_school, false)
  ON CONFLICT (school_id) DO NOTHING;

  -- ── Social media (demo connected accounts) ───────────────────────────────
  INSERT INTO edu.school_social_accounts (school_id, provider, page_name, page_id, active)
  SELECT v_school, 'facebook', 'Akoro Demo Academy Official', '102345678901234', true
  WHERE NOT EXISTS (SELECT 1 FROM edu.school_social_accounts WHERE school_id = v_school AND provider = 'facebook');

  INSERT INTO edu.school_social_accounts (school_id, provider, page_name, page_id, active)
  SELECT v_school, 'instagram', '@akoro_demo_academy', '17841400123456789', true
  WHERE NOT EXISTS (SELECT 1 FROM edu.school_social_accounts WHERE school_id = v_school AND provider = 'instagram');

  -- ── Domain (a sample verified custom domain) ─────────────────────────────
  INSERT INTO edu.school_domains (school_id, domain, verified, verified_at)
  SELECT v_school, 'www.akorodemoacademy.com', true, now()
  WHERE NOT EXISTS (SELECT 1 FROM edu.school_domains WHERE school_id = v_school);

  -- ── Website config + a sample full-HTML template ─────────────────────────
  INSERT INTO edu.school_website (school_id) VALUES (v_school)
  ON CONFLICT (school_id) DO NOTHING;

  UPDATE edu.school_website
  SET enabled = true,
      mode = 'template',
      hero_subtitle = 'Empowering students with knowledge, values, and skills for a brighter tomorrow.',
      meta_title = 'Akoro Demo Academy',
      meta_keywords = 'school, education, learning'
  WHERE school_id = v_school AND hero_subtitle IS NULL;

  INSERT INTO edu.school_website_templates (school_id, name, description, html, is_active)
  SELECT v_school, 'demo-templates', 'Simple welcome landing page', $html$<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Akoro Demo Academy — Welcome</title>
  <meta name="description" content="Welcome to Akoro Demo Academy. Empowering students with knowledge, values, and skills for a brighter tomorrow.">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; }
    nav { padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; background: #fff; }
    .logo { font-size: 24px; font-weight: 900; color: #1a56db; }
    .nav-links { display: flex; gap: 24px; list-style: none; }
    .nav-links a { font-size: 14px; font-weight: 600; color: #333; text-decoration: none; }
    .hero { min-height: 80vh; display: flex; align-items: center; justify-content: center; text-align: center; background: linear-gradient(160deg,#eef2ff,#fff); }
    .hero h1 { font-size: 48px; font-weight: 900; margin-bottom: 16px; }
    .hero span { color: #1a56db; }
    .hero p { font-size: 18px; color: #666; max-width: 600px; margin: 0 auto 32px; }
    .btn-primary { display: inline-block; padding: 14px 32px; border-radius: 50px; font-weight: 700; text-decoration: none; background: #1a56db; color: #fff; }
    footer { background: #1a202c; color: #ccc; padding: 40px; text-align: center; font-size: 14px; }
  </style>
</head>
<body>
  <nav>
    <div class="logo">Akoro Demo Academy</div>
    <ul class="nav-links">
      <li><a href="#about">About</a></li>
      <li><a href="#contact">Contact</a></li>
      <li><a href="/login">Login</a></li>
    </ul>
  </nav>

  <section class="hero">
    <div>
      <h1>Welcome to <span>Akoro Demo Academy</span></h1>
      <p>Empowering students with knowledge, values, and skills for a brighter tomorrow.</p>
      <a href="/login" class="btn-primary">Parent / Student Login</a>
    </div>
  </section>

  <footer>
    <p>&copy; 2026 Akoro Demo Academy. All Rights Reserved.</p>
  </footer>
</body>
</html>$html$, true
  WHERE NOT EXISTS (SELECT 1 FROM edu.school_website_templates WHERE school_id = v_school);

  RAISE NOTICE 'Seeded school portal data for school_id=%', v_school;
END $$;
