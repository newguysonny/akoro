/**
 * JoinRequestsPage — dedicated approval queue for learners who requested to
 * join this teacher's class. Promotes the in-page banner (previously shown at
 * the top of the Students page) to its own routed page with an empty state.
 * Approving a request moves the learner into the active class roster.
 */
import { PageLayout } from '../components/Layout.jsx';
import JoinRequests from './students-page/JoinRequests.jsx';

export default function JoinRequestsPage() {
  return (
    <PageLayout title="Join Requests" subtitle="Learners who asked to join your class — approve to add them to your roster">
      <JoinRequests showEmpty />
    </PageLayout>
  );
}
