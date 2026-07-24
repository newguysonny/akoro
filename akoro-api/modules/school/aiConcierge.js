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
import db from "../../db.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { authenticateToken } from "../auth/routes.js";
import { resolveSchoolByHost } from "./tenant.js";

const router = Router();
const lc = (s) => String(s || "").toLowerCase().trim();

// ── Determine the caller's role within a school ───────────────────────────────
async function roleInSchool(user, school) {
  if (!user || !school) return null;
  if (user.id === school.admin_user_id) return "admin";
  const { data: t } = await db.from("school_teachers").select("teacher_id")
    .eq("school_id", school.id).eq("teacher_id", user.id).maybeSingle();
  if (t) return "teacher";
  // Parent: their email is a guardian on a student in this school.
  const { data: kid } = await db.schema("mgmt").from("students").select("id")
    .eq("school_id", school.id).eq("status", "active").ilike("guardian_email", lc(user.email)).limit(1).maybeSingle();
  if (kid) return "parent";
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
        .select("id, first_name, last_name, class_id, section_id, classes(name)")
        .eq("school_id", school.id).eq("status", "active").ilike("guardian_email", lc(user.email));
      const children = kids || [];
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
      if (name === "get_payment_link") {
        const host = school.host || `${school.slug}.akoro.name.ng`;
        return { url: `https://${host}/pay`, note: "Open this link to pay outstanding fees online." };
      }
    }
  } catch (e) { return { error: e.message }; }
  return { error: "unknown tool" };
}

// ── Chat loop (function-calling) ──────────────────────────────────────────────
async function conciergeChat({ role, school, user, message, history }) {
  const tools = role === "guest" ? GUEST_TOOLS : role === "parent" ? PARENT_TOOLS : [];
  const persona = {
    guest: `You are the admissions assistant for ${school.name}. Warmly help prospective families: answer questions about the school, programmes, tuition and admissions using get_school_info, offer to book a campus tour, and capture their contact details for follow-up. Be encouraging and concise; never invent fees or policies you can't confirm — offer to have the school follow up instead.`,
    parent: `You are the parent assistant for ${school.name}, helping ${user?.full_name || "a parent"}. Use the tools to answer about THEIR children only — progress, fees and school calendar. Be warm, clear and reassuring. For fee payments, give the payment link.`,
  }[role] || `You are the assistant for ${school.name}.`;

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
router.post("/site/guest-chat", async (req, res) => {
  try {
    const { host, message, history } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message required" });
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).json({ error: "This website isn't connected to a school yet." });
    const out = await conciergeChat({ role: "guest", school, user: null, message: message.trim(), history });
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

export default router;
