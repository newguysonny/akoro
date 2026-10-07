/**
 * lib/billingModel.js contract tests (plan §4.6 Phase 2): the subscription
 * action state machine (exact renderSubActions semantics from the prototype),
 * customer standing/balance, invoice transitions, and the derived invoice
 * timeline / overdue math.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  subscriptionActions, applySubscriptionAction,
  customerStanding, customerBalance,
  applyInvoiceAction, invoiceTimeline, invoiceOverdueDays,
  addCycleDays, todayStr,
} from "./billingModel.js";

const T = "2026-09-29";
const sub = (over) => ({
  status: "active", cycle: "monthly", price: 1500, tier_access: "paid",
  tier: { name: "Premium", access: "paid" }, ...over,
});

/* ── subscriptionActions (which buttons the detail shows) ─────────────────── */

test("subscriptionActions: per-status buttons, exact prototype semantics", () => {
  assert.deepEqual(subscriptionActions(sub()), ["pause", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "trial" })), ["extend-trial", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "past_due" })), ["retry-payment", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "paused" })), ["resume", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "canceled" })), ["reactivate"]);
});

test("subscriptionActions: free non-trial plans have no billing actions", () => {
  assert.deepEqual(subscriptionActions(sub({ status: "active", price: 0, tier_access: "free" })), []);
  // A trial on a free tier still gets trial actions.
  assert.deepEqual(subscriptionActions(sub({ status: "trial", price: 0, tier_access: "free" })), ["extend-trial", "cancel"]);
});

/* ── applySubscriptionAction ──────────────────────────────────────────────── */

test("applySubscriptionAction: pause/cancel clear next_date; resume/reactivate schedule a cycle out", () => {
  const paused = applySubscriptionAction("pause", sub({ next_date: "2026-10-12" }), T);
  assert.deepEqual(paused.patch, { status: "paused", next_date: null });
  assert.equal(paused.event, "Paused by admin");

  const canceled = applySubscriptionAction("cancel", sub({ next_date: "2026-10-12" }), T);
  assert.deepEqual(canceled.patch, { status: "canceled", next_date: null });

  const resumed = applySubscriptionAction("resume", sub({ status: "paused", next_date: null }), T);
  assert.equal(resumed.patch.status, "active");
  assert.equal(resumed.patch.next_date, "2026-10-29"); // +30 days
  assert.equal(resumed.event, "Resumed by admin");

  const annual = applySubscriptionAction("reactivate", sub({ status: "canceled", cycle: "annual", next_date: null }), T);
  assert.equal(annual.patch.next_date, addCycleDays(T, "annual"));
  assert.equal(annual.patch.next_date, "2027-09-29");
  assert.equal(annual.event, "Reactivated by admin");
});

test("applySubscriptionAction: extend-trial adds 7 days from the later of next_date/today", () => {
  const future = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: "2026-10-05" }), T);
  assert.equal(future.patch.next_date, "2026-10-12");
  assert.equal(future.patch.status, undefined);

  // next_date already in the past (or missing) → extend from today.
  const past = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: "2026-09-01" }), T);
  assert.equal(past.patch.next_date, "2026-10-06");
  const none = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: null }), T);
  assert.equal(none.patch.next_date, "2026-10-06");
});

test("applySubscriptionAction: illegal transitions are rejected with a stable code", () => {
  for (const [action, s] of [
    ["pause", sub({ status: "paused" })],
    ["resume", sub({ status: "active" })],
    ["reactivate", sub({ status: "active" })],
    ["extend-trial", sub({ status: "active" })],
    ["retry-payment", sub({ status: "active" })],
    ["cancel", sub({ status: "canceled" })],
    ["pause", sub({ status: "active", price: 0, tier_access: "free" })],
  ]) {
    const out = applySubscriptionAction(action, s, T);
    assert.ok(out.error, `${action} on ${s.status} should fail`);
    assert.equal(out.error.code, "invalid_action");
  }
});

/* ── customers ────────────────────────────────────────────────────────────── */

test("customerStanding/customerBalance: exact prototype precedence", () => {
  const s = (over) => sub(over);
  assert.deepEqual(customerStanding([s({ status: "past_due" }), s({ status: "active" })]), { key: "past_due", label: "Past due" });
  assert.deepEqual(customerStanding([s({ status: "active" })]), { key: "active", label: "Good standing" });
  assert.deepEqual(customerStanding([s({ status: "active", price: 0, tier_access: "free" }), s({ status: "trial" })]), { key: "trial", label: "On trial" });
  assert.deepEqual(customerStanding([]), { key: "canceled", label: "No active paid plan" });
  assert.deepEqual(customerStanding([s({ status: "canceled" })]), { key: "canceled", label: "No active paid plan" });

  assert.equal(customerBalance([s({ status: "past_due", price: 14400 }), s({ status: "active", price: 1500 })]), 14400);
  assert.equal(customerBalance([s({ status: "active" })]), 0);
});

/* ── invoices ─────────────────────────────────────────────────────────────── */

test("applyInvoiceAction: finalize/mark-paid/void transitions", () => {
  const fin = applyInvoiceAction("finalize", "draft", T);
  assert.deepEqual(fin.patch, { status: "open" });

  const paid = applyInvoiceAction("mark-paid", "open", T);
  assert.deepEqual(paid.patch, { status: "paid", paid_at: T });

  const voided = applyInvoiceAction("void", "draft", T);
  assert.equal(voided.patch.status, "void");
  assert.equal(voided.patch.voided_at, `${T}T00:00:00.000Z`);

  for (const [action, status] of [["finalize", "open"], ["mark-paid", "draft"], ["mark-paid", "paid"], ["void", "paid"], ["void", "void"]]) {
    const out = applyInvoiceAction(action, status, T);
    assert.ok(out.error, `${action} on ${status} should fail`);
    assert.equal(out.error.code, "invalid_action");
  }
});

test("invoiceTimeline: derived most-recent-first; invoiceOverdueDays only for open past due", () => {
  const tl = invoiceTimeline({ status: "paid", issued_at: "2026-09-12", due_at: "2026-09-12", paid_at: "2026-09-12", created_at: "2026-09-12T10:00:00Z" });
  assert.equal(tl[0].text, "Marked paid by admin");
  assert.ok(tl.some((e) => e.text === "Invoice issued"));

  assert.equal(invoiceOverdueDays({ status: "open", due_at: "2026-09-25" }, T), 4);
  assert.equal(invoiceOverdueDays({ status: "open", due_at: "2026-10-25" }, T), 0);
  assert.equal(invoiceOverdueDays({ status: "paid", due_at: "2026-09-25" }, T), 0);
  assert.equal(invoiceOverdueDays({ status: "open", due_at: null }, T), 0);
});

/* ═══ computeOverview (Phase 5 analytics) ════════════════════════════════════ */

import { computeOverview } from "./billingModel.js";

const today = "2026-09-29";

test("computeOverview: KPIs count paying/trials/past-due and 7-day trial endings", () => {
  const subs = [
    { id: "a", learner_id: "L1", customer_id: "C1", status: "active", price: 1500, cycle: "monthly", next_date: "2026-10-20", tier_name: "Premium", learner_name: "Ada", trial_ended: false, ever_paid: true },
    { id: "b", learner_id: "L2", customer_id: "C2", status: "active", price: 0, cycle: "monthly", next_date: null, tier_name: "Freemium", learner_name: "Bo", trial_ended: false, ever_paid: false },
    { id: "c", learner_id: "L3", customer_id: "C3", status: "trial", price: 1500, cycle: "monthly", next_date: "2026-10-02", tier_name: "Premium", learner_name: "Cy", trial_ended: false, ever_paid: false },
    { id: "d", learner_id: "L4", customer_id: "C4", status: "past_due", price: 1500, cycle: "monthly", next_date: "2026-09-28", tier_name: "Premium", learner_name: "Dee", trial_ended: true, ever_paid: true },
    { id: "e", learner_id: "L5", customer_id: "C5", status: "trial", price: 1500, cycle: "monthly", next_date: "2026-11-01", tier_name: "Premium", learner_name: "Em", trial_ended: false, ever_paid: false },
  ];
  const o = computeOverview({ subs, paidInvoices: [], activePilots: 3, today });
  assert.equal(o.kpis.paying, 1);
  assert.equal(o.kpis.trials, 2);
  assert.equal(o.kpis.trialsEnding, 1);           // Cy ends within 7 days, Em doesn't
  assert.equal(o.kpis.pastDue, 1);
  assert.equal(o.kpis.atRisk, 1500);
  assert.equal(o.kpis.activePilots, 3);
});

test("computeOverview: conversion is learner-based and null until a trial concluded", () => {
  const empty = computeOverview({ subs: [], paidInvoices: [], activePilots: 0, today });
  assert.equal(empty.kpis.conversion.pct, null);

  const subs = [
    // L1: trial ended, then paid → converted. L2: trial ended, never paid. L3: still trialing (not concluded).
    { id: "a", learner_id: "L1", status: "active", price: 1500, cycle: "monthly", tier_name: "Premium", trial_ended: true, ever_paid: true },
    { id: "b", learner_id: "L2", status: "active", price: 0, cycle: "monthly", tier_name: "Freemium", trial_ended: true, ever_paid: false },
    { id: "c", learner_id: "L3", status: "trial", price: 1500, cycle: "monthly", tier_name: "Premium", trial_ended: false, ever_paid: false },
  ];
  const o = computeOverview({ subs, paidInvoices: [], activePilots: 0, today });
  assert.deepEqual(o.kpis.conversion, { pct: 50, converted: 1, concluded: 2 });
});

test("computeOverview: plan mix is Trial + active subs per tier, Freemium/Premium first", () => {
  const subs = [
    { id: "a", learner_id: "L1", status: "active", price: 1500, cycle: "monthly", tier_name: "Premium", trial_ended: false, ever_paid: true },
    { id: "b", learner_id: "L2", status: "active", price: 0, cycle: "monthly", tier_name: "Freemium", trial_ended: false, ever_paid: false },
    { id: "c", learner_id: "L3", status: "active", price: 0, cycle: "monthly", tier_name: "Freemium", trial_ended: false, ever_paid: false },
    { id: "d", learner_id: "L4", status: "active", price: 0, cycle: "monthly", tier_name: "Custom Tier", trial_ended: false, ever_paid: false },
    { id: "e", learner_id: "L5", status: "trial", price: 1500, cycle: "monthly", tier_name: "Premium", trial_ended: false, ever_paid: false },
    { id: "f", learner_id: "L6", status: "canceled", price: 1500, cycle: "monthly", tier_name: "Premium", trial_ended: false, ever_paid: true }, // not in mix
  ];
  const o = computeOverview({ subs, paidInvoices: [], activePilots: 0, today });
  assert.deepEqual(o.mix, [
    { label: "Trial", n: 1 },
    { label: "Freemium", n: 2 },
    { label: "Premium", n: 1 },
    { label: "Custom Tier", n: 1 },
  ]);
});

test("computeOverview: attention lists past_due then ending trials; renewals window is 30 days", () => {
  const subs = [
    { id: "pd", learner_id: "L1", status: "past_due", price: 1500, cycle: "monthly", next_date: "2026-09-20", tier_name: "Premium", learner_name: "Ada", trial_ended: false, ever_paid: true },
    { id: "te", learner_id: "L2", status: "trial", price: 1500, cycle: "monthly", next_date: "2026-10-01", tier_name: "Premium", learner_name: "Bo", trial_ended: false, ever_paid: false },
    { id: "r1", learner_id: "L3", status: "active", price: 1500, cycle: "monthly", next_date: "2026-10-15", tier_name: "Premium", learner_name: "Cy", trial_ended: false, ever_paid: true },
    { id: "r2", learner_id: "L4", status: "active", price: 18000, cycle: "annual", next_date: "2026-10-31", tier_name: "Premium", learner_name: "Dee", trial_ended: false, ever_paid: true },
    { id: "x",  learner_id: "L5", status: "active", price: 1500, cycle: "monthly", next_date: "2026-12-25", tier_name: "Premium", learner_name: "Em", trial_ended: false, ever_paid: true }, // outside 30d
  ];
  const o = computeOverview({ subs, paidInvoices: [], activePilots: 0, today });
  assert.deepEqual(o.attention.map((a) => a.kind), ["past_due", "trial_ending"]);
  assert.equal(o.attention[0].subscription_id, "pd");
  assert.deepEqual(o.renewals.map((r) => r.subscription_id), ["r1"]); // r2 (day 32) and x (day 87) are outside the window
});

test("computeOverview: MRR normalizes annual to monthly; revenue comes only from paid invoices", () => {
  const subs = [
    { id: "a", learner_id: "L1", customer_id: "C1", status: "active", price: 1500, cycle: "monthly", next_date: "2026-10-20", tier_name: "Premium", trial_ended: false, ever_paid: true },
    { id: "b", learner_id: "L2", customer_id: "C2", status: "active", price: 18000, cycle: "annual", next_date: "2027-03-01", tier_name: "Premium", trial_ended: false, ever_paid: true },
    { id: "c", learner_id: "L3", customer_id: "C3", status: "active", price: 1500, cycle: "monthly", next_date: "2026-10-01", tier_name: "Premium", trial_ended: false, ever_paid: true }, // trial? no — active
  ];
  const paidInvoices = [
    { customer_id: "C1", amount: 1500 },
    { customer_id: "C1", amount: 1500 },
    { customer_id: "C2", amount: 18000 },
    { customer_id: "C4", amount: 500 },
  ];
  const o = computeOverview({ subs, paidInvoices, activePilots: 0, today });
  assert.equal(o.revenue.mrr, 4500); // 1500 + 18000/12 + 1500
  assert.equal(o.revenue.arr, 4500 * 12);
  assert.equal(o.revenue.revenueToDate, 21500);
  assert.equal(o.revenue.payingCustomers, 3);
  assert.equal(o.revenue.avgPerCustomer, Math.round(21500 / 3));
});
