// Placeholder settings for unit tests that import modules reaching db.js /
// the AI client: those exit at load without them. Import FIRST in a test file
// (ES imports run in order). Nothing is called on them; real values win.
process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
