import { useState, useEffect, useCallback } from 'react';
import { Plus, Swords, Users, Clock, Trophy, Play, Zap, Search, Trash2, Pencil, Radio, ClipboardList } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, StatusPill, Badge, Toast } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import AudiencePicker, { audienceBody, parseHandles, BLANK_AUDIENCE } from '../components/AudiencePicker.jsx';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import NoAgentModal, { isNoAgentError } from '../components/NoAgentModal.jsx';
import WatchBattleModal from '../components/WatchBattleModal.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

/* ── New / Edit Battle Modal ────────────────────────────────────────────── */
const BLANK = {
  courseId: '', title: '', topic: '', description: '',
  kind: 'course',            // 'course' | 'class'
  questionSource: 'auto',    // 'auto' | 'bank' | 'ai'
  classId: '', subject: '',  // class battles only
  audience: BLANK_AUDIENCE,
  totalQuestions: '15', duration: '15', xpPrize: '200', hpPerMiss: '10', minXp: '0',
  difficulty: 'intermediate', scheduledAt: '', expiresInMinutes: '60',
};

function BattleModal({ open, onClose, onSubmit, courses, editing }) {
  const [form, setForm]     = useState(BLANK);
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Classes carry their own subjects, which is what a class battle draws
  // questions from — so one fetch answers both "which class?" and "which
  // subject?".
  useEffect(() => {
    if (!open) return;
    setClassesLoading(true);
    apiGet('/api/battle/my-classes')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, [open]);

  const chosenClass = classes.find(c => c.id === form.classId);

  // Reset each time the modal opens, seeded from the battle being edited.
  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setForm({
        ...BLANK,
        // Edit what it is: a class battle or review has no course, and keeping
        // kind 'course' blocked Save with "Pick a course."
        kind: editing.type === 'review' ? 'review' : (editing.scope === 'class' || editing.classroomId) ? 'class' : 'course',
        courseId: editing.courseId || '',
        classId: editing.classroomId || '',
        subject: editing.subject || '',
        title: editing.title || '',
        topic: editing.topic || '',
        description: editing.description || '',
        totalQuestions: String(editing.totalQuestions || 15),
        duration: String(editing.durationMin || 15),
        xpPrize: String(editing.xpPool || 200),
        hpPerMiss: String(editing.hpPerMiss ?? 10),
        minXp: String(editing.entry?.minXp ?? 0),
        difficulty: editing.difficulty || 'intermediate',
        scheduledAt: editing.scheduledAt ? toLocalInput(editing.scheduledAt) : '',
      });
    } else {
      setForm({ ...BLANK, courseId: courses[0]?.id || '' });
    }
  }, [open, editing, courses]);

  useEffect(() => {
    if (!classes.length) return;
    setForm(f => {
      if (f.classId && classes.some(c => c.id === f.classId)) return f;
      const first = classes[0];
      return { ...f, classId: first.id, subject: first.subjects?.[0] ?? '' };
    });
  }, [classes]);

  useEffect(() => {
    if (!chosenClass) return;
    setForm(f => (chosenClass.subjects?.includes(f.subject)
      ? f : { ...f, subject: chosenClass.subjects?.[0] ?? '' }));
  }, [chosenClass]);   // eslint-disable-line react-hooks/exhaustive-deps


  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!editing && (form.kind === 'class' || form.kind === 'review')) {
      if (!form.classId) return setError('Pick a class.');
      if (!form.subject) return setError('Pick a subject — the questions are drawn from one.');
    } else if (!editing && !form.courseId) return setError('Pick a course.');
    // A review is one learner being checked, not a group being set work.
    if (!editing && form.kind === 'review') {
      const picked = form.audience.selected.length + parseHandles(form.audience.typed).length;
      if (form.audience.mode !== 'picked' || picked !== 1) {
        return setError('A study review is for one learner — choose exactly one.');
      }
    }
    if (!form.title.trim()) return setError('Give the battle a title.');
    if (!editing) {
      const aud = form.audience;
      if (aud.mode === 'class' && !aud.classroomId) return setError('Pick which class this is for.');
      if (aud.mode === 'picked' && !(aud.selected.length + parseHandles(aud.typed).length))
        return setError('Choose at least one learner, or send it to a course or class.');
    }

    setLoading(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save the battle.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Battle' : 'Create Battle'} width={540}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Battle type first: it decides where the questions come from, and
            therefore what every field below means. A course battle draws on
            that course's question bank; a class battle draws on the
            past-questions bank for a subject the class studies. */}
        {!editing && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 7 }}>Battle type *</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'course', label: '📘 Course battle', hint: courses.length ? "From a course's question bank" : 'No courses yet', off: !courses.length },
                { key: 'class',  label: '🏫 Class battle',  hint: classesLoading ? 'Loading…' : classes.length ? 'From a class subject' : 'No classes yet', off: !classesLoading && !classes.length },
                // Not a contest: one learner, no opponent, no winner — a mark
                // sheet at the end saying what they knew.
                { key: 'review', label: '📋 Study review',  hint: classesLoading ? 'Loading…' : classes.length ? 'One learner, mark sheet' : 'No classes yet', off: !classesLoading && !classes.length },
              ].map(o => (
                <button key={o.key} type="button" disabled={o.off}
                  onClick={() => setField('kind', o.key)}
                  style={{
                    flex: 1, padding: '9px 8px', borderRadius: 10, textAlign: 'left',
                    border: `1.5px solid ${form.kind === o.key ? AMBER : BORDER}`,
                    background: form.kind === o.key ? `${AMBER}12` : WHITE,
                    cursor: o.off ? 'not-allowed' : 'pointer', opacity: o.off ? 0.5 : 1,
                    fontFamily: FONT,
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: form.kind === o.key ? AMBER : INK }}>{o.label}</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(form.kind === 'course' || (editing && form.courseId)) ? (
          <Sel label="Course *" value={form.courseId} onChange={e => setField('courseId', e.target.value)} disabled={!!editing}>
            <option value="">Select a course…</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </Sel>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Sel label="Class *" value={form.classId} onChange={e => setField('classId', e.target.value)} disabled={!!editing}>
              {classesLoading && <option value="">Loading classes…</option>}
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.student_count ? ` — ${c.student_count} learners` : ''}
                </option>
              ))}
            </Sel>
            {/* Fixed once made: the questions are already written for this class and subject. */}
            <Sel label="Subject *" value={form.subject} onChange={e => setField('subject', e.target.value)} disabled={!!editing}>
              {(chosenClass?.subjects ?? []).length === 0 && <option value="">No subjects set</option>}
              {(chosenClass?.subjects ?? []).map(sub => <option key={sub} value={sub}>{sub}</option>)}
            </Sel>
          </div>
        )}

        <Inp label="Battle Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Photosynthesis Showdown" />
        <Inp label="Topic" value={form.topic} onChange={e => setField('topic', e.target.value)} placeholder="e.g. Photosynthesis" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="What will learners be tested on?" rows={2} />

        {/* The scope is already settled above, so this only asks WHO within it —
            offering "a class" again here would be the same question with two
            possible answers. */}
        {!editing && (
          <AudiencePicker
            value={form.audience}
            onChange={(v) => setField('audience', v)}
            // A review has no "everyone" — it is one learner by definition, so
            // offering the whole class here would be offering something the
            // server will refuse.
            modes={form.kind === 'review' ? ['picked'] : ['course', 'picked']}
            allLabel={form.kind !== 'course'
              ? { label: 'Everyone in the class', hint: 'All active members' }
              : { label: 'Everyone on the course', hint: 'All active enrolments' }}
            rosterUrl={form.kind !== 'course'
              ? (form.classId ? `/api/battle/classes/${form.classId}/roster` : null)
              : (form.courseId ? `/api/battle/courses/${form.courseId}/roster` : null)}
            requireAgent
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <Inp label="Questions" type="number" min="1" value={form.totalQuestions} onChange={e => setField('totalQuestions', e.target.value)} disabled={!!editing} title={editing ? 'The questions are already written — make a new battle to change how many.' : undefined} />
          <Inp label="Duration (min)" type="number" min="1" value={form.duration} onChange={e => setField('duration', e.target.value)} />
          <Inp label="XP prize" type="number" min="0" value={form.xpPrize} onChange={e => setField('xpPrize', e.target.value)} />
          {/* What a miss costs — like marks per question. Learners see it before they accept. */}
          <Inp label="HP lost per miss" type="number" min="0" max="50" value={form.hpPerMiss} onChange={e => setField('hpPerMiss', e.target.value)} />
        </div>
        {/* Entry requirement for a battle. A review checks knowledge — never gated on XP. */}
        {form.kind !== 'review' && (
          <Inp label="Minimum XP to join (0 = open to all)" type="number" min="0" value={form.minXp} onChange={e => setField('minXp', e.target.value)} />
        )}
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginTop: -6 }}>
          {(() => {
            const h = Math.min(50, Math.max(0, parseInt(form.hpPerMiss, 10) || 0));
            return h ? `Every agent starts on 100 HP and loses ${h} for each question it misses — out after ${Math.ceil(100 / h)} misses (then it watches, unranked).`
              : 'No HP lost for misses — nobody can be knocked out.';
          })()}
        </div>
        {/* Duration is shared across the questions, so say what each one gets.
            The number on its own told a teacher nothing — and until now it did
            nothing either: every battle ran at a hard 15 seconds a question
            whatever was typed here. */}
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginTop: -6 }}>
          {(() => {
            const q = parseInt(form.totalQuestions, 10);
            const m = parseInt(form.duration, 10);
            if (!q || !m) return 'Duration is shared across the questions.';
            const secs = Math.min(180, Math.max(8, Math.floor((m * 60) / q)));
            const clamped = secs !== Math.floor((m * 60) / q);
            return `≈ ${secs}s per question${clamped ? ' (clamped to the 8–180s range)' : ''}`;
          })()}
        </div>

        {!editing && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 7 }}>Questions *</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'auto', label: 'Bank + AI', hint: 'Real questions first, AI for the rest' },
                { key: 'bank', label: 'Question bank only', hint: 'Past papers / your bank' },
                { key: 'ai',   label: 'Generate with AI',   hint: 'Written in the bank\u2019s style' },
              ].map(o => (
                <button key={o.key} type="button" onClick={() => setField('questionSource', o.key)} style={{
                  flex: 1, padding: '9px 8px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                  border: `1.5px solid ${form.questionSource === o.key ? AMBER : BORDER}`,
                  background: form.questionSource === o.key ? `${AMBER}12` : WHITE, fontFamily: FONT,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: form.questionSource === o.key ? AMBER : INK }}>{o.label}</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>{o.hint}</div>
                </button>
              ))}
            </div>
            {form.questionSource !== 'bank' && (
              <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT, marginTop: 5, lineHeight: 1.45 }}>
                Generated questions are modelled on real exam questions for this subject and cost coins.
                Nothing is charged if generation fails.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="intermediate">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
          <Inp label="Schedule for (optional)" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading || !form.title.trim() || (!editing && form.kind === 'course' && !form.courseId)}>
            {loading ? 'Saving…' : editing ? 'Save changes' : 'Create Battle'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* datetime-local wants local wall-clock, not the ISO Z string. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── Difficulty badge ───────────────────────────────────────────────────── */
function DiffBadge({ difficulty }) {
  const map = {
    easy:         { color: GREEN, bg: '#DCFCE7', label: 'easy' },
    medium:       { color: AMBER, bg: '#FFF7ED', label: 'medium' },
    intermediate: { color: AMBER, bg: '#FFF7ED', label: 'medium' },
    hard:         { color: RED,   bg: '#FEE2E2', label: 'hard' },
  };
  const cfg = map[difficulty] || map.intermediate;
  return <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>;
}

/* ── Participants drawer ────────────────────────────────────────────────── */
/**
 * Who was invited, who accepted, who declined, and — once it has run — how they
 * did. The card only ever showed a participant COUNT, which for an invitation
 * is the wrong number: it counts seats, not people who agreed to sit in them.
 * Same shape as the Self Study drawer, deliberately.
 */
function ParticipantsModal({ open, onClose, battleId }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !battleId) { setData(null); setError(null); return; }
    let live = true;
    apiGet(`/api/battle/battles/${battleId}/participants`)
      .then(d => { if (live) setData(d?.data ?? null); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, battleId]);

  const STATE = {
    accepted: { color: GREEN, bg: '#DCFCE7', label: 'Accepted' },
    declined: { color: RED,   bg: '#FEE2E2', label: 'Declined' },
    invited:  { color: MUTED, bg: LIGHT,     label: 'No answer yet' },
  };
  const s = data?.summary;
  const ran = data && ['live', 'completed'].includes(data.status);

  return (
    <Modal open={open} onClose={onClose} title={data?.title || 'Participants'} width={500}>
      {error ? (
        <div style={{ fontSize: 13, color: RED, fontFamily: FONT, padding: '10px 0' }}>{error}</div>
      ) : !data ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT, padding: '10px 0' }}>Loading…</div>
      ) : (
        <div style={{ fontFamily: FONT }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge color={GREEN} bg="#DCFCE7">{s.accepted} accepted</Badge>
            {s.pending  > 0 && <Badge color={MUTED} bg={LIGHT}>{s.pending} not answered</Badge>}
            {s.declined > 0 && <Badge color={RED} bg="#FEE2E2">{s.declined} declined</Badge>}
            <Badge color={BLUE} bg="#EFF6FF">{s.invited} invited</Badge>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {data.participants.filter(p => p.role !== 'teacher').map(p => {
              const st = STATE[p.state] || STATE.invited;
              return (
                <div key={p.userId} style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                  border: `1px solid ${BORDER}`, borderRadius: 10, background: WHITE,
                }}>
                  <span style={{ fontSize: 16 }}>{p.emoji || '🧑‍🎓'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
                      {p.fullName}{p.isWinner && <span title="Winner"> 🏆</span>}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED }}>@{p.username}</div>
                  </div>
                  {/* Once it has run, the score IS the status — showing
                      "Accepted" next to a finished battle says nothing. */}
                  {ran && p.state === 'accepted'
                    ? <Badge color={PURPLE} bg={`${PURPLE}14`}>{p.score} pts · {p.correct}✓</Badge>
                    : <Badge color={st.color} bg={st.bg}>{st.label}</Badge>}
                </div>
              );
            })}
            {s.invited === 0 && (
              <div style={{ fontSize: 12, color: MUTED, padding: '10px 0' }}>Nobody was invited to this battle.</div>
            )}
          </div>

          {s.pending > 0 && !ran && (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 12, lineHeight: 1.5 }}>
              Learners who never answer are left out when the battle starts — they are not
              scored for it.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}


/* ── Mark sheet (study review) ──────────────────────────────────────────── */
/**
 * A review has no winner, so a scoreboard says nothing about it. What a teacher
 * wants is the paper back: every question, what the learner chose, what was
 * right — plus where the gaps cluster, which is the thing they would otherwise
 * tally by hand.
 */
function MarkSheetModal({ open, onClose, battleId }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !battleId) { setData(null); setError(null); return; }
    let live = true;
    apiGet(`/api/battle/battles/${battleId}/results`)
      .then(d => { if (live) setData(d); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, battleId]);

  const s = data?.score;

  return (
    <Modal open={open} onClose={onClose} title={data?.learner?.fullName ? `${data.learner.fullName} — mark sheet` : 'Mark sheet'} width={620}>
      {error ? (
        <div style={{ fontSize: 13, color: RED, fontFamily: FONT, padding: '10px 0' }}>{error}</div>
      ) : !data ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT, padding: '10px 0' }}>Loading…</div>
      ) : data.type !== 'review' ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>This battle is not a study review.</div>
      ) : (
        <div style={{ fontFamily: FONT }}>
          {/* The number first — it is the answer to "how did they do?" */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px',
            borderRadius: 12, background: LIGHT, marginBottom: 14,
          }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: s.percent >= 50 ? GREEN : RED }}>{s.percent}%</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{s.correct} of {s.total} correct</span>
            <span style={{ flex: 1 }} />
            {/* What the review paid. The drawer showed the mark but not the
                reward, so a teacher could not answer "what did they get for
                it?" — which is the learner's first question. */}
            {data.learner?.xpEarned > 0 && (
              <Badge color={AMBER} bg="#FFF7ED"><Zap size={10} style={{ marginRight: 3 }} />{data.learner.xpEarned} XP</Badge>
            )}
            {s.unanswered > 0 && <Badge color={MUTED} bg={WHITE}>{s.unanswered} unanswered</Badge>}
            {data.battle?.duration_formatted && (
              <Badge color={MUTED} bg={WHITE}><Clock size={10} style={{ marginRight: 3 }} />{data.battle.duration_formatted}</Badge>
            )}
          </div>

          {data.byTopic?.length > 1 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, marginBottom: 7, letterSpacing: .3 }}>BY TOPIC — WEAKEST FIRST</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {data.byTopic.map(t => (
                  <Badge key={t.topic} color={t.percent >= 50 ? GREEN : RED} bg={t.percent >= 50 ? '#DCFCE7' : '#FEE2E2'}>
                    {t.topic} {t.correct}/{t.total}
                  </Badge>
                ))}
              </div>
            </>
          )}

          <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, marginBottom: 7, letterSpacing: .3 }}>EVERY QUESTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {data.markSheet.map(r => (
              <div key={r.order} style={{
                border: `1px solid ${r.isCorrect ? GREEN + '55' : BORDER}`, borderRadius: 10, padding: '10px 12px',
                background: r.isCorrect ? '#F0FDF4' : WHITE,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: r.isCorrect ? GREEN : RED }}>
                    {r.isCorrect ? '✓' : '✗'} Q{r.order}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, flex: 1 }}>{r.question}</span>
                  {r.topic && <span style={{ fontSize: 10, color: MUTED }}>{r.topic}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
                  {/* "No answer" is not the same as a wrong answer, and a
                      teacher reading the sheet needs to see which it was. */}
                  {!r.answered
                    ? <span style={{ color: MUTED }}>No answer given</span>
                    : <>Chose <b style={{ color: r.isCorrect ? GREEN : RED }}>{r.chosenAnswer}</b></>}
                  {!r.isCorrect && <> · Correct answer <b style={{ color: GREEN }}>{r.correctAnswer}</b></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Battle Card ────────────────────────────────────────────────────────── */
function BattleCard({ battle, onStart, onEdit, onDelete, onViewParticipants, onWatch }) {
  const isLive     = battle.status === 'live';
  const isFinished = ['completed', 'cancelled', 'expired'].includes(battle.status);
  // A review has one learner and no winner, so the contest wording on this card
  // ("participants", the trophy) would misdescribe it.
  const isReview   = battle.type === 'review';
  const editable   = !['live', 'completed'].includes(battle.status) && battle.mine;
  const deletable  = battle.status !== 'live' && battle.mine;
  const scheduled  = battle.scheduledAt ? new Date(battle.scheduledAt) : null;

  return (
    <div style={{
      background: WHITE, border: `1px solid ${isLive ? AMBER : BORDER}`,
      borderRadius: 16, padding: '20px',
      boxShadow: isLive ? `0 4px 20px ${AMBER}22` : 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {isLive && (
        <div style={{
          position: 'absolute', top: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 4,
          background: '#DCFCE7', color: GREEN, fontSize: 10, fontWeight: 800,
          padding: '3px 8px', borderRadius: 20,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: GREEN, display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
          LIVE
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: isLive ? `linear-gradient(135deg, ${AMBER}, #D4651E)` : `${PURPLE}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isReview ? <ClipboardList size={20} color={isLive ? WHITE : PURPLE} />
                    : <Swords size={20} color={isLive ? WHITE : PURPLE} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, fontFamily: FONT }}>{battle.title}</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{battle.topic || battle.subject}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusPill status={battle.status} />
        <DiffBadge difficulty={battle.difficulty} />
        <button
          type="button"
          onClick={() => onViewParticipants(battle)}
          title="View participants"
          style={{ border: 'none', padding: 0, background: 'none', cursor: 'pointer' }}
        >
          <Badge color={BLUE} bg="#EFF6FF">
            {isReview ? <>📋 Review</> : <><Users size={10} style={{ marginRight: 2 }} />{battle.participantCount}</>}
          </Badge>
        </button>
        <Badge color={MUTED} bg={LIGHT}><Clock size={10} style={{ marginRight: 2 }} />{battle.durationMin}min</Badge>
        <Badge color={AMBER} bg="#FFF7ED"><Zap size={10} style={{ marginRight: 2 }} />{battle.xpPool} XP</Badge>
      </div>

      {scheduled && (
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, marginBottom: 14 }}>
          {isFinished ? 'Ended' : 'Starts'}: {scheduled.toLocaleDateString()} at {scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {!isFinished && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn
            size="sm"
            variant={isLive ? 'secondary' : 'primary'}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => (isLive ? onWatch(battle) : onStart(battle.id))}
          >
            {/* When it is live this said "In Progress" and did nothing at all.
                Live is exactly when a school wants to look in. */}
            {isLive ? <><Radio size={14} /> Watch Live</> : <><Play size={14} /> Start Now</>}
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => onViewParticipants(battle)} title="View participants"><Users size={13} /></Btn>
          {editable && (
            <>
              <Btn size="sm" variant="secondary" onClick={() => onEdit(battle)} title="Edit"><Pencil size={13} /></Btn>
              <Btn size="sm" variant="secondary" onClick={() => onDelete(battle)} title="Cancel battle"><Trash2 size={13} /></Btn>
            </>
          )}
        </div>
      )}

      {isFinished && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => onViewParticipants(battle)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
              color: MUTED, fontFamily: FONT, background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Trophy size={14} color={AMBER} />
            {isReview ? 'View mark sheet' : `${battle.participantCount} participants — see results`}
          </button>
          <Btn size="sm" variant="secondary" onClick={() => onWatch(battle)} title="Review the battle"><Radio size={13} /></Btn>
          {editable && <Btn size="sm" variant="secondary" onClick={() => onEdit(battle)} title="Edit"><Pencil size={13} /></Btn>}
          {deletable && <Btn size="sm" variant="secondary" onClick={() => onDelete(battle)} title="Delete"><Trash2 size={13} /></Btn>}
        </div>
      )}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function BattlesPage() {
  const { getBattles, createBattle, updateBattle, startBattle, deleteBattle } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();
  const { user } = useAuth();
  const socket = useInstructorSocket(user?.id);

  const [battles, setBattles] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [viewing, setViewing] = useState(null);   // battle id whose roster is open
  const [watching, setWatching] = useState(null); // battle being watched live
  const [marking, setMarking]   = useState(null); // review whose mark sheet is open
  const [editing, setEditing] = useState(null);
  const [toast,   setToast]   = useState(null);
  const [filter,  setFilter]  = useState('all');
  const [noAgent, setNoAgent] = useState(null);   // holds the retry, so creating one resumes the battle

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const res = await getBattles();
      setBattles(res?.data ?? []);
    } catch (err) {
      console.warn('Battles API error:', err);
      setBattles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getCourses()
      .then(res => setCourses(res?.data ?? res?.courses ?? []))
      .catch(() => setCourses([]));
  }, []);

  // Real-time battle updates
  useEffect(() => {
    const refresh = () => load();
    socket.on('battle.created', refresh);
    socket.on('battle.updated', refresh);
    return () => {
      socket.off('battle.created', refresh);
      socket.off('battle.updated', refresh);
    };
  }, [load]);

  // The modal's submit awaits this, so a thrown error surfaces in the form.
  // A missing agent is not a form error though — it's a setup step, so we swap
  // it for the modal that creates one and then replays this exact submit.
  const handleSubmit = async (form) => {
    try {
      return await submitBattle(form);
    } catch (err) {
      if (!isNoAgentError(err)) throw err;
      setNoAgent(() => () => submitBattle(form));
      return;   // the battle modal closes; the agent modal takes over
    }
  };

  const submitBattle = async (form) => {
    const scheduledIso = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;

    if (editing) {
      await updateBattle(editing.id, {
        title: form.title.trim(),
        description: form.description || null,
        topic: form.topic || null,
        difficulty: form.difficulty,
        total_questions: parseInt(form.totalQuestions, 10) || 15,
        time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
        xp_prize: parseInt(form.xpPrize, 10) || 0,
        xp_pool:  parseInt(form.xpPrize, 10) || 0,
        hp_per_miss: form.hpPerMiss === '' ? undefined : parseInt(form.hpPerMiss, 10),
        min_xp: form.kind === 'review' ? 0 : (parseInt(form.minXp, 10) || 0),
        scheduled_start: scheduledIso,
      });
      showToast('Battle updated');
    } else {
      const res = await createBattle({
        kind: form.kind, courseId: form.courseId, classId: form.classId,
        question_source: form.questionSource,
        ...(form.kind !== 'course' ? { subject: form.subject } : {}),
        // The server decides what a review IS; the form only says which it is.
        ...(form.kind === 'review' ? { mode: 'review' } : {}),
        title: form.title.trim(),
        description: form.description || null,
        topic: form.topic || null,
        difficulty: form.difficulty,
        total_questions: parseInt(form.totalQuestions, 10) || 15,
        time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
        xp_prize: parseInt(form.xpPrize, 10) || 200,
        hp_per_miss: form.hpPerMiss === '' ? undefined : parseInt(form.hpPerMiss, 10),
        min_xp: form.kind === 'review' ? 0 : (parseInt(form.minXp, 10) || 0),
        expires_in_minutes: parseInt(form.expiresInMinutes, 10) || 60,
        scheduled_for: scheduledIso,
        // course | class | chosen learners — one helper so battles and self
        // study can never disagree on what a mode means.
        ...audienceBody(form.audience),
      });
      const d = res?.data ?? {};
      // Name who missed out. "2 skipped" tells a teacher nothing they can act on.
      const bits = [];
      if (d.skipped?.not_enrolled?.length) bits.push(`not on this course: ${d.skipped.not_enrolled.join(', ')}`);
      if (d.skipped?.not_in_class?.length)  bits.push(`not in this class: ${d.skipped.not_in_class.join(', ')}`);
      if (d.skipped?.no_agent?.length)     bits.push(`no agent yet: ${d.skipped.no_agent.join(', ')}`);
      // Where the questions came from is the thing a teacher most wants to know
      // about an AI-assisted battle, so lead with it.
      const src = d.generated ? `${d.fromBank} from the bank + ${d.generated} generated` : `${d.questions} questions`;
      showToast(`Battle created — ${d.invited} challenged, ${src}${bits.length ? `. Left out — ${bits.join('; ')}` : ''}`);
    }
    setEditing(null);
    load();
  };

  const handleStart = async (id) => {
    try {
      await startBattle(id);
      setBattles(bs => bs.map(b => b.id === id ? { ...b, status: 'live' } : b));
      showToast('Battle is starting — it goes live in a moment.');
    } catch (e) {
      showToast(e?.message || 'Could not start the battle', 'error');
    }
  };

  const handleDelete = async (battle) => {
    if (!await confirmDialog(`Delete “${battle.title}”? This removes it for everyone invited, along with its questions and results.`)) return;
    const before = battles;
    setBattles(bs => bs.filter(b => b.id !== battle.id));
    try {
      await deleteBattle(battle.id);
      showToast('Battle deleted');
    } catch (e) {
      setBattles(before);   // it's still there — don't pretend otherwise
      showToast(e?.message || 'Could not delete the battle', 'error');
    }
  };

  const openNew  = () => { setEditing(null); setModal(true); };
  const openEdit = (b) => { setEditing(b); setModal(true); };

  const filtered = filter === 'all' ? battles : battles.filter(b => b.status === filter);

  const stats = {
    live:      battles.filter(b => b.status === 'live').length,
    scheduled: battles.filter(b => b.status === 'scheduled').length,
    completed: battles.filter(b => b.status === 'completed').length,
    total:     battles.length,
  };

  return (
    <PageLayout
      title="Battles"
      subtitle="Create and manage quiz battles across your school"
      action={
        <Btn size="sm" onClick={openNew}>
          <Plus size={14} /> New Battle
        </Btn>
      }
    >
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total', value: stats.total, color: AMBER },
          { label: 'Live Now', value: stats.live, color: GREEN },
          { label: 'Scheduled', value: stats.scheduled, color: BLUE },
          { label: 'Completed', value: stats.completed, color: PURPLE },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: FONT }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'live', 'scheduled', 'lobby', 'completed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: filter === f ? AMBER : WHITE,
              color: filter === f ? WHITE : MUTED,
              border: `1.5px solid ${filter === f ? AMBER : BORDER}`,
              cursor: 'pointer', fontFamily: FONT, textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Battles grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <Swords size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {filter === 'all' ? 'No battles yet' : `No ${filter} battles`}
          </p>
          {filter === 'all' && <Btn onClick={openNew}><Plus size={14} /> Create your first battle</Btn>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(b => (
            <BattleCard key={b.id} battle={b} onStart={handleStart} onEdit={openEdit}
                        onDelete={handleDelete}
                        onViewParticipants={(x) => (x.type === 'review' && x.status === 'completed'
                          ? setMarking(x.id) : setViewing(x.id))}
                        onWatch={setWatching} />
          ))}
        </div>
      )}

      {watching && (
        <WatchBattleModal battle={watching} onClose={() => setWatching(null)} onEnded={load} />
      )}
      <MarkSheetModal open={!!marking} onClose={() => setMarking(null)} battleId={marking} />
      <ParticipantsModal open={!!viewing} onClose={() => setViewing(null)} battleId={viewing} />
      <BattleModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null); }}
        onSubmit={handleSubmit}
        courses={courses}
        editing={editing}
      />
      <NoAgentModal open={!!noAgent} context="battle" onClose={() => setNoAgent(null)} onCreated={noAgent} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
