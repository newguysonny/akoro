/**
 * store.js — Shared in-memory stores for courses module.
 *
 * Consumed by scheduler.js. In production these would be replaced
 * by DB queries, but the in-memory shape is sufficient for the
 * scheduler's current usage.
 */

let _sessions = [];
let _courses  = [];
let _teachers = [];

export const SessionStore = {
  list:   (filters = {}) => {
    let r = _sessions;
    if (filters.courseId)  r = r.filter(s => s.courseId  === filters.courseId);
    if (filters.teacherId) r = r.filter(s => s.teacherId === filters.teacherId);
    return r;
  },
  get:    (id)    => _sessions.find(s => s.id === id) ?? null,
  create: (data)  => { _sessions.push(data); return data; },
  update: (id, d) => { const i = _sessions.findIndex(s => s.id === id); if (i === -1) return null; _sessions[i] = { ..._sessions[i], ...d }; return _sessions[i]; },
  delete: (id)    => { const i = _sessions.findIndex(s => s.id === id); if (i !== -1) _sessions.splice(i, 1); return i !== -1; },
};

export const CourseStore = {
  list:   ()      => [..._courses],
  get:    (id)    => _courses.find(c => c.id === id) ?? null,
  create: (data)  => { _courses.push(data); return data; },
  update: (id, d) => { const i = _courses.findIndex(c => c.id === id); if (i === -1) return null; _courses[i] = { ..._courses[i], ...d }; return _courses[i]; },
  delete: (id)    => { const i = _courses.findIndex(c => c.id === id); if (i !== -1) _courses.splice(i, 1); return i !== -1; },
};

export const TeacherStore = {
  list:   ()      => [..._teachers],
  get:    (id)    => _teachers.find(t => t.id === id) ?? null,
  create: (data)  => { _teachers.push(data); return data; },
  update: (id, d) => { const i = _teachers.findIndex(t => t.id === id); if (i === -1) return null; _teachers[i] = { ..._teachers[i], ...d }; return _teachers[i]; },
  delete: (id)    => { const i = _teachers.findIndex(t => t.id === id); if (i !== -1) _teachers.splice(i, 1); return i !== -1; },
};
