-- Small key/value store for platform switches an admin flips from the console
-- (no redeploy). First use: which engine parses scanned documents.
CREATE TABLE IF NOT EXISTS edu.platform_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO edu.platform_settings (key, value)
VALUES ('records_extract_engine', '"runpod"'::jsonb)
ON CONFLICT (key) DO NOTHING;
