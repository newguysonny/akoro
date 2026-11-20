/**
 * lib/bootLog.js — the startup banner and the last-migration echo
 * (Phase 19 step 4). app.js calls these from inside the listen callback, so the
 * listener still opens before either one touches the database.
 */

/** Print the module/route banner the operator sees on every boot. */
export function printStartBanner(config) {
  console.log(`
[API]  Akoro API  [${config.instanceId.slice(0, 8)}]  --  http://localhost:${config.server.port}

[MODULES]
    /api/auth/*           Auth
    /api/courses/*        Courses + Cart + Payments + Live Sessions
    /api/ranking/*        XP Leaderboards
    /api/profiles/*       Teachers / Classrooms / Schools
    /api/adaptive/*       AI Teaching Agents (NaNa, Professor, Trained)
    /api/battle/*         1v1 / Open / Classroom / Session Battles
    /api/tasks/*          Teacher AI Task Agent

[ENDPOINTS]
    /api/profiles/instructor/students    global student list
    /api/profiles/teacher/invite         magic invite link
    /api/profiles/invite/:token          invite preview (public) · POST /invite/redeem joins
    /api/profiles/teacher/students/import CSV bulk import
    /api/profiles/students/:id           edit + message student
    /api/battle/instructor/stats         battle dashboard stats
    /api/battle/battles/:id   PUT        edit battle
    /api/battle/courses/:id/battles/session  session-scoped battle
    /api/live-sessions/:id/replay        recording playback
    /api/adaptive/training/stream/*      live device training

[SOCKET.IO]  (Redis adapter)
    session:<id>  chat:<id>  classroom:<id>  battle:<id>  user:<id>

[HEALTH]  /health  /ready
  `);
}

/**
 * Best-effort: show the last DB migration run so deploys are verifiable from
 * the API's own boot log (never blocks startup).
 */
export function logLastMigration(db) {
  return db.schema("edu")
    .from("migration_log")
    .select("run_group, applied, failed, git_sha, ran_at")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      if (!data) return console.log("[MIGRATIONS]  no runs recorded yet (run `npm run db:deploy`).");
      const sha = data.git_sha ? ` @ ${String(data.git_sha).slice(0, 7)}` : "";
      console.log(`[MIGRATIONS]  last run ${data.ran_at} -- ${data.run_group}, ${data.applied} applied${data.failed ? `, ${data.failed} failed` : ""}${sha}`);
    })
    .catch(() => { /* table may not exist yet — ignore */ });
}
