/**
 * Battle management pieces shared by the Activities page (Battles is no longer
 * a page of its own): the edit modal, the participants roster and the review
 * mark sheet.
 */
import { useState, useEffect } from 'react';
import { Modal, Badge } from '../Primitives.jsx';
import { apiGet } from '../../services/api.js';
import BattleForm from './BattleForm.jsx';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';

import { Ico } from '../../theme/Ico.jsx';
import Loading from "../Loading.jsx";

/* ── New / Edit Battle Modal ────────────────────────────────────────────── */
export function BattleModal({ open, onClose, onSubmit, courses, editing }) {
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Battle' : 'Create Battle'} width={540}>
      <BattleForm onSubmit={onSubmit} onCancel={onClose} courses={courses} editing={editing}
        submitLabel={editing ? 'Save changes' : 'Create Battle'} />
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
export function DiffBadge({ difficulty }) {
  const map = {
    easy:         { color: GREEN, bg: '#DCFCE7', label: 'easy' },
    medium:       { color: C.brand, bg: C.brandSoft, label: 'medium' },
    intermediate: { color: C.brand, bg: C.brandSoft, label: 'medium' },
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
export function ParticipantsModal({ open, onClose, battleId }) {
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
    invited:  { color: C.muted, bg: C.bg,     label: 'No answer yet' },
  };
  const s = data?.summary;
  const ran = data && ['live', 'completed'].includes(data.status);

  return (
    <Modal open={open} onClose={onClose} title={data?.title || 'Participants'} width={500}>
      {error ? (
        <div style={{ fontSize: 13, color: RED, fontFamily: C.font, padding: '10px 0' }}>{error}</div>
      ) : !data ? (
        <Loading label="Loading the battle…" />
      ) : (
        <div style={{ fontFamily: C.font }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge color={GREEN} bg="#DCFCE7">{s.accepted} accepted</Badge>
            {s.pending  > 0 && <Badge color={C.muted} bg={C.bg}>{s.pending} not answered</Badge>}
            {s.declined > 0 && <Badge color={RED} bg="#FEE2E2">{s.declined} declined</Badge>}
            <Badge color={BLUE} bg="#EFF6FF">{s.invited} invited</Badge>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {data.participants.filter(p => p.role !== 'teacher').map(p => {
              const st = STATE[p.state] || STATE.invited;
              return (
                <div key={p.userId} style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                  border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: '#6B7280' }}>{(p.fullName || 'L').trim().charAt(0).toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                      {p.fullName}{p.isWinner && <Ico ti="ti-trophy" size={12} color="#F59E0B" style={{ verticalAlign: '-2px', marginLeft: 4 }} />}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>@{p.username}</div>
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
              <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Nobody was invited to this battle.</div>
            )}
          </div>

          {s.pending > 0 && !ran && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
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
export function MarkSheetModal({ open, onClose, battleId }) {
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
        <div style={{ fontSize: 13, color: RED, fontFamily: C.font, padding: '10px 0' }}>{error}</div>
      ) : !data ? (
        <Loading label="Loading the battle…" />
      ) : data.type !== 'review' ? (
        <div style={{ fontSize: 13, color: C.muted, fontFamily: C.font }}>This battle is not a study review.</div>
      ) : (
        <div style={{ fontFamily: C.font }}>
          {/* The number first — it is the answer to "how did they do?" */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px',
            borderRadius: 12, background: C.bg, marginBottom: 14,
          }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: s.percent >= 50 ? GREEN : RED }}>{s.percent}%</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{s.correct} of {s.total} correct</span>
            <span style={{ flex: 1 }} />
            {/* What the review paid. The drawer showed the mark but not the
                reward, so a teacher could not answer "what did they get for
                it?" — which is the learner's first question. */}
            {data.learner?.xpEarned > 0 && (
              <Badge color={C.brand} bg={C.brandSoft}><Ico ti="ti-bolt" size={10} style={{ marginRight: 3 }} />{data.learner.xpEarned} XP</Badge>
            )}
            {s.unanswered > 0 && <Badge color={C.muted} bg={C.surface}>{s.unanswered} unanswered</Badge>}
            {data.battle?.duration_formatted && (
              <Badge color={C.muted} bg={C.surface}><Ico ti="ti-clock" size={10} style={{ marginRight: 3 }} />{data.battle.duration_formatted}</Badge>
            )}
          </div>

          {data.byTopic?.length > 1 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: .3 }}>BY TOPIC — WEAKEST FIRST</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {data.byTopic.map(t => (
                  <Badge key={t.topic} color={t.percent >= 50 ? GREEN : RED} bg={t.percent >= 50 ? '#DCFCE7' : '#FEE2E2'}>
                    {t.topic} {t.correct}/{t.total}
                  </Badge>
                ))}
              </div>
            </>
          )}

          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: .3 }}>EVERY QUESTION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {data.markSheet.map(r => (
              <div key={r.order} style={{
                border: `1px solid ${r.isCorrect ? GREEN + '55' : C.border}`, borderRadius: 10, padding: '10px 12px',
                background: r.isCorrect ? '#F0FDF4' : C.surface,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: r.isCorrect ? GREEN : RED }}>
                    {r.isCorrect ? '✓' : '✗'} Q{r.order}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, flex: 1 }}>{r.question}</span>
                  {r.topic && <span style={{ fontSize: 10, color: C.muted }}>{r.topic}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                  {/* "No answer" is not the same as a wrong answer, and a
                      teacher reading the sheet needs to see which it was. */}
                  {!r.answered
                    ? <span style={{ color: C.muted }}>No answer given</span>
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

