/**
 * ActivitiesPage — the record of everything set for learners, every type in
 * one place (self study, assignments, projects, live courses, multi-stage and
 * battles) with its stage. Nothing is CREATED here any more: the agent
 * prepares activities from chat (prepare_activity) and the draft preview in
 * chat is where they are edited and assigned. Drafts still awaiting review show
 * at the top of the list.
 */
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn } from '../components/Primitives.jsx';
import { C } from '../theme/colors.js';
import ActivityPreviewPanel from '../components/ActivityPreviewPanel.jsx';
import DetailPage from './activities-page/DetailPage.jsx';
import ActivitiesHome from './activities-page/ActivitiesHome.jsx';

export default function ActivitiesPage() {
  const location = useLocation();
  const [sp] = useSearchParams();
  // The dedicated pages are PATHS (/activities/detail, /activities/draft) —
  // branch on the pathname, falling back to the query for ?draft=?detail=
  // links.
  const onDetail = location.pathname.endsWith('/detail');
  const onDraft = location.pathname.endsWith('/draft');
  const draftId = sp.get('draft');
  const detailId = sp.get('detail') || (onDetail ? ((location.state || {}).activity || {}).id : null);
  if (onDraft || draftId) return <DraftRoute draftId={draftId} />;
  if (onDetail || detailId) return <DetailRoute detailId={detailId} />;
  return <ActivitiesHome />;
}

/* The AI-prepared draft opens as a DEDICATED PAGE (its own URL), not a modal. */
function DraftRoute({ draftId }) {
  const navigate = useNavigate();
  if (!draftId) {
    return (
      <PageLayout title="AI-prepared activity" subtitle="Review & assign — human-in-the-loop">
        <div style={{ fontFamily: C.font, color: C.muted }}>No draft was specified.</div>
        <div style={{ marginTop: 14 }}><Btn onClick={() => navigate('/activities')}>Back to activities</Btn></div>
      </PageLayout>
    );
  }
  return (
    <PageLayout title="AI-prepared activity" subtitle="Review & assign — human-in-the-loop">
      <div style={{ height: 'calc(100vh - 190px)', minHeight: 460 }}>
        <ActivityPreviewPanel
          draftId={draftId}
          onClose={() => navigate(-1)}
          onResolved={() => navigate('/activities')}
        />
      </div>
    </PageLayout>
  );
}

/* Activity details — a dedicated page (its own URL), not a modal. */
function DetailRoute({ detailId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = (location.state || {}).activity;
  return <DetailPage activity={fromState || { id: detailId }} onDeleted={() => navigate('/activities')} onClose={() => navigate(-1)} />;
}
