/**
 * The live teaching session over a real WebSocket — the way the learner
 * app runs it (TeachAgentModal: socket.io, start_adaptive_session,
 * teacher_message) — from the server to itself, so no outbound proxy is
 * in the way. Also proves continuation: reopening with the SAVED session's
 * id (session_saved.rowId) brings the earlier lesson back.
 */
import { readLogs, logSeq } from "../../../lib/logTap.js";
import { io } from "socket.io-client";
import { signInternalAccess } from "../../auth/index.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

/** Wait for one event (or an error event) on a socket. */
const once = (socket, event, ms) => new Promise((resolve) => {
  const t = setTimeout(() => { socket.off(event, on); socket.off("error", onErr); resolve({ timeout: true }); }, ms);
  const on = (d) => { clearTimeout(t); socket.off("error", onErr); resolve({ data: d }); };
  const onErr = (e) => { clearTimeout(t); socket.off(event, on); resolve({ error: e?.message || String(e) }); };
  socket.once(event, on);
  socket.once("error", onErr);
});

async function connect(user) {
  const token = signInternalAccess({ id: user.id, role: user.role || "student" }, 600);
  const socket = io(API_BASE, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15_000 });
  const ok = await new Promise((resolve) => {
    socket.once("connect", () => resolve(true));
    socket.once("connect_error", () => resolve(false));
  });
  return { socket, ok, transport: socket.io?.engine?.transport?.name || null };
}

export const socketSession = {
  name: "teaching.socket_session", area: "teaching", risk: "write",
  description: "A live teaching session over a real WebSocket: it starts, answers a message, is saved with a row id, and reopening with that id continues the lesson.",
  params: { learner: { default: "@tester20" } },
  async run(ctx, p) {
    const learner = await ctx.as(p.learner);
    const rows = [];
    ctx.cleanup(async () => {
      for (const id of rows) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: learner.id, filters: { id } });
    });

    // 1. Connect over WebSocket and start a lesson.
    const a = await connect(learner);
    ctx.expect.ok("the socket connects", a.ok);
    if (!a.ok) { a.socket.close(); return; }
    ctx.expect.eq("…over WebSocket (not long-polling)", a.transport, "websocket");
    const topic = `${ctx.marker} Photosynthesis`;
    const savedA = once(a.socket, "session_saved", 120_000);
    a.socket.emit("start_adaptive_session", { topic, subject: "Basic Science", mode: "fresh" });
    const ready = await once(a.socket, "session_ready", 120_000);
    ctx.expect.ok("the session is ready", !!ready.data, ready.error || (ready.timeout ? "timed out" : null));
    if (!ready.data) { a.socket.close(); return; }
    ctx.expect.ok("…with an opening", !!(ready.data.message || (ready.data.openingBlocks || []).length));
    const saved = await savedA;
    const rowId = saved.data?.rowId;
    ctx.expect.ok("it is saved, with a row id", saved.data?.saved === true && /^[0-9a-f-]{36}$/i.test(rowId || ""), saved.data || saved);
    if (rowId) rows.push(rowId);
    ctx.expect.ok("the live id is not the row id (continuation must use the row id)", ready.data.sessionId !== rowId);

    // 2. A message gets a turn back.
    const turnLogs = logSeq();
    a.socket.emit("teacher_message", { message: "Plants make their own food using sunlight, water and carbon dioxide." });
    const turn = await once(a.socket, "turn_complete", 120_000);
    // An empty turn says nothing by itself: the server's warnings from this turn ride along.
    if (!(turn.data?.blocks || []).length) {
      for (const line of readLogs({ since: turnLogs, limit: 40 }).lines.filter((l) => /warn|error|fail|reject|\b4\d\d\b/i.test(String(l.msg)))) ctx.note(`log: ${String(line.msg).slice(0, 400)}`);
    }
    ctx.expect.ok("a message gets a reply turn", (turn.data?.blocks || []).length > 0, turn.error || (turn.timeout ? "timed out" : null));
    a.socket.emit("end_session", {});
    await new Promise((r) => setTimeout(r, 2_000));
    a.socket.close();
    if (!rowId) return;

    // 3. Reopen with the saved row id: the lesson continues.
    const b = await connect(learner);
    ctx.expect.ok("a second socket connects", b.ok);
    if (!b.ok) { b.socket.close(); return; }
    const savedB = once(b.socket, "session_saved", 120_000);
    b.socket.emit("start_adaptive_session", { topic, subject: "Basic Science", mode: "continuation", sessionId: rowId });
    const again = await once(b.socket, "session_ready", 120_000);
    ctx.expect.eq("reopening continues the lesson", again.data?.sessionType, "continuation");
    ctx.expect.ok("…with the earlier turns restored", (again.data?.historyBlocks || []).length > 0, { historyBlocks: (again.data?.historyBlocks || []).length });
    const savedAgain = await savedB;
    if (savedAgain.data?.rowId) rows.push(savedAgain.data.rowId);
    b.socket.emit("end_session", {});
    await new Promise((r) => setTimeout(r, 1_000));
    b.socket.close();
  },
};

/**
 * The guide speaks in ideas, not messages: the session opens with starter
 * ideas (no guide message), and each turn's protégé reply carries 2-3 "say
 * this next" ideas from the guide — never a guide block in the conversation.
 */
export const guideIdeasSession = {
  name: "teaching.guide_ideas", area: "teaching", risk: "write",
  description: "A live teaching session: it opens with the guide's starter ideas, not a guide message; each reply from the protégé carries 2-3 ideas from the guide for the learner's next message; the guide posts no message.",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    const learner = await ctx.as(p.learner);
    const rows = [];
    ctx.cleanup(async () => {
      for (const id of rows) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: learner.id, filters: { id } });
    });
    const a = await connect(learner);
    ctx.expect.ok("the socket connects", a.ok);
    if (!a.ok) { a.socket.close(); return; }
    const saved = once(a.socket, "session_saved", 120_000);
    a.socket.emit("start_adaptive_session", { topic: `${ctx.marker} Photosynthesis`, subject: "Basic Science", mode: "fresh" });
    const ready = await once(a.socket, "session_ready", 120_000);
    ctx.expect.ok("the session is ready", !!ready.data, ready.error || (ready.timeout ? "timed out" : null));
    if (!ready.data) { a.socket.close(); return; }
    const opening = ready.data.openingBlocks || [];
    const starters = opening.find((b) => b.type === "guide-ideas");
    ctx.note(`opening: ${JSON.stringify(opening.map((b) => b.type))} · ideas: ${JSON.stringify(starters?.ideas || [])}`);
    ctx.expect.ok("opens with the guide's starter ideas", (starters?.ideas || []).length >= 2, starters);
    ctx.expect.ok("…and no guide message", !opening.some((b) => b.type === "guide"), opening.map((b) => b.type));
    const s = await saved;
    if (s.data?.rowId) rows.push(s.data.rowId);

    for (const [i, message] of [starters?.ideas?.[1] || "Let me explain photosynthesis in my own words.",
      "Plants use sunlight, water and carbon dioxide to make their own food, and they give out oxygen."].entries()) {
      a.socket.emit("teacher_message", { message });
      const turn = await once(a.socket, "turn_complete", 150_000);
      const blocks = turn.data?.blocks || [];
      const reply = blocks.find((b) => b.type === "student-agent");
      ctx.note(`turn ${i + 1}: "${message.slice(0, 60)}" → ${JSON.stringify(blocks.map((b) => b.type))} · reply "${String(reply?.text || "").slice(0, 120)}" · ideas ${JSON.stringify(reply?.guide?.ideas || [])}`);
      ctx.expect.ok(`turn ${i + 1}: the protégé replies`, !!reply?.text, turn.error || (turn.timeout ? "timed out" : blocks.map((b) => b.type)));
      ctx.expect.ok(`turn ${i + 1}: with 2-3 ideas from the guide`, (reply?.guide?.ideas || []).length >= 2 && reply.guide.ideas.length <= 3, reply?.guide);
      ctx.expect.ok(`turn ${i + 1}: the guide posts no message`, !blocks.some((b) => b.type === "guide"), blocks.map((b) => b.type));
    }
    a.socket.emit("end_session", {});
    await new Promise((r) => setTimeout(r, 2_000));
    a.socket.close();
  },
};
