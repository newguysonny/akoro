/**
 * CreateBattleSheet — a learner starts a battle.
 *
 * Same idea as the teacher's version in the instructor/school apps, and the
 * same endpoint: pick a course, then say WHO. One classmate makes a 1-v-1
 * challenge they can accept or decline; several — or the whole class — makes a
 * group battle everyone is entered into. Usernames can be typed as well as
 * tapped, because learners know each other by handle.
 */
import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import { apiGet, apiPost } from '../../services/api.js';

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

export default function CreateBattleSheet({ onClose, onCreated }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [roster, setRoster] = useState([]);
  const [rLoading, setRLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('picked');       // 'picked' | 'class'
  const [selected, setSelected] = useState([]);
  const [typed, setTyped] = useState('');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [xpPrize, setXpPrize] = useState('200');
  const [scheduledAt, setScheduledAt] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Courses the learner is actually enrolled in — you can only battle inside one.
  useEffect(() => {
    apiGet('/api/user/enrollments')
      .then(d => {
        const list = (d.data || d.enrollments || [])
          .filter(e => e.courses)
          .map(e => ({ id: e.courses.id, title: e.courses.title }));
        setCourses(list);
        if (list.length) setCourseId(list[0].id);
      })
      .catch(() => setCourses([]));
  }, []);

  useEffect(() => {
    if (!courseId) { setRoster([]); return; }
    let dead = false;
    setRLoading(true);
    apiGet(`/api/battle/courses/${courseId}/roster`)
      .then(d => { if (!dead) setRoster(d?.data ?? []); })
      .catch(() => { if (!dead) setRoster([]); })
      .finally(() => { if (!dead) setRLoading(false); });
    return () => { dead = true; };
  }, [courseId]);

  const typedNames = typed.split(',').map(s => s.trim()).filter(Boolean);
  const count = mode === 'class'
    ? roster.filter(r => r.has_agent).length
    : selected.length + typedNames.length;

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    setError('');
    if (!courseId) return setError('Pick a course first.');
    if (!title.trim()) return setError('Give your battle a title.');
    if (mode === 'picked' && count === 0) return setError('Choose at least one classmate, or pick “Whole class”.');

    setBusy(true);
    try {
      const d = await apiPost(`/api/battle/courses/${courseId}/battles/invite`, {
        title: title.trim(),
        topic: topic.trim() || null,
        difficulty,
        xp_prize: parseInt(xpPrize, 10) || 200,
        expires_in_minutes: 60,
        scheduled_for: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        whole_class: mode === 'class',
        user_ids: mode === 'class' ? [] : selected,
        usernames: mode === 'class' ? [] : typedNames,
      });
      onCreated?.(d?.data ?? d);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not create the battle.');
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,6,18,.55)', backdropFilter: 'blur(5px)' }} />
      <div style={SHEET}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border3)', margin: '14px auto 20px' }} />
        <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>⚔️ Start a battle</p>
        <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Challenge one classmate, a few of them, or your whole class. Your agents do the fighting.
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL}>Course</label>
          <select value={courseId} onChange={e => setCourseId(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
            {courses.length === 0 && <option value="">No enrolled courses yet</option>}
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL}>Battle title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Photosynthesis Showdown" style={FIELD} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL}>Topic <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ak-text-muted)' }}>optional</span></label>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Photosynthesis" style={FIELD} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={LABEL}>Who are you challenging?</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['picked', 'Pick classmates', 'One or more'], ['class', 'Whole class', 'Everyone enrolled']].map(([k, l, hint]) => (
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
                  <div style={{ padding: 14, fontSize: 12, color: 'var(--ak-text-muted)' }}>Loading classmates…</div>
                ) : roster.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 12, color: 'var(--ak-text-muted)' }}>No classmates in this course yet.</div>
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
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, fontWeight: 700, color: count ? GREEN : 'var(--ak-text-muted)', margin: '8px 0 0' }}>
            {mode === 'class'
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
          <button onClick={submit} disabled={busy || !title.trim() || !courseId} style={{
            flex: 1.6, padding: '13px', borderRadius: 14, border: 'none',
            background: (busy || !title.trim() || !courseId) ? 'var(--ak-border2)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
            fontSize: 13, fontWeight: 800,
            color: (busy || !title.trim() || !courseId) ? 'var(--ak-text-muted)' : '#fff',
            cursor: (busy || !title.trim() || !courseId) ? 'default' : 'pointer',
            fontFamily: "'Nunito',sans-serif",
          }}>{busy ? 'Sending…' : `⚔️ Challenge${count ? ` ${count}` : ''}`}</button>
        </div>
      </div>
    </>
  );
}
