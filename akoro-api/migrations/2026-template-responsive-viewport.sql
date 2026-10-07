-- =============================================================
-- 2026-template-responsive-viewport.sql
-- Fix "school website shows desktop layout on phones": some stored website
-- templates have no <meta name="viewport"> (or a fixed-width one), so mobile
-- browsers render the desktop layout. Normalise existing templates to a
-- responsive viewport. New uploads are normalised at ingest time in code.
-- Idempotent (guards skip already-responsive rows). Runs on deploy.
-- =============================================================

DO $$
DECLARE
  resp text := '<meta name="viewport" content="width=device-width, initial-scale=1">';
BEGIN
  -- 1) Has a viewport meta but it isn't responsive → replace it.
  UPDATE edu.school_website_templates
     SET html = regexp_replace(html, '<meta[^>]*name\s*=\s*["'']?viewport["'']?[^>]*>', resp, 'i')
   WHERE html ~* 'name\s*=\s*["'']?viewport' AND html !~* 'width\s*=\s*device-width';
  UPDATE edu.platform_website_templates
     SET html = regexp_replace(html, '<meta[^>]*name\s*=\s*["'']?viewport["'']?[^>]*>', resp, 'i')
   WHERE html ~* 'name\s*=\s*["'']?viewport' AND html !~* 'width\s*=\s*device-width';

  -- 2) Has a <head> but no viewport meta at all → inject one.
  UPDATE edu.school_website_templates
     SET html = regexp_replace(html, '(<head[^>]*>)', '\1' || E'\n' || resp, 'i')
   WHERE html ~* '<head' AND html !~* 'name\s*=\s*["'']?viewport';
  UPDATE edu.platform_website_templates
     SET html = regexp_replace(html, '(<head[^>]*>)', '\1' || E'\n' || resp, 'i')
   WHERE html ~* '<head' AND html !~* 'name\s*=\s*["'']?viewport';
END $$;
