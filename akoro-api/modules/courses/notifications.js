/**
 * notifications.js  —  Piabam Notifications router
 *
 * Handles:
 *   - In-app notification list (paginated)
 *   - Mark one or all as read
 *   - Delete notification
 *   - Get / update notification preferences
 *   - Register push token
 *
 * Usage in app.js:
 *   import notificationsRouter from "./routes/notifications.js";
 *   app.use("/api", notificationsRouter);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/index.js";
import { getPublicKey, isPushEnabled }    from "../notifications/webpush.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true, data, ...meta });
const res204 = (res)                  => res.status(204).send();
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  // GET /api/notifications?limit=20&offset=0
  list: asyncHandler(async (req, res) => {
    const { limit = 20, offset = 0 } = req.query;

    const { data, error, count } = await db
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw new Error(error.message);

    // Unread must be the TOTAL count of unread rows, not just those on this
    // page — otherwise a ?limit=1 badge poll caps the count at 1.
    const { count: unread, error: unreadErr } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .eq("is_read", false);
    if (unreadErr) throw new Error(unreadErr.message);

    res200(res, data ?? [], { total: count ?? 0, unread: unread ?? 0 });
  }),

  // POST /api/notifications/mark-read
  // Body: { ids: ["uuid1","uuid2"] } or { all: true }
  markRead: asyncHandler(async (req, res) => {
    const { ids, all } = req.body;

    let query = db
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", req.user.id);

    if (!all && ids?.length) query = query.in("id", ids);

    const { error } = await query;
    if (error) throw new Error(error.message);
    res200(res, { message: "Marked as read" });
  }),

  // DELETE /api/notifications/:id
  delete: asyncHandler(async (req, res) => {
    const { error } = await db
      .from("notifications")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);

    if (error) throw new Error(error.message);
    res204(res);
  }),

  // GET /api/notifications/preferences
  getPreferences: asyncHandler(async (req, res) => {
    const { data } = await db
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    res200(res, data ?? {
      email_enabled: true, sms_enabled: true,
      push_enabled: false, whatsapp_enabled: false,
      notify_session_reminders: true, notify_session_started: true,
      notify_session_cancelled: true, notify_session_rescheduled: true,
      notify_new_announcements: true, notify_qa_replies: true,
    });
  }),

  // PUT /api/notifications/preferences
  updatePreferences: asyncHandler(async (req, res) => {
    const allowed = [
      "email_enabled", "sms_enabled", "push_enabled", "whatsapp_enabled",
      "notify_session_reminders", "notify_session_started",
      "notify_session_cancelled", "notify_session_rescheduled",
      "notify_new_announcements", "notify_qa_replies",
      "phone_number", "whatsapp_number",
    ];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    updates.updated_at = now();

    const { data, error } = await db
      .from("user_notification_preferences")
      .upsert({ user_id: req.user.id, ...updates }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw new Error(error.message);
    res200(res, data);
  }),

  // GET /api/notifications/push/public-key
  // The VAPID public key the browser needs to subscribe. Also tells the client
  // whether push is configured server-side at all.
  pushPublicKey: asyncHandler(async (req, res) => {
    res200(res, { enabled: isPushEnabled(), public_key: getPublicKey() || null });
  }),

  // POST /api/notifications/push/subscribe
  // Body: { subscription: { endpoint, keys: { p256dh, auth } } }
  pushSubscribe: asyncHandler(async (req, res) => {
    const sub = req.body?.subscription || req.body;
    const endpoint = sub?.endpoint;
    const p256dh   = sub?.keys?.p256dh;
    const auth     = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth)
      return res.status(400).json({ success: false, message: "Invalid push subscription" });

    const { error } = await db.from("web_push_subscriptions").upsert({
      user_id:      req.user.id,
      endpoint, p256dh, auth,
      user_agent:   req.headers["user-agent"] || null,
      last_used_at: now(),
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);

    // Reflect the opt-in in the user's preferences.
    await db.from("user_notification_preferences")
      .upsert({ user_id: req.user.id, push_enabled: true, updated_at: now() }, { onConflict: "user_id" });

    res200(res, { subscribed: true });
  }),

  // POST /api/notifications/push/unsubscribe
  // Body: { endpoint }  — removes just this device.
  pushUnsubscribe: asyncHandler(async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (endpoint) {
      await db.from("web_push_subscriptions").delete()
        .eq("user_id", req.user.id).eq("endpoint", endpoint);
    }
    res200(res, { unsubscribed: true });
  }),

  // POST /api/notifications/push-token
  registerPushToken: asyncHandler(async (req, res) => {
    const { push_token } = req.body;
    if (!push_token)
      return res.status(400).json({ success: false, message: "push_token is required" });

    const { data, error } = await db
      .from("user_notification_preferences")
      .upsert(
        { user_id: req.user.id, push_token, push_enabled: true, updated_at: now() },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    res200(res, { registered: true, push_enabled: true });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get ("/notifications",                authenticateToken, handlers.list);
router.post("/notifications/mark-read",      authenticateToken, handlers.markRead);
router.delete("/notifications/:id",          authenticateToken, handlers.delete);
router.get ("/notifications/preferences",    authenticateToken, handlers.getPreferences);
router.put ("/notifications/preferences",    authenticateToken, handlers.updatePreferences);
router.post("/notifications/push-token",     authenticateToken, [body("push_token").notEmpty()], runValidation, handlers.registerPushToken);
router.get ("/notifications/push/public-key", authenticateToken, handlers.pushPublicKey);
router.post("/notifications/push/subscribe",  authenticateToken, handlers.pushSubscribe);
router.post("/notifications/push/unsubscribe", authenticateToken, handlers.pushUnsubscribe);

export default router;
