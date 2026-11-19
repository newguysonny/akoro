/**
 * battle/store.js — the module's database layer. Every Supabase query the
 * battle HTTP surface makes lives behind these groups, one group per table
 * family, so service code names what it wants and never builds a PostgREST
 * chain itself.
 *
 *   battles   → store-battles.js    (the battle itself)
 *   seats     → store-seats.js      (participants and viewers)
 *   questions → store-questions.js  (bank, paper, answers, log)
 *   people    → store-people.js     (users, agents, courses, classes, school)
 *
 * Notifications are a one-query table and stay here.
 */
import db from "../../db.js";

export * as battles from "./store-battles.js";
export * as seats from "./store-seats.js";
export * as questions from "./store-questions.js";
export * as people from "./store-people.js";

export const insertNotification = (userId, type, title, content, relatedId) =>
  db.from("notifications").insert({ user_id: userId, type, title, content, related_id: relatedId });
