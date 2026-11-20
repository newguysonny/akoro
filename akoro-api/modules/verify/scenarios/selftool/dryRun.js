// Self-tooling dry runs: the agent builds (or refuses to build) a tool from chat.
import { needCreate } from "./shared.js";

export async function runAgentBuildsTool(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const year = String(new Date().getUTCFullYear());
    const sessions = (await ctx.db.rows("edu.adaptive_sessions", { student_id: me.id }, { columns: "started_at, completed_at" }))
      .filter((r) => r.started_at && r.completed_at && String(r.started_at).startsWith(year));
    const turn = await ctx.agent.chat({ as: p.learner, model: p.model,
      // No existing tool totals session time — it needs a new one.
      prompt: "How many hours did my learning sessions take in total each month this year? Work it out for me." });
    ctx.expect.eq("turn answered", turn.status, 200);
    // The agent may retry after a rejection — judge its last build.
    const built = (turn.tools || []).filter((t) => t.tool === "create_tool").at(-1);
    ctx.expect.ok("agent called create_tool", !!built, (turn.tools || []).map((t) => t.tool));
    ctx.expect.eq("tool built and verified", built?.result?.status, "created");
    const rows = built?.result?.result?.rows || [];
    if (sessions.length) ctx.expect.gte("tool returned this learner's months", rows.length, 1);
    // The tool's total (any numeric column, in minutes or hours) must equal the database's.
    const minutes = sessions.reduce((n, r) => n + Math.round((Date.parse(r.completed_at) - Date.parse(r.started_at)) / 60_000), 0);
    const got = rows.reduce((n, r) => n + Object.entries(r).filter(([k, v]) => typeof v === "number" && !/count|year|month/i.test(k)).reduce((a, [, v]) => a + v, 0), 0);
    ctx.expect.ok("total matches the database (minutes or hours)", Math.abs(got - minutes) <= 1 || Math.abs(got - minutes / 60) <= 0.05, { got, minutes });
    ctx.note(`${sessions.length} finished sessions this year in the database, ${minutes} minutes`);
    ctx.expect.noBackendNames("reply has no backend names", turn.reply);
    ctx.expect.loopHealthy(turn);
}

export async function runAgentEscalates(ctx, p) {
    await needCreate(ctx);
    const { capabilityStatus } = await import("../../../self-tooling/index.js");
    if ((await capabilityStatus("battles.class_results")) === "enabled") ctx.expect.blocked("battles.class_results is granted on this server — nothing to escalate");
    const me = await ctx.as(p.learner);
    const before = await ctx.db.count("edu.agent_tool_requests", { requester_id: me.id });
    const turn = await ctx.agent.chat({ as: p.learner, model: p.model,
      prompt: "In the battles I played, how did the other players score compared to me?" });
    ctx.expect.eq("turn answered", turn.status, 200);
    const built = (turn.tools || []).filter((t) => t.tool === "create_tool").at(-1);
    ctx.expect.ok("agent called create_tool", !!built, (turn.tools || []).map((t) => t.tool));
    ctx.expect.eq("create_tool escalated", built?.result?.status, "escalated");
    ctx.expect.ok("reply says it needs permission", /permission|admin|approv/i.test(turn.reply || ""), (turn.reply || "").slice(0, 200));
    ctx.expect.noBackendNames("reply has no backend names", turn.reply);
    ctx.expect.eq("dry run made no request", await ctx.db.count("edu.agent_tool_requests", { requester_id: me.id }), before);
    ctx.expect.loopHealthy(turn);
}

export async function runCodeToolBuilt(ctx, p) {
    await needCreate(ctx);
    const { codeEnabled } = await import("../../../self-tooling/index.js");
    if (!codeEnabled()) ctx.expect.blocked("AKORO_SELF_TOOLING_CODE_ENABLED is off on this server");
    const exam = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "dry", input: {
      goal: `Spread my weak topics over the days until my exam on ${exam}: two topics a day, weakest first, skipping Sundays`,
      name: "weak_topic_plan", label: "Weak-topic plan", run: {} } });
    ctx.expect.eq("created", r?.status, "created");
    ctx.note(`mode ${r?.mode}; ${JSON.stringify(r?.definition || null).slice(0, 400)}`);
    ctx.expect.eq("built as code (recipes and specs can't schedule)", r?.mode, "code");
    const rows = r?.result?.rows || [];
    ctx.expect.gte("plan has days", rows.length, 1);
    const perDay = new Map();
    for (const row of rows) {
      const d = String(row.date || row.day || "");
      perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    ctx.expect.ok("every row has a date", rows.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || x.day || ""))), rows.slice(0, 3));
    ctx.expect.ok("at most two topics a day", [...perDay.values()].every((n) => n <= 2), Object.fromEntries(perDay));
    ctx.expect.ok("no Sundays", [...perDay.keys()].every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0), [...perDay.keys()]);
    ctx.expect.ok("all before the exam", [...perDay.keys()].every((d) => d < exam), exam);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    ctx.expect.ok("none in the past", [...perDay.keys()].every((d) => d >= today), today);
    // Weakest first: confidence never goes down along the plan (when rows carry it, else via the learner's topics).
    const me = await ctx.as(p.learner);
    const conf = new Map();
    const { data: agent } = await (await import("../../../../db.js")).default.schema("edu").from("student_agents").select("id").eq("student_id", me.id).maybeSingle();
    if (agent?.id) for (const k of await ctx.db.rows("edu.agent_knowledge", { agent_id: agent.id }, { columns: "topic, confidence" })) conf.set(String(k.topic).toLowerCase(), Number(k.confidence));
    const seq = rows.map((x) => conf.get(String(x.topic || "").toLowerCase())).filter((c) => Number.isFinite(c));
    if (seq.length >= 2) ctx.expect.ok("weakest first", seq.every((c, i) => i === 0 || c >= seq[i - 1] - 1e-9), seq);
}
