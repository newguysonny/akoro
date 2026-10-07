/**
 * services/presenceService.js  —  Piabam Presence Service
 *
 * Tracks active socket connections per live session and course chat room
 * using Redis, so presence counts are accurate across multiple API instances
 * behind a load balancer.
 *
 * Without this service, socket.io room size only reflects connections on
 * the LOCAL server instance. With Redis, any instance can query the true
 * global count.
 *
 * Usage:
 *   import presence from "../services/presenceService.js";
 *
 *   // In Socket.io connection handler (app.js):
 *   socket.on("join-session", async (sessionId) => {
 *     socket.join(`session:${sessionId}`);
 *     await presence.joinSession(userId, sessionId, socket.id);
 *   });
 *
 *   socket.on("disconnect", async () => {
 *     await presence.removeSocket(socket.id);
 *   });
 *
 *   // In a route handler:
 *   const count = await presence.getSessionCount(sessionId);
 *   const users = await presence.getSessionUsers(sessionId);
 *
 * Redis key structure:
 *   presence:session:<sessionId>     HSET  socketId → userId  (TTL 24h)
 *   presence:chat:<courseId>         HSET  socketId → userId  (TTL 24h)
 *   presence:socket:<socketId>       STRING  JSON metadata     (TTL 24h)
 *
 * Environment variables:
 *   REDIS_URL
 */

import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
redis.on("error", (err) => console.error("[presence] Redis error:", err.message));

const TTL = 24 * 60 * 60;   // 24 hours — auto-cleans stale connections

// ─── Key builders ─────────────────────────────────────────────────────────────

const sessionKey = (sessionId) => `presence:session:${sessionId}`;
const chatKey    = (courseId)  => `presence:chat:${courseId}`;
const socketKey  = (socketId)  => `presence:socket:${socketId}`;

// ─── Session presence ─────────────────────────────────────────────────────────

/**
 * joinSession
 * Called when a user joins a live session room via Socket.io.
 */
const joinSession = async (userId, sessionId, socketId) => {
  const pipeline = redis.pipeline();

  // Track socket → userId in the session hash
  pipeline.hset(sessionKey(sessionId), socketId, userId);
  pipeline.expire(sessionKey(sessionId), TTL);

  // Track socket metadata for cleanup on disconnect
  pipeline.set(
    socketKey(socketId),
    JSON.stringify({ userId, sessionId, type: "session" }),
    "EX", TTL
  );

  await pipeline.exec();

  const count = await getSessionCount(sessionId);
  console.log(`[presence] 👤 ${userId} joined session=${sessionId}  count=${count}`);
  return count;
};

/**
 * leaveSession
 * Called when a user explicitly leaves a live session.
 */
const leaveSession = async (userId, sessionId, socketId) => {
  await redis.hdel(sessionKey(sessionId), socketId);
  await redis.del(socketKey(socketId));

  const count = await getSessionCount(sessionId);
  console.log(`[presence] 👋 ${userId} left session=${sessionId}  count=${count}`);
  return count;
};

/**
 * getSessionCount
 * Returns total number of connected sockets in a live session.
 */
const getSessionCount = async (sessionId) => {
  return redis.hlen(sessionKey(sessionId));
};

/**
 * getSessionUsers
 * Returns array of unique userIds currently in a live session.
 */
const getSessionUsers = async (sessionId) => {
  const hash = await redis.hgetall(sessionKey(sessionId));
  if (!hash) return [];
  return [...new Set(Object.values(hash))];
};

// ─── Chat presence ────────────────────────────────────────────────────────────

/**
 * joinChat
 * Called when a user joins a course chat room.
 */
const joinChat = async (userId, courseId, socketId) => {
  const pipeline = redis.pipeline();

  pipeline.hset(chatKey(courseId), socketId, userId);
  pipeline.expire(chatKey(courseId), TTL);
  pipeline.set(
    socketKey(socketId),
    JSON.stringify({ userId, courseId, type: "chat" }),
    "EX", TTL
  );

  await pipeline.exec();
  return redis.hlen(chatKey(courseId));
};

/**
 * leaveChat
 * Called when a user leaves a course chat room.
 */
const leaveChat = async (userId, courseId, socketId) => {
  await redis.hdel(chatKey(courseId), socketId);
  await redis.del(socketKey(socketId));
  return redis.hlen(chatKey(courseId));
};

/**
 * getChatCount
 * Returns number of connected users in a course chat room.
 */
const getChatCount = async (courseId) => {
  return redis.hlen(chatKey(courseId));
};

/**
 * getChatUsers
 * Returns unique userIds currently in a course chat room.
 */
const getChatUsers = async (courseId) => {
  const hash = await redis.hgetall(chatKey(courseId));
  if (!hash) return [];
  return [...new Set(Object.values(hash))];
};

// ─── Generic disconnect cleanup ───────────────────────────────────────────────

/**
 * removeSocket
 * Called on socket disconnect — cleans up from whichever room the socket was in.
 * This handles unexpected disconnects (network drop, browser close, etc.)
 */
const removeSocket = async (socketId) => {
  const raw = await redis.get(socketKey(socketId));
  if (!raw) return;

  let meta;
  try { meta = JSON.parse(raw); } catch { return; }

  const { userId, type, sessionId, courseId } = meta;

  if (type === "session" && sessionId) {
    await redis.hdel(sessionKey(sessionId), socketId);
    const count = await getSessionCount(sessionId);
    console.log(`[presence] 🔌 Disconnect cleaned  session=${sessionId}  count=${count}`);
  }

  if (type === "chat" && courseId) {
    await redis.hdel(chatKey(courseId), socketId);
    const count = await getChatCount(courseId);
    console.log(`[presence] 🔌 Disconnect cleaned  chat=${courseId}  count=${count}`);
  }

  await redis.del(socketKey(socketId));
};

// ─── Bulk queries ─────────────────────────────────────────────────────────────

/**
 * getMultipleSessionCounts
 * Efficiently fetches presence counts for multiple sessions in one pipeline.
 * Useful for listing sessions with live viewer counts.
 */
const getMultipleSessionCounts = async (sessionIds = []) => {
  if (!sessionIds.length) return {};

  const pipeline = redis.pipeline();
  sessionIds.forEach((id) => pipeline.hlen(sessionKey(id)));
  const results = await pipeline.exec();

  return Object.fromEntries(
    sessionIds.map((id, i) => [id, results[i]?.[1] ?? 0])
  );
};

/**
 * isUserInSession
 * Returns true if a specific user currently has any active socket in a session.
 */
const isUserInSession = async (userId, sessionId) => {
  const hash = await redis.hgetall(sessionKey(sessionId));
  if (!hash) return false;
  return Object.values(hash).includes(userId);
};

// ─── Export ───────────────────────────────────────────────────────────────────

export default {
  // Session
  joinSession,
  leaveSession,
  getSessionCount,
  getSessionUsers,
  getMultipleSessionCounts,
  isUserInSession,

  // Chat
  joinChat,
  leaveChat,
  getChatCount,
  getChatUsers,

  // Cleanup
  removeSocket,
};
