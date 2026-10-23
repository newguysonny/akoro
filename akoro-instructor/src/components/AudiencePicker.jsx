/**
 * AudiencePicker — "who is this for?", asked once, the same way everywhere.
 *
 * A course and a class are different groupings that happen to overlap: a course
 * is whoever enrolled in a subject, a class is JSS1. The old form called the
 * course "whole class", which is wrong for a school admin — they think in
 * JSS1/JSS2, and would have sent work to the wrong set of people believing it
 * was right.
 *
 * So it is one field with three mutually exclusive answers rather than several
 * toggles: two toggles would let you set both and force us to invent a merge
 * rule nobody asked for.
 *
 *   course   → everyone actively enrolled in the selected course
 *   class    → everyone in a class (JSS1), which is NOT the same set
 *   picked   → named learners, ticked from a roster or typed as usernames
 *
 * `courseBound` marks a feature that cannot escape its course — battles draw
 * their questions from a course's bank, so a class member who isn't enrolled
 * genuinely can't take part. The picker says so up front instead of letting the
 * teacher find out from a count that came back smaller than expected.
 */
import { useState, useEffect } from 'react';
import { Search, Users, GraduationCap, UserCheck } from 'lucide-react';
import { Inp, Sel, Badge } from './Primitives.jsx';
import { apiGet } from '../services/api.js';
import { GREEN } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const MODES = [
  { key: 'course', label: 'Everyone on the course', hint: 'All active enrolments', Icon: Users, ti: 'ti-users' },
  { key: 'class',  label: 'A class',                hint: 'e.g. JSS1',            Icon: GraduationCap, ti: 'ti-school' },
  { key: 'picked', label: 'Chosen learners',        hint: 'One or more',          Icon: UserCheck, ti: 'ti-user-check' },
];

/** Parse the free-text username box the same way the server will. */
export function parseHandles(typed) {
  return String(typed || '').split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean);
}

/**
 * Turn the picker's value into the request body every targeting endpoint takes.
 * Kept here so battles and self study can never drift apart on what a mode means.
 */
export function audienceBody(value) {
  const { mode, classroomId, selected = [], typed = '' } = value;
  // 'course' is "everyone in whatever scope the caller established" — the whole
  // course for a course battle, the whole class for a class battle. The scope
  // itself travels in the URL, not here.
  if (mode === 'course') return { whole_class: true, classroom_id: null, user_ids: [], usernames: [] };
  if (mode === 'class')  return { whole_class: true, classroom_id: classroomId || null, user_ids: [], usernames: [] };
  return { whole_class: false, classroom_id: null, user_ids: selected, usernames: parseHandles(typed) };
}

/**
 * `modes` lets a caller narrow the question. Self study asks "which group?" and
 * needs all three. A battle has already established its scope (this course, or
 * this class) by the time it asks who plays, so it only needs "everyone in it"
 * or "these people" — offering "a class" again there would be asking the same
 * question twice with two different answers.
 */
export default function AudiencePicker({
  value, onChange, courseId, courseBound = false, requireAgent = false,
  modes: modeKeys = ['course', 'class', 'picked'],
  rosterUrl = null,          // overrides the course roster (e.g. a class roster)
  allLabel = null,           // what "everyone" means in this scope
}) {
  const { mode, classroomId, selected = [], typed = '' } = value;
  const set = (patch) => onChange({ ...value, ...patch });
  const MODE_LIST = MODES
    .filter((m) => modeKeys.includes(m.key))
    .map((m) => (m.key === 'course' && allLabel ? { ...m, label: allLabel.label, hint: allLabel.hint } : m));

  const [classes, setClasses]   = useState([]);
  const [roster, setRoster]     = useState([]);
  const [rLoading, setRLoading] = useState(false);
  const [q, setQ]               = useState('');

  useEffect(() => {
    if (!modeKeys.includes('class')) return;
    apiGet('/api/instructor/classrooms')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]));
  }, [modeKeys.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The roster follows whichever group is selected, so the count and the list
  // always describe the same people.
  useEffect(() => {
    const url = rosterUrl
      ? rosterUrl
      : mode === 'class' && classroomId
        ? `/api/instructor/classrooms/${classroomId}/students`
        : courseId ? `/api/battle/courses/${courseId}/roster` : null;
    if (!url) { setRoster([]); return; }
    let dead = false;
    setRLoading(true);
    apiGet(url)
      .then(d => { if (!dead) setRoster(d?.data ?? []); })
      .catch(() => { if (!dead) setRoster([]); })
      .finally(() => { if (!dead) setRLoading(false); });
    return () => { dead = true; };
  }, [mode, classroomId, courseId, rosterUrl]);

  const eligible = requireAgent ? roster.filter(r => r.has_agent) : roster;
  const chosenClass = classes.find(c => c.id === classroomId);

  const count = mode === 'picked'
    ? selected.length + parseHandles(typed).length
    : mode === 'class'
      ? (chosenClass ? (requireAgent ? eligible.length : (roster.length || chosenClass.student_count)) : 0)
      : eligible.length;

  const term = q.trim().toLowerCase();
  const shown = term
    ? roster.filter(r => (r.full_name || '').toLowerCase().includes(term) || (r.username || '').toLowerCase().includes(term))
    : roster;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 7 }}>Send to *</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {MODE_LIST.map(({ key, label, hint, Icon, ti }) => {
          const on = mode === key;
          return (
            <button key={key} type="button" onClick={() => set({ mode: key })} style={{
              flex: 1, padding: '9px 8px', borderRadius: 10, cursor: 'pointer',
              fontFamily: C.font, textAlign: 'left',
              border: `1.5px solid ${on ? C.brand : C.border}`,
              background: on ? tint(7) : C.surface,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <Ico ti={ti} size={12} color={on ? C.brand : C.muted} />
                <span style={{ fontSize: 12, fontWeight: 800, color: on ? C.brand : C.ink }}>{label}</span>
              </div>
              <div style={{ fontSize: 10.5, color: C.muted }}>{hint}</div>
            </button>
          );
        })}
      </div>

      {mode === 'class' && (
        <>
          <Sel value={classroomId || ''} onChange={e => set({ classroomId: e.target.value })}>
            <option value="">Select a class…</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
              </option>
            ))}
          </Sel>
          {classes.length === 0 && (
            <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, marginTop: 5 }}>
              No classes set up yet. Create one under Academics → Classes.
            </div>
          )}
          {courseBound && classroomId && (
            <div style={{
              marginTop: 7, padding: '8px 10px', borderRadius: 9,
              background: tint(14, '#F59E0B'), border: `1px solid ${tint(35, '#F59E0B')}`,
              fontSize: 11, color: '#92400E', fontFamily: C.font, lineHeight: 1.5,
            }}>
              A battle uses the course's question bank, so only learners in this class who are
              also enrolled on the course can take part. Anyone left out is listed after you create it.
            </div>
          )}
        </>
      )}

      {mode === 'picked' && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, background: C.bg }}>
            <Ico ti="ti-search" size={13} color={C.muted} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search learners by name or username…"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, fontFamily: C.font, color: C.ink }} />
          </div>

          <div style={{ maxHeight: 190, overflowY: 'auto' }}>
            {rLoading ? (
              <div style={{ padding: 14, fontSize: 12, color: C.muted, fontFamily: C.font }}>Loading roster…</div>
            ) : shown.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: C.muted, fontFamily: C.font }}>
                {roster.length === 0 ? 'Nobody enrolled on this course yet.' : 'No match.'}
              </div>
            ) : shown.map(r => {
              const blocked = requireAgent && !r.has_agent;
              const on = selected.includes(r.id);
              return (
                <button key={r.id} type="button" disabled={blocked}
                  onClick={() => set({
                    selected: on ? selected.filter(x => x !== r.id) : [...selected, r.id],
                  })}
                  title={blocked ? 'This learner has no agent yet, so they cannot battle' : ''}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                    border: 'none', borderBottom: `1px solid ${C.border}`, textAlign: 'left',
                    background: on ? tint(7) : C.surface,
                    cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.45 : 1,
                    fontFamily: C.font,
                  }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: `1.5px solid ${on ? C.brand : C.border}`, background: on ? C.brand : C.surface,
                    color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: '16px', textAlign: 'center',
                  }}>{on ? '✓' : ''}</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#6B7280', width: 16, textAlign: 'center' }}>{(r.full_name || r.username || 'L').trim().charAt(0).toUpperCase()}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.full_name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.muted }}>@{r.username}</span>
                  </span>
                  {blocked && <Badge color={C.muted} bg={C.bg}>no agent</Badge>}
                </button>
              );
            })}
          </div>

          <div style={{ padding: '9px 10px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
            <Inp label="…or type usernames" value={typed} onChange={e => set({ typed: e.target.value })}
              placeholder="priya, amaka, jss1_mate3" />
            <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 4 }}>
              Comma-separated usernames or emails. Unknown names are reported before anything is created.
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: count ? GREEN : C.muted, fontWeight: 700, fontFamily: C.font, marginTop: 7 }}>
        {mode === 'class' && !classroomId
          ? 'Pick a class to see how many learners that is.'
          : `${count} learner${count === 1 ? '' : 's'} will get this`}
      </div>
    </div>
  );
}

export const BLANK_AUDIENCE = { mode: 'course', classroomId: '', selected: [], typed: '' };
