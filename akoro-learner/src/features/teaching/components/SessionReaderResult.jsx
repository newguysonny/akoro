// Tool panes: community boards, Ask, a tool's creations and one creation.
import { useState, useRef, useEffect } from "react";
import { BRAND, GREEN, GOLD, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import ReaderPodcast from './ReaderPodcast.jsx';
import ReaderAsk from './ReaderAsk.jsx';
import ReaderDiscussion from './ReaderDiscussion.jsx';
import { citeLabel } from '../../../lib/askAnswer.js';
import { artifactToTab } from '../../../lib/readerArtifacts.js';
import { toolById, kindPlural, focusLabelOf, rowTitleOf, resultSub, whereFrom, QUIZ_HINTS, sentenceCiteFor } from './sessionReaderModel.js';

const KIND_LIST_PAGE = 10;

function ToolKindList({ kind, tabs, saved, onOpenTab, onOpenSaved, onDeleteTab, onDeleteSaved, onNew }) {
  const def = toolById(kind);
  const [shown, setShown] = useState(KIND_LIST_PAGE);
  const sentinelRef = useRef(null);
  const rows = [
    ...(tabs || []).map((tab) => ({ key: `t-${tab.id}`, tab, ts: tab.createdAt || "", title: rowTitleOf(tab), sub: resultSub(tab), status: kind === "podcast" ? tab.podcast?.status || null : null })),
    ...(saved || []).map((a) => { const tab = artifactToTab(a, a.id); return { key: `s-${a.id}`, savedItem: a, ts: a.createdAt || "", title: rowTitleOf(tab), sub: resultSub(tab), status: kind === "podcast" ? a.content?.podcast?.status || null : null }; }),
  ].sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  const visible = rows.slice(0, shown);
  // Paged, not infinite: the end sentinel reveals the NEXT 10 only, and
  // stops at the total — the footer always says how many of how many.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || shown >= rows.length || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((s) => s + KIND_LIST_PAGE);
    }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rows.length]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="font-display text-base font-semibold" style={{ color: "var(--ak-text)" }}>{kindPlural(kind)}</div>
          <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>Newest first · saved on this document</div>
        </div>
        <button type="button" onClick={onNew} className="folio-primary-btn flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold flex-shrink-0">
          <Icon name="ti-plus" size={13}/> New
        </button>
      </div>
      <div className="flex flex-col">
        {visible.map((r) => (
          <div key={r.key} className="flex items-center gap-3 py-3 border-b" style={{ borderColor: "var(--ak-border)" }}>
            <button type="button" onClick={() => (r.tab ? onOpenTab(r.tab) : onOpenSaved(r.savedItem))}
              className="flex-1 flex items-center gap-3 min-w-0 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: def?.bg }}>
                <Icon name={def?.icon || "ti-file-text"} size={17} color={def?.fg}/>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm font-bold" style={{ color: "var(--ak-text)" }}>{r.title}</span>
                <span className="block truncate text-xs" style={{ color: "var(--ak-text-sub)" }}>{r.sub}</span>
              </span>
            </button>
            {r.status === "ready" && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full flex-shrink-0" style={{ background: "rgba(16,185,129,.12)", color: "var(--ak-success-text)" }}>Ready</span>}
            {r.status === "making" && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full flex-shrink-0" style={{ background: "rgba(245,158,11,.14)", color: "var(--ak-warn-text)" }}>Making…</span>}
            {r.status === "failed" && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full flex-shrink-0" style={{ background: "rgba(239,68,68,.12)", color: "var(--ak-danger-text)" }}>Failed</span>}
            <button type="button" aria-label={`Delete ${r.title}`} title="Delete"
              onClick={() => (r.tab ? onDeleteTab(r.tab) : onDeleteSaved(r.savedItem))}
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text-sub)" }}>
              <Icon name="ti-trash" size={14}/>
            </button>
            <Icon name="ti-chevron-right" size={15} color="var(--ak-text-sub)"/>
          </div>
        ))}
        {!rows.length && (
          <div className="text-sm py-6 text-center" style={{ color: "var(--ak-text-sub)" }}>Nothing here yet — make the first one.</div>
        )}
      </div>
      {rows.length > KIND_LIST_PAGE && (
        <div ref={sentinelRef} className="text-center text-xs py-4" style={{ color: "var(--ak-text-sub)" }}>
          {shown < rows.length ? `Showing ${Math.min(shown, rows.length)} of ${rows.length} — scroll for more` : `All ${rows.length} shown`}
        </div>
      )}
    </div>
  );
}

function Citation({ cite, onCite }) {
  if (!cite) return null;
  const isPage = Number.isInteger(cite.page);
  if (!isPage && !Number.isFinite(cite.startMs) && !cite.sourceRecordId) return null;
  return (
    <button type="button" onClick={() => onCite(cite)} className="folio-citation" title={cite.quote ? `“${cite.quote}”` : "Jump to source in the reader"}>
      <Icon name={isPage ? "ti-file-text" : "ti-player-play"} size={10}/>
      {cite.sourceName ? <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{cite.sourceName}</span> : isPage ? `Page ${cite.page + 1}` : citeLabel({ startMs: cite.startMs })}
    </button>
  );
}

/* ── Result views (Fortizo's structure, derived content) ───────────────────── */

function EmptyResult({ reason }) {
  return (
    <div className="rounded-lg border p-3.5 text-xs leading-relaxed" style={{ borderColor: "var(--ak-border2)", background: "var(--ak-tag-bg)", color: "var(--ak-text-sub)" }}>
      <Icon name="ti-info-circle" size={14} color={GOLD}/> {reason}
    </div>
  );
}

function ContextBadge({ name }) {
  if (!name) return null;
  return (
    <span title={`Shaped by the attached “${name}”`}
      className="inline-flex items-center rounded px-1.5 py-0.5 ml-1 text-[10px] font-semibold align-middle"
      style={{ background: "rgba(108,59,255,.10)", color: "var(--ak-accent)" }}>
      From {name.length > 24 ? `${name.slice(0, 24)}…` : name}
    </span>
  );
}

/* Completion screen for a quiz/flashcard run: a short, honest summary and
   the two things a learner wants next — start again, or go back to reading. */
function StudyResult({ done, noun = "cards", stats = [], score = null, onReset, onReturn }) {
  return (
    <div className="py-3 text-center">
      <div className="flex items-center justify-center mb-30" style={{ marginBottom: 14 }}>
        <span className="flex items-center justify-center rounded-full" style={{ width: 54, height: 54, background: `${GOLD}18`, border: `1px solid ${GOLD}44` }}>
          <Icon name="ti-confetti" size={26} color={GREEN}/>
        </span>
      </div>
      <div className="font-display text-lg font-semibold" style={{ color: "var(--ak-text)" }}>Great job!</div>
      <div className="text-xs mt-1" style={{ color: "var(--ak-text-sub)" }}>You've completed {done} {noun}</div>
      {score != null && <div className="text-sm font-bold mt-1" style={{ color: GREEN }}>{score}% correct</div>}
      {stats.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 mt-4">
          {stats.map((st) => (
            <div key={st.label} className="rounded-lg py-2" style={{ background: st.bg || "var(--ak-tag-bg)", border: `1px solid ${st.color}33` }}>
              <div className="text-sm font-extrabold" style={{ color: st.color }}>{st.value}</div>
              <div className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</div>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onReset} className="folio-primary-btn w-full py-2.5 rounded-lg text-sm font-bold mt-4">
        Start again
      </button>
      {onReturn && (
        <button type="button" onClick={onReturn} className="folio-btn-outline w-full py-2.5 rounded-lg text-xs font-bold mt-2">
          Return to content
        </button>
      )}
    </div>
  );
}

function ResultView({ tab, onUpdate, onCite, onRetryPodcast = null, onReturnToContent = null }) {
  const header = (
    <div className="mb-3.5">
      <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{tab.title}</div>
      <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{resultSub(tab)}</div>
    </div>
  );

  function renderBody() {
    if (tab.toolId === "summary") {
      if (!tab.summaryPoints?.length) return <>{header}<EmptyResult reason={tab.emptyReason || "Nothing to summarise yet."}/></>;
      return (
        <div>
          {header}
          {tab.summaryPoints.map((p, i) => (
            <div key={i} className="flex gap-2.5 mb-3.5">
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: BRAND }}/>
              <p className="text-sm leading-relaxed m-0" style={{ color: "var(--ak-text-sec)" }}>{p.text} <Citation cite={p.cite} onCite={onCite}/></p>
            </div>
          ))}
        </div>
      );
    }

    if (tab.toolId === "podcast" && tab.podcast) {
      return (
        <div>
          {header}
          <ReaderPodcast podcast={tab.podcast} onCite={onCite} onRetry={onRetryPodcast ? () => onRetryPodcast(tab) : null}/>
        </div>
      );
    }

    if (tab.toolId === "podcast") {
      return (
        <div>
          {header}
          <div className="rounded-lg p-4 mb-3.5" style={{ background: "var(--ak-surface)", border: "1px solid var(--ak-border2)" }}>
            <div className="font-display text-sm mb-0.5" style={{ color: "var(--ak-text)" }}>Episode — {tab.values.focus || tab.topic || "This page"}</div>
            <div className="text-xs mb-3.5" style={{ color: "var(--ak-text-sub)" }}>{tab.values.length || "Medium · 8–10 min"} · outline preview</div>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: BRAND }} title="Playable episodes are coming soon">
                <Icon name="ti-player-play" size={15} color="#fff"/>
              </span>
              <div className="flex-1 h-1 rounded-full relative" style={{ background: "var(--ak-tag-bg)" }}>
                <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: "33%", background: BRAND }}/>
              </div>
              <span className="font-ui-mono text-xs" style={{ color: "var(--ak-text-sub)" }}>0:00</span>
            </div>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{tab.podcastBlurb} <Citation cite={tab.cite} onCite={onCite}/></p>
        </div>
      );
    }

    if (tab.toolId === "video") {
      return (
        <div>
          {header}
          <div className="w-full rounded-lg flex items-center justify-center relative mb-3" style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg,var(--ak-surface),var(--ak-bg))", border: "1px solid var(--ak-border2)" }}>
            <span className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: BRAND }} title="Rendered episodes are coming soon">
              <Icon name="ti-player-play" size={17} color="#fff"/>
            </span>
            <span className="absolute bottom-2.5 right-2.5 font-ui-mono text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,.55)", color: "#fff" }}>preview</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{tab.videoBlurb} <Citation cite={tab.cite} onCite={onCite}/></p>
        </div>
      );
    }

    if (tab.toolId === "quiz") {
      const questions = tab.quizQuestions || [];
      if (!questions.length) return <>{header}<EmptyResult reason={tab.emptyReason || "No quiz could be built from this page."}/></>;
      const total = questions.length;
      const idx = Math.min(tab.quizIndex ?? 0, total - 1);
      const q = questions[idx];
      const answers = tab.quizAnswers || questions.map(() => ({ selected: null, checked: false, dontKnow: false }));
      const correctCount = questions.reduce((n, qq, i) => {
        const a = answers[i];
        return n + (a?.checked && !a.dontKnow && qq.options.some((o) => o.correct && o.key === a.selected) ? 1 : 0);
      }, 0);
      const skippedCount = answers.filter((a) => a?.dontKnow).length;
      const wrongCount = Math.max(0, questions.filter((_, i) => answers[i]?.checked).length - correctCount - skippedCount);
      if (tab.quizDone) {
        return (
          <>
            {header}
            <StudyResult done={total} noun="questions" score={Math.round((correctCount / total) * 100)}
              stats={[
                { label: "Correct", value: correctCount, color: GREEN, bg: `${GREEN}0f` },
                { label: "Wrong", value: wrongCount, color: RED, bg: `${RED}0f` },
                { label: "Skipped", value: skippedCount, color: GOLD, bg: `${GOLD}0f` },
                { label: "Total", value: total, color: BRAND, bg: `${BRAND}0f` },
              ]}
              onReset={() => onUpdate({ quizAnswers: [], quizIndex: 0, quizHint: null, quizDone: false })}
              onReturn={onReturnToContent}/>
          </>
        );
      }
      const ans = answers[idx] || { selected: null, checked: false, dontKnow: false };
      const revealed = ans.checked || ans.dontKnow;
      const selectedOpt = q.options.find((o) => o.key === ans.selected);
      const correctOpt = q.options.find((o) => o.correct);

      function patchAnswer(partial) {
        const next = answers.slice();
        next[idx] = { ...ans, ...partial };
        onUpdate({ quizAnswers: next });
      }

      return (
        <div>
          {header}
          <div className="flex items-center justify-between mb-2">
            <span className="font-ui-mono text-xs" style={{ color: "var(--ak-text-sub)" }}>Question {idx + 1} of {total}</span>
          </div>
          <div style={{ height: 3, borderRadius: 3, background: "var(--ak-border2)", marginBottom: 12, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(((idx + (revealed ? 1 : 0)) / total) * 100)}%`, height: "100%", background: BRAND, transition: "width .2s" }}/>
          </div>
          <div className="font-display text-sm font-medium mb-3.5" style={{ color: "var(--ak-text)" }}>{q.prompt}</div>
          <div className="mb-1.5">
            {q.options.map((opt) => {
              let cls = { border: "var(--ak-border2)", background: "transparent" };
              if (revealed && opt.correct) cls = { border: GREEN, background: "rgba(16,185,129,.12)" };
              else if (revealed && opt.key === ans.selected) cls = { border: "var(--ak-danger-text)", background: "rgba(239,68,68,.12)" };
              else if (!revealed && opt.key === ans.selected) cls = { border: BRAND, background: "rgba(108,59,255,.12)" };
              return (
                <div
                  key={opt.key}
                  onClick={() => !revealed && patchAnswer({ selected: opt.key, checked: true })}
                  className="flex items-center gap-2.5 px-3 py-2.5 border rounded-lg mb-2 text-sm cursor-pointer"
                  style={{ borderColor: cls.border, background: cls.background, color: "var(--ak-text)" }}
                >
                  <span className="w-5 h-5 rounded-full border flex items-center justify-center font-ui-mono text-xs flex-shrink-0" style={{ borderColor: "var(--ak-border2)" }}>{opt.key}</span>
                  {opt.text}
                </div>
              );
            })}
          </div>

          {tab.quizHint && (
            <div className="text-xs leading-relaxed rounded-lg p-2.5 mb-3" style={{ color: "var(--ak-text-sub)", background: "var(--ak-tag-bg)", border: "1px solid var(--ak-border2)" }}>{tab.quizHint}</div>
          )}

          {!revealed && (
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.simple })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
                <Icon name="ti-bulb" size={13}/> Make it simple
              </button>
              <button type="button" onClick={() => onUpdate({ quizHint: QUIZ_HINTS.walk })} className="folio-chip flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap">
                <Icon name="ti-list-numbers" size={13}/> Walk me through it
              </button>
            </div>
          )}

          {!revealed && (
            <div className="flex gap-2">
              <button type="button" onClick={() => patchAnswer({ dontKnow: true })} className="folio-btn-outline flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-sm font-bold flex-shrink-0">
                <Icon name="ti-help" size={14}/> Don't know
              </button>
            </div>
          )}

          {revealed && (
            <div className="mt-2.5 text-xs" style={{ color: "var(--ak-text-sub)" }}>
              {ans.dontKnow
                ? `No worries — the answer is: ${correctOpt?.text}`
                : selectedOpt?.correct
                ? "Correct!"
                : `Not quite — the correct answer is: ${correctOpt?.text}`}
              {q.explanation && <div className="mt-1.5 leading-relaxed" style={{ color: "var(--ak-text-sec)" }}>{q.explanation}</div>}
              {/* The citation lives in the answer (Matt, 2026-11-17): shown
                  only once the answer is revealed, so learners don't go
                  looking it up before trying. */}
              <div className="mt-2 flex">
                <Citation cite={q.cite} onCite={onCite}/>
                <ContextBadge name={q.contextName}/>
              </div>
            </div>
          )}

          {revealed && (idx < total - 1 ? (
            <button type="button" onClick={() => onUpdate({ quizIndex: idx + 1, quizHint: null })} className="folio-primary-btn w-full py-2.5 rounded-lg text-sm font-bold mt-3">
              Next question
            </button>
          ) : (
            <button type="button" onClick={() => onUpdate({ quizDone: true })} className="folio-primary-btn w-full py-2.5 rounded-lg text-sm font-bold mt-3">
              See results
            </button>
          ))}
        </div>
      );
    }

    if (tab.toolId === "flashcards") {
      const cards = tab.cardSet || [];
      if (!cards.length) return <>{header}<EmptyResult reason={tab.emptyReason || "No cards could be built from this page."}/></>;
      const cardIdx = Math.min(tab.cardIndex ?? 0, cards.length - 1);
      const card = cards[cardIdx];
      const cardCite = card.cite || sentenceCiteFor(tab.createdPage);
      const ratings = Array.isArray(tab.cardRatings) ? tab.cardRatings : [];
      if (tab.cardDone) {
        const count = (label) => ratings.filter((r) => r === label).length;
        return (
          <>
            {header}
            <StudyResult done={cards.length} noun="cards"
              stats={[
                { label: "Again", value: count("again"), color: RED, bg: `${RED}0f` },
                { label: "Hard", value: count("hard"), color: GOLD, bg: `${GOLD}0f` },
                { label: "Good", value: count("good"), color: GREEN, bg: `${GREEN}0f` },
                { label: "Easy", value: count("easy"), color: BRAND, bg: `${BRAND}0f` },
              ]}
              onReset={() => onUpdate({ cardRatings: [], cardIndex: 0, flipped: false, cardDone: false })}
              onReturn={onReturnToContent}/>
          </>
        );
      }
      return (
        <div>
          {header}
          <div className="flex items-center justify-between text-xs mb-2" style={{ color: "var(--ak-text-sub)" }}>
            <span>Card {cardIdx + 1} of {cards.length}</span>
            <span>Tap the card to flip</span>
          </div>
          <div style={{ height: 3, borderRadius: 3, background: "var(--ak-border2)", marginBottom: 12, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(((cardIdx + 1) / cards.length) * 100)}%`, height: "100%", background: BRAND, transition: "width .2s" }}/>
          </div>
          <div className="w-full mb-3.5" style={{ perspective: "1000px", aspectRatio: "4 / 3" }}>
            <div
              onClick={() => onUpdate({ flipped: !tab.flipped })}
              className="relative w-full h-full cursor-pointer transition-transform duration-500"
              style={{ transformStyle: "preserve-3d", transform: tab.flipped ? "rotateY(180deg)" : "none" }}
            >
              <div className="absolute inset-0 rounded-lg flex items-center justify-center text-center p-4 border" style={{ backfaceVisibility: "hidden", background: "rgba(108,59,255,.12)", borderColor: "rgba(108,59,255,.35)" }}>
                <span className="font-display text-lg font-semibold" style={{ color: "var(--ak-accent)" }}>{card.front}</span>
              </div>
              <div
                className="absolute inset-0 rounded-lg flex items-center justify-center text-center p-4 pb-9 text-sm leading-relaxed"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "var(--ak-surface)", border: "1px solid var(--ak-border2)", color: "var(--ak-text)" }}
              >
                {card.back}
                {/* Citation on the answer side only (Matt, 2026-11-17). */}
                <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex" onClick={(e) => e.stopPropagation()}>
                  <Citation cite={cardCite} onCite={onCite}/>
                  <ContextBadge name={card.contextName}/>
                </span>
              </div>
            </div>
          </div>
          {tab.flipped && (
            <div className="mb-3">
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--ak-text-sub)" }}>How well did you know this?</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[["again", "Again", RED], ["hard", "Hard", GOLD], ["good", "Good", GREEN], ["easy", "Easy", BRAND]].map(([id, label, color]) => {
                  const on = ratings[cardIdx] === id;
                  return (
                    <button key={id} type="button"
                      onClick={() => { const next = ratings.slice(); next[cardIdx] = id; onUpdate({ cardRatings: next }); }}
                      className="rounded-lg py-1.5 text-[11px] font-bold"
                      style={{ border: `1px solid ${on ? color : "var(--ak-border2)"}`, background: on ? `${color}16` : "transparent", color: on ? color : "var(--ak-text-sub)" }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onUpdate({ cardIndex: (cardIdx - 1 + cards.length) % cards.length, flipped: false })}
              className="folio-btn-outline w-10 h-9 rounded-lg border flex items-center justify-center flex-shrink-0"
            >
              <Icon name="ti-chevron-left" size={14}/>
            </button>
            {cardIdx < cards.length - 1 ? (
              <button type="button" onClick={() => onUpdate({ cardIndex: cardIdx + 1, flipped: false })}
                className="folio-primary-btn flex-1 py-2.5 rounded-lg text-sm font-bold">
                Next card
              </button>
            ) : (
              <button type="button" onClick={() => onUpdate({ cardDone: true })}
                className="folio-primary-btn flex-1 py-2.5 rounded-lg text-sm font-bold">
                See results
              </button>
            )}
          </div>
        </div>
      );
    }

    if (tab.toolId === "notes") {
      return (
        <div>
          {header}
          <textarea
            value={tab.notesValue ?? ""}
            onChange={(e) => onUpdate({ notesValue: e.target.value })}
            placeholder="Write a note about this page…"
            style={{ minHeight: "16rem" }}
            className="folio-form-field w-full border rounded-lg p-3 font-display text-sm leading-relaxed resize-y focus:outline-none"
          />
          <div className="flex justify-between font-ui-mono text-xs mt-2" style={{ color: "var(--ak-text-sub)" }}>
            <span>Page {tab.createdPage + 1}</span>
            <span>saved on this device</span>
          </div>
        </div>
      );
    }

    return null;
  }

  return renderBody();
}

/* ── Community boards (Fortizo) — persistent per document, seeded empty.
   There is no shared backend behind a session's reference material, so the
   boards start honestly empty rather than pretending classmates have posted. ── */

function ThreadNode({ node, onReply, onLike, depth = 0 }) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    const t = replyText.trim();
    if (!t) return;
    onReply(node.id, t);
    setReplyText("");
    setReplying(false);
  }

  const indent = Math.min(depth, 4) * 20;

  return (
    <div style={{ marginLeft: indent }} className={depth > 0 ? "mt-3 pl-3 border-l-2" : "mb-5"}>
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ background: node.color || "var(--ak-text-sub)" }}
        >
          {node.author[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--ak-text)" }}>{node.author}</span>
            <span className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{node.ts}</span>
          </div>
          <p className="text-sm mt-0.5 mb-1.5" style={{ color: "var(--ak-text-sec)" }}>{node.text}</p>
          <div className="flex items-center gap-3.5 text-xs">
            <button type="button" onClick={() => onLike(node.id)} className="flex items-center gap-1 hover:opacity-80" style={{ color: "var(--ak-text-sub)" }}>
              <Icon name="ti-thumb-up" size={13}/> {node.likes || 0}
            </button>
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-bold hover:opacity-80" style={{ color: "var(--ak-accent)" }}>
              Reply
            </button>
          </div>

          {replying && (
            <div className="flex items-center gap-2 mt-2.5">
              <input
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReply()}
                placeholder="Write a reply…"
                className="folio-form-field flex-1 border rounded-full px-3 py-1.5 text-sm focus:outline-none"
              />
              <button type="button" onClick={submitReply} className="folio-primary-btn px-3 py-1.5 rounded-full text-xs font-bold flex-shrink-0">
                Send
              </button>
            </div>
          )}

          {(node.replies || []).map((child) => (
            <ThreadNode key={child.id} node={child} onReply={onReply} onLike={onLike} depth={depth + 1}/>
          ))}
        </div>
      </div>
    </div>
  );
}

function addReplyToTree(nodes, parentId, reply) {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, replies: [...(n.replies || []), reply] };
    if (n.replies?.length) return { ...n, replies: addReplyToTree(n.replies, parentId, reply) };
    return n;
  });
}
function likeInTree(nodes, id) {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, likes: (n.likes || 0) + 1 };
    if (n.replies?.length) return { ...n, replies: likeInTree(n.replies, id) };
    return n;
  });
}

function CommunityBoard({ title, subtitle, placeholder, actionLabel, emptyText, threads, setThreads }) {
  const [text, setText] = useState("");

  function post() {
    const t = text.trim();
    if (!t) return;
    const node = { id: "t-" + Date.now(), author: "You", color: BRAND, text: t, ts: "just now", likes: 0, replies: [] };
    setThreads((prev) => [node, ...prev]);
    setText("");
  }

  return (
    <div>
      <div className="mb-4">
        <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{title}</div>
        <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 mb-5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && post()}
          placeholder={placeholder}
          className="folio-form-field flex-1 border rounded-full px-3.5 py-2 text-sm focus:outline-none"
        />
        <button type="button" onClick={post} className="folio-primary-btn px-4 py-2 rounded-full text-sm font-bold flex-shrink-0">
          {actionLabel}
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{emptyText}</p>
      ) : (
        threads.map((t) => (
          <ThreadNode
            key={t.id}
            node={t}
            onLike={(id) => setThreads((prev) => likeInTree(prev, id))}
            onReply={(id, replyText) =>
              setThreads((prev) => addReplyToTree(prev, id, { id: id + "-" + Date.now(), author: "You", color: BRAND, text: replyText, ts: "just now", likes: 0, replies: [] }))
            }
          />
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION READER MODAL — the Fortizo reader pane. Mobile: full-screen modal
   over the session. Desktop/tablet: the Fortizo split — reader left, the
   live learning session (`chatNode`) right.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SessionReaderResult({ reader }) {
  const {
    activeTabId, discussion, qaThreads, setQaThreads, discussionThreads, setDiscussionThreads,
    ask, sideAsk, communityTabsOpen, askPin, setAskPin, citeJump,
    activeListKind, resultTabs, savedItems, switchTabTo, openSavedItem,
    deleteResultTab, deleteSavedItem, openForm, activeResultTab, updateResultTab,
    tools, retryPodcast,
  } = reader;

  return (
    <>
        {/* Community panes — persistent boards, not generated. */}
        {activeTabId === "qa" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ background: "var(--ak-bg)" }}>
            <CommunityBoard
              title="Q&A"
              subtitle="Ask a question about this material — it stays with this session."
              placeholder="Ask a question…"
              actionLabel="Ask"
              emptyText="No questions yet — be the first to ask."
              threads={qaThreads}
              setThreads={setQaThreads}
            />
          </div>
        )}
        {activeTabId === "discussion" && (
          <div className={discussion?.communities?.length ? "flex-1 min-h-0 px-4 py-4" : "flex-1 min-h-0 overflow-y-auto px-4 py-4"} style={{ background: "var(--ak-bg)" }}>
            {discussion?.communities?.length ? (
              /* Connected: the community's persistent, real-time group
                 chat — owned by the community, open on every content
                 it's connected to. */
              <ReaderDiscussion communities={discussion.communities}/>
            ) : (
              <CommunityBoard
                title="Discussion"
                subtitle="Talk through this material — points, questions, connections."
                placeholder="Start a discussion…"
                actionLabel="Post"
                emptyText="No discussion yet — start the conversation."
                threads={discussionThreads}
                setThreads={setDiscussionThreads}
              />
            )}
          </div>
        )}

        {/* Ask — stays mounted while open, so an answer still streaming
            survives a look at the page it cites. */}
        {ask && !sideAsk && communityTabsOpen.includes("ask") && (
          <div className="flex-1 min-h-0 px-4 py-4" style={{ background: "var(--ak-bg)", display: activeTabId === "ask" ? "flex" : "none", flexDirection: "column" }}>
            <ReaderAsk ask={ask} onCite={citeJump} pin={askPin} onPinClear={() => setAskPin(null)}/>
          </div>
        )}

        {/* Tool list pane — a tool tab's home: every creation of the kind. */}
        {activeListKind && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ background: "var(--ak-bg)" }}>
            <ToolKindList key={activeListKind} kind={activeListKind}
              tabs={resultTabs.filter((t) => t.toolId === activeListKind)}
              saved={savedItems.filter((a) => a.kind === activeListKind)}
              onOpenTab={(tab) => switchTabTo(tab.id)}
              onOpenSaved={openSavedItem}
              onDeleteTab={deleteResultTab}
              onDeleteSaved={deleteSavedItem}
              onNew={() => openForm(activeListKind)}/>
          </div>
        )}

        {/* Result pane — shown when a generated tab (not "Original Content") is active. */}
        {activeTabId !== "reader" && activeTabId !== "qa" && activeTabId !== "discussion" && activeTabId !== "ask" && activeResultTab && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ background: "var(--ak-bg)" }}>
            <div className="flex items-center gap-2 mb-3.5">
              <button type="button" onClick={() => switchTabTo(`tool:${activeResultTab.toolId}`)}
                className="flex items-center gap-1 text-sm font-bold flex-shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-accent)", padding: 0 }}>
                <Icon name="ti-chevron-left" size={15}/> {kindPlural(activeResultTab.toolId)}
              </button>
            </div>
            <ResultView tab={activeResultTab} onUpdate={(patch) => updateResultTab(activeResultTab.id, patch)} onCite={citeJump}
              onRetryPodcast={tools?.podcast ? retryPodcast : null}
              onReturnToContent={() => switchTabTo("reader")}/>
          </div>
        )}
    </>
  );
}
