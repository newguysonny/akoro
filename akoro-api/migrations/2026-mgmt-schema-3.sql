-- =============================================================
-- 2026-mgmt-schema-3.sql
-- Third mgmt batch — FACILITIES & SERVICES: Study Center, Certificates,
-- Communicate, Library, Inventory, Transport, Hostel, Help Center,
-- Asset Management. Run AFTER 2026-mgmt-schema-2.sql. Idempotent.
-- =============================================================

-- ═════════════════════ STUDY CENTER ════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.syllabus_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  term text, topic text NOT NULL, description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','covered'))
);
CREATE TABLE IF NOT EXISTS mgmt.classwork_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  teacher_id uuid, log_date date NOT NULL DEFAULT CURRENT_DATE,
  topic text NOT NULL, notes text
);
CREATE TABLE IF NOT EXISTS mgmt.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  resource_type text NOT NULL DEFAULT 'document' CHECK (resource_type IN ('document','video','link')),
  url text, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.homework_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  title text NOT NULL, description text, due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.live_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  platform text, meeting_url text, starts_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended'))
);

-- ═════════════════════ CERTIFICATES ════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.certificate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, description text,
  body text NOT NULL DEFAULT '',                     -- supports {{recipient_name}}, {{school_name}}, {{date}}, {{serial_no}}
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  template_id uuid REFERENCES mgmt.certificate_templates(id) ON DELETE SET NULL,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  serial_no text NOT NULL, issued_on date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (school_id, serial_no)
);

-- ═════════════════════ COMMUNICATE ═════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, body text,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','staff','parents')),
  publish_on date NOT NULL DEFAULT CURRENT_DATE, expires_on date, pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, description text,
  event_type text NOT NULL DEFAULT 'event' CHECK (event_type IN ('event','holiday')),
  starts_on date NOT NULL DEFAULT CURRENT_DATE, ends_on date
);
CREATE TABLE IF NOT EXISTS mgmt.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, message text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','sms','email','whatsapp')),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','staff','parents')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, image_url text, album text, taken_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════ LIBRARY ═══════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.book_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, author text, isbn text, shelf text,
  category_id uuid REFERENCES mgmt.book_categories(id) ON DELETE SET NULL,
  copies_total integer NOT NULL DEFAULT 1, copies_available integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS mgmt.book_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES mgmt.books(id) ON DELETE CASCADE,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  borrower_name text,
  issued_on date NOT NULL DEFAULT CURRENT_DATE, due_on date, returned_on date,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','returned'))
);

-- ═══════════════════════ INVENTORY ═════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, unit text DEFAULT 'pcs',
  category_id uuid REFERENCES mgmt.item_categories(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0, reorder_level numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.inventory_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, phone text, email text, address text, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES mgmt.inventory_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0, unit_cost numeric NOT NULL DEFAULT 0,
  supplier_id uuid REFERENCES mgmt.inventory_suppliers(id) ON DELETE SET NULL,
  received_on date NOT NULL DEFAULT CURRENT_DATE, note text
);
CREATE TABLE IF NOT EXISTS mgmt.item_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES mgmt.inventory_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0, issued_to text, purpose text,
  issued_on date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE IF NOT EXISTS mgmt.pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES mgmt.inventory_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0, buyer text,
  sold_on date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE IF NOT EXISTS mgmt.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  supplier_id uuid REFERENCES mgmt.inventory_suppliers(id) ON DELETE SET NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  ordered_on date NOT NULL DEFAULT CURRENT_DATE, UNIQUE (school_id, order_no)
);
CREATE TABLE IF NOT EXISTS mgmt.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  purchase_order_id uuid REFERENCES mgmt.purchase_orders(id) ON DELETE SET NULL,
  received_on date NOT NULL DEFAULT CURRENT_DATE, note text
);
CREATE TABLE IF NOT EXISTS mgmt.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES mgmt.inventory_suppliers(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0, method text DEFAULT 'bank', reference text,
  paid_on date NOT NULL DEFAULT CURRENT_DATE
);

-- ═══════════════════════ TRANSPORT ═════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  plate_no text NOT NULL, model text, capacity integer NOT NULL DEFAULT 0,
  driver_name text, driver_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  UNIQUE (school_id, plate_no)
);
CREATE TABLE IF NOT EXISTS mgmt.transport_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, start_point text, end_point text, fare numeric NOT NULL DEFAULT 0,
  vehicle_id uuid REFERENCES mgmt.vehicles(id) ON DELETE SET NULL,
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.vehicle_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES mgmt.vehicles(id) ON DELETE CASCADE,
  location text NOT NULL, note text,
  reported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mgmt_vehicle_locations ON mgmt.vehicle_locations (school_id, vehicle_id, reported_at DESC);

-- ═════════════════════════ HOSTEL ══════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.hostels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  hostel_type text NOT NULL DEFAULT 'mixed' CHECK (hostel_type IN ('boys','girls','mixed')),
  warden_name text, warden_phone text, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, capacity integer NOT NULL DEFAULT 4, cost_per_term numeric NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.hostel_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  hostel_id uuid REFERENCES mgmt.hostels(id) ON DELETE CASCADE,
  room_type_id uuid REFERENCES mgmt.room_types(id) ON DELETE SET NULL,
  room_no text NOT NULL, capacity integer NOT NULL DEFAULT 4,
  UNIQUE (hostel_id, room_no)
);
CREATE TABLE IF NOT EXISTS mgmt.hostel_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES mgmt.hostel_rooms(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  allocated_on date NOT NULL DEFAULT CURRENT_DATE, vacated_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','vacated'))
);

-- ═══════════════════════ HELP CENTER ═══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.help_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  category_id uuid REFERENCES mgmt.help_categories(id) ON DELETE SET NULL,
  title text NOT NULL, body text, published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════ ASSET MANAGEMENT ══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, asset_tag text NOT NULL,
  category_id uuid REFERENCES mgmt.asset_categories(id) ON DELETE SET NULL,
  purchase_cost numeric NOT NULL DEFAULT 0, purchase_date date,
  depreciation_rate numeric NOT NULL DEFAULT 10,   -- % straight-line per year
  location text,
  status text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','in_store','maintenance','disposed')),
  UNIQUE (school_id, asset_tag)
);
CREATE TABLE IF NOT EXISTS mgmt.asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES mgmt.assets(id) ON DELETE CASCADE,
  assigned_to text NOT NULL, assigned_on date NOT NULL DEFAULT CURRENT_DATE,
  returned_on date, note text
);
CREATE TABLE IF NOT EXISTS mgmt.asset_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES mgmt.assets(id) ON DELETE CASCADE,
  maintenance_type text, cost numeric NOT NULL DEFAULT 0,
  performed_on date NOT NULL DEFAULT CURRENT_DATE, note text
);
CREATE TABLE IF NOT EXISTS mgmt.asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES mgmt.assets(id) ON DELETE CASCADE,
  disposal_type text NOT NULL DEFAULT 'sold' CHECK (disposal_type IN ('sold','scrapped','donated')),
  amount numeric NOT NULL DEFAULT 0, disposed_on date NOT NULL DEFAULT CURRENT_DATE, note text
);
CREATE TABLE IF NOT EXISTS mgmt.asset_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  audit_date date NOT NULL DEFAULT CURRENT_DATE, auditor text, findings text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
