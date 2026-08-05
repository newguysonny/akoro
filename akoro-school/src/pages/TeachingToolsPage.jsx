/**
 * TeachingToolsPage — the teaching tool suite in the school portal.
 * The suite itself lives in components/teaching/TeachingTools.jsx and is shared
 * with the AI chat on the school website, so both stay identical.
 */
import { PageLayout } from '../components/Layout.jsx';
import TeachingTools from '../components/teaching/TeachingTools.jsx';

export default function TeachingToolsPage() {
  return (
    <PageLayout title="Teaching Tools" subtitle="Podcasts, misconceptions, hooks, vocabulary, grading and more — generated from your topic">
      <TeachingTools />
    </PageLayout>
  );
}
