/**
 * TeachingToolsPage — the teaching tool suite for instructors.
 * Same component and same backend catalog as the school portal and the AI chat
 * on school websites, so a tool behaves identically wherever a teacher meets it.
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
