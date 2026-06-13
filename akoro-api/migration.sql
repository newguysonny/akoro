-- ============================================================
-- Piabam Platform — Supabase Postgres Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. USERS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    avatar_url    TEXT,
    role          TEXT NOT NULL DEFAULT 'student'
                    CHECK (role IN ('student', 'instructor', 'admin')),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    phone         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. COURSES ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    slug                TEXT UNIQUE NOT NULL,
    description         TEXT,
    cover_image_url     TEXT,
    promo_video_url     TEXT,
    course_type         TEXT NOT NULL DEFAULT 'live'
                          CHECK (course_type IN ('live', 'video')),
    subject             TEXT,
    level               TEXT CHECK (level IN ('beginner', 'intermediate', 'advanced', 'all')),
    language            TEXT DEFAULT 'English',
    -- Pricing (stored in kobo — NGN smallest unit)
    price               INTEGER NOT NULL DEFAULT 0,
    discount_price      INTEGER,
    discount_expires_at TIMESTAMPTZ,
    currency            TEXT DEFAULT 'NGN',
    is_free             BOOLEAN NOT NULL DEFAULT false,
    refund_window_days  INTEGER NOT NULL DEFAULT 30,
    -- Stats
    total_students      INTEGER NOT NULL DEFAULT 0,
    rating              NUMERIC(3,2) DEFAULT 0,
    total_hours         NUMERIC(5,1),
    -- Status
    is_published        BOOLEAN NOT NULL DEFAULT false,
    published_at        TIMESTAMPTZ,
    -- Live class scheduling (for course_type = 'live')
    platform            TEXT CHECK (platform IN ('zoom', 'meet', 'teams')),
    session_length_min  INTEGER,
    schedule_pattern    TEXT CHECK (schedule_pattern IN ('weekly', 'biweekly', 'custom')),
    -- Meta
    last_updated_at     TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. COURSE MODULES & LESSONS ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS course_modules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id         UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,
    video_url         TEXT,
    thumbnail_url     TEXT,
    duration_seconds  INTEGER,
    order_index       INTEGER NOT NULL DEFAULT 0,
    is_preview        BOOLEAN NOT NULL DEFAULT false,
    lesson_type       TEXT NOT NULL DEFAULT 'video'
                        CHECK (lesson_type IN ('video', 'quiz', 'assignment', 'reading')),
    content_json      JSONB,   -- { questions: [], passing_score: 70 } for quizzes
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id             UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed             BOOLEAN NOT NULL DEFAULT false,
    last_position_seconds INTEGER NOT NULL DEFAULT 0,
    quiz_score            INTEGER,
    completed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, lesson_id)
);

-- ─── 4. PAYMENTS & ENROLLMENTS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    amount_paid         INTEGER NOT NULL,   -- in kobo
    currency            TEXT DEFAULT 'NGN',
    payment_provider    TEXT CHECK (payment_provider IN ('paystack', 'flutterwave', 'manual')),
    provider_reference  TEXT,
    provider_response   JSONB,
    status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    paid_at             TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    refund_reason       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    payment_id  UUID REFERENCES payments(id),   -- NULL for free courses
    status      TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired', 'refunded', 'suspended')),
    progress    INTEGER NOT NULL DEFAULT 0,      -- 0-100 percent
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,                     -- NULL = lifetime access
    UNIQUE (user_id, course_id)
);

-- ─── 5. PROVIDER OAUTH TOKENS ────────────────────────────────────────────────
-- Source of truth for Zoom / Google / Teams tokens.
-- Redis is a 1-hour read cache on top of this table.

CREATE TABLE IF NOT EXISTS provider_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL CHECK (provider IN ('zoom', 'google', 'teams')),
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_refreshed_at TIMESTAMPTZ,
    refresh_error     TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (user_id, provider)
);

-- ─── 6. LIVE SESSIONS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_sessions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id                   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    instructor_id               UUID NOT NULL REFERENCES users(id),
    title                       TEXT NOT NULL,
    description                 TEXT,
    topic                       TEXT,
    subject                     TEXT,
    session_type                TEXT NOT NULL DEFAULT 'class'
                                  CHECK (session_type IN ('class', 'revision', 'office_hours')),
    -- Scheduling
    scheduled_start             TIMESTAMPTZ NOT NULL,
    scheduled_end               TIMESTAMPTZ,
    actual_start                TIMESTAMPTZ,
    actual_end                  TIMESTAMPTZ,
    -- Meeting
    platform                    TEXT DEFAULT 'zoom'
                                  CHECK (platform IN ('zoom', 'meet', 'teams')),
    meeting_id                  TEXT,
    meeting_password            TEXT,
    meeting_url                 TEXT,
    join_url                    TEXT,
    -- Capacity
    max_participants            INTEGER NOT NULL DEFAULT 50,
    current_participants        INTEGER NOT NULL DEFAULT 0,
    waitlist_enabled            BOOLEAN NOT NULL DEFAULT true,
    -- Status & recording
    status                      TEXT NOT NULL DEFAULT 'scheduled'
                                  CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled', 'recorded')),
    recording_url               TEXT,
    -- Notification sent flags
    reminder_sent_24h           BOOLEAN NOT NULL DEFAULT false,
    reminder_sent_1h            BOOLEAN NOT NULL DEFAULT false,
    reminder_sent_10min         BOOLEAN NOT NULL DEFAULT false,
    started_notification_sent   BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_participants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_id       UUID REFERENCES enrollments(id),
    status              TEXT NOT NULL DEFAULT 'registered'
                          CHECK (status IN ('registered', 'joined', 'left', 'no_show', 'waitlisted')),
    joined_at           TIMESTAMPTZ,
    left_at             TIMESTAMPTZ,
    duration_minutes    INTEGER,
    attended            BOOLEAN NOT NULL DEFAULT false,
    feedback_rating     INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),
    feedback_text       TEXT,
    reminder_24h_sent   BOOLEAN NOT NULL DEFAULT false,
    reminder_1h_sent    BOOLEAN NOT NULL DEFAULT false,
    reminder_10min_sent BOOLEAN NOT NULL DEFAULT false,
    started_sent        BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_waitlist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position    INTEGER,
    notified_at TIMESTAMPTZ,
    joined_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_analytics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    total_registered    INTEGER,
    total_attended      INTEGER,
    attendance_rate     NUMERIC(5,2),
    avg_watch_time      INTEGER,
    peak_concurrent     INTEGER NOT NULL DEFAULT 0,
    questions_asked     INTEGER NOT NULL DEFAULT 0,
    avg_rating          NUMERIC(3,2),
    recorded_views      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id)
);

-- ─── 7. PEER SESSIONS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS peer_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    host_student_id     UUID NOT NULL REFERENCES users(id),
    instructor_id       UUID NOT NULL REFERENCES users(id),
    title               TEXT NOT NULL,
    topic               TEXT,
    subject             TEXT,
    scheduled_start     TIMESTAMPTZ NOT NULL,
    scheduled_end       TIMESTAMPTZ,
    actual_start        TIMESTAMPTZ,
    actual_end          TIMESTAMPTZ,
    platform            TEXT NOT NULL CHECK (platform IN ('zoom', 'google', 'teams')),
    meeting_id          TEXT,
    meeting_url         TEXT,
    meeting_password    TEXT,
    max_participants    INTEGER NOT NULL DEFAULT 15,
    current_participants INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'upcoming'
                          CHECK (status IN ('upcoming', 'live', 'ended', 'cancelled')),
    recording_url       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS peer_session_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    peer_session_id UUID NOT NULL REFERENCES peer_sessions(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered', 'joined', 'left')),
    joined_at       TIMESTAMPTZ,
    left_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (peer_session_id, user_id)
);

-- ─── 8. Q&A ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS questions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    upvotes     INTEGER NOT NULL DEFAULT 0,
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    is_pinned   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_answers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id       UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content           TEXT NOT NULL,
    is_teacher_answer BOOLEAN NOT NULL DEFAULT false,
    upvotes           INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_upvotes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (question_id, user_id)
);

-- ─── 9. ANNOUNCEMENTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    author_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    content        TEXT NOT NULL,
    is_important   BOOLEAN NOT NULL DEFAULT false,
    is_pinned      BOOLEAN NOT NULL DEFAULT false,
    scheduled_for  TIMESTAMPTZ,
    sent_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_reads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (announcement_id, user_id)
);

-- ─── 10. REVIEWS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment             TEXT,
    is_verified_purchase BOOLEAN NOT NULL DEFAULT false,
    helpful_count       INTEGER NOT NULL DEFAULT 0,
    reported_count      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS review_helpful (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id  UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (review_id, user_id)
);

-- ─── 11. CLASS CHAT ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_agents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name  TEXT NOT NULL,
    agent_emoji TEXT NOT NULL DEFAULT '🤖',
    agent_color TEXT DEFAULT '#E8884A',
    agent_bg    TEXT DEFAULT '#FEF0E6',
    total_xp    INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS class_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_type  TEXT NOT NULL CHECK (sender_type IN ('student', 'teacher', 'agent', 'system')),
    agent_id     UUID REFERENCES user_agents(id),
    message      TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text'
                   CHECK (message_type IN ('text', 'system_alert', 'challenge')),
    reply_to_id  UUID REFERENCES class_messages(id),
    likes        INTEGER NOT NULL DEFAULT 0,
    is_pinned    BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_message_likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES class_messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id)
);

-- ─── 12. NOTIFICATIONS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT,
    related_id UUID,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_queue (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id        UUID REFERENCES live_sessions(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    channel           TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'whatsapp')),
    recipient         TEXT NOT NULL,
    subject           TEXT,
    body              TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    retry_count       INTEGER NOT NULL DEFAULT 0,
    error_message     TEXT,
    sent_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_notification_preferences (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Channel toggles
    email_enabled               BOOLEAN NOT NULL DEFAULT true,
    sms_enabled                 BOOLEAN NOT NULL DEFAULT true,
    push_enabled                BOOLEAN NOT NULL DEFAULT true,
    whatsapp_enabled            BOOLEAN NOT NULL DEFAULT false,
    -- Event toggles
    notify_session_reminders    BOOLEAN NOT NULL DEFAULT true,
    notify_session_started      BOOLEAN NOT NULL DEFAULT true,
    notify_session_cancelled    BOOLEAN NOT NULL DEFAULT true,
    notify_session_rescheduled  BOOLEAN NOT NULL DEFAULT true,
    notify_new_announcements    BOOLEAN NOT NULL DEFAULT true,
    notify_qa_replies           BOOLEAN NOT NULL DEFAULT true,
    -- Contact
    phone_number                TEXT,
    whatsapp_number             TEXT,
    push_token                  TEXT,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

-- ─── 13. VIDEOS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS videos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,
    order_index       INTEGER NOT NULL DEFAULT 0,
    is_preview        BOOLEAN NOT NULL DEFAULT false,
    video_url         TEXT,
    hls_path          TEXT,
    source_key        TEXT,
    variants          JSONB,
    duration          NUMERIC(10,3),
    file_size         BIGINT,
    encoding_status   TEXT NOT NULL DEFAULT 'queued'
                        CHECK (encoding_status IN ('queued', 'encoding', 'completed', 'failed')),
    encoding_progress INTEGER NOT NULL DEFAULT 0,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS encoding_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id      UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    input_file    TEXT NOT NULL,
    output_path   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'encoding', 'completed', 'failed')),
    error_message TEXT,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 14. VIDEO PROGRESS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS video_progress (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id         UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    watched_duration INTEGER NOT NULL DEFAULT 0,
    last_position    INTEGER NOT NULL DEFAULT 0,
    completed        BOOLEAN NOT NULL DEFAULT false,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, video_id)
);

-- ─── 15. INDEXES ─────────────────────────────────────────────────────────────

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

-- Courses
CREATE INDEX IF NOT EXISTS idx_courses_instructor  ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_courses_type        ON courses(course_type);
CREATE INDEX IF NOT EXISTS idx_courses_published   ON courses(is_published);
CREATE INDEX IF NOT EXISTS idx_courses_slug        ON courses(slug);

-- Course content
CREATE INDEX IF NOT EXISTS idx_modules_course        ON course_modules(course_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lessons_module        ON lessons(module_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user  ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON lesson_progress(lesson_id);

-- Payments & enrollments
CREATE INDEX IF NOT EXISTS idx_payments_user     ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_course   ON payments(course_id);
CREATE INDEX IF NOT EXISTS idx_payments_status   ON payments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_user  ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);

-- Provider tokens
CREATE INDEX IF NOT EXISTS idx_provider_tokens_user    ON provider_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_expires ON provider_tokens(expires_at, is_active);

-- Live sessions
CREATE INDEX IF NOT EXISTS idx_live_sessions_course        ON live_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_instructor    ON live_sessions(instructor_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status_start  ON live_sessions(status, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_session_participants_session ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user    ON session_participants(user_id);

-- Peer sessions
CREATE INDEX IF NOT EXISTS idx_peer_sessions_course   ON peer_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_peer_sessions_host     ON peer_sessions(host_student_id);
CREATE INDEX IF NOT EXISTS idx_peer_sessions_status   ON peer_sessions(status, scheduled_start);

-- Q&A
CREATE INDEX IF NOT EXISTS idx_questions_course   ON questions(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_user     ON questions(user_id);
CREATE INDEX IF NOT EXISTS idx_answers_question   ON question_answers(question_id);

-- Announcements
CREATE INDEX IF NOT EXISTS idx_announcements_course ON announcements(course_id);

-- Reviews
CREATE INDEX IF NOT EXISTS idx_reviews_course ON reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user   ON reviews(user_id);

-- Chat
CREATE INDEX IF NOT EXISTS idx_class_messages_course  ON class_messages(course_id, created_at);
CREATE INDEX IF NOT EXISTS idx_class_messages_sender  ON class_messages(sender_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read  ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user    ON user_notification_preferences(user_id);

-- Videos
CREATE INDEX IF NOT EXISTS idx_videos_course           ON videos(course_id);
CREATE INDEX IF NOT EXISTS idx_videos_encoding_status  ON videos(encoding_status);
CREATE INDEX IF NOT EXISTS idx_video_progress_user     ON video_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_video_progress_course   ON video_progress(course_id);

-- User agents
CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);

-- ═══════════════════════════════════════════════════════════════
-- PART 2: Extended features
-- Run this after the initial migration.sql
-- ═══════════════════════════════════════════════════════════════

-- ─── Full-text search ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_courses_title_trgm       ON courses USING gin(title       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_courses_description_trgm ON courses USING gin(description gin_trgm_ops);

-- ─── Coupons ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              TEXT UNIQUE NOT NULL,
    description       TEXT,
    discount_type     TEXT NOT NULL DEFAULT 'percent'
                        CHECK (discount_type IN ('percent', 'fixed')),
    discount_value    INTEGER NOT NULL,        -- percent (0-100) or kobo
    max_uses          INTEGER,                 -- NULL = unlimited
    used_count        INTEGER NOT NULL DEFAULT 0,
    course_id         UUID REFERENCES courses(id) ON DELETE CASCADE,  -- NULL = all courses
    instructor_id     UUID REFERENCES users(id) ON DELETE CASCADE,    -- NULL = platform-wide
    valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until       TIMESTAMPTZ,             -- NULL = no expiry
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupons_code       ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_course     ON coupons(course_id);
CREATE INDEX IF NOT EXISTS idx_coupons_instructor ON coupons(instructor_id);

-- Track which user used which coupon
CREATE TABLE IF NOT EXISTS coupon_uses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id   UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    payment_id  UUID NOT NULL REFERENCES payments(id),
    used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (coupon_id, user_id)
);

-- ─── Wishlists ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishlists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlists_user   ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_course ON wishlists(course_id);

-- ─── Gifts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gifts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id        UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    recipient_email  TEXT NOT NULL,
    recipient_user_id UUID REFERENCES users(id),           -- set when redeemed
    course_id        UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    payment_id       UUID NOT NULL REFERENCES payments(id),
    token            TEXT UNIQUE NOT NULL,                  -- redemption token
    message          TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'redeemed', 'expired')),
    expires_at       TIMESTAMPTZ NOT NULL,
    redeemed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gifts_token         ON gifts(token);
CREATE INDEX IF NOT EXISTS idx_gifts_sender        ON gifts(sender_id);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient_email ON gifts(recipient_email);

-- ─── Certificates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id      UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    enrollment_id  UUID NOT NULL REFERENCES enrollments(id),
    certificate_url TEXT NOT NULL,       -- R2 URL of the generated PDF
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_certificates_user   ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates(course_id);

-- ─── Subtitles / Captions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_subtitles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    language    TEXT NOT NULL,           -- e.g. "en", "fr", "yo" (Yoruba)
    label       TEXT NOT NULL,           -- e.g. "English", "Français"
    file_url    TEXT NOT NULL,           -- R2 URL of the .vtt file
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (video_id, language)
);
CREATE INDEX IF NOT EXISTS idx_subtitles_video ON video_subtitles(video_id);

-- ─── Instructor earnings + commission ─────────────────────────
-- One row per payment — immutable audit trail
-- commission_percent is snapshotted at time of purchase
-- so changing PLATFORM_COMMISSION_PERCENT never alters old records
CREATE TABLE IF NOT EXISTS instructor_earnings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id        UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id            UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    payment_id           UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    student_id           UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    gross_amount         INTEGER NOT NULL,   -- total paid by student (kobo)
    commission_percent   NUMERIC(5,2) NOT NULL,
    commission_amount    INTEGER NOT NULL,   -- platform keeps this (kobo)
    net_amount           INTEGER NOT NULL,   -- instructor receives this (kobo)
    currency             TEXT NOT NULL DEFAULT 'NGN',
    status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'paid', 'refunded', 'on_hold')),
    payout_id            UUID,              -- set when included in a payout batch
    earned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payment_id)                     -- one earning record per payment
);
CREATE INDEX IF NOT EXISTS idx_earnings_instructor ON instructor_earnings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_earnings_course     ON instructor_earnings(course_id);
CREATE INDEX IF NOT EXISTS idx_earnings_status     ON instructor_earnings(status);
CREATE INDEX IF NOT EXISTS idx_earnings_payout     ON instructor_earnings(payout_id);

-- ─── Payouts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount              INTEGER NOT NULL,    -- total payout amount (kobo)
    currency            TEXT NOT NULL DEFAULT 'NGN',
    payment_provider    TEXT DEFAULT 'paystack',
    provider_reference  TEXT,               -- Paystack transfer reference
    provider_response   JSONB,
    bank_code           TEXT,               -- recipient bank code
    account_number      TEXT,               -- recipient account number
    account_name        TEXT,               -- verified account name
    status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    earnings_count      INTEGER NOT NULL DEFAULT 0,   -- number of earnings in batch
    failure_reason      TEXT,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at        TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payouts_instructor ON payouts(instructor_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status     ON payouts(status);

-- Bank details stored per instructor (for payout)
CREATE TABLE IF NOT EXISTS instructor_bank_details (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_code      TEXT NOT NULL,
    bank_name      TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_name   TEXT NOT NULL,   -- verified via Paystack resolve API
    is_default     BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (instructor_id)          -- one bank account per instructor for now
);

-- ─── Course bundles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_bundles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    cover_image_url TEXT,
    price         INTEGER NOT NULL,          -- bundle price in kobo
    currency      TEXT NOT NULL DEFAULT 'NGN',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bundle_courses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id  UUID NOT NULL REFERENCES course_bundles(id) ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id)        ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bundle_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_bundle ON bundle_courses(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_course ON bundle_courses(course_id);

-- ─── pg_trgm weighted search function ────────────────────────────────────────
-- Called by bundles.js searchCourses() via db.rpc("search_courses", ...)
-- Title matches score 2x higher than description matches.

CREATE OR REPLACE FUNCTION search_courses(
    search_query  TEXT,
    p_course_type TEXT    DEFAULT NULL,
    p_subject     TEXT    DEFAULT NULL,
    p_level       TEXT    DEFAULT NULL,
    p_min_price   INTEGER DEFAULT NULL,
    p_max_price   INTEGER DEFAULT NULL,
    p_limit       INTEGER DEFAULT 20,
    p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
    id               UUID,
    title            TEXT,
    slug             TEXT,
    description      TEXT,
    cover_image_url  TEXT,
    course_type      TEXT,
    subject          TEXT,
    level            TEXT,
    language         TEXT,
    price            INTEGER,
    discount_price   INTEGER,
    currency         TEXT,
    is_free          BOOLEAN,
    total_students   INTEGER,
    rating           NUMERIC,
    total_hours      NUMERIC,
    is_published     BOOLEAN,
    similarity_score REAL
)
LANGUAGE sql STABLE AS $$
    SELECT
        c.id, c.title, c.slug, c.description, c.cover_image_url,
        c.course_type, c.subject, c.level, c.language,
        c.price, c.discount_price, c.currency, c.is_free,
        c.total_students, c.rating, c.total_hours, c.is_published,
        -- Title match weighted 2x over description
        (similarity(c.title, search_query) * 2 +
         similarity(COALESCE(c.description, ''), search_query)) AS similarity_score
    FROM courses c
    WHERE
        c.is_published = true
        AND (
            similarity(c.title, search_query) > 0.1
            OR similarity(COALESCE(c.description, ''), search_query) > 0.05
            OR c.title       ILIKE '%' || search_query || '%'
            OR c.description ILIKE '%' || search_query || '%'
        )
        AND (p_course_type IS NULL OR c.course_type = p_course_type)
        AND (p_subject     IS NULL OR c.subject     = p_subject)
        AND (p_level       IS NULL OR c.level       = p_level)
        AND (p_min_price   IS NULL OR c.price      >= p_min_price)
        AND (p_max_price   IS NULL OR c.price      <= p_max_price)
    ORDER BY similarity_score DESC, c.total_students DESC
    LIMIT  p_limit
    OFFSET p_offset;
$$;

-- Helper RPCs used by payments.js ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_course_students(course_id_input UUID)
RETURNS VOID LANGUAGE sql AS $$
    UPDATE courses SET total_students = total_students + 1 WHERE id = course_id_input;
$$;

CREATE OR REPLACE FUNCTION increment_coupon_uses(coupon_id_input UUID)
RETURNS VOID LANGUAGE sql AS $$
    UPDATE coupons SET used_count = used_count + 1 WHERE id = coupon_id_input;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Ranking + Profiles module tables
-- ═══════════════════════════════════════════════════════════════

-- ─── Classrooms ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classrooms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id     UUID,                          -- NULL for standalone teachers
    name          TEXT NOT NULL,
    description   TEXT,
    student_limit INTEGER NOT NULL DEFAULT 20,
    is_upgraded   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_school  ON classrooms(school_id);

CREATE TABLE IF NOT EXISTS classroom_students (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    classroom_id  UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'removed', 'suspended')),
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (classroom_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_students_classroom ON classroom_students(classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_students_user      ON classroom_students(user_id);

-- ─── School profiles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    logo_url      TEXT,
    website       TEXT,
    address       TEXT,
    phone         TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_profiles_admin ON school_profiles(admin_user_id);

CREATE TABLE IF NOT EXISTS school_teachers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES school_profiles(id) ON DELETE CASCADE,
    teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (school_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_school_teachers_school  ON school_teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_school_teachers_teacher ON school_teachers(teacher_id);

-- Add school_admin role to users check
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'instructor', 'school_admin', 'admin'));

-- Add must_change_password flag for auto-created accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- ─── XP transactions (ranking source of truth) ────────────────
CREATE TABLE IF NOT EXISTS xp_transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id     UUID REFERENCES courses(id) ON DELETE SET NULL,
    classroom_id  UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    reason        TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user      ON xp_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_course    ON xp_transactions(course_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_classroom ON xp_transactions(classroom_id);

-- ─── XP leaderboard (materialised every 15 min by ranking cron) ─
CREATE TABLE IF NOT EXISTS xp_leaderboard (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL CHECK (scope IN ('course', 'classroom', 'global')),
    course_id    UUID REFERENCES courses(id) ON DELETE CASCADE,
    classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE,
    total_xp     INTEGER NOT NULL DEFAULT 0,
    rank         INTEGER,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, scope, course_id, classroom_id)
);
CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_user      ON xp_leaderboard(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_scope     ON xp_leaderboard(scope, total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_course    ON xp_leaderboard(course_id, total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_classroom ON xp_leaderboard(classroom_id, total_xp DESC);

-- ─── Cart items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_user   ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_course ON cart_items(course_id);

-- ─── Helper: increment agent XP ───────────────────────────────
CREATE OR REPLACE FUNCTION increment_agent_xp(user_id_input UUID, xp_amount INTEGER)
RETURNS VOID LANGUAGE sql AS $$
    UPDATE user_agents SET total_xp = total_xp + xp_amount WHERE user_id = user_id_input;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 4: Adaptive Learning Module (edu schema)
-- Run after Parts 1-3.
-- Uses pgvector extension for RAG embeddings.
-- All user FKs reference public.users(id) — shared identity.
-- ═══════════════════════════════════════════════════════════════
-- =============================================================
-- MIGRATIONS.sql
-- Run once in Supabase SQL editor
-- All new tables for v3: trained agents + student agent system
-- =============================================================

-- ── EXTENSIONS ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA  IF NOT EXISTS edu;

-- =============================================================
-- TEACHER TRAINING (existing — kept for reference)
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.training_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL,
  run_id        UUID,
  title         TEXT,
  subject       TEXT,
  file_type     TEXT CHECK (file_type IN ('audio','video','live')),
  file_path     TEXT,
  file_size     BIGINT,
  status        TEXT DEFAULT 'processing',
  chunks_stored INT  DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS edu.teacher_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id          UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id            UUID,
  teacher_name        TEXT,
  agent_name          TEXT DEFAULT 'Pythia',
  subject             TEXT,
  style_profile       JSONB,
  concepts_taught     TEXT[],
  total_hours_trained NUMERIC DEFAULT 0,
  session_count       INT     DEFAULT 0,
  last_trained_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.training_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id    UUID,
  session_id  UUID REFERENCES edu.training_sessions(id) ON DELETE CASCADE,
  chunk_text  TEXT NOT NULL,
  chunk_type  TEXT,
  metadata    JSONB DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_chunks_embedding
  ON edu.training_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS edu.stream_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES edu.training_sessions(id) ON DELETE CASCADE,
  teacher_id  UUID,
  agent_id    UUID,
  subject     TEXT,
  run_id      UUID,
  expires_at  TIMESTAMPTZ
);

-- =============================================================
-- NEW: TEACHER AGENT ORCHESTRATION CONFIG
-- Derived from training — unique flow per teacher
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.agent_orchestration_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID UNIQUE NOT NULL,
  teacher_id        UUID REFERENCES public.users(id) ON DELETE CASCADE,

  -- Flow type derived from pedagogical_pattern
  flow_type         TEXT DEFAULT 'phase-based'
                    CHECK (flow_type IN ('phase-based','lecture-drill','challenge-first','custom')),

  -- Phase definitions unique to this teacher
  -- e.g. [{ id: "HOOK", label: "Hook", description: "..." }, ...]
  phase_definitions JSONB DEFAULT '[]',

  -- Guide agent config (teacher's voice + style)
  guide_config      JSONB DEFAULT '{}',

  -- Control agent config (teacher's boundary + redirect style)
  control_config    JSONB DEFAULT '{}',

  -- Student agent tuning for this teacher's class
  student_config    JSONB DEFAULT '{}',

  -- System prompt fragments injected at runtime
  prompt_injections JSONB DEFAULT '{}',

  -- Metadata
  derived_from_run  UUID,
  training_version  INT DEFAULT 1,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_agent
  ON edu.agent_orchestration_config(agent_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_teacher
  ON edu.agent_orchestration_config(teacher_id);

-- =============================================================
-- NEW: STUDENT AGENTS
-- One agent per student — grows with each session
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.student_agents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name             TEXT DEFAULT 'My Learning Agent',
  level            INT  DEFAULT 1,
  total_sessions   INT  DEFAULT 0,
  total_turns      INT  DEFAULT 0,
  knowledge_score  NUMERIC DEFAULT 0,  -- grows with every session
  subjects_learned TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id)  -- one agent per student
);

CREATE INDEX IF NOT EXISTS idx_student_agents_student
  ON edu.student_agents(student_id);

-- =============================================================
-- NEW: STUDENT PERSONAL KNOWLEDGE
-- Topics/lessons/notes saved by the student
-- Used as RAG source 2 when agent responds
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.student_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id    UUID REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  subject     TEXT,
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'manual'
              CHECK (source IN ('manual','session','teacher','upload')),
  confidence  NUMERIC DEFAULT 0.5,
  tags        TEXT[] DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_knowledge_student
  ON edu.student_knowledge(student_id);
CREATE INDEX IF NOT EXISTS idx_student_knowledge_embedding
  ON edu.student_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- =============================================================
-- NEW: AGENT KNOWLEDGE
-- What the student agent has been taught across all sessions
-- Grows every session — RAG source 1
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.agent_knowledge (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  subject       TEXT,
  content       TEXT NOT NULL,
  chunk_type    TEXT DEFAULT 'taught'
                CHECK (chunk_type IN ('taught','corrected','recalled','reinforced')),
  confidence    NUMERIC DEFAULT 0.5,
  times_seen    INT DEFAULT 1,
  last_seen_at  TIMESTAMPTZ DEFAULT now(),
  session_id    TEXT,  -- which session this came from
  embedding     vector(1536),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent
  ON edu.agent_knowledge(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_embedding
  ON edu.agent_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- =============================================================
-- NEW: SESSION KNOWLEDGE DELTA
-- Per-session record of what was learned
-- Tracks intelligence growth over time
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.session_knowledge_delta (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               TEXT NOT NULL,
  agent_id                 UUID REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id               UUID REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_agent_id         UUID,  -- NULL if using built-in pair

  -- What was covered
  topic                    TEXT,
  subject                  TEXT,
  concepts_learned         TEXT[] DEFAULT '{}',
  misconceptions_cleared   TEXT[] DEFAULT '{}',

  -- State deltas
  understanding_start      NUMERIC DEFAULT 0,
  understanding_end        NUMERIC DEFAULT 0,
  understanding_delta      NUMERIC DEFAULT 0,

  -- Knowledge additions
  agent_knowledge_added    INT DEFAULT 0,    -- new chunks added to agent KB
  student_knowledge_refs   INT DEFAULT 0,   -- times student KB was referenced
  teacher_chunks_used      INT DEFAULT 0,   -- times teacher material was used

  -- Session stats
  total_turns              INT DEFAULT 0,
  session_duration_sec     INT DEFAULT 0,
  xp_earned                INT DEFAULT 0,

  started_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_delta_agent
  ON edu.session_knowledge_delta(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_delta_student
  ON edu.session_knowledge_delta(student_id, started_at DESC);

-- =============================================================
-- SIMILARITY SEARCH FUNCTIONS
-- =============================================================

-- Match agent knowledge chunks
CREATE OR REPLACE FUNCTION match_agent_knowledge(
  p_agent_id        UUID,
  p_query_embedding vector(1536),
  p_match_count     INT DEFAULT 6
)
RETURNS TABLE (
  id         UUID,
  topic      TEXT,
  content    TEXT,
  chunk_type TEXT,
  confidence NUMERIC,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT id, topic, content, chunk_type, confidence,
         1 - (embedding <=> p_query_embedding) AS similarity
  FROM edu.agent_knowledge
  WHERE agent_id = p_agent_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Match student personal knowledge
CREATE OR REPLACE FUNCTION match_student_knowledge(
  p_student_id      UUID,
  p_query_embedding vector(1536),
  p_match_count     INT DEFAULT 6
)
RETURNS TABLE (
  id         UUID,
  topic      TEXT,
  content    TEXT,
  source     TEXT,
  confidence NUMERIC,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT id, topic, content, source, confidence,
         1 - (embedding <=> p_query_embedding) AS similarity
  FROM edu.student_knowledge
  WHERE student_id = p_student_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Match teacher training chunks (existing)
CREATE OR REPLACE FUNCTION match_training_chunks(
  p_teacher_id      UUID,
  p_query_embedding vector(1536),
  p_match_count     INT DEFAULT 6
)
RETURNS TABLE (
  id         UUID,
  chunk_text TEXT,
  chunk_type TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT id, chunk_text, chunk_type, metadata,
         1 - (embedding <=> p_query_embedding) AS similarity
  FROM edu.training_chunks
  WHERE teacher_id = p_teacher_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- =============================================================
-- AGENT KNOWLEDGE GROWTH VIEW
-- Shows intelligence growth per agent over time
-- =============================================================

CREATE OR REPLACE VIEW edu.agent_intelligence_growth AS
SELECT
  sa.id            AS agent_id,
  sa.student_id,
  sa.name          AS agent_name,
  sa.level,
  sa.total_sessions,
  sa.total_turns,
  sa.knowledge_score,
  sa.subjects_learned,
  COUNT(ak.id)     AS total_knowledge_chunks,
  AVG(ak.confidence) AS avg_confidence,
  MAX(ak.last_seen_at) AS last_active,
  sa.created_at
FROM edu.student_agents sa
LEFT JOIN edu.agent_knowledge ak ON ak.agent_id = sa.id
GROUP BY sa.id, sa.student_id, sa.name, sa.level,
         sa.total_sessions, sa.total_turns,
         sa.knowledge_score, sa.subjects_learned, sa.created_at;
-- =============================================================
-- MIGRATIONS_v31.sql
-- v3.1 additions only — run after MIGRATIONS.sql
-- Adds: subject/topic structure, decay tracking, notifications
-- =============================================================

-- ── Add subject + decay columns to agent_knowledge ───────────
ALTER TABLE edu.agent_knowledge
  ADD COLUMN IF NOT EXISTS subject          TEXT,
  ADD COLUMN IF NOT EXISTS confidence       NUMERIC DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS decay_rate       NUMERIC DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS next_review_due  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority         TEXT DEFAULT 'low'
    CHECK (priority IN ('critical','high','medium','low'));

-- Back-fill next_review_due for existing rows
UPDATE edu.agent_knowledge
SET next_review_due = NOW() + INTERVAL '7 days'
WHERE next_review_due IS NULL;

-- ── Add subject + decay columns to student_knowledge ─────────
ALTER TABLE edu.student_knowledge
  ADD COLUMN IF NOT EXISTS confidence       NUMERIC DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS decay_rate       NUMERIC DEFAULT 0.08,
  ADD COLUMN IF NOT EXISTS next_review_due  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority         TEXT DEFAULT 'low'
    CHECK (priority IN ('critical','high','medium','low'));

UPDATE edu.student_knowledge
SET next_review_due = NOW() + INTERVAL '14 days'
WHERE next_review_due IS NULL;

-- ── Decay events log ─────────────────────────────────────────
-- Records every decay calculation and review event
CREATE TABLE IF NOT EXISTS edu.decay_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  topic            TEXT NOT NULL,
  event_type       TEXT NOT NULL
    CHECK (event_type IN ('decay_calculated','review_triggered',
                          'review_completed','reinforced','alert_sent')),
  confidence_before NUMERIC,
  confidence_after  NUMERIC,
  days_since_review INT,
  decay_amount      NUMERIC,
  session_id        TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decay_events_agent
  ON edu.decay_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decay_events_student
  ON edu.decay_events(student_id, created_at DESC);

-- ── Decay notifications ───────────────────────────────────────
-- Push alerts sent to students when topic confidence drops
CREATE TABLE IF NOT EXISTS edu.decay_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  topic        TEXT NOT NULL,
  confidence   NUMERIC NOT NULL,
  priority     TEXT NOT NULL,
  message      TEXT NOT NULL,
  is_read      BOOLEAN DEFAULT false,
  is_actioned  BOOLEAN DEFAULT false,  -- true when student starts review session
  session_id   TEXT,                   -- populated when review session is started
  created_at   TIMESTAMPTZ DEFAULT now(),
  read_at      TIMESTAMPTZ,
  actioned_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decay_notifs_student
  ON edu.decay_notifications(student_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decay_notifs_agent
  ON edu.decay_notifications(agent_id);

-- ── Knowledge subject summary view ───────────────────────────
-- Aggregates agent knowledge by subject for dashboard
CREATE OR REPLACE VIEW edu.agent_knowledge_by_subject AS
SELECT
  ak.agent_id,
  ak.student_id,
  ak.subject,
  COUNT(ak.id)             AS topic_count,
  AVG(ak.confidence)       AS avg_confidence,
  MIN(ak.confidence)       AS min_confidence,
  MAX(ak.confidence)       AS max_confidence,
  COUNT(CASE WHEN ak.priority = 'critical' THEN 1 END) AS critical_count,
  COUNT(CASE WHEN ak.priority = 'high'     THEN 1 END) AS high_count,
  COUNT(CASE WHEN ak.priority = 'medium'   THEN 1 END) AS medium_count,
  COUNT(CASE WHEN ak.priority = 'low'      THEN 1 END) AS low_count,
  MIN(ak.next_review_due)  AS earliest_review_due,
  MAX(ak.last_seen_at)     AS last_activity,
  SUM(ak.times_seen)       AS total_reviews
FROM edu.agent_knowledge ak
GROUP BY ak.agent_id, ak.student_id, ak.subject;

-- ── Topic health view ─────────────────────────────────────────
-- Per-topic confidence + decay status
CREATE OR REPLACE VIEW edu.agent_topic_health AS
SELECT
  ak.id,
  ak.agent_id,
  ak.student_id,
  ak.subject,
  ak.topic,
  ak.confidence,
  ak.decay_rate,
  ak.next_review_due,
  ak.last_seen_at,
  ak.times_seen,
  ak.priority,
  EXTRACT(EPOCH FROM (NOW() - ak.last_seen_at)) / 86400 AS days_since_review,
  CASE
    WHEN ak.confidence < 0.35 THEN 'critical'
    WHEN ak.confidence < 0.55 THEN 'high'
    WHEN ak.confidence < 0.72 THEN 'medium'
    ELSE 'healthy'
  END AS health_status,
  -- Projected confidence after 7 more days of decay
  GREATEST(0.05, ak.confidence - (ak.decay_rate * 7)) AS projected_7day
FROM edu.agent_knowledge ak;

-- ── Updated next_review_due index ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_review_due
  ON edu.agent_knowledge(agent_id, next_review_due ASC)
  WHERE next_review_due IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_subject_topic
  ON edu.agent_knowledge(agent_id, subject, topic);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_priority
  ON edu.agent_knowledge(agent_id, priority)
  WHERE priority IN ('critical', 'high');
-- =============================================================
-- MIGRATIONS_v32.sql
-- Run after MIGRATIONS.sql and MIGRATIONS_v31.sql
-- Adds: marketplace, purchases, extended user preferences
-- =============================================================

-- ── Extended user agent preferences ──────────────────────────
-- Replaces the simple agent_preferences table with a richer one
CREATE TABLE IF NOT EXISTS edu.user_agent_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  default_pair_id  TEXT NOT NULL DEFAULT 'nana-sargeant',
  -- Array of teacher agent UUIDs the user has purchased/unlocked
  purchased_agents UUID[] DEFAULT '{}',
  -- The agent currently selected for active chat sessions
  active_agent_id  UUID,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_agent_prefs_user
  ON edu.user_agent_preferences(user_id);

-- Migrate existing agent_preferences rows if any (skip if source table doesn't exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'edu' AND table_name = 'agent_preferences'
  ) THEN
    INSERT INTO edu.user_agent_preferences (user_id, default_pair_id, updated_at)
    SELECT agent_id, COALESCE(guide_pair_id, 'nana-sargeant'), updated_at
    FROM edu.agent_preferences
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

-- ── Marketplace listings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL,   -- references edu.agent_orchestration_config.agent_id
  teacher_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  subject          TEXT NOT NULL,
  topics_covered   TEXT[] DEFAULT '{}',
  price_kobo       INT  NOT NULL DEFAULT 0,  -- 0 = free
  currency         TEXT NOT NULL DEFAULT 'NGN',
  is_active        BOOLEAN DEFAULT true,
  is_free          BOOLEAN GENERATED ALWAYS AS (price_kobo = 0) STORED,
  preview_topics   TEXT[] DEFAULT '{}',      -- shown before purchase
  sample_tip       TEXT,                     -- sample NaNa-style tip
  total_students   INT  DEFAULT 0,
  total_sessions   INT  DEFAULT 0,
  avg_rating       NUMERIC(3,2) DEFAULT 0.00,
  rating_count     INT  DEFAULT 0,
  teacher_name     TEXT,
  teacher_avatar   TEXT,
  agent_avatar     TEXT,
  style_summary    TEXT,  -- e.g. "Warm, example-first, conversational"
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_active
  ON edu.marketplace_listings(is_active, subject, price_kobo);
CREATE INDEX IF NOT EXISTS idx_marketplace_teacher
  ON edu.marketplace_listings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_agent
  ON edu.marketplace_listings(agent_id);

-- ── Agent purchases ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.agent_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL,
  listing_id       UUID NOT NULL REFERENCES edu.marketplace_listings(id),
  amount_kobo      INT  NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'NGN',
  paystack_ref     TEXT UNIQUE,        -- Paystack transaction reference
  paystack_status  TEXT DEFAULT 'pending'
                   CHECK (paystack_status IN ('pending','success','failed','refunded')),
  access_granted   BOOLEAN DEFAULT false,
  receipt_url      TEXT,
  metadata         JSONB DEFAULT '{}',
  purchased_at     TIMESTAMPTZ DEFAULT now(),
  verified_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchases_student
  ON edu.agent_purchases(student_id, paystack_status);
CREATE INDEX IF NOT EXISTS idx_purchases_ref
  ON edu.agent_purchases(paystack_ref);
CREATE INDEX IF NOT EXISTS idx_purchases_agent
  ON edu.agent_purchases(agent_id, access_granted);

-- ── Marketplace reviews ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.marketplace_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES edu.marketplace_listings(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES edu.agent_purchases(id),
  rating      INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_listing
  ON edu.marketplace_reviews(listing_id, rating DESC);

-- ── Function: check if user owns an agent ────────────────────
CREATE OR REPLACE FUNCTION edu.user_owns_agent(
  p_user_id  UUID,
  p_agent_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM edu.user_agent_preferences
    WHERE user_id = p_user_id
      AND (p_agent_id = ANY(purchased_agents))
  )
  OR EXISTS (
    SELECT 1 FROM edu.agent_purchases
    WHERE student_id   = p_user_id
      AND agent_id     = p_agent_id
      AND access_granted = true
  );
$$;

-- ── Marketplace summary view ──────────────────────────────────
CREATE OR REPLACE VIEW edu.marketplace_summary AS
SELECT
  ml.id,
  ml.agent_id,
  ml.teacher_id,
  ml.title,
  ml.description,
  ml.subject,
  ml.topics_covered,
  ml.price_kobo,
  ml.currency,
  ml.is_active,
  ml.is_free,
  ml.preview_topics,
  ml.sample_tip,
  ml.total_students,
  ml.avg_rating,
  ml.rating_count,
  ml.teacher_name,
  ml.teacher_avatar,
  ml.agent_avatar,
  ml.style_summary,
  ml.created_at,
  tp.style_profile,
  tp.concepts_taught,
  tp.total_hours_trained,
  tp.session_count       AS training_sessions
FROM edu.marketplace_listings ml
LEFT JOIN edu.teacher_profiles tp ON tp.agent_id = ml.agent_id
WHERE ml.is_active = true;

-- ── Trigger: update avg_rating on new review ─────────────────
CREATE OR REPLACE FUNCTION edu.update_listing_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE edu.marketplace_listings
  SET avg_rating   = (SELECT AVG(rating)   FROM edu.marketplace_reviews WHERE listing_id = NEW.listing_id),
      rating_count = (SELECT COUNT(*)      FROM edu.marketplace_reviews WHERE listing_id = NEW.listing_id),
      updated_at   = NOW()
  WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_listing_rating ON edu.marketplace_reviews;
CREATE TRIGGER trg_update_listing_rating
  AFTER INSERT OR UPDATE ON edu.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION edu.update_listing_rating();

-- ── Student session state (hot: Redis, cold: here) ────────────
CREATE TABLE IF NOT EXISTS edu_student_states (
  agent_id   UUID PRIMARY KEY,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edu_student_states_updated
  ON edu_student_states(updated_at DESC);

-- ── RPC for ownership check (renamed to avoid schema prefix issues) ──
CREATE OR REPLACE FUNCTION edu_user_owns_agent(p_user_id UUID, p_agent_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM edu.user_agent_preferences
    WHERE user_id = p_user_id AND (p_agent_id = ANY(purchased_agents))
  ) OR EXISTS (
    SELECT 1 FROM edu.agent_purchases
    WHERE student_id = p_user_id AND agent_id = p_agent_id AND access_granted = true
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 5: Battle Module Tables
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS battles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id          UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    battle_type        TEXT NOT NULL CHECK (battle_type IN ('1v1','open','classroom')),
    title              TEXT NOT NULL,
    description        TEXT,
    topic              TEXT,
    subject            TEXT,
    difficulty         TEXT NOT NULL DEFAULT 'intermediate',
    total_questions    INTEGER NOT NULL DEFAULT 15,
    time_limit_seconds INTEGER NOT NULL DEFAULT 900,
    xp_prize           INTEGER NOT NULL DEFAULT 200,
    xp_pool            INTEGER NOT NULL DEFAULT 200,
    max_participants   INTEGER NOT NULL DEFAULT 10,
    total_participants INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'lobby'
                         CHECK (status IN ('lobby','scheduled','live','completed','expired','cancelled')),
    scheduled_start    TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ NOT NULL,
    actual_start       TIMESTAMPTZ,
    actual_end         TIMESTAMPTZ,
    duration_seconds   INTEGER,
    peak_viewers       INTEGER NOT NULL DEFAULT 0,
    created_by         UUID NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battles_course   ON battles(course_id);
CREATE INDEX IF NOT EXISTS idx_battles_status   ON battles(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_battles_creator  ON battles(created_by);

CREATE TABLE IF NOT EXISTS battle_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id       UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    agent_id        UUID NOT NULL REFERENCES user_agents(id),
    role            TEXT NOT NULL DEFAULT 'participant'
                      CHECK (role IN ('creator','opponent','participant','teacher')),
    score           INTEGER NOT NULL DEFAULT 0,
    hp              INTEGER NOT NULL DEFAULT 100,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    wrong_answers   INTEGER NOT NULL DEFAULT 0,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    max_streak      INTEGER NOT NULL DEFAULT 0,
    avg_response_ms INTEGER,
    is_winner       BOOLEAN NOT NULL DEFAULT false,
    final_rank      INTEGER,
    xp_earned       INTEGER NOT NULL DEFAULT 0,
    is_connected    BOOLEAN NOT NULL DEFAULT false,
    last_heartbeat  TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ,
    UNIQUE (battle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_battle_participants_battle ON battle_participants(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_participants_user   ON battle_participants(user_id);

CREATE TABLE IF NOT EXISTS battle_questions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id             UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    question_order        INTEGER NOT NULL,
    question_text         TEXT NOT NULL,
    options_json          TEXT NOT NULL,
    correct_answer_index  INTEGER NOT NULL,
    topic                 TEXT,
    subject               TEXT,
    xp_value              INTEGER NOT NULL DEFAULT 35,
    time_limit_seconds    INTEGER NOT NULL DEFAULT 15
);
CREATE INDEX IF NOT EXISTS idx_battle_questions_battle ON battle_questions(battle_id, question_order);

CREATE TABLE IF NOT EXISTS battle_answers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id       UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    participant_id  UUID NOT NULL REFERENCES battle_participants(id),
    question_id     UUID NOT NULL REFERENCES battle_questions(id),
    selected_index  INTEGER NOT NULL,
    is_correct      BOOLEAN NOT NULL DEFAULT false,
    response_time_ms INTEGER,
    xp_gained       INTEGER NOT NULL DEFAULT 0,
    streak_at_time  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (participant_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_battle_answers_battle ON battle_answers(battle_id);

CREATE TABLE IF NOT EXISTS battle_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id      UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    question_order INTEGER,
    event_type     TEXT NOT NULL,
    user_id        UUID,
    agent_name     TEXT,
    agent_emoji    TEXT,
    message        TEXT NOT NULL,
    meta_json      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battle_log_battle ON battle_log(battle_id, created_at);

CREATE TABLE IF NOT EXISTS battle_viewers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id      UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id),
    is_participant BOOLEAN NOT NULL DEFAULT false,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (battle_id, user_id)
);

CREATE TABLE IF NOT EXISTS question_bank (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id            UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    subject              TEXT,
    topic                TEXT,
    question_text        TEXT NOT NULL,
    options_json         TEXT NOT NULL,
    correct_answer_index INTEGER NOT NULL,
    difficulty           TEXT NOT NULL DEFAULT 'intermediate',
    xp_value             INTEGER NOT NULL DEFAULT 35,
    times_used           INTEGER NOT NULL DEFAULT 0,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    is_ai_generated      BOOLEAN NOT NULL DEFAULT false,
    created_by           UUID NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_question_bank_course ON question_bank(course_id, is_active);
CREATE INDEX IF NOT EXISTS idx_question_bank_topic  ON question_bank(topic, difficulty);

CREATE TABLE IF NOT EXISTS xp_ledger (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    agent_id      UUID NOT NULL REFERENCES user_agents(id),
    amount        INTEGER NOT NULL,
    source        TEXT NOT NULL,
    reference_id  UUID,
    running_total INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user ON xp_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_cache (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope            TEXT NOT NULL,
    scope_id         UUID NOT NULL,
    user_id          UUID NOT NULL REFERENCES users(id),
    rank             INTEGER NOT NULL,
    total_xp         INTEGER NOT NULL DEFAULT 0,
    battles_won      INTEGER NOT NULL DEFAULT 0,
    battles_played   INTEGER NOT NULL DEFAULT 0,
    win_rate         INTEGER NOT NULL DEFAULT 0,
    last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scope, scope_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_scope ON leaderboard_cache(scope, scope_id, rank);

CREATE OR REPLACE FUNCTION increment_question_uses(q_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE question_bank SET times_used = times_used + 1 WHERE id = q_id;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 6: Tasks Module Tables
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    CREATE TYPE task_status   AS ENUM ('pending','queued','running','done','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE task_priority AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE run_status    AS ENUM ('running','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE output_type   AS ENUM ('message','quiz','report','reminder','grade','file','session','battle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Task agents (teacher's AI assistants — separate from student user_agents)
CREATE TABLE IF NOT EXISTS task_agents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id    UUID NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    emoji         TEXT NOT NULL DEFAULT '🤖',
    system_prompt TEXT NOT NULL,
    subject       TEXT NOT NULL,
    level         INTEGER NOT NULL DEFAULT 1,
    xp            INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id   UUID NOT NULL REFERENCES users(id),
    agent_id     UUID NOT NULL REFERENCES user_agents(id),
    course_id    UUID REFERENCES courses(id),
    title        TEXT NOT NULL,
    description  TEXT,
    priority     task_priority NOT NULL DEFAULT 'medium',
    status       task_status NOT NULL DEFAULT 'pending',
    task_type    TEXT NOT NULL DEFAULT 'general',
    payload      JSONB NOT NULL DEFAULT '{}',
    due_at       TIMESTAMPTZ,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    timezone     TEXT NOT NULL DEFAULT 'Africa/Lagos',
    bull_job_id  TEXT,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_at) WHERE status IN ('pending','queued');

CREATE TABLE IF NOT EXISTS task_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_number  INTEGER NOT NULL,
    status      run_status NOT NULL DEFAULT 'running',
    agent_steps JSONB NOT NULL DEFAULT '[]',
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, run_number DESC);

CREATE TABLE IF NOT EXISTS task_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id  UUID REFERENCES users(id),
    task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
    file_key    TEXT,
    file_name   TEXT,
    file_type   TEXT,
    file_url    TEXT,
    size_bytes  BIGINT,
    ocr_text    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_files_task    ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_task_files_teacher ON task_files(teacher_id);

CREATE TABLE IF NOT EXISTS task_outputs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    output_type output_type NOT NULL,
    content     JSONB NOT NULL,
    delivered   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_outputs_task ON task_outputs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_schedules (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    cron_expr TEXT NOT NULL,
    timezone  TEXT NOT NULL DEFAULT 'Africa/Lagos',
    UNIQUE (task_id)
);

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION PATCH: Fix 4 schema issues
-- Run this after Parts 1-6.
-- ═══════════════════════════════════════════════════════════════

-- ─── Fix 1: Move edu_student_states into edu schema ───────────
-- Rename existing table if it exists in public schema
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'edu_student_states'
  ) THEN
    ALTER TABLE public.edu_student_states SET SCHEMA edu;
    ALTER TABLE edu.edu_student_states RENAME TO student_states;
    RAISE NOTICE 'Moved edu_student_states → edu.student_states';
  ELSE
    -- Create fresh in the right place
    CREATE TABLE IF NOT EXISTS edu.student_states (
      agent_id   UUID PRIMARY KEY,
      state      JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    RAISE NOTICE 'Created edu.student_states';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_edu_student_states_updated
  ON edu.student_states(updated_at DESC);

-- Drop old public index if it survived the rename
DROP INDEX IF EXISTS idx_edu_student_states_updated;

-- ─── Fix 2: Bridge xp_ledger → xp_transactions via trigger ───
-- When the battle module writes to xp_ledger, the trigger
-- automatically mirrors the row into xp_transactions so the
-- ranking module sees all XP including battle earnings.
-- source mapping: battle_win/battle_correct/battle_streak → battle_xp

CREATE OR REPLACE FUNCTION sync_xp_ledger_to_transactions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO xp_transactions (
    user_id,
    course_id,
    classroom_id,
    reason,
    amount,
    metadata,
    created_at
  )
  SELECT
    NEW.user_id,
    -- Look up course_id from the battle reference
    b.course_id,
    NULL,
    NEW.source,
    NEW.amount,
    jsonb_build_object(
      'source',       NEW.source,
      'reference_id', NEW.reference_id,
      'agent_id',     NEW.agent_id,
      'from',         'xp_ledger_sync'
    ),
    NEW.created_at
  FROM battles b
  WHERE b.id = NEW.reference_id
  ON CONFLICT DO NOTHING;

  -- Fallback: if no battle found (e.g. other ledger sources), still insert
  IF NOT FOUND THEN
    INSERT INTO xp_transactions (
      user_id, reason, amount, metadata, created_at
    ) VALUES (
      NEW.user_id,
      NEW.source,
      NEW.amount,
      jsonb_build_object(
        'source',       NEW.source,
        'reference_id', NEW.reference_id,
        'agent_id',     NEW.agent_id,
        'from',         'xp_ledger_sync'
      ),
      NEW.created_at
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_xp_ledger ON xp_ledger;
CREATE TRIGGER trg_sync_xp_ledger
  AFTER INSERT ON xp_ledger
  FOR EACH ROW
  EXECUTE FUNCTION sync_xp_ledger_to_transactions();

-- ─── Fix 3: Merge leaderboard_cache into xp_leaderboard ───────
-- Strategy:
--   1. Add battle columns to xp_leaderboard
--   2. Expand scope CHECK to include 'battle_course'
--   3. Migrate existing leaderboard_cache rows into xp_leaderboard
--   4. Drop leaderboard_cache
--   5. Update indexes

-- Step 3a: Add battle stats columns to xp_leaderboard
ALTER TABLE xp_leaderboard
  ADD COLUMN IF NOT EXISTS battles_won    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battles_played INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_rate       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_ref_id   UUID;        -- replaces leaderboard_cache.scope_id

-- Step 3b: Widen the scope CHECK to cover battle scopes
ALTER TABLE xp_leaderboard
  DROP CONSTRAINT IF EXISTS xp_leaderboard_scope_check;

ALTER TABLE xp_leaderboard
  ADD CONSTRAINT xp_leaderboard_scope_check
  CHECK (scope IN ('course', 'classroom', 'global', 'battle_course'));

-- Step 3c: Migrate data from leaderboard_cache
INSERT INTO xp_leaderboard (
  user_id, scope, scope_ref_id, total_xp,
  rank, battles_won, battles_played, win_rate, updated_at
)
SELECT
  user_id,
  'battle_course',
  scope_id,
  total_xp,
  rank,
  battles_won,
  battles_played,
  win_rate,
  last_computed_at
FROM leaderboard_cache
ON CONFLICT (user_id, scope, course_id, classroom_id)
DO UPDATE SET
  battles_won    = EXCLUDED.battles_won,
  battles_played = EXCLUDED.battles_played,
  win_rate       = EXCLUDED.win_rate,
  total_xp       = GREATEST(xp_leaderboard.total_xp, EXCLUDED.total_xp),
  updated_at     = now();

-- Step 3d: Drop leaderboard_cache now that data is migrated
DROP TABLE IF EXISTS leaderboard_cache;
DROP INDEX IF EXISTS idx_leaderboard_scope;

-- Step 3e: Add new index for battle scope queries
CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_battle
  ON xp_leaderboard(scope_ref_id, total_xp DESC)
  WHERE scope = 'battle_course';

CREATE INDEX IF NOT EXISTS idx_xp_leaderboard_scope_ref
  ON xp_leaderboard(scope_ref_id, scope);

-- ─── Fix 4: Confirm edu schema created before its tables ──────
-- The CREATE SCHEMA is already at line 961 (Part 4 header).
-- This is a safety re-run — harmless if schema already exists.
CREATE SCHEMA IF NOT EXISTS edu;

-- ─── Summary comment ─────────────────────────────────────────
-- After this patch:
--   edu_student_states  → edu.student_states          (Fix 1)
--   xp_ledger INSERT    → also writes xp_transactions  (Fix 2)
--   leaderboard_cache   → merged into xp_leaderboard   (Fix 3)
--   edu schema          → confirmed created first       (Fix 4)
--
-- Final table count: 78 (79 - 1 dropped leaderboard_cache)
-- Schemas: public (62 tables), edu (16 tables)

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION PATCH 2: Missing endpoint columns
-- Adds system_prompt + personality to user_agents
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_agents
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS personality   TEXT;

-- Ensure task_status enum includes 'pending' for toggle-undone
-- (already included at creation — this is a safety no-op)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'task_status')
  ) THEN
    ALTER TYPE task_status ADD VALUE 'pending';
  END IF;
END $$;

-- Invite tokens are JWT-signed (no table needed)
-- Live session recording_url already exists (line 185 of migration)
-- refund_window_days already exists on courses table

-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION PATCH 3: Adaptive teaching sessions
-- Two new tables for the "human teaches student AI agent" phase engine
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS edu.adaptive_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_agent_id         UUID REFERENCES public.user_agents(id),
  topic                    TEXT NOT NULL,
  subject                  TEXT NOT NULL,
  subtopics                JSONB NOT NULL DEFAULT '[]',
  objectives               JSONB NOT NULL DEFAULT '{}',
  current_subtopic_idx     INTEGER NOT NULL DEFAULT 0,
  current_phase            TEXT    NOT NULL DEFAULT '1',  -- '1'|'2'|'3'|'4'|'assessment'|'complete'
  status                   TEXT    NOT NULL DEFAULT 'configured'
                             CHECK (status IN ('configured','active','complete','blocked','abandoned')),
  session_history          JSONB   NOT NULL DEFAULT '[]',
  objectives_covered       JSONB   NOT NULL DEFAULT '{}',
  confidence_by_subtopic   JSONB   NOT NULL DEFAULT '{}',
  assessment_state         JSONB,                          -- current Sargeant gate state
  teacher_agent_id         UUID,                           -- optional trained guide agent
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_sessions_student
  ON edu.adaptive_sessions(student_id);

CREATE INDEX IF NOT EXISTS idx_adaptive_sessions_status
  ON edu.adaptive_sessions(status);

CREATE TABLE IF NOT EXISTS edu.session_phase_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES edu.adaptive_sessions(id) ON DELETE CASCADE,
  subtopic_idx      INTEGER  NOT NULL,
  subtopic          TEXT     NOT NULL,
  phase             TEXT     NOT NULL,   -- '1'|'2'|'3'|'4'|'assessment'
  confidence_start  FLOAT    DEFAULT 0,
  confidence_end    FLOAT,
  gaps_covered      JSONB    DEFAULT '[]',
  objectives_met    JSONB    DEFAULT '[]',
  assessment_score  FLOAT,
  passed            BOOLEAN,
  completed_at      TIMESTAMPTZ,
  UNIQUE (session_id, subtopic_idx, phase)
);

CREATE INDEX IF NOT EXISTS idx_session_phase_session
  ON edu.session_phase_progress(session_id);

-- Row-level security: students can only read their own sessions
ALTER TABLE edu.adaptive_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY adaptive_sessions_owner ON edu.adaptive_sessions
  FOR ALL USING (student_id = auth.uid());

ALTER TABLE edu.session_phase_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_phase_owner ON edu.session_phase_progress
  FOR ALL USING (
    session_id IN (
      SELECT id FROM edu.adaptive_sessions WHERE student_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION PATCH 4: Rename default guide from nana-sargeant to nana-esumai
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE edu.user_agent_preferences
  ALTER COLUMN default_pair_id SET DEFAULT 'nana-esumai';

-- Update any existing rows that still reference deleted agents
UPDATE edu.user_agent_preferences
  SET default_pair_id = 'nana-esumai', updated_at = now()
  WHERE default_pair_id IN ('nana-sargeant', 'professor-warden');

-- Remove deleted agent IDs from purchased_agents arrays.
-- (purchased_agents is uuid[]; the legacy IDs are non-uuid pair strings,
--  so this is defensive. Written with unnest/ARRAY() instead of a
--  text[]->uuid[] round-trip cast, which some SQL editors mis-parse.)
UPDATE edu.user_agent_preferences
  SET purchased_agents = ARRAY(
        SELECT a FROM unnest(purchased_agents) AS a
        WHERE a::text NOT IN ('nana-sargeant', 'professor-warden')
      )
  WHERE EXISTS (
        SELECT 1 FROM unnest(purchased_agents) AS a
        WHERE a::text IN ('nana-sargeant', 'professor-warden')
      );

-- ── Auth hardening: refresh tokens + jti deny-list ──────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti        UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family     UUID NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user   ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Automatically clean expired revoked tokens daily
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens (expires_at);

-- ── Settings: extended user profile columns ───────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_type       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS year_group        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS study_level       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language          TEXT NOT NULL DEFAULT 'English';
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_mode      TEXT NOT NULL DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color      TEXT NOT NULL DEFAULT '#6C3BFF';
ALTER TABLE users ADD COLUMN IF NOT EXISTS teaching_guide    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guide_emoji       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects          TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN NOT NULL DEFAULT false;

-- ── Account lifecycle: deactivate (reversible) / delete (right-to-erasure) ─────
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;

-- ── Settings: extended agent profile columns ──────────────────────────────────

ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS personality    TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS exam_board     TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS subjects       TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS goal           TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS level          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS total_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS total_turns    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS knowledge_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS photo_url      TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS year_group     TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS study_level    TEXT;
