/**
 * services/meetingService.js  —  Piabam Meeting Service
 *
 * Thin re-export so services can import meeting helpers
 * without coupling directly to the routes layer.
 * All logic lives in routes/meeting-integration.js.
 */
export { createMeeting, endMeeting, ensureValidToken } from "../modules/courses/meeting-integration.js";
