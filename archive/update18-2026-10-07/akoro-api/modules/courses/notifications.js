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
import { authenticateToken }              from "../auth/routes.js";

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

    const unread = (data ?? []).filter((n) => !n.is_read).length;
    res200(res, data ?? [], { total: count ?? 0, unread });
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

export default router;
