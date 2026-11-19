export { default as authModule } from "./routes.js";
export { authenticateToken, requireRole, authenticateSocket, issueTokenPair, signHandoff, verifyHandoff, invalidateCachedUser, signInternalAccess, signCourseInvite, verifyCourseInvite, endSession, INVITE_MAX_DAYS, signChallengeForGate, signRefreshForGate } from "./routes.js";
export { sendNotificationEmail, sendWelcomeEmail, sendPasswordResetEmail, sendGenericEmail } from "./emails.js";
