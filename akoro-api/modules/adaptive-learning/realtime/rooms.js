// Room joins shared by the presence and teaching handlers.

import { sessionRoom, studentRoom, userRoom } from "./rules.js";

export function joinSessionRoom(socket, sessionId) {
  if (sessionId) socket.join(sessionRoom(sessionId));
}

export function joinStudentRoom(socket, studentId) {
  if (studentId) socket.join(studentRoom(studentId));
}

export function joinUserRoom(socket, userId) {
  if (userId) socket.join(userRoom(userId));
}

// Out-of-session pushes (e.g. agent_purchased after a marketplace payment)
// reach this socket even when no teaching session is active. Identity comes
// from the token — the payload id is ignored.
export function joinStudentRooms(socket) {
  const u = socket.data.user;
  if (u) {
    socket.join(studentRoom(u.id));
    // Also join the generic user room so notifyUser() pushes (bell
    // notifications: purchases, payouts, reviews, class alerts…) arrive live.
    socket.join(userRoom(u.id));
  }
}
