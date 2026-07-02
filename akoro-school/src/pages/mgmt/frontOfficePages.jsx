/**
 * Front Office module pages (mgmt schema).
 * Dashboard is custom; the rest are ResourcePage configs.
 */
import { useState, useEffect } from 'react';
import { DoorOpen, Users, MessageSquareWarning, Mail } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet } from '../../services/api.js';
import { AMBER, MUTED2, GREEN, RED, BLUE, PURPLE } from '../../constants.js';

const BASE = '/api/school/mgmt';
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v).replace('_', ' ')}</span>;
};

export function FrontOfficeDashboardPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/front-office`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.enquiries, label: 'Admission Enquiries', icon: DoorOpen, c: BLUE, to: '/mgmt/enquiries' },
    { n: stats.openEnquiries, label: 'New Enquiries', icon: DoorOpen, c: AMBER, to: '/mgmt/enquiries' },
    { n: stats.visitorsToday, label: 'Visitors Today', icon: Users, c: GREEN, to: '/mgmt/visitor-book' },
    { n: stats.openComplaints, label: 'Open Complaints', icon: MessageSquareWarning, c: RED, to: '/mgmt/complaints' },
    { n: stats.postalRecords, label: 'Postal Records', icon: Mail, c: PURPLE, to: '/mgmt/postal-records' },
  ] : [];
  return (
    <PageLayout title="Front Office Dashboard" subtitle="Reception activity at a glance">
      <StatCards cards={cards} loading={!stats} />
    </PageLayout>
  );
}

export function AdmissionEnquiriesPage() {
  const STATUSES = [{ value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'admitted', label: 'Admitted' }, { value: 'closed', label: 'Closed' }];
  return <ResourcePage title="Admission Enquiries" subtitle="Prospective parent enquiries" resource="enquiries"
    columns={[
      { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' },
      { key: 'class_interest', label: 'Class' }, { key: 'source', label: 'Source' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { new: AMBER, contacted: BLUE, admitted: GREEN, closed: MUTED2 }) },
      { key: 'follow_up_on', label: 'Follow Up' },
    ]}
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'class_interest', label: 'Class of Interest', placeholder: 'JSS1' },
      { key: 'source', label: 'Source', placeholder: 'Referral / Website / Walk-in' },
      { key: 'status', label: 'Status', type: 'select', default: 'new', options: STATUSES },
      { key: 'follow_up_on', label: 'Follow Up On', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]}
    listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Enquiry" />;
}

export function VisitorBookPage() {
  return <ResourcePage title="Visitor Book" subtitle="Who came in and why" resource="visitors"
    columns={[
      { key: 'name', label: 'Visitor' }, { key: 'phone', label: 'Phone' },
      { key: 'purpose', label: 'Purpose' }, { key: 'to_meet', label: 'To Meet' },
      { key: 'check_in', label: 'Check In', render: (r) => new Date(r.check_in).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
      { key: 'check_out', label: 'Check Out', render: (r) => r.check_out ? new Date(r.check_out).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : pill('on premises', { 'on premises': GREEN }) },
    ]}
    fields={[
      { key: 'name', label: 'Visitor Name', required: true },
      { key: 'phone', label: 'Phone' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'to_meet', label: 'To Meet' },
      { key: 'id_proof', label: 'ID Proof', placeholder: 'e.g. National ID' },
      { key: 'check_out', label: 'Check Out Time', type: 'datetime-local' },
    ]} createLabel="Log Visitor" searchKeys={['name', 'phone', 'purpose', 'to_meet']} />;
}

export function ComplaintsPage() {
  const STATUSES = [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In Progress' }, { value: 'resolved', label: 'Resolved' }];
  return <ResourcePage title="Complaints" subtitle="Issues raised by parents & visitors" resource="complaints"
    columns={[
      { key: 'complainant', label: 'Complainant' }, { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { open: RED, in_progress: AMBER, resolved: GREEN }) },
    ]}
    fields={[
      { key: 'complainant', label: 'Complainant', required: true },
      { key: 'phone', label: 'Phone' },
      { key: 'category', label: 'Category', placeholder: 'Transport / Fees / Academics…' },
      { key: 'status', label: 'Status', type: 'select', default: 'open', options: STATUSES },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'action_note', label: 'Action Taken', type: 'textarea', full: true },
    ]}
    listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Complaint" />;
}

export function PostalRecordsPage() {
  const DIRECTIONS = [{ value: 'receive', label: 'Received' }, { value: 'dispatch', label: 'Dispatched' }];
  return <ResourcePage title="Postal Records" subtitle="Incoming & outgoing mail" resource="postal-records"
    columns={[
      { key: 'direction', label: 'Direction', render: (r) => pill(r.direction, { receive: BLUE, dispatch: PURPLE }) },
      { key: 'reference_no', label: 'Ref No' }, { key: 'item', label: 'Item' },
      { key: 'from_name', label: 'From' }, { key: 'to_name', label: 'To' },
      { key: 'record_date', label: 'Date' },
    ]}
    fields={[
      { key: 'direction', label: 'Direction', type: 'select', default: 'receive', options: DIRECTIONS },
      { key: 'reference_no', label: 'Reference No' },
      { key: 'item', label: 'Item', required: true },
      { key: 'record_date', label: 'Date', type: 'date' },
      { key: 'from_name', label: 'From' },
      { key: 'to_name', label: 'To' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]}
    listFilters={[{ key: 'direction', label: 'Direction', options: DIRECTIONS }]} createLabel="New Record" />;
}
