import { GREEN, GOLD, RED } from '../../../constants.js';
import { PlayIcon, TrophyIcon, Icon } from '../../../components/common/Icons.jsx';
import { AgentAvatar } from '../../../components/common/AgentAvatar.jsx';
import { FONT, panel, optBtn } from './battleStyles.js';

export default function BattleArenaTab({ m }) {
  const {
    isLive, isCompleted, A, Bp, myId, isCheck, reviewHost, startBattle, notice,
    sorted, isClassroom, teacher, students, question, reveal, selected, totalQ, curOrder, me,
    iAmParticipant, isReview, myResult, results, myXp, winner, over, judgeVerdict,
    timer, timerPct, timerColor,
  } = m;

  const AgentPill = ({ p, big }) => (
    <div style={{ width: big ? 52 : 42, height: big ? 52 : 42, borderRadius: '50%', background: `${p?.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${p?.agentColor}66` }}><AgentAvatar emoji={p?.agentEmoji} size={big ? 34 : 28}/></div>
  );

  const TimerRing = () => (
    <div style={{ position: 'relative', width: 34, height: 34 }}>
      <svg viewBox="0 0 36 36" style={{ width: 34, height: 34, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - timerPct / 100)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .9s linear' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: timerColor }}>{timer}</div>
    </div>
  );

  const StudentRow = ({ p, rank }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 12, background: p.userId === myId ? 'rgba(232,136,74,.15)' : 'rgba(255,255,255,.04)', border: p.userId === myId ? '1px solid rgba(232,136,74,.35)' : '1px solid rgba(255,255,255,.07)' }}>
      <span style={{ fontSize: 12, width: 18, textAlign: 'center' }}>{rank === 0 ? <Icon name="ti-medal" size={12} color={GOLD}/> : rank === 1 ? <Icon name="ti-medal" size={12} color="#C0C0C0"/> : rank === 2 ? <Icon name="ti-medal" size={12} color="#CD7F32"/> : rank + 1}</span>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${p.agentColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AgentAvatar emoji={p.agentEmoji} size={19}/></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.agentName}</span>
          {p.userId === myId && <span style={{ fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 20, background: 'rgba(232,136,74,.30)', color: '#E8884A' }}>YOU</span>}
          {p.streak >= 2 && <span style={{ fontSize: 9, color: "#FB923C", display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="ti-flame" size={9} color="#FB923C"/>{p.streak}</span>}
        </div>
        <div style={{ height: 4, marginTop: 3, background: 'rgba(255,255,255,.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p.hp}%`, background: p.hp > 50 ? GREEN : p.hp > 25 ? GOLD : RED, borderRadius: 2, transition: 'width .5s' }} />
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', minWidth: 24, textAlign: 'right' }}>{p.score}</div>
    </div>
  );

  return (
    <>
              {/* Lobby / start */}
              {!isLive && !isCompleted && (
                <div style={{ ...panel }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>{A && <><AgentPill p={A} big /><div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{A.agentName}{A.userId === myId ? ' (you)' : ''}</div></>}</div>
                    {!isCheck && <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#1A1A2E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>VS</div>}
                    <div style={{ flex: 1, textAlign: 'center' }}>{Bp && <><AgentPill p={Bp} big /><div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{Bp.agentName}</div></>}</div>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 14 }}>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)', marginBottom: 10 }}>{isCheck ? (reviewHost === 'guide' ? 'Your guide’s review starts in a moment…' : 'The Agent Check starts in a moment…') : 'Waiting for the battle to start…'}</div>
                    {!isCheck && <button onClick={startBattle} style={{ padding: '10px 18px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#E8884A,#D97706)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 7 }}><PlayIcon size={13} color="#fff" />Start battle</button>}
                    {notice && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>{notice}</div>}
                  </div>
                </div>
              )}

              {/* The arena: scoreboard and the question — stacked, or side by side on a wide screen (.ak-arena). */}
              <div className="ak-arena">
              {/* Scoreboard */}
              {(isLive || isCompleted) && (
                <div style={panel}>
                  {sorted.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '18px 0', color: 'rgba(255,255,255,.35)', fontSize: 12.5 }}>Waiting for participants…</div>
                  ) : isClassroom ? (
                    <>
                      {/* Teacher card */}
                      {teacher && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'rgba(124,58,237,.16)', border: '1px solid rgba(124,58,237,.32)', marginBottom: 12 }}>
                          <div style={{ width: 44, height: 44, borderRadius: '50%', background: `${teacher.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${teacher.agentColor}66` }}><AgentAvatar emoji={teacher.agentEmoji} size={29}/></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13.5 }}>{teacher.agentName}</div>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: 'rgba(124,58,237,.35)', color: '#C4B5FD' }}>TEACHER</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 24, fontWeight: 900, color: teacher.agentColor }}>{teacher.score}</div>
                            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.35)' }}>{teacher.hp} HP</div>
                          </div>
                        </div>
                      )}
                      {/* vs N student agents + timer + question count */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.40)' }}>vs {students.length} student agent{students.length === 1 ? '' : 's'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isLive && question && !reveal && <TimerRing />}
                          {totalQ > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{curOrder}/{totalQ}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {students.map((p, rank) => <StudentRow key={p.userId} p={p} rank={rank} />)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: .4 }}>{isCompleted ? 'FINAL STANDINGS' : 'HEAD TO HEAD'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {totalQ > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{curOrder}/{totalQ}</span>}
                          {isLive && question && !reveal && <TimerRing />}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        {[A, Bp].map((ag, idx) => ag && (
                          <div key={idx} style={{ flex: 1, textAlign: 'center' }}>
                            <AgentPill p={ag} big />
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{ag.agentName}</div>
                            {ag.userId === myId && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 20, background: 'rgba(255,255,255,.12)', color: '#fff' }}>YOU</span>}
                            <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4, color: ag.agentColor }}>{ag.score}</div>
                            <div style={{ marginTop: 5 }}>
                              <div style={{ height: 8, background: 'rgba(255,255,255,.12)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${ag.hp}%`, background: ag.hp > 50 ? GREEN : ag.hp > 25 ? GOLD : RED, borderRadius: 4, transition: 'width .5s' }} /></div>
                              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>{ag.hp} HP</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Live question */}
              {isLive && question && (
                <div style={panel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A' }}>Q{question.questionOrder}{totalQ ? `/${totalQ}` : ''}{question.topic ? ` · ${question.topic}` : ''}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>+{question.xpValue} XP</span>
                    {me?.streak >= 2 && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(249,115,22,.20)', color: "#FB923C", display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="ti-flame" size={10} color="#FB923C"/>{me.streak}× streak</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.55, marginBottom: 12 }}>{question.questionText}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {(question.options || []).map((opt, i) => {
                      let bg = 'rgba(255,255,255,.06)', border = '1.5px solid rgba(255,255,255,.14)', color = '#E8E2D9';
                      if (reveal) {
                        if (i === reveal.correctIndex) { bg = 'rgba(16,185,129,.20)'; border = '1.5px solid #10B981'; color = '#6EF7C8'; }
                        else if (i === selected) { bg = 'rgba(239,68,68,.15)'; border = '1.5px solid #EF4444'; color = '#FCA5A5'; }
                      } else if (selected === i) { border = '1.5px solid #E8884A'; bg = 'rgba(255,255,255,.12)'; }
                      const pickers = reveal?.answers?.filter((a) => a.selectedIndex === i) || [];
                      return (
                        <div key={i} style={{ ...optBtn, border, background: bg, color, cursor: 'default' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{['A', 'B', 'C', 'D', 'E'][i]}</span>{opt}
                          </span>
                          {pickers.length > 0 && (
                            <span style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                              {pickers.map((a, j) => <span key={j} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: a.userId === myId ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AgentAvatar emoji={a.agentEmoji} size={11}/> {a.userId === myId ? 'You' : a.agentName}</span>)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.35)' }}>
                    {iAmParticipant && !isReview && (me?.hp ?? 100) <= 0
                      ? 'Your agent is out of HP — you are watching as a spectator'
                      : iAmParticipant
                      ? (isCheck ? 'Your agent is answering from your notes — watch it' : isReview ? 'Your agent is working through your review' : 'Your agent is answering — watch it play')
                      : "You're watching this battle"}
                  </div>
                  {reveal?.judge && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
                      <Icon name="ti-gavel" size={15} color={GOLD} />
                      <div style={{ fontSize: 12, lineHeight: 1.45, color: '#E2E8F0' }}><b style={{ color: GOLD }}>{reveal.judge.judge || 'Sergeant'}</b> · {reveal.judge.answer}{reveal.judge.why ? ` — ${reveal.judge.why}` : ''}</div>
                    </div>
                  )}
                  {myResult && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: myResult.is_correct ? '#4ADE80' : '#F87171' }}>{myResult.is_correct ? <><Icon name="ti-check" size={12} color="#4ADE80"/> Your agent got it{myResult.xp_gained ? ` — +${myResult.xp_gained} XP` : ''}</> : <><Icon name="ti-x" size={12} color="#F87171"/> Your agent got it wrong</>}</div>}
                </div>
              )}

              {isLive && !question && <div style={{ ...panel, textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 12.5 }}>Next question loading…</div>}
              </div>

              {/* Review result — a review has no winner, so the panel below
                  rendered nothing at all for one: a finished review showed no
                  score and no XP, just an empty arena. */}
              {isCompleted && isReview && ['review', 'check'].includes(results?.type) && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <Icon name="ti-clipboard" size={34} color="rgba(255,255,255,.35)"/>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 4 }}>
                    {results.score?.correct} of {results.score?.total} correct
                  </div>
                  <div style={{
                    fontSize: 26, fontWeight: 900, marginTop: 2,
                    color: (results.score?.percent ?? 0) >= 50 ? '#4ADE80' : '#F87171',
                  }}>{results.score?.percent}%</div>
                  {(results.score?.unanswered > 0) && (
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>
                      {results.score.unanswered} not answered (no notes on it, no credit, or out of time)
                    </div>
                  )}
                  {(results.score?.guessed > 0) && (
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>
                      {results.score.guessed} guessed — not in your notes, so not counted
                    </div>
                  )}
                  {results.battle?.duration_formatted && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>
                      Duration {results.battle.duration_formatted}
                    </div>
                  )}
                  {/* The per-question XP the agent earned along the way, plus
                      what the review paid at the end — one number, because a
                      learner does not care which half it came from. */}
                  {(myXp + (results.learner?.xpEarned ?? 0)) > 0 && (
                    <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>
                      +{myXp + (results.learner?.xpEarned ?? 0)} XP earned
                    </div>
                  )}
                  {/* Weakest topics first — the one thing a learner can act on. */}
                  {results.byTopic?.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 }}>
                      {results.byTopic.slice(0, 4).map(t => (
                        <span key={t.topic} style={{
                          fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                          background: t.percent >= 50 ? 'rgba(16,185,129,.16)' : 'rgba(239,68,68,.14)',
                          color: t.percent >= 50 ? '#6EF7C8' : '#FCA5A5',
                        }}>{t.topic} {t.correct}/{t.total}</span>
                      ))}
                    </div>
                  )}
                  {/* Each question is in the Questions and Log tabs, as for every battle. */}
                </div>
              )}

              {/* Winner */}
              {isCompleted && winner && !isReview && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <TrophyIcon size={38} color={GOLD} />
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>{winner.agentName} wins!</div>
                  {over?.durationFormatted && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Duration {over.durationFormatted}</div>}
                  {myXp > 0 && <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>+{myXp} XP earned</div>}
                </div>
              )}

              {/* Nobody ranked (everyone knocked out) or a team tie: say so. */}
              {isCompleted && !winner && !isReview && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <TrophyIcon size={30} color="rgba(255,255,255,.35)" />
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>
                    {over?.team ? (over.team.winner ? `Team ${over.team.winner} wins!` : "It's a tie between the teams") : 'No winner — every agent ran out of HP'}
                  </div>
                  {myXp > 0 && <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>+{myXp} XP earned</div>}
                </div>
              )}

              {/* Sergeant's verdict — for every finished battle, winner or not. */}
              {isCompleted && !isReview && judgeVerdict && (
                <div style={{ ...panel, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="ti-gavel" size={16} color={GOLD} />
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#E2E8F0' }}><b style={{ color: GOLD }}>Sergeant's verdict</b><br />{judgeVerdict}</div>
                </div>
              )}
    </>
  );
}
