/**
 * aiConcierge.js — the role-aware school AI assistant (concierge).
 *
 * ONE chat, audience-scoped tools + context:
 *   • guest   (public, by host) — Admissions Counselor: answer tuition/aid
 *     questions, book a campus tour, capture a lead.
 *   • parent  (guardian_email)  — Engagement + Fees: child summary, fee balance,
 *     calendar, and a pay link.
 *   • student/teacher/admin     — fall through to the study tutor as before.
 *
 * Uses OpenAI function-calling: the model calls the role-scoped tools, we run
 * them against the school's data (mgmt.*), and it answers from the results.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import db from "../../db.js";
import { openai, OPENAI_MODEL, llmComplete } from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { resolveSchoolByHost, SITE_BASE_DOMAIN } from "./tenant.js";
import { getSyllabusContext } from "../../lib/syllabusGrounding.js";

const router = Router();
const TEACHER_ROLES = ["instructor", "teacher", "admin"];
const lc = (s) => String(s || "").toLowerCase().trim();

// ── Determine the caller's role within a school ───────────────────────────────
// Exact, case-insensitive email compare. ilike is used for the indexed DB
// lookup, but the guardian match is then verified EXACTLY here — an email
// containing LIKE metacharacters (_ / %) must not broaden the match to other
// families' children.
const emailMatches = (a, b) => lc(a || "") === lc(b || "") && !!lc(a || "");

async function roleInSchool(user, school) {
  if (!user || !school) return null;
  if (user.id === school.admin_user_id) return "admin";
  const { data: t } = await db.from("school_teachers").select("teacher_id")
    .eq("school_id", school.id).eq("teacher_id", user.id).maybeSingle();
  if (t) return "teacher";
  // Parent: their email is a guardian on a student in this school.
  const { data: kids } = await db.schema("mgmt").from("students").select("id, guardian_email")
    .eq("school_id", school.id).eq("status", "active").ilike("guardian_email", lc(user.email)).limit(10);
  if ((kids || []).some((k) => emailMatches(k.guardian_email, user.email))) return "parent";
  return "student"; // members reach the study tutor; role guard is server-side
}

// ── Fee balance for one student (class-wide + student-specific assignments) ────
async function feeBalance(schoolId, student) {
  const { data: assigns } = await db.schema("mgmt").from("fee_assignments")
    .select("amount, student_id, class_id")
    .eq("school_id", schoolId)
    .or(`student_id.eq.${student.id}${student.class_id ? `,and(class_id.eq.${student.class_id},student_id.is.null)` : ""}`);
  const owed = (assigns || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const { data: pays } = await db.schema("mgmt").from("fee_payments").select("amount").eq("student_id", student.id);
  const paid = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { owed, paid, balance: Math.max(0, owed - paid) };
}

const ngn = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;

// ── Tool catalogues (OpenAI function schema) per role ─────────────────────────
const GUEST_TOOLS = [
  { type: "function", function: { name: "get_school_info", description: "Get the school's name, description and admissions summary to answer questions about the school, programmes, tuition and admissions.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "book_tour", description: "Book a campus tour for a prospective family. Collect name and (email or phone) and a preferred date before calling.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, class_interest: { type: "string", description: "grade/class they're interested in" }, preferred_date: { type: "string", description: "YYYY-MM-DD" } }, required: ["name"] } } },
  { type: "function", function: { name: "capture_lead", description: "Save a prospective family's contact details so the school can follow up. Call when they show interest or share contact info.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, class_interest: { type: "string" }, note: { type: "string" } }, required: ["name"] } } },
];
const PARENT_TOOLS = [
  { type: "function", function: { name: "get_children", description: "List the parent's children at this school (name, class).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_child_summary", description: "Get a child's class, recent topics taught, and fee status.", parameters: { type: "object", properties: { child_name: { type: "string" } } } } },
  { type: "function", function: { name: "get_fee_balance", description: "Get the outstanding fee balance for a child (or all children).", parameters: { type: "object", properties: { child_name: { type: "string" } } } } },
  { type: "function", function: { name: "get_calendar", description: "Upcoming school events, holidays and meetings.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_teaching_materials", description: "List the teaching materials/resources (notes, worksheets, videos, links) for a child's class, optionally filtered by subject.", parameters: { type: "object", properties: { child_name: { type: "string" }, subject: { type: "string" } } } } },
  { type: "function", function: { name: "get_payment_link", description: "Get the link for the parent to pay outstanding fees online.", parameters: { type: "object", properties: {} } } },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
async function runTool(name, args, ctx) {
  const { school, user } = ctx;
  try {
    if (name === "get_school_info") {
      const { data: s } = await db.from("school_profiles").select("name, description, website, address, phone").eq("id", school.id).maybeSingle();
      return s || { name: school.name };
    }
    if (name === "book_tour" || name === "capture_lead") {
      const { data } = await db.schema("mgmt").from("enquiries").insert({
        school_id: school.id, name: args.name, phone: args.phone || null, email: args.email || null,
        class_interest: args.class_interest || null, source: "ai_admissions", status: "new",
        note: name === "book_tour" ? `Campus tour requested${args.preferred_date ? ` for ${args.preferred_date}` : ""}. ${args.note || ""}`.trim() : (args.note || null),
        follow_up_on: name === "book_tour" ? (args.preferred_date || null) : null,
      }).select("id").single();
      return { saved: true, id: data?.id, message: name === "book_tour" ? "Tour request recorded — the school will confirm." : "Details saved — the school will reach out." };
    }
    // Parent tools — scoped strictly to this parent's children.
    if (PARENT_TOOLS.some((t) => t.function.name === name)) {
      const { data: kids } = await db.schema("mgmt").from("students")
        .select("id, first_name, last_name, class_id, section_id, guardian_email, classes(name)")
        .eq("school_id", school.id).eq("status", "active").ilike("guardian_email", lc(user.email));
      // Verify the guardian email matches EXACTLY (ilike can over-match on _/%).
      const children = (kids || []).filter((k) => emailMatches(k.guardian_email, user.email));
      if (!children.length) return { children: [], note: "No child records linked to your email at this school." };
      const pick = (nm) => nm ? children.find((c) => lc(`${c.first_name} ${c.last_name}`).includes(lc(nm)) || lc(c.first_name) === lc(nm)) : children[0];

      if (name === "get_children")
        return { children: children.map((c) => ({ name: `${c.first_name} ${c.last_name}`, class: c.classes?.name })) };

      if (name === "get_fee_balance") {
        const targets = args.child_name ? [pick(args.child_name)].filter(Boolean) : children;
        const rows = await Promise.all(targets.map(async (c) => ({ child: `${c.first_name} ${c.last_name}`, ...(await feeBalance(school.id, c)) })));
        return { balances: rows.map((r) => ({ child: r.child, outstanding: ngn(r.balance), paid: ngn(r.paid), owed: ngn(r.owed) })) };
      }
      if (name === "get_child_summary") {
        const c = pick(args.child_name); if (!c) return { note: "Couldn't find that child." };
        const { data: logs } = await db.schema("mgmt").from("classwork_logs")
          .select("topic, subjects(name), log_date").eq("class_id", c.class_id).order("log_date", { ascending: false }).limit(5);
        const bal = await feeBalance(school.id, c);
        return { child: `${c.first_name} ${c.last_name}`, class: c.classes?.name,
          recent_topics: (logs || []).map((l) => `${l.subjects?.name || "Subject"}: ${l.topic}`),
          fee_outstanding: ngn(bal.balance) };
      }
      if (name === "get_calendar") {
        const today = new Date().toISOString().slice(0, 10);
        const { data: ev } = await db.schema("mgmt").from("school_events")
          .select("title, event_type, starts_on, ends_on").eq("school_id", school.id).gte("starts_on", today).order("starts_on").limit(8);
        return { events: (ev || []).map((e) => ({ title: e.title, type: e.event_type, date: e.starts_on })) };
      }
      if (name === "get_teaching_materials") {
        const c = pick(args.child_name); if (!c) return { note: "Couldn't find that child." };
        let mq = db.schema("mgmt").from("learning_resources")
          .select("title, resource_type, url, note, subjects(name)")
          .eq("school_id", school.id).eq("class_id", c.class_id).order("created_at", { ascending: false }).limit(40);
        const { data: mats } = await mq;
        let list = (mats || []).map((m) => ({ title: m.title, subject: m.subjects?.name || null, type: m.resource_type, link: m.url || null, note: m.note || null }));
        if (args.subject) list = list.filter((m) => lc(m.subject || "").includes(lc(args.subject)));
        return { child: `${c.first_name} ${c.last_name}`, class: c.classes?.name, count: list.length, materials: list };
      }
      if (name === "get_payment_link") {
        const host = school.host || `${school.slug}.${SITE_BASE_DOMAIN}`;
        return { url: `https://${host}/pay`, note: "Open this link to pay outstanding fees online." };
      }
    }
  } catch (e) { return { error: e.message }; }
  return { error: "unknown tool" };
}

// ── Chat loop (function-calling) ──────────────────────────────────────────────
// The public site's assistant introduces itself with the school's OWN agent
// name — the one chosen at onboarding (public.user_agents for the school-admin
// account), so the website and the in-app assistant are the same character.
// An explicit override on the website settings wins if one is set.
async function resolveAiName(school) {
  try {
    const { data: site } = await db.schema("edu").from("school_website")
      .select("ai_chat_name").eq("school_id", school.id).maybeSingle();
    if (site?.ai_chat_name?.trim()) return site.ai_chat_name.trim();

    const { data: sp } = await db.from("school_profiles")
      .select("admin_user_id").eq("id", school.id).maybeSingle();
    if (sp?.admin_user_id) {
      const { data: agent } = await db.from("user_agents")
        .select("agent_name").eq("user_id", sp.admin_user_id).maybeSingle();
      if (agent?.agent_name?.trim()) return agent.agent_name.trim();
    }
  } catch { /* fall through to the neutral default */ }
  return "Akoro";
}

async function conciergeChat({ role, school, user, message, history }) {
  const tools = role === "guest" ? GUEST_TOOLS : role === "parent" ? PARENT_TOOLS : [];
  const aiName = await resolveAiName(school);
  const persona = {
    guest: `You are ${aiName}, the admissions assistant for ${school.name}. Introduce yourself by name when you first greet someone. Warmly help prospective families: answer questions about the school, programmes, tuition and admissions using get_school_info, offer to book a campus tour, and capture their contact details for follow-up. Be encouraging and concise; never invent fees or policies you can't confirm — offer to have the school follow up instead.`,
    parent: `You are ${aiName}, the parent assistant for ${school.name}, helping ${user?.full_name || "a parent"}. Use the tools to answer about THEIR children only — progress, fees, school calendar, and teaching materials/resources for their child's subjects. When sharing materials, list them clearly with any links. Be warm, clear and reassuring. For fee payments, give the payment link.`,
  }[role] || `You are ${aiName}, the assistant for ${school.name}.`;

  const messages = [{ role: "system", content: persona }, ...(history || []).slice(-8), { role: "user", content: message }];
  const toolExecutions = [];
  for (let i = 0; i < 4; i++) {
    const resp = await openai.chat.completions.create({ model: OPENAI_MODEL, max_tokens: 700, messages, tools: tools.length ? tools : undefined });
    const msg = resp.choices?.[0]?.message ?? { content: "" };
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { reply: msg.content ?? "", toolExecutions };
    messages.push(msg);
    for (const call of calls) {
      let a = {}; try { a = JSON.parse(call.function.arguments || "{}"); } catch {}
      const result = await runTool(call.function.name, a, { school, user });
      toolExecutions.push({ tool: call.function.name, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "Let me connect you with the school office for that.", toolExecutions };
}

// ── PUBLIC guest endpoint (admissions counselor) ──────────────────────────────
// Unauthenticated and backed by an LLM, so it is the one endpoint on this
// router that anyone on the internet can spend our money on. Tighter than the
// router-wide limit, keyed by IP since there is no user.
const guestChatLimit = rateLimit({
  windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, error: "Too many messages — please wait a moment." },
});

router.post("/site/guest-chat", guestChatLimit, async (req, res) => {
  try {
    const { host, message, history } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message required" });
    // Cap what an anonymous caller can push into a prompt.
    const text = String(message).trim().slice(0, 2000);
    const past = Array.isArray(history) ? history.slice(-8) : [];
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).json({ error: "This website isn't connected to a school yet." });
    const out = await conciergeChat({ role: "guest", school, user: null, message: text, history: past });
    res.json({ success: true, ...out });
  } catch (e) { console.error("[guest-chat]", e); res.status(500).json({ error: "Something went wrong." }); }
});

// ── AUTHED concierge (role resolved per request) ──────────────────────────────
router.post("/ai/concierge", authenticateToken, async (req, res) => {
  try {
    const { host, message, history } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message required" });
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).json({ error: "School not found." });
    const { data: user } = await db.from("users").select("id, email, full_name, role").eq("id", req.user.id).maybeSingle();
    const role = await roleInSchool(user, school);
    if (role !== "parent")
      return res.json({ success: true, role, reply: null, useTutor: true });   // non-parents use the study tutor
    const out = await conciergeChat({ role, school, user, message: message.trim(), history });
    res.json({ success: true, role, ...out });
  } catch (e) { console.error("[concierge]", e); res.status(500).json({ error: "Something went wrong." }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — Teacher lesson tools (lesson plan · worksheet · quiz)
// ═══════════════════════════════════════════════════════════════════════════
const LESSON_SYSTEM = {
  lesson_plan: `You are an expert teacher's assistant. Produce a clear, classroom-ready LESSON PLAN in Markdown with: Topic, Class, Duration, Learning Objectives (bullet list), Materials, Introduction/Starter, Main Activities (step-by-step), Differentiation (support + challenge), Assessment/Check for understanding, and Plenary/Summary. Be practical and age-appropriate.`,
  worksheet: `You are an expert teacher's assistant. Produce a student WORKSHEET in Markdown: a short intro, then 8–12 progressively harder questions (mix of recall, application and one challenge), clearly numbered. Add an "Answer Key" section at the end. Age-appropriate.`,
  quiz: `You are an expert teacher's assistant. Produce a QUIZ in Markdown: 10 multiple-choice questions (A–D) on the topic, then an "Answers" section listing the correct option per question. Keep questions clear and unambiguous.`,
};
router.post("/ai/lesson", authenticateToken, requireRole(TEACHER_ROLES), async (req, res) => {
  try {
    const type = ["lesson_plan", "worksheet", "quiz"].includes(req.body?.type) ? req.body.type : "lesson_plan";
    const topic = String(req.body?.topic || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const className = String(req.body?.class || req.body?.className || "").trim();
    if (!topic) return res.status(400).json({ error: "topic is required" });

    // Ground in the exam syllabus where relevant.
    const syllabus = await getSyllabusContext(`${subject} ${topic}`.trim(), { limit: 3 }).catch(() => "");
    const prompt = `Create a ${type.replace("_", " ")} for:\nSubject: ${subject || "General"}\nClass: ${className || "Secondary"}\nTopic: ${topic}` +
      (syllabus ? `\n\nAlign with these syllabus references where relevant:\n${syllabus}` : "");
    const content = await llmComplete(prompt, { system: LESSON_SYSTEM[type], maxTokens: 1800, temperature: 0.5 });
    res.json({ success: true, data: { type, topic, subject, content } });
  } catch (e) { console.error("[ai/lesson]", e); res.status(500).json({ error: "Could not generate that. Try again." }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — Website builder auto-content (newsletter · recap · social · event)
// ═══════════════════════════════════════════════════════════════════════════
const CONTENT_SYSTEM = {
  newsletter: `You write warm, professional school NEWSLETTERS in Markdown: a friendly headline, 3–4 short sections (highlights, upcoming events, a note from the school), and a closing. Community-facing and positive.`,
  event_recap: `You write an upbeat EVENT RECAP / news post in Markdown for a school website: a catchy title, 2–3 short paragraphs celebrating what happened, and a closing line. SEO-friendly, warm.`,
  social_post: `You write short, engaging SOCIAL MEDIA posts (Instagram/Facebook) for a school. Return 2–3 caption options, each 2–4 lines with a few relevant hashtags. Friendly and shareable.`,
  event_page: `You write an EVENT LANDING PAGE in Markdown: an exciting title, a short hero blurb, "What to expect" bullets, date/time/venue placeholders, and a clear call-to-action to register. Concise and inviting.`,
};
router.post("/ai/website-content", authenticateToken, requireRole(TEACHER_ROLES), async (req, res) => {
  try {
    const type = ["newsletter", "event_recap", "social_post", "event_page"].includes(req.body?.type) ? req.body.type : "newsletter";
    const brief = String(req.body?.brief || req.body?.prompt || "").trim();
    if (!brief) return res.status(400).json({ error: "Tell me what it's about" });

    const { data: school } = await db.from("school_profiles").select("name, description").eq("id", req.body?.schoolId || "00000000-0000-0000-0000-000000000000").maybeSingle();
    const schoolName = school?.name || "our school";
    const content = await llmComplete(`School: ${schoolName}.\nWrite the ${type.replace("_", " ")} about: ${brief}`, {
      system: CONTENT_SYSTEM[type], maxTokens: 1200, temperature: 0.7,
    });
    res.json({ success: true, data: { type, content } });
  } catch (e) { console.error("[ai/website-content]", e); res.status(500).json({ error: "Could not generate that. Try again." }); }
});

// ── Caller's role in the school (for menu gating in the chat) ─────────────────
router.get("/ai/context", authenticateToken, async (req, res) => {
  try {
    const school = await resolveSchoolByHost(req.query.host);
    if (!school) return res.json({ success: true, role: null });
    const { data: user } = await db.from("users").select("id, email, full_name").eq("id", req.user.id).maybeSingle();
    const role = await roleInSchool(user, school);
    // The chat UI greets and labels itself with the school's own agent name,
    // so it must come from the same resolver the personas use.
    const aiName = await resolveAiName(school);
    res.json({ success: true, role, schoolName: school.name, aiName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Publish generated website content as a school site page (draft) ───────────
const slugify = (s) => String(s || "page").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";
router.post("/ai/publish-page", authenticateToken, requireRole(TEACHER_ROLES), async (req, res) => {
  try {
    const school = await resolveSchoolByHost(req.body?.host);
    if (!school) return res.status(404).json({ error: "School not found." });
    const { data: user } = await db.from("users").select("id, email").eq("id", req.user.id).maybeSingle();
    const role = await roleInSchool(user, school);
    if (!["teacher", "admin"].includes(role)) return res.status(403).json({ error: "Only school staff can publish pages." });

    const title = String(req.body?.title || "").trim() || "Untitled";
    const content = String(req.body?.content || "").trim();
    const status = req.body?.status === "published" ? "published" : "draft";
    if (!content) return res.status(400).json({ error: "Nothing to publish." });

    const slug = `${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
    const { data, error } = await db.schema("mgmt").from("site_pages")
      .insert({ school_id: school.id, title, slug, content, status }).select("id, title, slug, status").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data });
  } catch (e) { console.error("[ai/publish-page]", e); res.status(500).json({ error: e.message }); }
});

export default router;
