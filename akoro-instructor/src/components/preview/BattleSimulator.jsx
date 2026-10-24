/*
 * BattleSimulator — the battle as learners will see it, played out in the
 * preview with simulated agents. The arena copies the learner app's battle
 * player (akoro-learner/src/components/battles/BattleModal.jsx): the dark
 * panel, head-to-head (a duel) or the class scoreboard (a group, the teacher
 * hosting), the timer ring, options with who picked what, the reveal, then
 * the winner — or, for a study review, the mark sheet.
 *
 * Nothing is sent anywhere: the questions are the draft's sample, the agents
 * answer on a local clock (seeded, so a replay plays the same).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '../../theme/Ico.jsx';

const FONT = "'Nunito', sans-serif";
const GREEN = '#10B981', GOLD = '#F59E0B', RED = '#EF4444', ORANGE = '#E8884A';
const COLORS = ['#6C3BFF', '#EC4899', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444'];
const TICK_MS = 500;           // the simulated clock: one tick per half second
const THINK_TICKS = 8;         // ticks to answer a question
const REVEAL_TICKS = 4;        // ticks the reveal stays up

/** A seeded random (mulberry32): the same draft replays the same battle. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 7);

/** PURE: the whole simulated battle, decided up front. */
export function planBattle({ questions, players, hpPerMiss = 10, seed = 1 }) {
  const rnd = seeded(seed);
  const state = players.map((p) => ({ ...p, score: 0, hp: 100, streak: 0, correct: 0 }));
  const rounds = questions.map((q) => {
    const answers = state.map((p) => {
      if (p.hp <= 0) return { id: p.id, pick: null, at: null };
      const right = rnd() < p.skill;
      const wrongs = q.options.map((_, i) => i).filter((i) => i !== q.correct);
      const pick = right ? q.correct : wrongs[Math.floor(rnd() * wrongs.length)];
      return { id: p.id, pick, at: 2 + Math.floor(rnd() * (THINK_TICKS - 3)) };
    });
    for (const a of answers) {
      const p = state.find((x) => x.id === a.id);
      if (a.pick == null) continue;
      if (a.pick === q.correct) { p.score += 1; p.correct += 1; p.streak += 1; }
      else { p.streak = 0; p.hp = Math.max(0, p.hp - hpPerMiss); }
    }
    return { answers, after: state.map((p) => ({ id: p.id, score: p.score, hp: p.hp, streak: p.streak, correct: p.correct })) };
  });
  return rounds;
}

export default function BattleSimulator({ title, topic, subject, questions = [], format = '1v1', players = [], hpPerMiss = 10, onClose }) {
  const isReview = format === 'review';
  const isClass = format === 'group';
  const cast = useMemo(() => players.map((p, i) => ({ id: p.id || `p${i}`, name: p.name, color: COLORS[i % COLORS.length], skill: p.skill ?? 0.55 + ((i * 17) % 30) / 100 })), [players]);
  const rounds = useMemo(() => planBattle({ questions, players: cast, hpPerMiss: isReview ? 0 : hpPerMiss, seed: hash(`${title}|${questions.length}`) }), [questions, cast, hpPerMiss, isReview, title]);
  const [run, setRun] = useState(0);              // bump to replay
  const [step, setStep] = useState({ q: 0, tick: 0, phase: 'lobby' });
  const timer = useRef(null);

  useEffect(() => {
    setStep({ q: 0, tick: 0, phase: 'lobby' });
    const start = setTimeout(() => setStep({ q: 0, tick: 0, phase: 'ask' }), 1400);
    return () => clearTimeout(start);
  }, [run]);

  useEffect(() => {
    if (step.phase !== 'ask' && step.phase !== 'reveal') return undefined;
    timer.current = setTimeout(() => {
      setStep((s) => {
        if (s.phase === 'ask') return s.tick + 1 >= THINK_TICKS ? { ...s, tick: 0, phase: 'reveal' } : { ...s, tick: s.tick + 1 };
        if (s.tick + 1 < REVEAL_TICKS) return { ...s, tick: s.tick + 1 };
        return s.q + 1 >= questions.length ? { ...s, phase: 'done' } : { q: s.q + 1, tick: 0, phase: 'ask' };
      });
    }, TICK_MS);
    return () => clearTimeout(timer.current);
  }, [step, questions.length]);

  const q = questions[step.q];
  const round = rounds[step.q];
  // Scores shown: after the reveal, this round counts; while asking, the last one.
  const shownAfter = step.phase === 'done' ? rounds.at(-1)?.after : step.phase === 'reveal' ? round?.after : rounds[step.q - 1]?.after;
  const standing = cast.map((p) => ({ ...p, ...(shownAfter?.find((a) => a.id === p.id) || { score: 0, hp: 100, streak: 0, correct: 0 }) }));
  const sorted = [...standing].sort((a, b) => b.score - a.score || b.hp - a.hp);
  const live = step.phase === 'ask' || step.phase === 'reveal';
  const done = step.phase === 'done';
  const answeredNow = round?.answers.filter((a) => a.pick != null && (step.phase === 'reveal' || a.at <= step.tick)) || [];
  const secondsLeft = Math.max(0, Math.ceil(((THINK_TICKS - step.tick) * TICK_MS) / 1000 * 2.5));
  const timerPct = step.phase === 'ask' ? 100 - (step.tick / THINK_TICKS) * 100 : 0;
  const timerColor = timerPct > 50 ? GREEN : timerPct > 25 ? GOLD : RED;

  const panel = { borderRadius: 16, padding: 14, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' };
  const Avatar = ({ p, size = 44 }) => (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${p.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${p.color}66` }}>
      <Ico ti="ti-robot" size={Math.round(size * 0.55)} color={p.color} />
    </div>
  );
  const hpBar = (hp, h = 8) => (
    <div style={{ height: h, background: 'rgba(255,255,255,.12)', borderRadius: h / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${hp}%`, background: hp > 50 ? GREEN : hp > 25 ? GOLD : RED, borderRadius: h / 2, transition: 'width .5s' }} />
    </div>
  );
  const TimerRing = () => (
    <div style={{ position: 'relative', width: 34, height: 34 }}>
      <svg viewBox="0 0 36 36" style={{ width: 34, height: 34, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - timerPct / 100)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .45s linear' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: timerColor }}>{secondsLeft}</div>
    </div>
  );

  const [A, B] = standing;
  const winner = !isReview && done ? sorted[0] : null;
  const reviewee = standing[0];

  return (
    <div data-battle-sim="" style={{ borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg,#0f1320,#141c2e,#1a1430)', border: '1px solid rgba(255,255,255,.1)', fontFamily: FONT, minHeight: 440 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          {live && <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 9px', borderRadius: 20, background: 'rgba(239,68,68,.22)', color: '#F87171', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F87171' }} />LIVE</span>}
          {done && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.55)' }}>COMPLETED</span>}
          {step.phase === 'lobby' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(108,59,255,.25)', color: '#A78BFA' }}>LOBBY</span>}
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || topic || 'Battle'}</span>
            <span style={{ color: 'rgba(255,255,255,.5)', fontWeight: 700, fontSize: 10.5 }}>{isReview ? `Study review · ${reviewee?.name}` : isClass ? `Class battle · ${cast.length} agents` : `${A?.name} vs ${B?.name}`}</span>
          </span>
        </div>
        <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: .5, padding: '3px 8px', borderRadius: 20, background: 'rgba(232,136,74,.18)', color: ORANGE }}>PREVIEW · SIMULATED</span>
      </div>

      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Lobby */}
        {step.phase === 'lobby' && (
          <div style={{ ...panel, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
              {(isClass ? cast.slice(0, 4) : cast.slice(0, isReview ? 1 : 2)).map((p) => (
                <div key={p.id} style={{ textAlign: 'center' }}><Avatar p={p} size={52} /><div style={{ color: '#fff', fontWeight: 800, fontSize: 12, marginTop: 6 }}>{p.name}</div></div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)', marginTop: 12 }}>{isReview ? 'The review starts in a moment…' : 'The battle starts in a moment…'}</div>
          </div>
        )}

        {/* Scoreboard */}
        {(live || done) && (
          <div style={panel}>
            {isClass || isReview ? (
              <>
                {isClass && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 12, background: 'rgba(124,58,237,.16)', border: '1px solid rgba(124,58,237,.32)', marginBottom: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(124,58,237,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-school" size={20} color="#C4B5FD" /></div>
                    <div style={{ flex: 1 }}><div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>You</div><span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: 'rgba(124,58,237,.35)', color: '#C4B5FD' }}>TEACHER · HOSTS</span></div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.40)' }}>{isReview ? 'REVIEW' : `${cast.length} student agents`}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {step.phase === 'ask' && <TimerRing />}
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{Math.min(step.q + 1, questions.length)}/{questions.length}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(isReview ? standing.slice(0, 1) : sorted).map((p, rank) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
                      {!isReview && <span style={{ width: 18, textAlign: 'center', fontSize: 12, color: '#fff' }}>{rank < 3 ? <Ico ti="ti-medal" size={12} color={[GOLD, '#C0C0C0', '#CD7F32'][rank]} /> : rank + 1}</span>}
                      <Avatar p={p} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{p.name}</span>
                          {p.streak >= 2 && <span style={{ fontSize: 9, color: '#FB923C', display: 'inline-flex', alignItems: 'center', gap: 2 }}><Ico ti="ti-flame" size={9} color="#FB923C" />{p.streak}</span>}
                        </div>
                        {!isReview && <div style={{ marginTop: 3 }}>{hpBar(p.hp, 4)}</div>}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>{p.score}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: .4 }}>{done ? 'FINAL STANDINGS' : 'HEAD TO HEAD'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{Math.min(step.q + 1, questions.length)}/{questions.length}</span>
                    {step.phase === 'ask' && <TimerRing />}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {[A, B].map((ag) => ag && (
                    <div key={ag.id} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}><Avatar p={ag} size={52} /></div>
                      <div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{ag.name}</div>
                      <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4, color: ag.color }}>{ag.score}</div>
                      <div style={{ margin: '5px 18px 0' }}>{hpBar(ag.hp)}<div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>{ag.hp} HP</div></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* The question */}
        {live && q && (
          <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: ORANGE }}>Q{step.q + 1}/{questions.length}{q.topic || topic ? ` · ${q.topic || topic}` : ''}</span>
              {subject && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{subject}</span>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.55, marginBottom: 12 }}>{q.text}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {q.options.map((opt, i) => {
                let bg = 'rgba(255,255,255,.06)', border = '1.5px solid rgba(255,255,255,.14)', color = '#E8E2D9';
                if (step.phase === 'reveal' && i === q.correct) { bg = 'rgba(16,185,129,.20)'; border = '1.5px solid #10B981'; color = '#6EF7C8'; }
                const pickers = answeredNow.filter((a) => a.pick === i).map((a) => cast.find((p) => p.id === a.id));
                const wrongPick = step.phase === 'reveal' && i !== q.correct && pickers.length > 0;
                if (wrongPick) { bg = 'rgba(239,68,68,.15)'; border = '1.5px solid #EF4444'; color = '#FCA5A5'; }
                return (
                  <div key={i} style={{ padding: '10px 13px', borderRadius: 13, fontSize: 13, background: bg, border, color }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{'ABCDE'[i]}</span>{opt}
                    </span>
                    {pickers.length > 0 && (
                      <span style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                        {pickers.map((p) => <span key={p.id} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(255,255,255,.08)', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-robot" size={10} color={p.color} />{p.name}</span>)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.35)' }}>
              {step.phase === 'reveal' ? 'Answer revealed' : isReview ? 'The agent is answering from what its learner taught it' : 'The agents are answering from what their learners taught them'}
            </div>
          </div>
        )}

        {/* The end */}
        {done && isReview && (
          <div style={{ ...panel, textAlign: 'center' }}>
            <Ico ti="ti-clipboard-check" size={34} color="rgba(255,255,255,.4)" />
            <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 4 }}>{reviewee.correct} of {questions.length} correct</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: reviewee.correct / questions.length >= 0.5 ? '#4ADE80' : '#F87171' }}>{Math.round((reviewee.correct / Math.max(1, questions.length)) * 100)}%</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>A mark sheet for the learner and for you. It doesn't count toward the grade.</div>
          </div>
        )}
        {done && winner && (
          <div style={{ ...panel, textAlign: 'center' }}>
            <Ico ti="ti-trophy" size={38} color={GOLD} />
            <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>{winner.name} wins!</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{winner.correct} of {questions.length} correct · {winner.hp} HP left</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-flame" size={11} color="#F97316" />Simulated agents · sample questions</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setRun((r) => r + 1)} style={{ padding: '7px 13px', borderRadius: 11, border: 'none', background: 'rgba(255,255,255,.10)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-reload" size={12} />Replay</button>
          {onClose && <button type="button" onClick={onClose} style={{ padding: '7px 13px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg,#E8884A,#D97706)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Done</button>}
        </div>
      </div>
    </div>
  );
}
