/**
 * payouts-earnings.js  —  earnings read/aggregation layer
 *
 * Extracted from payouts.js (Phase 19 step 4). Holds the pure earnings
 * summary builder plus the instructor and admin earnings-overview handlers.
 * Queries, commission maths and response shapes are unchanged; the mounted
 * router in payouts.js imports `earningsHandlers` and `adminEarningsHandlers`.
 */

import db                                 from "../../db.js";
import { businessConfig }                 from "../../config/index.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });

// ─── Earnings summary builder ─────────────────────────────────────────────────

const buildEarningsSummary = (earnings) => {
  const all       = earnings ?? [];
  const pending   = all.filter((e) => e.status === "pending");
  const paid      = all.filter((e) => e.status === "paid");
  const refunded  = all.filter((e) => e.status === "refunded");

  const sumNet    = (rows) => rows.reduce((s, e) => s + e.net_amount, 0);
  const sumGross  = (rows) => rows.reduce((s, e) => s + e.gross_amount, 0);

  const pendingNet = sumNet(pending);

  return {
    commission_percent:       businessConfig.commissionPercent,
    total_gross_ngn:          sumGross(all) / 100,
    total_platform_fee_ngn:   all.reduce((s, e) => s + e.commission_amount, 0) / 100,
    total_net_ngn:            sumNet(all) / 100,
    pending_payout_ngn:       pendingNet / 100,
    paid_out_ngn:             sumNet(paid) / 100,
    refunded_ngn:             sumNet(refunded) / 100,
    total_sales:              all.length,
    pending_sales:            pending.length,
    can_request_payout:       pendingNet >= businessConfig.payoutMinimumKobo,
    minimum_payout_ngn:       businessConfig.payoutMinimumKobo / 100,
  };
};

// ─── Instructor earnings handlers ─────────────────────────────────────────────

const earningsHandlers = {

  /**
   * GET /api/instructor/earnings
   * Full earnings overview for the authenticated instructor.
   */
  overview: asyncHandler(async (req, res) => {
    const instructorId = req.user.id;

    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select(`
        id, gross_amount, commission_percent, commission_amount,
        net_amount, currency, status, earned_at, payout_id,
        courses ( id, title, cover_image_url ),
        student:users!instructor_earnings_student_id_fkey ( id, full_name, username )
      `)
      .eq("instructor_id", instructorId)
      .order("earned_at", { ascending: false });

    if (error) throw new Error(error.message);

    const summary = buildEarningsSummary(earnings ?? []);

    res200(res, {
      summary,
      earnings: earnings ?? [],
    });
  }),

  /**
   * GET /api/instructor/earnings/by-course
   * Earnings grouped by course — useful for the payout dashboard chart.
   */
  byCourse: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("course_id, net_amount, gross_amount, commission_amount, status, courses(id, title, cover_image_url)")
      .eq("instructor_id", req.user.id)
      .neq("status", "refunded");

    if (error) throw new Error(error.message);

    // Group by course
    const grouped = {};
    for (const e of (earnings ?? [])) {
      const cid = e.course_id;
      if (!grouped[cid]) {
        grouped[cid] = {
          course_id:        cid,
          course_title:     e.courses?.title,
          cover_image_url:  e.courses?.cover_image_url,
          total_sales:      0,
          gross_ngn:        0,
          platform_fee_ngn: 0,
          net_ngn:          0,
          pending_ngn:      0,
        };
      }
      grouped[cid].total_sales      += 1;
      grouped[cid].gross_ngn        += e.gross_amount / 100;
      grouped[cid].platform_fee_ngn += e.commission_amount / 100;
      grouped[cid].net_ngn          += e.net_amount / 100;
      if (e.status === "pending")
        grouped[cid].pending_ngn    += e.net_amount / 100;
    }

    res200(res, Object.values(grouped));
  }),

  /**
   * GET /api/instructor/earnings/monthly
   * Monthly earnings breakdown for chart display.
   */
  monthly: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("net_amount, gross_amount, commission_amount, status, earned_at")
      .eq("instructor_id", req.user.id)
      .neq("status", "refunded")
      .order("earned_at", { ascending: true });

    if (error) throw new Error(error.message);

    // Group by year-month
    const monthly = {};
    for (const e of (earnings ?? [])) {
      const key = e.earned_at.slice(0, 7); // "2025-06"
      if (!monthly[key]) {
        monthly[key] = { month: key, sales: 0, gross_ngn: 0, net_ngn: 0, platform_fee_ngn: 0 };
      }
      monthly[key].sales          += 1;
      monthly[key].gross_ngn      += e.gross_amount / 100;
      monthly[key].net_ngn        += e.net_amount / 100;
      monthly[key].platform_fee_ngn += e.commission_amount / 100;
    }

    res200(res, Object.values(monthly));
  }),
};

// ─── Admin earnings handlers ───────────────────────────────────────────────────

const adminEarningsHandlers = {

  /**
   * GET /api/admin/earnings
   * Platform-wide earnings overview (admin only).
   */
  platformOverview: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("gross_amount, commission_amount, net_amount, status, currency");

    if (error) throw new Error(error.message);

    const all         = earnings ?? [];
    const totalGross  = all.reduce((s, e) => s + e.gross_amount, 0);
    const totalCommission = all.reduce((s, e) => s + e.commission_amount, 0);
    const totalNet    = all.reduce((s, e) => s + e.net_amount, 0);
    const pendingNet  = all.filter((e) => e.status === "pending").reduce((s, e) => s + e.net_amount, 0);
    const paidNet     = all.filter((e) => e.status === "paid").reduce((s, e) => s + e.net_amount, 0);

    res200(res, {
      commission_percent:          businessConfig.commissionPercent,
      total_gmv_ngn:               totalGross / 100,       // Gross Merchandise Value
      total_platform_revenue_ngn:  totalCommission / 100,
      total_instructor_earnings_ngn: totalNet / 100,
      pending_instructor_payouts_ngn: pendingNet / 100,
      paid_out_ngn:                paidNet / 100,
      total_transactions:          all.length,
    });
  }),

  /**
   * GET /api/admin/earnings/instructors
   * Per-instructor earnings summary (admin only).
   */
  byInstructor: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select(`
        instructor_id, gross_amount, commission_amount, net_amount, status,
        instructor:users!instructor_earnings_instructor_id_fkey ( id, full_name, email, username )
      `);

    if (error) throw new Error(error.message);

    const grouped = {};
    for (const e of (earnings ?? [])) {
      const iid = e.instructor_id;
      if (!grouped[iid]) {
        grouped[iid] = {
          instructor_id:  iid,
          instructor:     e.instructor,
          total_sales:    0,
          gross_ngn:      0,
          platform_fee_ngn: 0,
          net_ngn:        0,
          pending_ngn:    0,
          paid_ngn:       0,
        };
      }
      grouped[iid].total_sales      += 1;
      grouped[iid].gross_ngn        += e.gross_amount / 100;
      grouped[iid].platform_fee_ngn += e.commission_amount / 100;
      grouped[iid].net_ngn          += e.net_amount / 100;
      if (e.status === "pending") grouped[iid].pending_ngn += e.net_amount / 100;
      if (e.status === "paid")    grouped[iid].paid_ngn    += e.net_amount / 100;
    }

    res200(res, Object.values(grouped).sort((a, b) => b.gross_ngn - a.gross_ngn));
  }),
};

export { buildEarningsSummary, earningsHandlers, adminEarningsHandlers };
