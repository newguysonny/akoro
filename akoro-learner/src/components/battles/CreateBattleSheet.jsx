/**
 * CreateBattleSheet — a learner starts a battle.
 *
 * Two kinds, because learners come in two shapes. A COURSE battle is for
 * someone enrolled on a course and draws questions from that course's bank.
 * A CLASS battle is for someone who simply attends JSS1 and studies Mathematics
 * there — most school learners — and draws from the past-questions bank by
 * subject. Everything downstream is identical: one opponent makes a 1-v-1
 * challenge they accept or decline, several make a group battle.
 *
 * Loading is stated, never implied. "No enrolled courses yet" and "no
 * classmates" are claims about this learner's account; showing either while the
 * request is still in flight tells them something false about themselves.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BRAND, RED, GREEN } from '../../constants.js';
import { apiGet, apiPost } from '../../services/api.js';
import NoAgentSheet, { isNoAgentError } from './NoAgentSheet.jsx';

const SHEET = {
  position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2100,
  background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0',
  padding: '0 20px 48px', boxShadow: '0 -8px 40px rgba(0,0,0,.14)',
  animation: 'sheet-up .3s cubic-bezier(.32,1.2,.64,1)',
  fontFamily: "'Nunito',sans-serif", maxHeight: '86vh', overflowY: 'auto',
};
const FIELD = {
  width: '100%', padding: '11px 14px', borderRadius: 12,
  border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface-hover)',
  fontSize: 13.5, fontWeight: 600, color: 'var(--ak-text)',
  fontFamily: "'Nunito',sans-serif", outline: 'none', boxSizing: 'border-box',
};
const LABEL = { fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)', display: 'block', marginBottom: 6, letterSpacing: .3 };

const ANIM_CSS =
  '@keyframes ak-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}' +
  '@keyframes ak-spin{to{transform:rotate(360deg)}}';

/* A shimmer bar, so an empty list reads as "still loading", not "nothing here". */
function Skeleton({ h = 44, mb = 8 }) {
  return (
    <div style={{
      height: h, marginBottom: mb, borderRadius: 12,
      background: 'linear-gradient(90deg, var(--ak-surface-hover) 25%, var(--ak-border) 37%, var(--ak-surface-hover) 63%)',
      backgroundSize: '400% 100%', animation: 'ak-shimmer 1.3s ease infinite',
    }} />
  );
}

function Spinner({ size = 12, color = 'var(--ak-text-muted)' }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      border: `2px solid ${color}40`, borderTopColor: color,
      animation: 'ak-spin .7s linear infinite', verticalAlign: 'middle',
    }} />
  );
}

export default function CreateBattleSheet({ onClose, onCreated }) {
  // Chosen first, because it changes what every field below means.
  const [kind, setKind] = useState(null);          // 'course' | 'class' | null while loading

  const [courses, setCourses] = useState([]);
  const [classes, setClasses] = useState([]);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [courseId, setCourseId] = useState('');
  const [classId, setClassId]   = useState('');
  const [subject, setSubject]   = useState('');

  const [roster, setRoster]     = useState([]);
  const [rLoading, setRLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('picked');       // 'picked' | 'all'
  const [selected, setSelected] = useState([]);
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);  // resolving typed usernames
  const [checked, setChecked] = useState(null);     // { found: [], missing: [] }
  const [difficulty, setDifficulty] = useState('intermediate');
  const [xpPrize, setXpPrize] = useState('200');
  const [scheduledAt, setScheduledAt] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsAgent, setNeedsAgent] = useState(false);

  /* ── What can this learner battle in? ──────────────────────────────────── */
  useEffect(() => {
    let dead = false;
    Promise.allSettled([apiGet('/api/user/enrollments'), apiGet('/api/battle/my-classes')])
      .then(([enr, cls]) => {
        if (dead) return;
        const courseList = enr.status === 'fulfilled'
          ? (enr.value?.data || enr.value?.enrollments || [])
              .filter(e => e.courses).map(e => ({ id: e.courses.id, title: e.courses.title }))
          : [];
        const classList = cls.status === 'fulfilled' ? (cls.value?.data ?? []) : [];
        setCourses(courseList);
        setClasses(classList);
        // Land on whichever they actually have, so nobody opens onto an empty tab.
        setKind(courseList.length ? 'course' : classList.length ? 'class' : 'course');
        if (courseList.length) setCourseId(courseList[0].id);
        if (classList.length) {
          setClassId(classList[0].id);
          setSubject(classList[0].subjects?.[0] ?? '');
        }
      })
      .finally(() => { if (!dead) setScopeLoading(false); });
    return () => { dead = true; };
  }, []);

  const chosenClass = useMemo(() => classes.find(c => c.id === classId), [classes, classId]);

  // Subjects follow the class.
  useEffect(() => {
    if (kind !== 'class' || !chosenClass) return;
    if (!chosenClass.subjects?.includes(subject)) setSubject(chosenClass.subjects?.[0] ?? '');
  }, [kind, chosenClass]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Roster follows the scope ──────────────────────────────────────────── */
  useEffect(() => {
    const url = kind === 'class'
      ? (classId ? `/api/battle/classes/${classId}/roster` : null)
      : (courseId ? `/api/battle/courses/${courseId}/roster` : null);
    if (!url) { setRoster([]); return; }
    let dead = false;
    setRLoading(true);
    setSelected([]);
    apiGet(url)
      .then(d => { if (!dead) setRoster(d?.data ?? []); })
      .catch(() => { if (!dead) setRoster([]); })
      .finally(() => { if (!dead) setRLoading(false); });
    return () => { dead = true; };
  }, [kind, courseId, classId]);

  /* ── Typed usernames: resolve them as you type ─────────────────────────── */
  const typedNames = useMemo(
    () => typed.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean), [typed]);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!typedNames.length) { setChecked(null); setChecking(false); return; }
    setChecking(true);
    debounceRef.current = setTimeout(() => {
      // Checked against the roster we already hold — the people they can
      // actually battle. A username that exists on the platform but isn't in
      // this class is still a dead end, so this is both faster than asking the
      // server and more truthful than "that account exists".
      const byName = new Map(roster.map(r => [String(r.username || '').toLowerCase(), r]));
      const found = [], missing = [];
      for (const n of typedNames) (byName.has(n.toLowerCase()) ? found : missing).push(n);
      setChecked({ found, missing });
      setChecking(false);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [typed, roster]);   // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = roster.filter(r => r.has_agent);
  const count = mode === 'all'
    ? eligible.length
    : selected.length + (checked ? checked.found.length : typedNames.length);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const scopeWord = kind === 'class' ? 'class' : 'course';

  const submit = async () => {
    setError('');
    if (kind === 'course' && !courseId) return setError('Pick a course first.');
    if (kind === 'class' && !classId)   return setError('Pick a class first.');
    if (kind === 'class' && !subject)   return setError('Pick a subject — the questions come from one.');
    if (!title.trim()) return setError('Give your battle a title.');
    if (mode === 'picked' && count === 0) return setError('Choose at least one classmate, or pick “Everyone”.');
    if (checked?.missing.length) return setError(`Not in this ${scopeWord}: ${checked.missing.join(', ')}`);

    setBusy(true);
    try { await send(); }
    catch (err) {
      if (isNoAgentError(err)) { setNeedsAgent(true); setBusy(false); return; }
      setError(err?.message || 'Could not create the battle.');
      setBusy(false);
    }
  };

  const send = async () => {
    const body = {
      title: title.trim(),
      topic: topic.trim() || null,
      difficulty,
      xp_prize: parseInt(xpPrize, 10) || 200,
      expires_in_minutes: 60,
      scheduled_for: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      whole_class: mode === 'all',
      user_ids: mode === 'all' ? [] : selected,
      usernames: mode === 'all' ? [] : typedNames,
    };
    if (kind === 'class') body.subject = subject;

    const path = kind === 'class'
      ? `/api/battle/classes/${classId}/battles/invite`
      : `/api/battle/courses/${courseId}/battles/invite`;

    const d = await apiPost(path, body);
    onCreated?.(d?.data ?? d);
    onClose();
  };

  const hasNothing = !scopeLoading && !courses.length && !classes.length;

  return (
    <>
      <style>{ANIM_CSS}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,6,18,.55)', backdropFilter: 'blur(5px)' }} />
      <div style={SHEET}>
        {/* Sticky, not absolute: the sheet scrolls, and a close button that
            scrolls out of reach on a long form is the same as not having one.
            The backdrop dismisses too, but it's off screen once you scroll. */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 1, background: 'var(--ak-surface)',
          margin: '0 -20px', padding: '12px 20px 4px',
        }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border3)', margin: '0 auto' }} />
          <button onClick={onClose} aria-label="Close" style={{
            position: 'absolute', top: 8, right: 14, width: 30, height: 30, borderRadius: '50%',
            border: 'none', background: 'var(--ak-surface-hover)', color: 'var(--ak-text-sub)',
            fontSize: 18, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: '8px 0 6px' }}>⚔️ Start a battle</p>
        <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Challenge one classmate, a few of them, or everyone. Your agents do the fighting.
        </p>

        {scopeLoading ? (
          <>
            <Skeleton h={52} /><Skeleton h={46} /><Skeleton h={46} /><Skeleton h={110} />
            <p style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', textAlign: 'center', margin: '4px 0 0' }}>
              <Spinner /> Finding your classes and courses…
            </p>
          </>
        ) : hasNothing ? (
          <div style={{ padding: '26px 8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, opacity: .25 }}>📚</div>
            <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', margin: '10px 0 4px' }}>Nothing to battle in yet</p>
            <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', lineHeight: 1.5 }}>
              Join a course, or ask your teacher to add you to a class. Battles need classmates.
            </p>
            <button onClick={onClose} style={{
              marginTop: 18, padding: '11px 24px', borderRadius: 14, border: '1.5px solid var(--ak-border2)',
              background: 'var(--ak-surface-hover)', fontSize: 13, fontWeight: 800,
              color: 'var(--ak-text-sub)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
            }}>Close</button>
          </div>
        ) : (
          <>
            {/* ── Battle type ───────────────────────────────────────────── */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL}>Battle type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  ['course', '📘 Course battle', courses.length ? 'From a course you take' : 'No courses yet', !courses.length],
                  ['class',  '🏫 Class battle',  classes.length ? 'From a class subject'  : 'Not in a class yet', !classes.length],
                ].map(([k, label, hint, disabled]) => (
                  <button key={k} onClick={() => !disabled && setKind(k)} disabled={disabled} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 12, textAlign: 'left',
                    border: `1.5px solid ${kind === k ? BRAND : 'var(--ak-border2)'}`,
                    background: kind === k ? `${BRAND}10` : 'var(--ak-surface-hover)',
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .45 : 1,
                    fontFamily: "'Nunito',sans-serif",
                  }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: kind === k ? BRAND : 'var(--ak-text)' }}>{label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ak-text-muted)' }}>{hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {kind === 'course' ? (
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Course</label>
                <select value={courseId} onChange={e => setCourseId(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={LABEL}>Class</label>
                  <select value={classId} onChange={e => setClassId(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.student_count ? ` — ${c.student_count} learners` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={LABEL}>Subject</label>
                  <select value={subject} onChange={e => setSubject(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    {(chosenClass?.subjects ?? []).length === 0 && <option value="">No subjects set for this class</option>}
                    {(chosenClass?.subjects ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p style={{ fontSize: 10.5, color: 'var(--ak-text-muted)', margin: '5px 0 0', lineHeight: 1.45 }}>
                    Questions come from the past-questions bank for this subject.
                  </p>
                </div>
              </>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Battle title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Photosynthesis Showdown" style={FIELD} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={LABEL}>Topic <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ak-text-muted)' }}>optional</span></label>
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Photosynthesis" style={FIELD} />
            </div>

            {/* ── Who ───────────────────────────────────────────────────── */}
            <div style={{ marginBottom: 12 }}>
              <label style={LABEL}>Who are you challenging?</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[['picked', 'Pick classmates', 'One or more'],
                  ['all', kind === 'class' ? 'Whole class' : 'Everyone on this course', 'All of them']].map(([k, l, hint]) => (
                  <button key={k} onClick={() => setMode(k)} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 12, textAlign: 'left',
                    border: `1.5px solid ${mode === k ? BRAND : 'var(--ak-border2)'}`,
                    background: mode === k ? `${BRAND}10` : 'var(--ak-surface-hover)',
                    cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
                  }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: mode === k ? BRAND : 'var(--ak-text)' }}>{l}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ak-text-muted)' }}>{hint}</div>
                  </button>
                ))}
              </div>

              {mode === 'picked' && (
                <div style={{ border: '1px solid var(--ak-border2)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {rLoading ? (
                      <div style={{ padding: 10 }}><Skeleton h={38} /><Skeleton h={38} /><Skeleton h={38} mb={0} /></div>
                    ) : roster.length === 0 ? (
                      <div style={{ padding: 14, fontSize: 12, color: 'var(--ak-text-muted)' }}>
                        {kind === 'class' ? 'Nobody else is in this class yet.' : 'No classmates on this course yet.'}
                      </div>
                    ) : roster.map(r => {
                      const on = selected.includes(r.id);
                      return (
                        <button key={r.id} onClick={() => r.has_agent && toggle(r.id)} disabled={!r.has_agent} style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                          border: 'none', borderBottom: '1px solid var(--ak-border)', textAlign: 'left',
                          background: on ? `${BRAND}0d` : 'var(--ak-surface)',
                          cursor: r.has_agent ? 'pointer' : 'not-allowed', opacity: r.has_agent ? 1 : .45,
                          fontFamily: "'Nunito',sans-serif",
                        }}>
                          <span style={{
                            width: 19, height: 19, borderRadius: 6, flexShrink: 0, fontSize: 11, fontWeight: 900,
                            border: `2px solid ${on ? BRAND : 'var(--ak-border3)'}`, background: on ? BRAND : 'transparent',
                            color: '#fff', lineHeight: '16px', textAlign: 'center',
                          }}>{on ? '✓' : ''}</span>
                          <span style={{ fontSize: 16 }}>{r.emoji || '🧑‍🎓'}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ak-text)' }}>{r.full_name}</span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--ak-text-muted)' }}>@{r.username}</span>
                          </span>
                          {!r.has_agent && <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ak-text-muted)' }}>no agent</span>}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ padding: '10px 11px', borderTop: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)' }}>
                    <label style={LABEL}>…or type usernames</label>
                    <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="priya, amaka, jss1_mate3" style={FIELD} />
                    {/* Say what's happening while it resolves, and what it found
                        once it has — a typo belongs here, not on submit. */}
                    {typedNames.length > 0 && (
                      <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, lineHeight: 1.5 }}>
                        {checking ? (
                          <span style={{ color: 'var(--ak-text-muted)' }}>
                            <Spinner /> Checking {typedNames.length} name{typedNames.length === 1 ? '' : 's'}…
                          </span>
                        ) : (
                          <>
                            {checked?.found?.length > 0 && <span style={{ color: GREEN }}>✓ {checked.found.join(', ')}</span>}
                            {checked?.found?.length > 0 && checked?.missing?.length > 0 && <span style={{ color: 'var(--ak-text-muted)' }}> · </span>}
                            {checked?.missing?.length > 0 && (
                              <span style={{ color: RED }}>✕ {checked.missing.join(', ')} — not in this {scopeWord}</span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p style={{ fontSize: 11, fontWeight: 700, color: count ? GREEN : 'var(--ak-text-muted)', margin: '8px 0 0' }}>
                {rLoading && mode === 'all'
                  ? <><Spinner /> Counting…</>
                  : mode === 'all'
                    ? `${count} classmate${count === 1 ? '' : 's'} will be entered`
                    : count === 1
                      ? '1 classmate — a 1-v-1 challenge they can accept or decline'
                      : `${count} classmates — a group battle`}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={LABEL}>Difficulty</label>
                <select value={difficulty} onChange={e => setDifficulty(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                  <option value="easy">Easy</option>
                  <option value="intermediate">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={LABEL}>XP prize</label>
                <input type="number" min="0" value={xpPrize} onChange={e => setXpPrize(e.target.value)} style={FIELD} />
              </div>
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={LABEL}>🗓 Schedule for <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ak-text-muted)' }}>optional</span></label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={FIELD} />
              <p style={{ fontSize: 10.5, color: 'var(--ak-text-muted)', margin: '5px 0 0', lineHeight: 1.45 }}>
                Leave empty to send the challenge right now.
              </p>
            </div>

            {error && <p style={{ fontSize: 12, fontWeight: 800, color: RED, margin: '0 0 12px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{
                flex: 1, padding: '13px', borderRadius: 14, border: '1.5px solid var(--ak-border2)',
                background: 'var(--ak-surface-hover)', fontSize: 13, fontWeight: 800,
                color: 'var(--ak-text-sub)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
              }}>Cancel</button>
              <button onClick={submit} disabled={busy || !title.trim()} style={{
                flex: 1.6, padding: '13px', borderRadius: 14, border: 'none',
                background: (busy || !title.trim()) ? 'var(--ak-border2)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
                fontSize: 13, fontWeight: 800,
                color: (busy || !title.trim()) ? 'var(--ak-text-muted)' : '#fff',
                cursor: (busy || !title.trim()) ? 'default' : 'pointer',
                fontFamily: "'Nunito',sans-serif",
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
                {busy ? <><Spinner color="#fff" /> Sending…</> : `⚔️ Challenge${count ? ` ${count}` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>

      <NoAgentSheet
        open={needsAgent}
        onClose={() => setNeedsAgent(false)}
        defaultName="My Agent"
        onCreated={send}
      />
    </>
  );
}
