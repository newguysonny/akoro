-- Add force_logout_at to users table.
-- authenticateToken rejects any token whose iat < force_logout_at,
-- immediately invalidating all sessions for that user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_logout_at TIMESTAMPTZ;
