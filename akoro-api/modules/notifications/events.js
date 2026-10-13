/**
 * events.js — the canonical catalogue of platform notifications.
 *
 * Every domain raises notifications through a named helper here instead of
 * hand-writing titles/types at the call site. This keeps copy consistent, the
 * `type` strings stable (the frontend maps them to icons/colours), and makes it
 * trivial to see everything the platform can notify about in one file.
 *
 * All helpers are thin wrappers over notifyUser() and are best-effort — they
 * never throw, so a notification failure can't break the action that triggered
 * it. Amounts are passed already in naira (not kobo).
 */
import { notifyUser } from "../notify.js";

const ngn = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
const safe = (p) => notifyUser(p).catch((e) => console.warn("[notify:event] failed:", e?.message));

export const notify = {
  // ── Commerce: buyer (learner) ──────────────────────────────────────────────
  purchaseSuccess: ({ userId, email, name, itemTitle, amountNgn, link = "/orders" }) => safe({
    userId, type: "purchase_success", relatedId: null, link,
    title: "Payment successful",
    content: amountNgn === 0 ? `You now have access to “${itemTitle}”.` : `You paid ${ngn(amountNgn)} for “${itemTitle}”. Enjoy!`,
    email: email ? { to: email, name, subject: "Your Akoro purchase", ctaUrl: link, ctaLabel: "View order" } : null,
  }),

  orderProcessing: ({ userId, itemTitle, link = "/orders" }) => safe({
    userId, type: "order_processing", link,
    title: "Payment processing",
    content: `Your payment for “${itemTitle}” is being confirmed. We'll notify you once it's done.`,
  }),

  refundProcessed: ({ userId, email, name, itemTitle, amountNgn, link = "/orders" }) => safe({
    userId, type: "purchase_refunded", link,
    title: "Refund processed",
    content: `${ngn(amountNgn)} for “${itemTitle}” has been refunded. Access has been removed.`,
    email: email ? { to: email, name, subject: "Your Akoro refund", ctaUrl: link, ctaLabel: "View order" } : null,
  }),

  // ── Commerce: seller (instructor) ──────────────────────────────────────────
  newSale: ({ instructorId, courseTitle, netNgn, link = "/sales" }) => safe({
    userId: instructorId, type: "sale_new", link,
    title: "New sale",
    content: `Someone enrolled in “${courseTitle}”. You earned ${ngn(netNgn)}.`,
  }),

  payoutCompleted: ({ instructorId, email, name, amountNgn, link = "/earnings" }) => safe({
    userId: instructorId, type: "payout_completed", link,
    title: "Payout sent",
    content: `Your payout of ${ngn(amountNgn)} has been sent to your bank account.`,
    email: email ? { to: email, name, subject: "Your Akoro payout was sent", ctaUrl: link, ctaLabel: "View earnings" } : null,
  }),

  payoutFailed: ({ instructorId, amountNgn, reason, link = "/earnings" }) => safe({
    userId: instructorId, type: "payout_failed", link,
    title: "Payout failed",
    content: `Your payout of ${ngn(amountNgn)} could not be completed${reason ? `: ${reason}` : ""}. The funds are back in your balance — please retry.`,
  }),

  // ── Enrollment / access ────────────────────────────────────────────────────
  enrolled: ({ userId, courseTitle, link = "/library" }) => safe({
    userId, type: "enrollment_new", link,
    title: "You're enrolled",
    content: `You now have access to “${courseTitle}”. Start learning!`,
  }),

  agentUnlocked: ({ userId, agentName, link = "/discover" }) => safe({
    userId, type: "agent_unlocked", link,
    title: "Teaching guide unlocked",
    content: `“${agentName}” is now available for your sessions.`,
  }),

  toolUnlocked: ({ instructorId, toolName, link = "/marketplace" }) => safe({
    userId: instructorId, type: "tool_unlocked", link,
    title: "Tool unlocked",
    content: `“${toolName}” has been unlocked for your agent.`,
  }),

  // ── Reviews ────────────────────────────────────────────────────────────────
  newReview: ({ instructorId, courseTitle, rating, link = "/reviews" }) => safe({
    userId: instructorId, type: "review_new", link,
    title: "New review",
    content: `Your course “${courseTitle}” received a ${rating}-star review.`,
  }),

  // ── Course lifecycle (moderation) ──────────────────────────────────────────
  courseApproved: ({ instructorId, courseTitle, link = "/courses" }) => safe({
    userId: instructorId, type: "course_approved", link,
    title: "Course approved",
    content: `“${courseTitle}” is now live and available to learners.`,
  }),

  courseRejected: ({ instructorId, courseTitle, reason, link = "/courses" }) => safe({
    userId: instructorId, type: "course_rejected", link,
    title: "Course needs changes",
    content: `“${courseTitle}” wasn't approved${reason ? `: ${reason}` : ""}. Please review and resubmit.`,
  }),

  // ── Live sessions ──────────────────────────────────────────────────────────
  sessionReminder: ({ userId, sessionTitle, whenText, relatedId, link = "/live" }) => safe({
    userId, type: "session_reminder", relatedId, link,
    title: "Class starting soon",
    content: `“${sessionTitle}” starts ${whenText}.`,
  }),

  sessionStarted: ({ userId, sessionTitle, relatedId, link = "/live" }) => safe({
    userId, type: "session_started", relatedId, link,
    title: "Class is live",
    content: `“${sessionTitle}” has started — join now.`,
  }),

  sessionCancelled: ({ userId, sessionTitle, relatedId, link = "/live" }) => safe({
    userId, type: "session_cancelled", relatedId, link,
    title: "Class cancelled",
    content: `“${sessionTitle}” has been cancelled.`,
  }),

  // ── School ─────────────────────────────────────────────────────────────────
  schoolVerified: ({ userId, schoolName, link = "/dashboard" }) => safe({
    userId, type: "school_verified", link,
    title: "School approved",
    content: `“${schoolName}” has been verified. Your full dashboard is now unlocked.`,
  }),

  schoolRejected: ({ userId, schoolName, reason, link = "/dashboard" }) => safe({
    userId, type: "school_rejected", link,
    title: "School verification update",
    content: `“${schoolName}” could not be verified${reason ? `: ${reason}` : ""}.`,
  }),

  // ── Generic escape hatch ───────────────────────────────────────────────────
  custom: (payload) => safe(payload),
};
