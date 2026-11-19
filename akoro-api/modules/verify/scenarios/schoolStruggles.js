// Phase 11 UI backends: the school's view of its learners' struggles (D39) and
// the chat's model picker (§7.11.5). Read-only: GETs and evidence reads; the
// support flag is never opened here (that writes the access log).
import { SENSITIVE_TYPES } from "../../../lib/struggleTypes.js";
import { modelRegistry } from "../../../lib/modelRegistry.js";

const PATH = "/api/school/mgmt/learning/struggles";

export const schoolStrugglesScope = {
  name: "school.struggles_scope", area: "security", risk: "read",
  description: "The school admin (school@demo.akoro.app) reads its learners' struggles: every learner shown is a LINKED active student of that school, no sensitive type appears (only the may-need-support flag), and an unlinked student's support detail is 404. A demo teacher sees only the classes they teach (or none); a learner is refused (403).",
  params: { admin: { default: "@demo_school_admin" }, teacher: { default: "@demo_teacher1" }, learner: { default: "@tester01" } },
  async run(ctx, p) {
    const admin = await ctx.as(p.admin);
    const r = await ctx.http({ as: p.admin, path: PATH });
    if (r.status === 404) ctx.expect.blocked(`${p.admin} has no school on this server (${r.body?.error || 404})`);
    ctx.expect.status("school admin reads the struggles view", r, 200);
    const view = r.body?.data || {};
    const [school] = await ctx.db.rows("school_profiles", { admin_user_id: admin.id }, { columns: "id", limit: 1 });
    ctx.expect.ok("the admin's school found", !!school);
    const students = school ? await ctx.db.rows("mgmt.students", { school_id: school.id, status: "active" }, { columns: "id, user_id, class_id", limit: 2000 }) : [];
    const linked = new Set(students.filter((s) => s.user_id).map((s) => s.id));
    const unlinked = students.filter((s) => !s.user_id);
    const shown = (view.learners || []).map((l) => l.studentId);
    ctx.expect.ok("every learner shown is a linked student of this school", shown.every((id) => linked.has(id)), shown.filter((id) => !linked.has(id)));
    const types = (view.learners || []).flatMap((l) => [...(l.open || []), ...(l.resolved || [])].map((i) => i.type))
      .concat((view.classes || []).flatMap((c) => (c.topTypes || []).map((t) => t.type)));
    ctx.expect.ok("no sensitive type is shown (only the flag)", !types.some((t) => SENSITIVE_TYPES.includes(t)), types.filter((t) => SENSITIVE_TYPES.includes(t)));
    const totalUnlinked = (view.classes || []).reduce((n, c) => n + (c.unlinked || 0), 0);
    ctx.expect.eq("class totals count the unlinked students without data", totalUnlinked, unlinked.filter((s) => (view.classes || []).some((c) => c.classId === s.class_id)).length);
    ctx.note(`${(view.classes || []).length} classes · ${shown.length} learners with something to show · ${types.length} struggles`);
    if (unlinked[0]) ctx.expect.status("an unlinked student's support detail is 404", await ctx.http({ as: p.admin, path: `${PATH}/${unlinked[0].id}/support` }), 404);
    else ctx.note("no unlinked student in this school — that check skipped");

    const t = await ctx.http({ as: p.teacher, path: PATH });
    if (t.status === 404) ctx.note(`${p.teacher} isn't approved into a school here — teacher checks skipped`);
    else {
      ctx.expect.status("a teacher reads the view", t, 200);
      const teacher = await ctx.as(p.teacher);
      const [ct, cs] = await Promise.all([
        ctx.db.rows("mgmt.class_teachers", { teacher_id: teacher.id }, { columns: "class_id", limit: 200 }),
        ctx.db.rows("mgmt.class_subjects", { teacher_id: teacher.id }, { columns: "class_id", limit: 200 }),
      ]);
      const mine = new Set([...ct, ...cs].map((x) => x.class_id));
      const classes = (t.body?.data?.classes || []).map((c) => c.classId);
      ctx.expect.ok("a teacher sees only the classes they teach", classes.every((id) => mine.has(id)), classes.filter((id) => !mine.has(id)));
      const notMine = (view.classes || []).find((c) => !mine.has(c.classId));
      if (notMine) ctx.expect.status("a class they don't teach is refused", await ctx.http({ as: p.teacher, path: `${PATH}?class_id=${notMine.classId}` }), 403);
    }
    ctx.expect.status("a learner is refused", await ctx.http({ as: p.learner, path: PATH }), 403);
  },
};

export const modelPickerResolution = {
  name: "models.picker_resolution", area: "chat", risk: "read",
  description: "GET /api/adaptive/chat/models says whether the picker (AI_MODEL_PICKER_ENABLED) is on and lists each model with its cost against the default (the default 1×, no internals); grading and evidence stay on their locked model whatever the learner picks.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const r = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/models" });
    ctx.expect.status("the models list answers", r, 200);
    const picker = r.body?.picker;
    ctx.expect.ok("it says whether the picker is on", typeof picker?.enabled === "boolean", picker);
    const models = r.body?.models || [];
    const def = models.find((m) => m.default);
    ctx.expect.eq("the default is the server's default", def?.id, picker?.defaultId);
    ctx.expect.eq("the default costs 1×", def?.costMultiple, 1);
    ctx.expect.ok("no API model names or keys go to the browser", models.every((m) => !("apiModel" in m) && !("apiKeyEnv" in m)));
    ctx.expect.ok("an available model has its cost hint (or is the default)", models.filter((m) => m.available && !m.default).every((m) => m.costHint || m.costMultiple != null));
    for (const choice of models.filter((m) => m.available).map((m) => m.id).slice(0, 3)) {
      ctx.expect.eq(`assessor stays locked with "${choice}" picked`, modelRegistry.resolve({ role: "assessor", learnerChoice: choice }).source, "locked");
    }
    ctx.note(`picker ${picker?.enabled ? "on" : "off"} · ${models.filter((m) => m.available).length} of ${models.length} models usable here`);
  },
};
