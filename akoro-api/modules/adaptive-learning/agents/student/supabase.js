// =============================================================
// agents/student/supabase.js — the lazy edu-schema client shared by the
// student-agent knowledge files.
//
// Lazy: a barrel re-export must not build the client (or throw) in a test env.
// =============================================================

import { createClient } from "@supabase/supabase-js";

let _supabase = null;
export const supabase = new Proxy({}, { get(_, p) {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY);
  const v = _supabase[p];
  return typeof v === "function" ? v.bind(_supabase) : v;
} });
