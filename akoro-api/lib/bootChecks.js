// Boot-time assertions for the server. Imported by app.js only.
//
// db.js is lazy so tests and barrels can import it without credentials; the
// server therefore fails fast here, where the check belongs.
import config from "../config/index.js";

if (!config.supabase.url || !config.supabase.serviceKey) {
  console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env");
  process.exit(1);
}
