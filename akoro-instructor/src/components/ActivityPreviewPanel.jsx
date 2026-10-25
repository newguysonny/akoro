/**
 * ActivityPreviewPanel — the human half of AI activity creation.
 *
 * The agent prepared a draft in chat; this panel opens SIDE-BY-SIDE with the
 * conversation (full-screen on narrow windows) so the instructor can read the
 * activity exactly as learners will receive it, edit it, and — the only path
 * to learners — tap Assign. Assigning replays the draft through the same
 * endpoint the activities workbench uses, so targets, notifications and the
 * live learner ding behave identically.
 *
 * Phases: loading → ready ⇄ editing → assigning → assigned | discarded | error
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Download } from 'lucide-react';
import { downloadActivityPdf } from '../lib/activityPdf.js';
import { printPaperHtml } from './paper/PaperFrame.jsx';
import { apiBlob } from '../services/api.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import { GREEN, PURPLE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { ActivityForm, byKey, rowsFromQuestions } from './activities/ActivityForm.jsx';
import DraftVersions, { versionsOf } from './paper/DraftVersions.jsx';
import { apiPut } from '../services/api.js';
import BattleDraftPreview from './preview/BattleDraftPreview.jsx';
import SelfStudyDraftPreview from './preview/SelfStudyDraftPreview.jsx';
import AssignmentDraftPreview from './preview/AssignmentDraftPreview.jsx';
import ReviewBattleSettings, { REVIEW_DEFAULT } from './preview/ReviewBattleSettings.jsx';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import { audienceBody } from './AudiencePicker.jsx';
import ToolDraftPreview from './teaching/ToolDraftPreview.jsx';
import { TOOL_NAME, TOOL_ICON, accentFor } from './teaching/ToolResult.jsx';
import Loading from "./Loading.jsx";

const datetimeLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* The draft payload, shaped for ActivityForm's `initial` — the SAME form the
   workbench renders, prefilled from what the agent prepared. */
/* A battle draft → BattleForm's starting values: what the instructor said in chat. */
function battleInitialFrom(payload, draft = {}) {
  const d = payload.details || {};
  const base = prefillFrom(payload);
  const review = d.mode === 'review';
  const classroomId = payload.classroom_id || draft.audience?.classroom_id || '';
  const cls = review || !!classroomId || !!draft.audience?.class_name;
  const rep = d.repeat && d.repeat.days?.length ? d.repeat : null;
  return {
    kind: review ? 'review' : cls ? 'class' : 'course',
    title: base.title || draft.title || '', topic: base.topic, subject: payload.subject || '', difficulty: base.difficulty,
    description: d.note || '',
    ...(cls ? { classId: classroomId } : {}),
    audience: base.audience,
    ...(d.total_questions ? { totalQuestions: String(d.total_questions) } : {}),
    scheduledAt: rep ? '' : datetimeLocal(d.scheduled_at),
    ...(rep ? { repeats: true, days: rep.days, repeatTime: rep.time || '16:00', repeatUntil: datetimeLocal(rep.until) } : {}),
  };
}

const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos'; } catch { return 'Africa/Lagos'; } };

function prefillFrom(payload, version = null) {
  const paper = version?.status === 'ready' ? version.paper : null;
  return {
    // An assignment's questions come from the version on screen.
    ...(paper ? {
      questions: rowsFromQuestions(paper.questions), sections: paper.sections ?? [], passages: paper.passages ?? [],
      totalPoints: String(version.summary?.totalPoints || ''), aiAutoAllocate: false,
    } : {}),
    title: payload.title || '',
    subject: payload.subject || 'Basic Science',
    topic: payload.topic || '',
    instructions: payload.instructions || '',
    difficulty: payload.difficulty || 'intermediate',
    subtopics: payload.subtopics || [],
    objectives: payload.objectives || {},
    classId: payload.classroom_id || '',
    audience: payload.whole_class
      ? { mode: 'class', classroomId: payload.classroom_id || null, selected: [], typed: '' }
      : { mode: 'picked', classroomId: payload.classroom_id || null, selected: payload.user_ids || [], typed: (payload.usernames || []).join(', ') },
    dueAt: datetimeLocal(payload.due_at),
    scheduledAt: datetimeLocal(payload.details?.scheduled_at),
    durationMins: String(payload.details?.duration_mins || 60),
  };
}

const Chip = ({ children, color = C.muted, bg = C.bg }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 100, fontSize: 10.5, fontWeight: 800, color, background: bg, fontFamily: C.font }}>{children}</span>
);

const Row = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: C.muted2, marginBottom: 4, fontFamily: C.font }}>{label}</div>
    <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.55, fontFamily: C.font }}>{children}</div>
  </div>
);

export default function ActivityPreviewPanel({ draftId, revision = 0, initialVersion = null, onClose, onResolved }) {
  const navigate = useNavigate();
  const [savedOut, setSavedOut] = useState(null);   // { outputId, title } once a teaching resource is saved
  const [draft, setDraft] = useState(null);
  const [vSel, setVSel] = useState(initialVersion);   // the version tab on screen (null = newest)
  const [vEditing, setVEditing] = useState(false);
  const [vBusy, setVBusy] = useState(false);
  // Every hook sits above the early returns below (loading / error), or the
  // first render after the draft loads calls one more hook and React crashes (#310).
  const [pdfErr, setPdfErr] = useState(false);
  const [phase, setPhase] = useState('loading');   // loading|ready|editing|assigning|assigned|discarded|error
  const [error, setError] = useState('');
  const [assignedCount, setAssignedCount] = useState(0);
  const [dueLocal, setDueLocal] = useState(null);   // the due date picked here (datetime-local), null = as drafted
  // The review battle an assignment / self study comes with (on by default; Plan: Activity + Review).
  const [review, setReview] = useState(REVIEW_DEFAULT);
  // The questions that review battle will ask, written on the draft (null = not yet).
  const [reviewQs, setReviewQs] = useState(null);
  const [reviewQsBusy, setReviewQsBusy] = useState(false);
  const { createBattle } = useBattlesAPI();
  const { courses } = useCoursesAPI();

  const load = useCallback(async () => {
    setPhase('loading'); setError('');
    try {
      const d = await apiGet(`/api/self-study/drafts/${draftId}`);
      setDraft(d?.data?.draft ?? d?.draft ?? null);
      setPhase('ready');
    } catch (e) {
      setError(e?.message || 'Could not load the draft.');
      setPhase('error');
    }
  }, [draftId]);

  useEffect(() => { load(); }, [load, revision]);   // revision bumps when the agent revises the draft in chat
  // A new version made in chat opens on its tab; a card's Preview opens its own.
  useEffect(() => { setVSel(initialVersion); setVEditing(false); }, [revision, initialVersion, draftId]);

  /* While a version is drafting, look again every few seconds (quietly). */
  const drafting = versionsOf(draft).some((v) => v.status === 'drafting');
  useEffect(() => {
    if (!drafting) return undefined;
    const t = setInterval(() => {
      apiGet(`/api/self-study/drafts/${draftId}`).then((d) => { const next = d?.data?.draft ?? d?.draft; if (next) setDraft(next); }).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [drafting, draftId]);

  const saveVersion = async (n, body) => {
    setVBusy(true);
    try {
      await apiPut(`/api/self-study/drafts/${draftId}/versions/${n}`, body);
      const d = await apiGet(`/api/self-study/drafts/${draftId}`);
      setDraft(d?.data?.draft ?? d?.draft ?? draft);
    } finally { setVBusy(false); }
  };
  const retryVersion = async (n) => {
    setVBusy(true); setError('');
    try {
      await apiPost(`/api/self-study/drafts/${draftId}/versions/${n}/retry`, {});
      const d = await apiGet(`/api/self-study/drafts/${draftId}`);
      setDraft(d?.data?.draft ?? d?.draft ?? draft);
    } catch (e) { setError(e?.message || 'Could not retry.'); }
    finally { setVBusy(false); }
  };

  const markResolved = (state, count = 0, info = {}) => {
    setAssignedCount(count);
    setPhase(state);
    onResolved?.(draftId, state, info);
  };

  /* Go back to (or forward to) one round of a draft that isn't an assignment. */
  const restoreRound = async (n) => {
    setVBusy(true); setError('');
    try {
      const d = await apiPost(`/api/self-study/drafts/${draftId}/history/${n}/restore`, {});
      setDraft(d?.data?.draft ?? d?.draft ?? draft);
    } catch (e) { setError(e?.message || 'Could not go back to that version.'); }
    finally { setVBusy(false); }
  };

  const assign = async (overrides = null) => {
    setPhase('assigning'); setError('');
    try {
      const d = await apiPost(`/api/self-study/drafts/${draftId}/assign`, overrides || {});
      // A teaching resource is saved to the Library, not assigned — its row id is the link.
      if (d?.data?.saved) {
        const info = { outputId: d.data.outputId, title: d.data.title };
        setSavedOut(info);
        markResolved('saved', 0, info);
        return;
      }
      markResolved('assigned', d?.data?.assigned ?? 0);
    } catch (e) {
      setError(e?.message || 'Could not assign it.');
      setPhase('ready');
    }
  };

  const discard = async () => {
    setPhase('assigning'); setError('');
    try {
      await apiDelete(`/api/self-study/drafts/${draftId}`);
      markResolved('discarded');
    } catch (e) {
      setError(e?.message || 'Could not discard the draft.');
      setPhase('ready');
    }
  };

  /* Battle drafts complete through the ONE shared BattleForm; after its
     submit creates the battle, the draft records the provenance. */
  const battleSubmit = async (form) => {
    setPhase('assigning'); setError('');
    try {
      const scheduledIso = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;
      const res = await createBattle({
        kind: form.kind, courseId: form.courseId, classId: form.classId,
        question_source: form.questionSource,
        ...(form.kind !== 'course' ? { subject: form.subject } : {}),
        ...(form.kind === 'review' ? { mode: 'review' } : {}),
        title: form.title.trim(), description: form.description || null, topic: form.topic || null,
        difficulty: form.difficulty,
        total_questions: parseInt(form.totalQuestions, 10) || 15,
        time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
        xp_prize: parseInt(form.xpPrize, 10) || 200,
        expires_in_minutes: parseInt(form.expiresInMinutes, 10) || 60,
        scheduled_for: form.repeats ? null : scheduledIso,
        ...(form.repeats ? { repeat: { days: form.days, time: form.repeatTime, tz: localZone(), until: new Date(form.repeatUntil).toISOString() } } : {}),
        ...audienceBody(form.audience),
        // The draft's own questions (the ones its preview shows): the battle asks exactly those.
        draft_id: draftId,
      });
      // The invite answers { success, data: { battle_id, invited, … } } — without battle_id the draft was closed
      // with no link to the battle it created.
      const battleId = res?.data?.battle_id ?? res?.battle_id ?? res?.data?.battle?.id ?? res?.battle?.id ?? res?.data?.id ?? res?.id ?? null;
      // A recurring battle is a series (its battles are made before each start): the draft records the series.
      const seriesId = res?.data?.series_id ?? null;
      await apiPatch(`/api/self-study/drafts/${draftId}`, { status: 'assigned', assignment_id: battleId, ...(seriesId ? { series_id: seriesId } : {}) });
      markResolved('assigned', res?.data?.invited ?? res?.invited ?? 0);
    } catch (e) {
      setError(e?.message || 'Could not create the battle.');
      setPhase('ready');
    }
  };

  // The review battle runs at the due date unless the instructor picks another time.
  useEffect(() => {
    const due = draft?.payload?.due_at ? datetimeLocal(draft.payload.due_at) : '';
    if (due) setReview((r) => (r.at ? r : { ...r, at: due }));
  }, [draft?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Seed from the draft; (re)write them when the review is on and the count changed.
  useEffect(() => { setReviewQs(draft?.payload?.review_questions || null); }, [draft?.id, draft?.payload?.review_questions]);
  const reviewable = ['assignment', 'self_study'].includes(draft?.type) && draft?.status !== 'assigned';
  useEffect(() => {
    if (!reviewable || !review.on || !draftId) return undefined;
    if (reviewQs?.items?.length && reviewQs.count === review.questions) return undefined;
    let gone = false;
    const t = setTimeout(async () => {
      setReviewQsBusy(true);
      try {
        const r = await apiPost(`/api/self-study/drafts/${draftId}/review-questions`, { count: review.questions });
        const rq = r?.data?.review_questions ?? r?.review_questions;
        if (!gone && rq) setReviewQs(rq);
      } catch (e) {
        if (!gone) setReviewQs((q) => ({ ...(q || {}), count: review.questions, note: e?.message || "Couldn't write the review battle's questions." }));
      } finally { if (!gone) setReviewQsBusy(false); }
    }, 700);
    return () => { gone = true; clearTimeout(t); };
  }, [reviewable, review.on, review.questions, draftId, reviewQs?.count, reviewQs?.items?.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Stable per draft: BattleForm re-seeds itself whenever `initial` changes.
  const battleInitial = useMemo(() => (draft?.type === 'battle' ? battleInitialFrom(draft.payload || {}, draft) : null), [draft]);

  if (phase === 'loading') {
    return (
      <div style={{ height: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', fontFamily: C.font }}>
        <Loading label="Loading the draft…" />
      </div>
    );
  }

  if (phase === 'error' || !draft) {
    return (
      <div style={{ height: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, fontFamily: C.font }}>
        <Ico ti="ti-alert-triangle" size={20} color={RED} />
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 700, textAlign: 'center' }}>{error || 'Draft not found.'}</div>
        <Btn2 onClick={load}>Try again</Btn2>
        <Btn2 onClick={onClose}>Back to chat</Btn2>
      </div>
    );
  }

  const isTool = draft.type === 'teaching_tool';
  const toolKey = draft.payload?.tool;
  const meta = isTool
    ? { name: TOOL_NAME[toolKey] || 'Teaching resource', ti: 'ti-wand', color: accentFor(toolKey) }
    : byKey(draft.type) || {};
  const payload = draft.payload || {};
  const isBattle = draft.type === 'battle';
  const isJourney = draft.type === 'multi_stage';
  const isLive = draft.type === 'live_course';
  const stages = payload.details?.stages || [];
  const audience = draft.audience || {};
  const reviewBattle = reviewable ? {
    on: review.on, title: `Review battle · ${payload.topic || payload.title || draft.title || 'the activity'}`, topic: payload.topic, subject: payload.subject,
    questions: reviewQs?.items || [], loading: reviewQsBusy, note: reviewQs?.note, players: audience.names || [],
  } : null;
  const versions = versionsOf(draft);
  const questionsExist = versions.some((v) => (v.paper?.questions || []).length > 0);
  const shown = versions.find((v) => v.n === vSel) || versions.at(-1) || null;
  // Assign waits for what learners can't do without: a figure the paper
  // refers to, and an exact due date when the teacher said one in words.
  const needsFigure = !!shown && (shown.paper?.questions || []).some((q) => q?.figure_note && !q.figure);
  const dueValue = dueLocal ?? datetimeLocal(payload.due_at);
  const dueUnset = !isLive && !isBattle && !isJourney && !isTool && !!payload.due_hint && !dueValue;
  // The review battle's questions are being (re)written: assign once they're on screen.
  const reviewWriting = !!reviewBattle?.on && (reviewQsBusy || (!reviewQs?.note && reviewQs?.count !== review.questions));
  const assignBlock = needsFigure ? 'Add the missing figure first (Edit on the version).' : dueUnset ? `Set the exact due date for “${payload.due_hint}” first.` : '';
  const downloadPdf = () => {
    // A version with questions downloads as the paper, with its marking scheme after it.
    if (shown?.status === 'ready' && (shown.paper?.questions || []).length) {
      setPdfErr(false);
      apiBlob(`/api/self-study/drafts/${draft.id}/paper.html?version=${shown.n}&copy=both&embed=1`)
        .then((b) => b.text())
        .then((html) => printPaperHtml(html, `${draft.title || payload.topic || 'Assignment'} — V${shown.n}`))
        .catch(() => setPdfErr(true));
      return;
    }
    try {
      downloadActivityPdf({ draft, meta, shown, audience });
      setPdfErr(false);
    } catch { setPdfErr(true); }
  };
  const assignOverrides = () => ({
    ...(shown ? { version: shown.n } : {}),
    ...(['assignment', 'self_study'].includes(draft.type) ? { review: { on: review.on, at: review.at ? new Date(review.at).toISOString() : null, questions: review.questions } } : {}),
    ...(dueLocal != null ? { due_at: dueLocal ? new Date(dueLocal).toISOString() : null } : {}),
  });

  if (phase === 'saved') {
    return (
      <Frame onClose={onClose} meta={meta} type={draft.type}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-circle-check" size={26} color={GREEN} /></div>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.ink }}>Saved to your Library ✓</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, maxWidth: 280 }}>“{savedOut?.title || draft.title}” is in your Library, ready to open, copy or print.</div>
          {savedOut?.outputId && (
            <button onClick={() => navigate(`/library/${savedOut.outputId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '9px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.hero, color: '#fff', fontSize: 12.5, fontWeight: 800, fontFamily: C.font }}>
              <Ico ti="ti-external-link" size={13} /> Open it
            </button>
          )}
          <Btn2 onClick={onClose}>Back to chat</Btn2>
        </div>
      </Frame>
    );
  }

  if (phase === 'assigned') {
    return (
      <Frame onClose={onClose} meta={meta} type={draft.type}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-circle-check" size={26} color={GREEN} /></div>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.ink }}>Assigned ✓</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, maxWidth: 280 }}>
            {isBattle ? 'The battle is live from your draft.' : `“${draft.title}” is now on your learners' Activities feed${assignedCount ? ` — ${assignedCount} learner${assignedCount === 1 ? '' : 's'} notified` : ''}.`}
          </div>
          <a href="/activities" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '9px 16px', borderRadius: 12, background: C.hero, color: '#fff', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', fontFamily: C.font }}>
            <Ico ti="ti-external-link" size={13} /> Open the workbench
          </a>
          <Btn2 onClick={onClose}>Back to chat</Btn2>
        </div>
      </Frame>
    );
  }

  if (phase === 'discarded') {
    return (
      <Frame onClose={onClose} meta={meta} type={draft.type}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-trash" size={22} color={C.muted} /></div>
          <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>Draft discarded</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>Nothing was sent to anyone.</div>
          <Btn2 onClick={onClose}>Back to chat</Btn2>
        </div>
      </Frame>
    );
  }

  /* The brief at a glance — shared by the Settings tab and the other activity types. */
  const renderBrief = () => (
    <>
      {/* The brief at a glance: class, subject, topic, due — then who gets it. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0 14px' }}>
        <Row label="Class">{audience.class_name || <span style={{ color: C.muted2 }}>Not set — choose one in Edit details</span>}</Row>
        <Row label="Subject">{payload.subject || <span style={{ color: C.muted2 }}>—</span>}</Row>
        <Row label={isLive ? 'Session focus' : 'Topic'}>{payload.topic}</Row>
        <Row label="Due">
          {isLive ? (payload.due_hint || <span style={{ color: C.muted2 }}>—</span>) : (
            <>
              <input type="datetime-local" value={dueValue} aria-label="Due date" onChange={(e) => setDueLocal(e.target.value)}
                style={{ padding: '5px 7px', borderRadius: 8, border: `1px solid ${dueUnset ? RED : C.border}`, fontSize: 12, fontFamily: C.font, color: C.ink, maxWidth: '100%' }} />
              {payload.due_hint && !dueValue && <div style={{ fontSize: 11, color: RED, marginTop: 3 }}>You said “{payload.due_hint}” — pick the exact date and time.</div>}
            </>
          )}
        </Row>
      </div>
      <Row label="Who gets it">
        {audience.whole_class ? `Everyone in ${audience.class_name || 'the class'}` : (audience.label || '—')}
        {audience.resolved_count ? <Chip color={GREEN} bg="#DCFCE7">{audience.resolved_count} learner{audience.resolved_count === 1 ? '' : 's'}</Chip> : null}
        {(audience.names || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {audience.names.map((n) => <Chip key={n} color={C.ink} bg={C.bg}>@{n}</Chip>)}
            {(audience.resolved_count || 0) > audience.names.length && (
              <Chip color={C.muted2} bg={C.bg}>+{audience.resolved_count - audience.names.length} more</Chip>
            )}
          </div>
        )}
      </Row>
    </>
  );

  return (
    <Frame onClose={onClose} meta={meta} type={draft.type}>
      {/* The AI-prepared banner — honest about who made this and what it is */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 10, background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.3)', marginBottom: 14 }}>
        <Ico ti="ti-sparkles" size={13} color={PURPLE} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: PURPLE, fontFamily: C.font }}>
          {phase === 'editing' ? 'Editing before assign — you can change anything.' : isTool ? 'AI drafted — it only reaches your Library when you save it.' : 'AI prepared — nothing is sent until you assign.'}
        </span>
      </div>

      {/* What the agent last changed in chat — re-preview at a glance. */}
      {payload.last_change?.note && phase === 'ready' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 10, background: 'rgba(232,136,74,.09)', border: '1px solid rgba(232,136,74,.35)', marginBottom: 12 }}>
          <Ico ti="ti-pencil" size={12} color={C.brand} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.brand, fontFamily: C.font, flex: 1 }}>{payload.last_change.note}</span>
          {payload.last_change.at && <span style={{ fontSize: 10, color: C.muted2, fontFamily: C.font, flexShrink: 0 }}>
            {new Date(payload.last_change.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>}
        </div>
      )}

      {phase === 'editing' ? (
        /* The SAME form the workbench uses — prefilled, posting to the
           draft-assign approval instead of the bench. */
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          <ActivityForm
            type={draft.type}
            initial={prefillFrom(payload, shown)}
            savePayload={(pl) => apiPost(`/api/self-study/drafts/${draftId}/assign`, pl)}
            onAssigned={(count) => markResolved('assigned', count)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <Btn2 onClick={() => { setPhase('ready'); load(); }}>Back to preview</Btn2>
          </div>
        </div>
      ) : isTool ? (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          <ToolDraftPreview draft={draft} selected={shown?.n} onSelect={setVSel} onRetry={retryVersion} busy={vBusy}
            toolName={TOOL_NAME[toolKey]} toolEmoji={TOOL_ICON[toolKey]} />
        </div>
      ) : isBattle ? (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          <BattleDraftPreview draft={draft} initial={battleInitial} courses={courses} onSubmit={battleSubmit} audienceLabel={audience.label || '—'} />
        </div>
      ) : draft.type === 'self_study' ? (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          <SelfStudyDraftPreview draft={draft} audience={audience} dueLocal={dueValue} onDue={setDueLocal} dueHint={payload.due_hint}
            review={review} onReview={setReview} onEditPlan={() => setPhase('editing')} battle={reviewBattle} />
        </div>
      ) : draft.type === 'assignment' && versions.length > 0 ? (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          <AssignmentDraftPreview version={shown} title={payload.title || draft.title} topic={payload.topic} battle={reviewBattle}
            settings={(
              <div>
                {renderBrief()}
                <Row label="Instructions to learners">{shown?.paper?.instructions || payload.instructions || <span style={{ color: C.muted2 }}>None</span>}</Row>
                <div style={{ marginBottom: 12, borderTop: `1px solid ${C.border}` }}>
                  <ReviewBattleSettings value={review} onChange={setReview} dueLocal={dueValue} defaultOpen={false} />
                </div>
              </div>
            )}
            questions={(
              <div style={{ marginBottom: 14 }}>
                <DraftVersions draft={draft} selected={shown?.n} onSelect={setVSel}
                  onSave={saveVersion} onRetry={retryVersion} busy={vBusy}
                  editing={vEditing} setEditing={setVEditing} />
              </div>
            )} />
        </div>
      ) : isJourney ? (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          {(payload.history || []).length > 1 && (
            <HistoryTabs history={payload.history} current={payload.history_current} busy={vBusy} onPick={restoreRound} />
          )}
          <Row label="Audience">{audience.label || '—'}</Row>
          <Row label="Instructions">{payload.instructions || <span style={{ color: C.muted2 }}>None</span>}</Row>
          <Row label={`Roadmap — ${stages.length} stage${stages.length === 1 ? '' : 's'}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stages.map((st, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}` }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: PURPLE, color: '#fff', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{st.title}</div>
                    <div style={{ fontSize: 10.5, color: C.muted2 }}>{st.subject} · {st.topic}</div>
                  </div>
                  <Chip color={st.kind === 'battle' ? '#DC2626' : PURPLE} bg={st.kind === 'battle' ? 'rgba(220,38,38,.1)' : 'rgba(168,85,247,.1)'}>{st.kind === 'battle' ? <><Ico ti="ti-swords" size={12} color="#DC2626" /> battle · {st.questions || 5} questions</> : st.kind?.replace('_', ' ')}</Chip>
                </div>
              ))}
            </div>
          </Row>
          <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, lineHeight: 1.5 }}>
            Assigning creates each stage as real work (same path as the workbench), then chains them into the journey. A battle stage becomes a real battle for the same learners, and the next stage unlocks when it finishes.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
          {(payload.history || []).length > 1 && (
            <HistoryTabs history={payload.history} current={payload.history_current} busy={vBusy} onPick={restoreRound} />
          )}
          {renderBrief()}
          {!versions.length && <Row label="Instructions to learners">{payload.instructions || <span style={{ color: C.muted2 }}>None</span>}</Row>}
          {versions.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <DraftVersions draft={draft} selected={shown?.n} onSelect={setVSel}
                onSave={saveVersion} onRetry={retryVersion} busy={vBusy}
                editing={vEditing} setEditing={setVEditing} />
            </div>
          )}
          {draft.type === 'assignment' && (
            <div style={{ marginBottom: 12, borderTop: `1px solid ${C.border}` }}>
              <ReviewBattleSettings value={review} onChange={setReview} dueLocal={dueValue} defaultOpen={false} />
            </div>
          )}
          {isLive && (
            <Row label="Holds on">{payload.details?.scheduled_hint || <span style={{ color: RED }}>Not set yet — add the exact date and time before assigning.</span>}</Row>
          )}
          {!isLive && !isBattle && !versions.length && (
            <Row label={meta.planLabel || 'Plan'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(payload.subtopics || []).map((st, i) => (
                  <div key={i} style={{ padding: '8px 11px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{i + 1}. {st}</div>
                    {(payload.objectives?.[st] || []).length > 0 && (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {payload.objectives[st].map((o, j) => <li key={j} style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{o}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
                {!(payload.subtopics || []).length && <span style={{ color: RED }}>No plan yet.</span>}
              </div>
            </Row>
          )}
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 10, background: tint(9, RED), border: `1px solid ${tint(30, RED)}`, fontSize: 12, fontWeight: 700, color: RED, fontFamily: C.font, marginTop: 10 }}>
          <Ico ti="ti-alert-triangle" size={13} /> {error}
        </div>
      )}

      {/* Footer — the human decision. Assign is the ONLY path to learners. */}
      {phase !== 'editing' && !isBattle && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}`, marginTop: 12 }}>
          {!isTool && <button onClick={downloadPdf} disabled={!isJourney && !questionsExist && !(payload.subtopics || []).length}
            title="Download this activity as a PDF"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 13px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            <Ico ti="ti-download" size={13} /> PDF
          </button>}
          <button onClick={discard}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 13px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            <Ico ti="ti-trash" size={13} /> Discard
          </button>
          {(phase === 'ready') && !isJourney && !isTool && !vEditing && (!shown || shown.status === 'ready') && (
            <button onClick={() => setPhase('editing')}
              title={shown ? `Title, due date, who it's for — with Version ${shown.n}'s questions` : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 13px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              <Ico ti="ti-pencil" size={13} /> {shown ? 'Edit details' : 'Edit'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {assignBlock ? (
            <span style={{ fontSize: 11.5, color: RED, fontWeight: 700, fontFamily: C.font, textAlign: 'right' }}>{assignBlock}</span>
          ) : shown && (
            <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700, fontFamily: C.font, textAlign: 'right' }}>
              {isTool ? 'Saves' : 'Assigns'} <b style={{ color: C.ink }}>Version {shown.n}</b>{!isTool && audience.label ? <> to {audience.label}</> : null}
            </span>
          )}
          <button onClick={() => assign(assignOverrides())} disabled={phase === 'assigning' || vEditing || (shown && shown.status !== 'ready') || !!assignBlock || reviewWriting}
            data-review-writing={reviewWriting ? '' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 11, border: 'none', background: phase === 'assigning' || assignBlock || reviewWriting ? C.border : C.hero, color: '#fff', fontSize: 12.5, fontWeight: 900, cursor: phase === 'assigning' || reviewWriting ? 'wait' : assignBlock ? 'not-allowed' : 'pointer', fontFamily: C.font }}>
            {phase === 'assigning' || reviewWriting ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti={isTool ? 'ti-books' : 'ti-send'} size={13} />}
            {phase === 'assigning' ? (isTool ? 'Saving…' : 'Assigning…') : reviewWriting ? 'Writing review questions…' : isTool ? 'Save to Library' : 'Assign'}
          </button>
        </div>
      )}
      {phase !== 'editing' && isBattle && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${C.border}`, marginTop: 12 }}>
          <button onClick={discard}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 13px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            <Ico ti="ti-trash" size={13} /> Discard draft
          </button>
          <span style={{ fontSize: 11, color: C.muted2, fontFamily: C.font }}>Creating the battle closes this draft.</span>
        </div>
      )}
    </Frame>
  );
}

/* Every round of a draft that isn't an assignment: V1 as it was prepared, then each follow-up.
   Picking one makes it the draft (what Assign sends) — nothing is lost, you can come back. */
function HistoryTabs({ history, current, busy, onPick }) {
  const now = current ?? history.at(-1)?.n;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: C.muted2, marginBottom: 5, fontFamily: C.font }}>Versions</div>
      <div role="tablist" aria-label="Versions" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {history.map((h) => {
          const on = h.n === now;
          return (
            <button key={h.n} type="button" role="tab" aria-selected={on} disabled={busy} onClick={() => { if (!on) onPick(h.n); }} title={h.request}
              style={{ padding: '5px 11px', borderRadius: 9, cursor: on ? 'default' : 'pointer', fontFamily: C.font, fontSize: 12, fontWeight: 800,
                border: `1px solid ${on ? PURPLE : C.border}`, background: on ? 'rgba(168,85,247,.1)' : C.surface, color: on ? PURPLE : C.muted }}>
              V{h.n}{on ? ' · on screen' : ''}
            </button>
          );
        })}
      </div>
      {history.find((h) => h.n === now)?.request && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, fontFamily: C.font }}>“{history.find((h) => h.n === now).request}”</div>
      )}
    </div>
  );
}

/* ── Small local primitives (panel chrome) ─────────────────────────────────── */
function Frame({ children, onClose, meta, type }) {
  const Icon = meta.icon || ClipboardList;
  const color = meta.color || PURPLE;
  return (
    <div data-preview-panel={type} style={{ height: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', padding: '18px 18px 16px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: tint(9, color), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti={meta.ti || 'ti-clipboard-list'} size={18} color={color} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: C.ink, fontFamily: C.font, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.name || 'Activity'} · preview</div>
          <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font }}>Human-in-the-loop — you decide</div>
        </div>
        <button onClick={onClose} title="Back to chat" style={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${C.border}`, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Ico ti="ti-x" size={14} color={C.muted} /></button>
      </div>
      {children}
    </div>
  );
}

function Btn2({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>{children}</button>
  );
}
