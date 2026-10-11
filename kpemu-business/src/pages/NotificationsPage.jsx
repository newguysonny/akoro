import { Bell } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { INK, MUTED, BORDER, WHITE, ACCENT, FONT } from '../constants.js';

// The business console has no notification source yet — this page is the
// bell's honest destination: a real route with a real empty state, ready
// for the API to feed it.
export default function NotificationsPage() {
  return (
    <PageLayout title="Notifications" subtitle="Updates about your businesses, vouchers and wallet">
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#F1ECFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bell size={24} color={ACCENT} />
        </div>
        <div style={{ fontWeight: 800, color: INK, fontFamily: FONT, fontSize: 15 }}>You're all caught up</div>
        <div style={{ fontSize: 13, color: MUTED, maxWidth: 340, fontFamily: FONT, lineHeight: 1.5 }}>
          Notifications about your startups, voucher activity, redemptions and wallet will land here.
        </div>
      </div>
    </PageLayout>
  );
}
