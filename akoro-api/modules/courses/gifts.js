/**
 * routes/gifts.js  —  Piabam Gift a Course
 *
 * Flow:
 *   1. Sender pays for the course via Paystack
 *   2. On webhook success, a gift token is generated and emailed to recipient
 *   3. Recipient redeems the token → enrollment is activated
 *   4. Gift expires after 90 days if unredeemed
 *
 * Usage in app.js:
 *   import giftsRouter from "./routes/gifts.js";
 *   app.use("/api", giftsRouter);
 */

import { Router }                         from "express";
import axios                              from "axios";
import crypto                             from "crypto";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now       = () => new Date().toISOString();
const GIFT_TTL  = 90; // days before gift token expires

const generateToken = () => crypto.randomBytes(24).toString("hex");

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  /**
   * POST /api/gifts/initiate
   * Sender initiates a gift purchase.
   * Returns a Paystack checkout URL — metadata includes gift details.
   */
  initiate: asyncHandler(async (req, res) => {
    const { course_id, recipient_email, message } = req.body;
    const senderId = req.user.id;

    // Validate course
    const { data: course } = await db
      .from("courses")
      .select("id, title, price, discount_price, discount_expires_at, is_free, currency, is_published")
      .eq("id", course_id).single();

    if (!course)           return res400(res, "Course not found");
    if (!course.is_published) return res400(res, "Course is not available");
    if (course.is_free || course.price === 0)
      return res400(res, "Free courses cannot be gifted — share the link directly");

    // Can't gift to yourself
    const { data: sender } = await db.from("users").select("email").eq("id", senderId).single();
    if (sender?.email?.toLowerCase() === recipient_email.toLowerCase())
      return res400(res, "You cannot gift a course to yourself");

    // Check if recipient is already enrolled
    const { data: recipientUser } = await db
      .from("users").select("id").eq("email", recipient_email.toLowerCase()).single();

    if (recipientUser) {
      const { data: enrolled } = await db
        .from("enrollments").select("id")
        .eq("user_id", recipientUser.id).eq("course_id", course_id).single();
      if (enrolled) return res400(res, "Recipient is already enrolled in this course");
    }

    // Effective price
    const nowDate      = new Date();
    const discActive   = course.discount_price &&
      (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate);
    const priceKobo    = discActive ? course.discount_price : course.price;

    // Create pending payment
    const { data: payment } = await db.from("payments").insert({
      user_id:          senderId,
      course_id,
      amount_paid:      priceKobo,
      currency:         course.currency ?? "NGN",
      payment_provider: "paystack",
      status:           "pending",
    }).select().single();

    // Initiate Paystack
    const { data: psData } = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email:     sender.email,
        amount:    priceKobo,
        currency:  course.currency ?? "NGN",
        reference: `akoro_gift_${payment.id}_${Date.now()}`,
        metadata: {
          payment_id:       payment.id,
          course_id,
          user_id:          senderId,
          course_title:     course.title,
          is_gift:          true,
          recipient_email:  recipient_email.toLowerCase(),
          gift_message:     message ?? null,
        },
        callback_url: `${process.env.APP_URL}/api/payments/verify`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    await db.from("payments").update({ provider_reference: psData.data.reference }).eq("id", payment.id);

    res201(res, {
      checkout_url:    psData.data.authorization_url,
      reference:       psData.data.reference,
      recipient_email,
      price_ngn:       priceKobo / 100,
      course_title:    course.title,
    });
  }),

  /**
   * POST /api/gifts/webhook-create
   * Called internally by payments.js verifyWebhook when is_gift = true.
   * Creates the gift record and sends the redemption email.
   */
  createFromWebhook: async ({ paymentId, courseId, senderId, recipientEmail, message }) => {
    const token     = generateToken();
    const expiresAt = new Date(Date.now() + GIFT_TTL * 86_400_000).toISOString();

    const { data: gift } = await db.from("gifts").insert({
      sender_id:       senderId,
      recipient_email: recipientEmail.toLowerCase(),
      course_id:       courseId,
      payment_id:      paymentId,
      token,
      message:         message ?? null,
      status:          "pending",
      expires_at:      expiresAt,
    }).select().single();

    // Send gift email
    const { data: course }  = await db.from("courses").select("title").eq("id", courseId).single();
    const { data: sender }  = await db.from("users").select("full_name").eq("id", senderId).single();
    const redeemUrl         = `${process.env.APP_URL}/gifts/redeem?token=${token}`;

    try {
      const nodemailer = await import("nodemailer");
      const transport  = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      await transport.sendMail({
        from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.app"}>`,
        to:      recipientEmail,
        subject: `🎁 You've been gifted a course: ${course?.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
            <h2>You've received a course gift! 🎉</h2>
            <p><strong>${sender?.full_name ?? "Someone"}</strong> gifted you
               <strong>${course?.title}</strong> on Piabam.</p>
            ${message ? `<blockquote style="border-left:3px solid #E8884A;padding-left:12px;color:#555">${message}</blockquote>` : ""}
            <p>Click the button below to redeem your gift. This link expires in ${GIFT_TTL} days.</p>
            <a href="${redeemUrl}" style="display:inline-block;padding:12px 24px;background:#E8884A;color:#fff;border-radius:100px;text-decoration:none;font-weight:700">
              Redeem your gift →
            </a>
            <p style="color:#999;font-size:12px;margin-top:24px">
              Or copy this link: ${redeemUrl}
            </p>
          </div>
        `,
      });
      console.log(`[gifts] ✅ Gift email sent to ${recipientEmail}`);
    } catch (e) {
      console.error("[gifts] ⚠️  Failed to send gift email:", e.message);
    }

    return gift;
  },

  /**
   * POST /api/gifts/redeem
   * Recipient redeems a gift token.
   * Must be logged in — enrollment is tied to their user account.
   */
  redeem: asyncHandler(async (req, res) => {
    const { token } = req.body;
    const userId    = req.user.id;

    const { data: gift } = await db
      .from("gifts")
      .select("*, courses ( id, title )")
      .eq("token", token)
      .single();

    if (!gift)                              return res404(res, "Gift not found");
    if (gift.status === "redeemed")         return res400(res, "This gift has already been redeemed");
    if (gift.status === "expired")          return res400(res, "This gift has expired");
    if (new Date(gift.expires_at) < new Date()) {
      await db.from("gifts").update({ status: "expired" }).eq("id", gift.id);
      return res400(res, "This gift has expired");
    }

    // Verify email matches (or allow redemption if recipient has the token)
    const { data: user } = await db.from("users").select("email").eq("id", userId).single();
    if (user?.email?.toLowerCase() !== gift.recipient_email) {
      return res400(res, "This gift was sent to a different email address");
    }

    // Check not already enrolled
    const { data: existing } = await db
      .from("enrollments").select("id, status")
      .eq("user_id", userId).eq("course_id", gift.course_id).single();
    if (existing?.status === "active") return res400(res, "You are already enrolled in this course");

    // Activate enrollment
    await db.from("enrollments").upsert(
      { user_id: userId, course_id: gift.course_id, payment_id: gift.payment_id, status: "active" },
      { onConflict: "user_id,course_id" }
    );

    // Mark gift redeemed
    await db.from("gifts").update({
      status:            "redeemed",
      recipient_user_id: userId,
      redeemed_at:       now(),
    }).eq("id", gift.id);

    try { await db.rpc("increment_course_students", { course_id_input: gift.course_id }); } catch {}

    res200(res, {
      redeemed:     true,
      course_id:    gift.course_id,
      course_title: gift.courses?.title,
      message:      "Gift redeemed! You are now enrolled.",
    });
  }),

  /**
   * GET /api/gifts/sent
   * Sender's gift history.
   */
  listSent: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("gifts")
      .select(`
        id, recipient_email, status, message,
        expires_at, redeemed_at, created_at,
        courses ( id, title, cover_image_url )
      `)
      .eq("sender_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/gifts/received
   * Recipient's received gifts (matched by email).
   */
  listReceived: asyncHandler(async (req, res) => {
    const { data: user } = await db.from("users").select("email").eq("id", req.user.id).single();

    const { data, error } = await db
      .from("gifts")
      .select(`
        id, status, message, expires_at, redeemed_at, created_at,
        courses ( id, title, cover_image_url ),
        sender:users!gifts_sender_id_fkey ( full_name, avatar_url )
      `)
      .eq("recipient_email", user?.email?.toLowerCase())
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.post("/gifts/initiate",  authenticateToken, [
  body("course_id").notEmpty(),
  body("recipient_email").isEmail().normalizeEmail(),
  body("message").optional().trim().isLength({ max: 500 }),
], runValidation, handlers.initiate);

router.post("/gifts/redeem",    authenticateToken, [
  body("token").notEmpty().withMessage("Redemption token is required"),
], runValidation, handlers.redeem);

router.get ("/gifts/sent",      authenticateToken, handlers.listSent);
router.get ("/gifts/received",  authenticateToken, handlers.listReceived);

export { handlers as giftHandlers };
export default router;
