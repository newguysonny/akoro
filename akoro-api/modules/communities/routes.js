/**
 * modules/communities/routes.js — learner communities (higher-ed tier)
 *
 * Communities are study groups for higher-ed learners. The learner app's
 * Community page lists the caller's joined communities (GET /mine); the
 * plus icon creates one (POST /); every community has an Activity page
 * (community activities posted by its creator), plus settings / people /
 * analytics pages for the creator and a profile view for members.
 *
 * Mounted at /api/communities. All routes require an authenticated user.
 *
 * Community:
 *   GET    /mine               → my joined communities (role + member counts)
 *   GET    /                   → public communities (discovery, ?q= to search)
 *   POST   /                   → create (body: name, description?, emoji?)
 *   GET    /:id                → one community + my membership
 *   PATCH  /:id                → edit (creator only)
 *   POST   /:id/join           → join (idempotent)
 *   POST   /:id/leave          → leave (members only — creators delete instead)
 *   DELETE /:id                → delete (creator only)
 *
 * Community activities (creator posts, members submit):
 *   GET    /:id/activities     → the community's activity feed (with
 *                                creator name, submission counts, my_submitted)
 *   POST   /:id/activities     → create (creator only)
 *   POST   /activities/:activityId/submit → member submits (idempotent)
 *   DELETE /activities/:activityId        → delete (activity creator only)
 *
 * Community items (members share content into a community — the
 * "Add to community" page, mirroring the library's Add-to-folder):
 *   GET    /:id/items          → the community's shared materials (members only)
 *   POST   /items              → add one thing to N communities (members
 *                                only, idempotent per community)
 *
 * Creator tools:
 *   GET    /:id/members        → member list (names, avatars, roles)
 *   GET    /:id/analytics      → community stats + recent submissions
 *
 * NOTE on ordering: the /activities/:activityId routes are registered
 * before the /:id routes — "activities" must not be captured as :id.
 *
 * Phase 19 step 4 split: this file is the router + thin handler wiring +
 * middleware. Flows live in service.js, pure gates in rules.js, and Supabase
 * access in store.js. Endpoints, ordering, middleware order, envelopes, and
 * status/error text are unchanged.
 */

import { Router }                         from "express";
import { authenticateToken }              from "../auth/index.js";
import { DEFAULT_QUERY_TIMEOUT_MS }       from "../../lib/queryDeadline.js";
import { isCommunitySchemaUnavailable }   from "./store.js";
import {
  submitActivity,
  deleteActivity,
  addItems,
  listMyCommunities,
  listPublicCommunities,
  createCommunity,
  getCommunity,
  listActivities,
  createActivity,
  listItems,
  listMembers,
  getAnalytics,
  updateCommunity,
  joinCommunity,
  leaveCommunity,
  deleteCommunity,
} from "./service.js";
import {
  itemCommunities,
  getDiscussionMessages,
  postDiscussionMessage,
} from "./discussions.js";

const router = Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Arrival + auth brackets ────────────────────────────────────────────────
// The detail route has hung for days across two services and three builds,
// while every audited path on e33316f is deadline-capped (10s auth I/O, 20s
// queries). When reality disagrees with the audit, instrument reality: one
// line the INSTANT a communities request arrives, one when auth has passed.
// The next hang then names its segment from the logs alone —
//   no "arrived"  → the request never reached this process (edge/SW/browser)
//   arrived, no "auth ok" → wedged in authenticateToken (the [auth] 503 line
//                           names the call; its absence is itself a finding)
//   auth ok, no response  → wedged in a route handler (the step 504 line
//                           names the query)
router.use((req, _res, next) => {
  console.log(`[communities] ${req.method} ${req.originalUrl} — arrived`);
  next();
});
router.use(authenticateToken);
router.use((req, _res, next) => {
  console.log(`[communities] ${req.method} ${req.originalUrl} — auth ok (${req.user?.role ?? "?"} ${String(req.user?.id ?? "").slice(0, 8)})`);
  next();
});

/* ── Query deadlines ──────────────────────────────────────────────────────
   A wedged database call (a stuck lock, a starved PostgREST pool) never
   rejects on its own — the route's promise stays pending forever, the HTTP
   request never answers, and the learner watches a skeleton that never ends
   (live report: the community details page "keeps loading, no data
   arriving" — while every unauthenticated probe of the same route answered
   instantly). Each communities query races a deadline in store.js; past it
   the route answers 504 at once and the step that hung is named in the
   server logs, so the next occurrence points at its culprit instead of
   masquerading as a frontend bug. The losing query is left to settle in the
   background — its late failure is swallowed on purpose. */
// Exported for /health: the deployed build must be able to PROVE it carries
// the query deadline — a deploy that silently rolled back is otherwise
// indistinguishable from a hang, which is exactly the ambiguity we just hit.
export const COMMUNITIES_QUERY_TIMEOUT_MS = DEFAULT_QUERY_TIMEOUT_MS;

// ─── community activity routes (registered before /:id routes) ──────────────

/* POST /activities/:activityId/submit — a member submits (idempotent). */
router.post("/activities/:activityId/submit", asyncHandler(submitActivity));

/* DELETE /activities/:activityId — the activity's creator only. */
router.delete("/activities/:activityId", asyncHandler(deleteActivity));

// ─── POST /items — add one thing to N communities (members only) ───────────
// Registered before the /:id routes ("items" must not be captured as :id).
router.post("/items", asyncHandler(addItems));

// ─── community discussions — the community's group chat, in the reader ──────
/* GET /for-item?itemType=record&itemRef=<id> — which of MY communities
   have this content (registered before the /:id routes). */
router.get("/for-item", asyncHandler(itemCommunities));

/* GET /:id/discussion/messages — persistent history (members only). */
router.get("/:id/discussion/messages", asyncHandler(getDiscussionMessages));

/* POST /:id/discussion/messages { body } — post (members only; REST is the
   single write path and the socket room only fans out). */
router.post("/:id/discussion/messages", asyncHandler(postDiscussionMessage));

// ─── GET /mine — my joined communities ──────────────────────────────────────

router.get("/mine", asyncHandler(listMyCommunities));

// ─── GET / — public communities (discovery) ─────────────────────────────────

router.get("/", asyncHandler(listPublicCommunities));

// ─── POST / — create ────────────────────────────────────────────────────────

router.post("/", asyncHandler(createCommunity));

// ─── GET /:id — one community + my membership ───────────────────────────────

router.get("/:id", asyncHandler(getCommunity));

// ─── community activity feed ────────────────────────────────────────────────

/* GET /:id/activities — the community's activities, newest first. */
router.get("/:id/activities", asyncHandler(listActivities));

/* POST /:id/activities — the community creator posts an activity. */
router.post("/:id/activities", asyncHandler(createActivity));

/* GET /:id/items — the community's shared materials (members only). */
router.get("/:id/items", asyncHandler(listItems));

// ─── creator tools: members + analytics ─────────────────────────────────────

/* GET /:id/members — who's in the community (owner first). */
router.get("/:id/members", asyncHandler(listMembers));

/* GET /:id/analytics — community stats + recent submissions. */
router.get("/:id/analytics", asyncHandler(getAnalytics));

// ─── PATCH /:id — edit (creator only) ───────────────────────────────────────

router.patch("/:id", asyncHandler(updateCommunity));

// ─── POST /:id/join — join (idempotent) ─────────────────────────────────────

router.post("/:id/join", asyncHandler(joinCommunity));

// ─── POST /:id/leave — leave (members only) ─────────────────────────────────

router.post("/:id/leave", asyncHandler(leaveCommunity));

// ─── DELETE /:id — delete (creator only) ────────────────────────────────────

router.delete("/:id", asyncHandler(deleteCommunity));

// The communities feature is backed by its own late-added migration. Surface a
// deploy/readiness problem truthfully instead of the global, unhelpful 500; the
// client can tell the learner to retry while the release's schema step finishes.
router.use((err, _req, res, next) => {
  if (!isCommunitySchemaUnavailable(err)) return next(err);

  console.error("[communities] schema is not ready", {
    operation: err.operation,
    code: err.code,
    message: err.message,
    details: err.details,
  });
  return res.status(503).json({
    success: false,
    error: "Communities are still being set up. Please try again in a minute.",
    code: "COMMUNITIES_SCHEMA_PENDING",
  });
});

// A query that outlived its deadline (see store.js `step`) answers 504 instead
// of hanging the learner's page on a skeleton forever. The step that hung has
// already been named in the server logs by then.
router.use((err, _req, res, next) => {
  if (!err?.deadlineExceeded) return next(err);
  return res.status(504).json({
    success: false,
    error: "This community is taking too long to load. Please try again.",
    code: "COMMUNITIES_QUERY_TIMEOUT",
    step: err.step,
  });
});

export default router;
