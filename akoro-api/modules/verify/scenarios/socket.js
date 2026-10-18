/**
 * The live teaching session over a real WebSocket — the way the learner
 * app runs it (TeachAgentModal: socket.io, start_adaptive_session,
 * teacher_message) — from the server to itself, so no outbound proxy is
 * in the way. Also proves continuation: reopening with the SAVED session's
 * id (session_saved.rowId) brings the earlier lesson back.
 */
import { io } from "socket.io-client";
import { signInternalAccess } from "../../auth/routes.js";

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
    a.socket.emit("teacher_message", { message: "Plants make their own food using sunlight, water and carbon dioxide." });
    const turn = await once(a.socket, "turn_complete", 120_000);
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
