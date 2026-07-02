/**
 * publicPortal.js — the public (no-auth) side of every school's tenant site.
 * Mounted at /api/school/public; the Vercel Edge Middleware rewrites tenant
 * paths here, so parents/applicants see them on the school's own domain:
 *
 *   GET  /apply          online admission form (Admission Settings fields)
 *   POST /apply          submit application (+ optional admission-fee payment)
 *   GET  /pay            fee payment — enter admission number
 *   POST /pay            lookup → dues summary + amount/email form
 *   POST /pay/init       Paystack init with the SCHOOL'S OWN keys
 *   GET  /pay/verify     Paystack callback → record mgmt.fee_payments 'online'
 *   GET  /results        results checker — admission number + result PIN
 *   POST /results        render the student's marksheet for the PIN's exam
 *
 * Every route resolves the school from ?host= (appended by the middleware) or
 * the forwarded host header. All money amounts are naira; Paystack gets kobo.
 */
import { Router } from "express";
import express from "express";
import crypto from "crypto";
import db from "../../db.js";
import { resolveSchoolByHost, getSchoolGateway } from "./tenant.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

const M = () => db.schema("mgmt");
const E = () => db.schema("edu");
const studentLabel = (s) => [s.first_name, s.last_name].filter(Boolean).join(" ");
const naira = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ── Tenant + page plumbing ──────────────────────────────────────────────── */

function requestHost(req) {
  return req.query.host || req.body?.host || req.headers["x-forwarded-host"] || req.hostname;
}

async function tenant(req, res) {
  const host = requestHost(req);
  const school = await resolveSchoolByHost(host);
  if (!school) {
    res.status(404).type("html").send(shell(null, "Not found", `<h2>404 — no school is connected to this domain</h2>`));
    return null;
  }
  school.host = String(host || "").toLowerCase().split(":")[0];
  return school;
}

// Minimal branded page shell shared by every public-portal page.
function shell(school, title, body) {
  const name = school?.name || "School";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — ${esc(name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7fb;color:#1a1a2e}
  header{background:#fff;border-bottom:1px solid #e7e7ef;padding:16px 24px;display:flex;align-items:center;gap:12px}
  header img{height:36px}
  header b{font-size:18px}
  header a{margin-left:auto;color:#1a56db;text-decoration:none;font-weight:600;font-size:14px}
  main{max-width:760px;margin:32px auto;padding:0 20px}
  .card{background:#fff;border:1px solid #e7e7ef;border-radius:14px;padding:28px}
  h2{font-size:24px;margin-bottom:6px}
  .sub{color:#6b7280;margin-bottom:22px;font-size:14px}
  label{display:block;font-weight:600;font-size:13px;margin:14px 0 6px}
  label .req{color:#dc2626}
  input,select,textarea{width:100%;padding:11px 12px;border:1px solid #d7d7e0;border-radius:9px;font-size:14px;font-family:inherit;background:#fff}
  textarea{min-height:90px}
  .btn{display:inline-block;margin-top:22px;padding:13px 30px;border:0;border-radius:50px;background:#1a56db;color:#fff;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
  .btn.secondary{background:#fff;color:#1a56db;border:1px solid #1a56db}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
  @media(max-width:560px){.grid2{grid-template-columns:1fr}}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th,td{padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
  th{background:#f8f9fc;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280}
  .ok{color:#059669;font-weight:700}.bad{color:#dc2626;font-weight:700}
  .pill{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700}
  .pill.g{background:#d1fae5;color:#065f46}.pill.r{background:#fee2e2;color:#991b1b}.pill.y{background:#fef3c7;color:#92400e}
  .big{font-size:30px;font-weight:900}
  footer{padding:28px;text-align:center;color:#9ca3af;font-size:13px}
  @media print{header a,.btn,footer{display:none}}
</style>
</head>
<body>
<header>
  ${school?.logo_url ? `<img src="${esc(school.logo_url)}" alt="">` : ""}
  <b>${esc(name)}</b>
  <a href="/">← School website</a>
</header>
<main>${body}</main>
<footer>Powered by Akoro</footer>
</body>
</html>`;
}

const send = (res, school, title, body, status = 200) =>
  res.status(status).type("html").send(shell(school, title, body));

/* ── Paystack, with the school's OWN secret key ──────────────────────────── */

async function psRequest(secret, method, path, body) {
  const r = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok || data.status === false) throw new Error(data.message || `Paystack error ${r.status}`);
  return data.data;
}
const psInit = (secret, p) => psRequest(secret, "POST", "/transaction/initialize", p);
const psVerify = (secret, ref) => psRequest(secret, "GET", `/transaction/verify/${encodeURIComponent(ref)}`);
const newRef = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

/* ═════════════════════ ONLINE ADMISSION — /apply ═════════════════════════ */

async function admissionConfig(schoolId) {
  const { data: settings } = await E().from("school_admission_settings")
    .select("enabled, fee_amount").eq("school_id", schoolId).maybeSingle();
  const { data: fields } = await E().from("school_admission_fields")
    .select("id, label, field_type, options, required, sort_order")
    .eq("school_id", schoolId).order("sort_order", { ascending: true });
  return { settings: settings || { enabled: false, fee_amount: 0 }, fields: fields || [] };
}

function customFieldInput(f) {
  const name = `cf_${f.id}`;
  const req = f.required ? "required" : "";
  const star = f.required ? ' <span class="req">*</span>' : "";
  let input;
  const type = (f.field_type || "text").toLowerCase();
  if (type === "select" && Array.isArray(f.options) && f.options.length) {
    input = `<select name="${name}" ${req}><option value="">— select —</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
  } else if (type === "textarea") {
    input = `<textarea name="${name}" ${req}></textarea>`;
  } else {
    const htmlType = ["number", "date", "email", "tel"].includes(type) ? type : "text";
    input = `<input type="${htmlType}" name="${name}" ${req}>`;
  }
  return `<label>${esc(f.label)}${star}</label>${input}`;
}

router.get("/apply", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const { settings, fields } = await admissionConfig(school.id);
    if (!settings.enabled) {
      return send(res, school, "Admissions closed",
        `<div class="card"><h2>Admissions are currently closed</h2><p class="sub">Online admission is not open at ${esc(school.name)} right now. Please check back later or contact the school.</p></div>`);
    }
    const fee = Number(settings.fee_amount || 0);
    const body = `
<div class="card">
  <h2>Admission Application</h2>
  <p class="sub">Apply to ${esc(school.name)} online. Fields marked <span class="req">*</span> are required.${fee > 0 ? ` An admission fee of <b>${naira(fee)}</b> is payable online after submission.` : ""}</p>
  <form method="POST" action="/apply">
    <input type="hidden" name="host" value="${esc(school.host)}">
    <div class="grid2">
      <div><label>First name <span class="req">*</span></label><input name="first_name" required></div>
      <div><label>Last name</label><input name="last_name"></div>
      <div><label>Email${fee > 0 ? ' <span class="req">*</span>' : ""}</label><input type="email" name="email" ${fee > 0 ? "required" : ""}></div>
      <div><label>Phone</label><input type="tel" name="phone"></div>
      <div><label>Date of birth</label><input type="date" name="dob"></div>
      <div><label>Gender</label><select name="gender"><option value="">— select —</option><option>Male</option><option>Female</option></select></div>
      <div><label>Guardian name</label><input name="guardian_name"></div>
      <div><label>Guardian phone</label><input type="tel" name="guardian_phone"></div>
    </div>
    <label>Address</label><textarea name="address"></textarea>
    <label>Class applying for</label><input name="class_applied" placeholder="e.g. JSS 1">
    ${fields.map(customFieldInput).join("\n")}
    <button class="btn" type="submit">${fee > 0 ? `Submit &amp; pay ${naira(fee)}` : "Submit application"}</button>
  </form>
</div>`;
    send(res, school, "Apply", body);
  } catch (e) {
    console.error("[public apply]", e);
    res.status(500).type("html").send("<h1>Something went wrong.</h1>");
  }
});

router.post("/apply", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const { settings, fields } = await admissionConfig(school.id);
    if (!settings.enabled) return send(res, school, "Admissions closed", `<div class="card"><h2>Admissions are currently closed</h2></div>`, 403);

    const b = req.body || {};
    if (!b.first_name?.trim()) return send(res, school, "Apply", `<div class="card"><h2>First name is required</h2><a class="btn" href="/apply">Back to the form</a></div>`, 400);

    const customAnswers = {};
    for (const f of fields) {
      const v = b[`cf_${f.id}`];
      if (v !== undefined && v !== "") customAnswers[f.label] = v;
    }
    const fee = Number(settings.fee_amount || 0);
    const applicationNo = newRef("APP");
    const { data: app, error } = await M().from("admission_applications").insert({
      school_id: school.id, application_no: applicationNo,
      first_name: b.first_name.trim(), last_name: b.last_name?.trim() || null,
      email: b.email?.trim() || null, phone: b.phone?.trim() || null,
      dob: b.dob || null, gender: b.gender || null,
      guardian_name: b.guardian_name?.trim() || null, guardian_phone: b.guardian_phone?.trim() || null,
      address: b.address?.trim() || null, class_applied: b.class_applied?.trim() || null,
      custom_answers: customAnswers, fee_amount: fee,
      fee_status: fee > 0 ? "unpaid" : "waived",
    }).select("id, application_no").single();
    if (error) throw new Error(error.message);

    // Admission fee → straight into the school's own Paystack checkout.
    if (fee > 0 && b.email?.trim()) {
      const gw = await getSchoolGateway(school.id);
      if (gw.ok) {
        const reference = newRef("ADM");
        await M().from("online_payments").insert({
          school_id: school.id, purpose: "admission", application_id: app.id,
          amount: fee, email: b.email.trim(), reference,
        });
        const ps = await psInit(gw.secret, {
          email: b.email.trim(), amount: Math.round(fee * 100), reference,
          callback_url: `https://${school.host}/pay/verify`,
          metadata: { school_id: school.id, purpose: "admission", application_no: app.application_no },
        });
        return res.redirect(ps.authorization_url);
      }
    }

    send(res, school, "Application received", `
<div class="card" style="text-align:center">
  <h2>Application received 🎉</h2>
  <p class="sub">Keep your application number safe — the school will contact you.</p>
  <div class="big">${esc(app.application_no)}</div>
  ${fee > 0 ? `<p class="sub" style="margin-top:14px">Admission fee of ${naira(fee)} is payable — the school will advise on payment.</p>` : ""}
  <a class="btn" href="/">Back to website</a>
</div>`);
  } catch (e) {
    console.error("[public apply submit]", e);
    res.status(500).type("html").send("<h1>Something went wrong submitting your application.</h1>");
  }
});

/* ═════════════════════ ONLINE FEES — /pay ════════════════════════════════ */

async function duesForStudent(schoolId, student) {
  const { data: assigns } = await M().from("fee_assignments")
    .select("class_id, student_id, amount").eq("school_id", schoolId);
  const { data: pays } = await M().from("fee_payments")
    .select("amount").eq("school_id", schoolId).eq("student_id", student.id);
  const assigned = (assigns || [])
    .filter((a) => a.student_id === student.id || (a.class_id && a.class_id === student.class_id && !a.student_id))
    .reduce((s, a) => s + Number(a.amount || 0), 0);
  const paid = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { assigned, paid, due: Math.max(0, assigned - paid) };
}

const payLookupForm = (school, msg = "") => `
<div class="card">
  <h2>Pay School Fees</h2>
  <p class="sub">Enter the student's admission number to see the outstanding balance and pay securely online.</p>
  ${msg ? `<p class="bad" style="margin-bottom:10px">${esc(msg)}</p>` : ""}
  <form method="POST" action="/pay">
    <input type="hidden" name="host" value="${esc(school.host)}">
    <label>Admission number <span class="req">*</span></label>
    <input name="admission_no" required placeholder="e.g. ADM-0042" autofocus>
    <button class="btn" type="submit">Look up student</button>
  </form>
</div>`;

router.get("/pay", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const gw = await getSchoolGateway(school.id);
    if (!gw.ok) return send(res, school, "Pay Fees", `<div class="card"><h2>Online payment unavailable</h2><p class="sub">${esc(school.name)} has not enabled online fee payment yet. Please pay at the school.</p></div>`);
    send(res, school, "Pay Fees", payLookupForm(school));
  } catch (e) {
    console.error("[public pay]", e);
    res.status(500).type("html").send("<h1>Something went wrong.</h1>");
  }
});

router.post("/pay", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const admissionNo = (req.body.admission_no || "").trim();
    const { data: student } = await M().from("students")
      .select("id, admission_no, first_name, last_name, class_id, guardian_email")
      .eq("school_id", school.id).eq("admission_no", admissionNo).maybeSingle();
    if (!student) return send(res, school, "Pay Fees", payLookupForm(school, "No student found with that admission number."), 404);

    const dues = await duesForStudent(school.id, student);
    const body = `
<div class="card">
  <h2>${esc(studentLabel(student))}</h2>
  <p class="sub">Admission No: <b>${esc(student.admission_no)}</b></p>
  <table>
    <tr><th>Total billed</th><th>Paid</th><th>Outstanding</th></tr>
    <tr><td>${naira(dues.assigned)}</td><td class="ok">${naira(dues.paid)}</td><td class="${dues.due > 0 ? "bad" : "ok"}">${naira(dues.due)}</td></tr>
  </table>
  ${dues.due <= 0 ? `<p class="ok" style="margin-top:18px">No outstanding fees — nothing to pay. 🎉</p><a class="btn secondary" href="/">Back to website</a>` : `
  <form method="POST" action="/pay/init">
    <input type="hidden" name="host" value="${esc(school.host)}">
    <input type="hidden" name="student_id" value="${esc(student.id)}">
    <label>Amount to pay (₦) <span class="req">*</span></label>
    <input type="number" name="amount" min="1" max="${dues.due}" step="0.01" value="${dues.due}" required>
    <label>Payer email (for the receipt) <span class="req">*</span></label>
    <input type="email" name="email" value="${esc(student.guardian_email || "")}" required>
    <button class="btn" type="submit">Pay securely with Paystack</button>
  </form>`}
</div>`;
    send(res, school, "Pay Fees", body);
  } catch (e) {
    console.error("[public pay lookup]", e);
    res.status(500).type("html").send("<h1>Something went wrong.</h1>");
  }
});

router.post("/pay/init", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const gw = await getSchoolGateway(school.id);
    if (!gw.ok) return send(res, school, "Pay Fees", `<div class="card"><h2>Online payment unavailable</h2></div>`, 403);

    const { student_id, amount, email } = req.body;
    const amt = Number(amount);
    if (!student_id || !email?.trim() || !amt || amt <= 0) {
      return send(res, school, "Pay Fees", `<div class="card"><h2>Invalid payment details</h2><a class="btn" href="/pay">Start again</a></div>`, 400);
    }
    const { data: student } = await M().from("students").select("id")
      .eq("school_id", school.id).eq("id", student_id).maybeSingle();
    if (!student) return send(res, school, "Pay Fees", `<div class="card"><h2>Student not found</h2><a class="btn" href="/pay">Start again</a></div>`, 404);

    const reference = newRef("FEE");
    const { error } = await M().from("online_payments").insert({
      school_id: school.id, purpose: "fees", student_id, amount: amt, email: email.trim(), reference,
    });
    if (error) throw new Error(error.message);

    const ps = await psInit(gw.secret, {
      email: email.trim(), amount: Math.round(amt * 100), reference,
      callback_url: `https://${school.host}/pay/verify`,
      metadata: { school_id: school.id, purpose: "fees", student_id },
    });
    res.redirect(ps.authorization_url);
  } catch (e) {
    console.error("[public pay init]", e);
    res.status(500).type("html").send("<h1>Could not start the payment. Please try again.</h1>");
  }
});

// Paystack callback (also handles admission-fee checkouts).
router.get("/pay/verify", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const reference = req.query.reference || req.query.trxref;
    if (!reference) return send(res, school, "Payment", `<div class="card"><h2>Missing payment reference</h2></div>`, 400);

    const { data: op } = await M().from("online_payments").select("*")
      .eq("school_id", school.id).eq("reference", reference).maybeSingle();
    if (!op) return send(res, school, "Payment", `<div class="card"><h2>Payment not found</h2></div>`, 404);

    if (op.status === "pending") {
      const gw = await getSchoolGateway(school.id);
      if (!gw.ok) return send(res, school, "Payment", `<div class="card"><h2>Gateway unavailable — contact the school</h2></div>`, 500);
      let verified;
      try { verified = await psVerify(gw.secret, reference); } catch { verified = null; }

      if (verified?.status === "success") {
        await M().from("online_payments").update({ status: "success", paid_at: new Date() }).eq("id", op.id);
        op.status = "success";
        if (op.purpose === "fees" && op.student_id) {
          // Also record in the normal fee ledger so reports/dues stay right.
          await M().from("fee_payments").insert({
            school_id: school.id, student_id: op.student_id, amount: op.amount,
            method: "online", reference, note: "Paid online via Paystack",
            received_by: "Online (Paystack)",
          });
        } else if (op.purpose === "admission" && op.application_id) {
          await M().from("admission_applications")
            .update({ fee_status: "paid", fee_reference: reference }).eq("id", op.application_id);
        }
      } else {
        await M().from("online_payments").update({ status: "failed" }).eq("id", op.id);
        op.status = "failed";
      }
    }

    let extra = "";
    if (op.purpose === "admission" && op.application_id) {
      const { data: app } = await M().from("admission_applications")
        .select("application_no").eq("id", op.application_id).maybeSingle();
      if (app) extra = `<p class="sub" style="margin-top:12px">Application number: <b>${esc(app.application_no)}</b> — keep it safe.</p>`;
    }
    const ok = op.status === "success";
    send(res, school, ok ? "Payment successful" : "Payment failed", `
<div class="card" style="text-align:center">
  <h2 class="${ok ? "ok" : "bad"}">${ok ? "Payment successful ✅" : "Payment not completed"}</h2>
  <div class="big" style="margin:14px 0">${naira(op.amount)}</div>
  <p class="sub">Reference: <b>${esc(op.reference)}</b> · ${esc(op.email)}</p>
  ${extra}
  ${ok ? `<button class="btn secondary" onclick="window.print()">Print receipt</button>` : `<a class="btn" href="${op.purpose === "admission" ? "/apply" : "/pay"}">Try again</a>`}
  <a class="btn" href="/" style="margin-left:8px">Back to website</a>
</div>`);
  } catch (e) {
    console.error("[public pay verify]", e);
    res.status(500).type("html").send("<h1>Could not verify the payment. Contact the school with your reference.</h1>");
  }
});

/* ═════════════════════ RESULTS CHECKER — /results ════════════════════════ */

const resultsForm = (school, msg = "") => `
<div class="card">
  <h2>Check Results</h2>
  <p class="sub">Enter the student's admission number and the result PIN issued by ${esc(school.name)}.</p>
  ${msg ? `<p class="bad" style="margin-bottom:10px">${esc(msg)}</p>` : ""}
  <form method="POST" action="/results">
    <input type="hidden" name="host" value="${esc(school.host)}">
    <label>Admission number <span class="req">*</span></label>
    <input name="admission_no" required placeholder="e.g. ADM-0042">
    <label>Result PIN <span class="req">*</span></label>
    <input name="pin" required placeholder="e.g. 4F7K-92QX">
    <button class="btn" type="submit">View result</button>
  </form>
</div>`;

router.get("/results", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    send(res, school, "Check Results", resultsForm(school));
  } catch (e) {
    console.error("[public results]", e);
    res.status(500).type("html").send("<h1>Something went wrong.</h1>");
  }
});

router.post("/results", async (req, res) => {
  try {
    const school = await tenant(req, res);
    if (!school) return;
    const admissionNo = (req.body.admission_no || "").trim();
    const pin = (req.body.pin || "").trim().toUpperCase();

    const { data: student } = await M().from("students")
      .select("id, admission_no, first_name, last_name, class_id")
      .eq("school_id", school.id).eq("admission_no", admissionNo).maybeSingle();
    if (!student) return send(res, school, "Check Results", resultsForm(school, "No student found with that admission number."), 404);

    const { data: pinRow } = await M().from("result_pins").select("*")
      .eq("school_id", school.id).eq("student_id", student.id).eq("pin", pin).maybeSingle();
    if (!pinRow) return send(res, school, "Check Results", resultsForm(school, "Invalid PIN for that admission number."), 403);
    if (pinRow.used_count >= pinRow.max_uses) return send(res, school, "Check Results", resultsForm(school, "This PIN has been used up. Contact the school for a new one."), 403);
    await M().from("result_pins").update({ used_count: pinRow.used_count + 1 }).eq("id", pinRow.id);

    const { data: exam } = await M().from("exams").select("id, name").eq("id", pinRow.exam_id).maybeSingle();
    const { data: scheds } = await M().from("exam_schedules").select("id, subject_id, max_marks, pass_marks")
      .eq("school_id", school.id).eq("exam_id", pinRow.exam_id).eq("class_id", student.class_id);
    const subjIds = (scheds || []).map((s) => s.subject_id);
    const { data: subjects } = subjIds.length
      ? await M().from("subjects").select("id, name").eq("school_id", school.id).in("id", subjIds)
      : { data: [] };
    const subjName = Object.fromEntries((subjects || []).map((s) => [s.id, s.name]));
    const { data: marks } = (scheds || []).length
      ? await M().from("exam_marks").select("schedule_id, marks").eq("student_id", student.id).in("schedule_id", scheds.map((s) => s.id))
      : { data: [] };
    const markOf = Object.fromEntries((marks || []).map((m) => [m.schedule_id, Number(m.marks)]));

    const { data: cls } = student.class_id
      ? await M().from("classes").select("name").eq("id", student.class_id).maybeSingle()
      : { data: null };
    const { data: remark } = await M().from("teacher_remarks").select("remark")
      .eq("school_id", school.id).eq("student_id", student.id).eq("exam_id", pinRow.exam_id).maybeSingle();

    let total = 0, maxTotal = 0;
    const rows = (scheds || []).map((s) => {
      const score = markOf[s.id];
      const max = Number(s.max_marks || 100);
      if (score !== undefined) total += score;
      maxTotal += max;
      const pass = s.pass_marks != null && score !== undefined ? score >= Number(s.pass_marks) : null;
      return `<tr><td>${esc(subjName[s.subject_id] || "?")}</td><td>${score ?? "—"}</td><td>${max}</td><td>${pass === null ? "—" : pass ? '<span class="pill g">Pass</span>' : '<span class="pill r">Fail</span>'}</td></tr>`;
    });
    const percent = maxTotal ? Math.round((total / maxTotal) * 100) : 0;

    send(res, school, "Result", `
<div class="card">
  <h2>${esc(exam?.name || "Exam")} Result</h2>
  <p class="sub">${esc(studentLabel(student))} · Admission No ${esc(student.admission_no)}${cls?.name ? ` · ${esc(cls.name)}` : ""}</p>
  ${rows.length ? `
  <table>
    <tr><th>Subject</th><th>Score</th><th>Max</th><th>Status</th></tr>
    ${rows.join("\n")}
    <tr><th>Total</th><th>${total}</th><th>${maxTotal}</th><th><span class="pill ${percent >= 50 ? "g" : "r"}">${percent}%</span></th></tr>
  </table>
  ${remark?.remark ? `<p style="margin-top:16px"><b>Teacher's remark:</b> ${esc(remark.remark)}</p>` : ""}
  <button class="btn secondary" onclick="window.print()">Print result</button>` : `<p class="sub">No marks have been published for this exam yet. Please check back later.</p>`}
  <a class="btn" href="/results" style="margin-left:8px">Check another</a>
</div>`);
  } catch (e) {
    console.error("[public results view]", e);
    res.status(500).type("html").send("<h1>Something went wrong.</h1>");
  }
});

export default router;
