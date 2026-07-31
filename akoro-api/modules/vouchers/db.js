/**
 * modules/vouchers/db.js
 * ─────────────────────────────────────────────────────────────
 * DECOUPLING BOUNDARY: this is the ONLY file in the module that touches the
 * shared Akoro Postgres client. Every other file in modules/vouchers/ imports
 * FROM HERE, never from "../../db.js" directly, and never reaches into any
 * other Akoro module.
 *
 * To extract this module into its own service: point `vdb` at a standalone
 * Postgres connection (Supabase or otherwise), `pg_dump --schema=vouchers`
 * the schema across, and nothing else in this folder has to change — the rest
 * of the module only ever calls db.schema("vouchers")....
 *
 * The one deliberate exception is public.users(id) — every FK in the schema
 * points at it because agents/startup-owners ARE Akoro users. If you split
 * this into a truly independent service, replace that FK with your own users
 * table and this module keeps working unchanged everywhere else.
 */
import db from "../../db.js";

export const vdb = () => db.schema("vouchers");
export default db;
