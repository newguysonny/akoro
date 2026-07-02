-- =============================================================
-- 2026-seed-mgmt-3.sql
-- Demo data for Facilities & Services. Run AFTER 2026-mgmt-schema-3.sql.
-- Idempotent.
-- =============================================================

DO $$
DECLARE
  v_school uuid; v_cat uuid; v_book uuid; v_item uuid; v_sup uuid;
  v_vehicle uuid; v_hostel uuid; v_rt uuid; v_room uuid; v_hc uuid; v_ac uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping.'; RETURN; END IF;

  -- Library
  INSERT INTO mgmt.book_categories (school_id, name)
  SELECT v_school, c FROM unnest(ARRAY['Fiction','Science','Reference']) c
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.book_categories WHERE school_id = v_school AND name = c);
  IF NOT EXISTS (SELECT 1 FROM mgmt.books WHERE school_id = v_school) THEN
    SELECT id INTO v_cat FROM mgmt.book_categories WHERE school_id = v_school AND name = 'Fiction';
    INSERT INTO mgmt.books (school_id, title, author, isbn, category_id, copies_total, copies_available, shelf)
    VALUES (v_school, 'Things Fall Apart', 'Chinua Achebe', '9780385474542', v_cat, 8, 8, 'A1'),
           (v_school, 'New School Physics', 'M.W. Anyakoha', '9789785447705', (SELECT id FROM mgmt.book_categories WHERE school_id = v_school AND name = 'Science'), 5, 5, 'B3');
  END IF;

  -- Inventory
  INSERT INTO mgmt.item_categories (school_id, name)
  SELECT v_school, c FROM unnest(ARRAY['Stationery','Uniforms','Cleaning']) c
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.item_categories WHERE school_id = v_school AND name = c);
  INSERT INTO mgmt.inventory_suppliers (school_id, name, phone)
  SELECT v_school, 'Lagos Book Depot', '+2348012340000'
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.inventory_suppliers WHERE school_id = v_school);
  IF NOT EXISTS (SELECT 1 FROM mgmt.inventory_items WHERE school_id = v_school) THEN
    SELECT id INTO v_cat FROM mgmt.item_categories WHERE school_id = v_school AND name = 'Stationery';
    INSERT INTO mgmt.inventory_items (school_id, name, unit, category_id, quantity, reorder_level, unit_price)
    VALUES (v_school, 'Exercise Books (80 leaves)', 'pcs', v_cat, 240, 50, 450),
           (v_school, 'Whiteboard Markers', 'pcs', v_cat, 60, 20, 300);
  END IF;

  -- Transport
  IF NOT EXISTS (SELECT 1 FROM mgmt.vehicles WHERE school_id = v_school) THEN
    INSERT INTO mgmt.vehicles (school_id, plate_no, model, capacity, driver_name, driver_phone)
    VALUES (v_school, 'LAG-234-XY', 'Toyota Coaster', 30, 'Mr. Sunday Adewale', '+2348098765432')
    RETURNING id INTO v_vehicle;
    INSERT INTO mgmt.transport_routes (school_id, name, start_point, end_point, fare, vehicle_id)
    VALUES (v_school, 'Route 1 — Ikeja Axis', 'Ikeja Bus Stop', 'School Gate', 15000, v_vehicle);
    INSERT INTO mgmt.vehicle_locations (school_id, vehicle_id, location, note)
    VALUES (v_school, v_vehicle, 'Allen Avenue Junction', 'Morning pickup run');
  END IF;

  -- Hostel
  IF NOT EXISTS (SELECT 1 FROM mgmt.hostels WHERE school_id = v_school) THEN
    INSERT INTO mgmt.hostels (school_id, name, hostel_type, warden_name)
    VALUES (v_school, 'Unity Hall', 'boys', 'Mr. Peter Obiora') RETURNING id INTO v_hostel;
    INSERT INTO mgmt.room_types (school_id, name, capacity, cost_per_term)
    VALUES (v_school, 'Standard (4-bed)', 4, 60000) RETURNING id INTO v_rt;
    INSERT INTO mgmt.hostel_rooms (school_id, hostel_id, room_type_id, room_no, capacity)
    VALUES (v_school, v_hostel, v_rt, 'U-101', 4);
  END IF;

  -- Help Center
  IF NOT EXISTS (SELECT 1 FROM mgmt.help_categories WHERE school_id = v_school) THEN
    INSERT INTO mgmt.help_categories (school_id, name) VALUES (v_school, 'Getting Started') RETURNING id INTO v_hc;
    INSERT INTO mgmt.help_articles (school_id, category_id, title, body)
    VALUES (v_school, v_hc, 'How to admit a new student',
      'Go to Student Information → Student Admission, fill in the admission form and save. The student immediately appears in the Student List and attendance registers.');
  END IF;

  -- Assets
  IF NOT EXISTS (SELECT 1 FROM mgmt.asset_categories WHERE school_id = v_school) THEN
    INSERT INTO mgmt.asset_categories (school_id, name) VALUES (v_school, 'Electronics') RETURNING id INTO v_ac;
    INSERT INTO mgmt.assets (school_id, name, asset_tag, category_id, purchase_cost, purchase_date, depreciation_rate, location)
    VALUES (v_school, 'Projector — Epson EB-X06', 'AST-0001', v_ac, 350000, CURRENT_DATE - 400, 20, 'Staff Room'),
           (v_school, '25KVA Generator', 'AST-0002', v_ac, 4200000, CURRENT_DATE - 800, 10, 'Generator House');
  END IF;

  -- Communicate
  INSERT INTO mgmt.notices (school_id, title, body, audience, pinned)
  SELECT v_school, 'Resumption Date', 'School resumes on 8th September 2026. All fees must be paid before resumption.', 'all', true
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.notices WHERE school_id = v_school);
  INSERT INTO mgmt.school_events (school_id, title, event_type, starts_on)
  SELECT v_school, 'Independence Day', 'holiday', '2026-10-01'
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.school_events WHERE school_id = v_school);

  -- Certificates
  INSERT INTO mgmt.certificate_templates (school_id, name, description, body)
  SELECT v_school, 'Certificate of Completion', 'End-of-session certificate',
    'This certifies that {{recipient_name}} has successfully completed the academic session at {{school_name}}. Issued on {{date}}. Serial: {{serial_no}}.'
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.certificate_templates WHERE school_id = v_school);

  RAISE NOTICE 'Seeded mgmt batch 3 for school_id=%', v_school;
END $$;
