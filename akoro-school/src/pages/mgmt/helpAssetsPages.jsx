/** Help Center + Asset Management + Reports & Analytics pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Wrench, Trash2 as TrashIcon, ClipboardCheck, Users, Wallet, BadgeCheck, Library } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v).replace('_', ' ')}</span>;
};

/* ═══ HELP CENTER ═══ */
export function HelpCategoriesPage() {
  return <ResourcePage title="Manage Categories" subtitle="Help-article topics" resource="help-categories"
    columns={[{ key: 'name', label: 'Category' }]} fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function BrowseArticlesPage() {
  return <ResourcePage title="Browse Articles" subtitle="How-to guides & FAQs" resource="help-articles"
    columns={[
      { key: 'title', label: 'Article' }, { key: 'category_name', label: 'Category' },
      { key: 'body', label: 'Content', render: (r) => <span style={{ color: C.muted }}>{(r.body || '').slice(0, 80)}{(r.body || '').length > 80 ? '…' : ''}</span> },
      { key: 'published', label: 'Published' },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'help-categories' } },
      { key: 'published', label: 'Published', type: 'toggle', default: true },
      { key: 'body', label: 'Article Body', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'category_id', label: 'Category', optionsFrom: { resource: 'help-categories' } }]} createLabel="New Article" />;
}

export function AIChatbotHelpPage() {
  const navigate = useNavigate();
  return (
    <PageLayout title="AI Chatbot" subtitle="Get answers from your school agent">
      <div style={{ maxWidth: 520, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '30px 28px', textAlign: 'center', fontFamily: C.font }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: tint(8), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Ico ti="ti-robot" size={30} color={C.brand} />
        </div>
        <p style={{ fontSize: 16, fontWeight: 800, color: C.ink, margin: '0 0 8px' }}>Ask your School Agent</p>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: '0 0 18px' }}>
          Your dedicated AI agent already knows your school. Ask it how to use any module, draft notices, summarise records, or troubleshoot — it lives in AI Chat.
        </p>
        <button onClick={() => navigate('/chat')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          Open AI Chat <Ico ti="ti-arrow-right" size={15} />
        </button>
      </div>
    </PageLayout>
  );
}

/* ═══ ASSET MANAGEMENT ═══ */
const ASSET_STATUSES = [
  { value: 'in_use', label: 'In Use' }, { value: 'in_store', label: 'In Store' },
  { value: 'maintenance', label: 'Maintenance' }, { value: 'disposed', label: 'Disposed' },
];
const ASSET_STATUS_COLORS = { in_use: GREEN, in_store: BLUE, maintenance: C.brand, disposed: C.muted2 };
const assetOpts = { resource: 'assets', labelFn: (r) => `${r.name} (${r.asset_tag})` };

export function AssetDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/assets`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.assets, label: 'Total Assets', icon: Boxes, ti: 'ti-packages', c: BLUE, to: '/mgmt/asset-register' },
    { n: naira(s.totalCost), label: 'Purchase Value', icon: Wallet, ti: 'ti-wallet', c: GREEN, to: '/mgmt/asset-depreciation' },
    { n: s.inUse, label: 'In Use', icon: BadgeCheck, ti: 'ti-rosette-discount-check', c: GREEN, to: '/mgmt/asset-register' },
    { n: s.underMaintenance, label: 'Under Maintenance', icon: Wrench, ti: 'ti-tool', c: C.brand, to: '/mgmt/asset-maintenance' },
    { n: s.disposed, label: 'Disposed', icon: TrashIcon, ti: 'ti-trash', c: C.muted2, to: '/mgmt/asset-disposals' },
    { n: s.openAudits, label: 'Open Audits', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: RED, to: '/mgmt/asset-audits' },
  ] : [];
  return <PageLayout title="Asset Dashboard" subtitle="Fixed assets at a glance"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function AssetRegisterPage() {
  return <ResourcePage title="Asset Register" subtitle="Every asset the school owns" resource="assets"
    columns={[
      { key: 'asset_tag', label: 'Tag' }, { key: 'name', label: 'Asset' }, { key: 'category_name', label: 'Category' },
      { key: 'purchase_cost', label: 'Cost', render: (r) => naira(r.purchase_cost) },
      { key: 'location', label: 'Location' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, ASSET_STATUS_COLORS) },
    ]}
    fields={[
      { key: 'name', label: 'Asset Name', required: true },
      { key: 'asset_tag', label: 'Asset Tag', required: true, placeholder: 'AST-0001' },
      { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'asset-categories' } },
      { key: 'status', label: 'Status', type: 'select', default: 'in_use', options: ASSET_STATUSES },
      { key: 'purchase_cost', label: 'Purchase Cost (₦)', type: 'number' },
      { key: 'purchase_date', label: 'Purchase Date', type: 'date' },
      { key: 'depreciation_rate', label: 'Depreciation Rate (%/yr)', type: 'number', default: 10 },
      { key: 'location', label: 'Location' },
    ]} listFilters={[{ key: 'category_id', label: 'Category', optionsFrom: { resource: 'asset-categories' } }, { key: 'status', label: 'Status', options: ASSET_STATUSES }]}
    searchKeys={['name', 'asset_tag', 'location']} createLabel="Register Asset" />;
}

export function AssetCategoriesPage() {
  return <ResourcePage title="Asset Categories" subtitle="Group assets by type" resource="asset-categories"
    columns={[{ key: 'name', label: 'Category' }]} fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function AssetAssignmentsPage() {
  return <ResourcePage title="Asset Assignments" subtitle="Who holds which asset" resource="asset-assignments"
    columns={[
      { key: 'asset_name', label: 'Asset' }, { key: 'assigned_to', label: 'Assigned To' },
      { key: 'assigned_on', label: 'Assigned' }, { key: 'returned_on', label: 'Returned' }, { key: 'note', label: 'Note' },
    ]}
    fields={[
      { key: 'asset_id', label: 'Asset', type: 'select', required: true, optionsFrom: assetOpts },
      { key: 'assigned_to', label: 'Assigned To', required: true },
      { key: 'assigned_on', label: 'Assigned On', type: 'date' },
      { key: 'returned_on', label: 'Returned On', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} createLabel="New Assignment" />;
}

/* Straight-line depreciation computed from the register. */
export function AssetDepreciationPage() {
  const [assets, setAssets] = useState(null);
  useEffect(() => { apiGet(`${BASE}/assets`).then((r) => setAssets(r.data || [])).catch(() => setAssets([])); }, []);
  const rows = (assets || []).filter((a) => a.status !== 'disposed').map((a) => {
    const cost = Number(a.purchase_cost || 0);
    const rate = Number(a.depreciation_rate || 0) / 100;
    const years = a.purchase_date ? Math.max(0, (Date.now() - new Date(a.purchase_date).getTime()) / (365.25 * 86400000)) : 0;
    const accumulated = Math.min(cost, cost * rate * years);
    return { ...a, years: years.toFixed(1), accumulated, bookValue: Math.max(0, cost - accumulated) };
  });
  return (
    <PageLayout title="Asset Depreciation" subtitle="Straight-line book values from the register">
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
        {!assets ? (
          <div style={{ padding: '30px', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No active assets in the register.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font, minWidth: 640 }}>
            <thead><tr style={{ background: C.bg }}>
              {['ASSET', 'COST', 'AGE (YRS)', 'RATE', 'ACCUMULATED', 'BOOK VALUE'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.name}<span style={{ fontSize: 10.5, color: C.muted2, marginLeft: 6 }}>{r.asset_tag}</span></td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5 }}>{naira(r.purchase_cost)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5 }}>{r.years}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5 }}>{r.depreciation_rate}%</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: RED }}>{naira(r.accumulated)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 800, color: GREEN }}>{naira(r.bookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

export function AssetMaintenancePage() {
  return <ResourcePage title="Asset Maintenance" subtitle="Repairs & servicing" resource="asset-maintenance"
    columns={[
      { key: 'asset_name', label: 'Asset' }, { key: 'maintenance_type', label: 'Type' },
      { key: 'cost', label: 'Cost', render: (r) => naira(r.cost) }, { key: 'performed_on', label: 'Date' }, { key: 'note', label: 'Note' },
    ]}
    fields={[
      { key: 'asset_id', label: 'Asset', type: 'select', required: true, optionsFrom: assetOpts },
      { key: 'maintenance_type', label: 'Type', placeholder: 'Servicing / Repair' },
      { key: 'cost', label: 'Cost (₦)', type: 'number' },
      { key: 'performed_on', label: 'Date', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} createLabel="Log Maintenance" />;
}

export function AssetDisposalsPage() {
  const TYPES = [{ value: 'sold', label: 'Sold' }, { value: 'scrapped', label: 'Scrapped' }, { value: 'donated', label: 'Donated' }];
  return <ResourcePage title="Asset Disposals" subtitle="Assets leaving the register" resource="asset-disposals"
    columns={[
      { key: 'asset_name', label: 'Asset' },
      { key: 'disposal_type', label: 'Type', render: (r) => pill(r.disposal_type, { sold: GREEN, scrapped: RED, donated: BLUE }) },
      { key: 'amount', label: 'Amount', render: (r) => naira(r.amount) }, { key: 'disposed_on', label: 'Date' },
    ]}
    fields={[
      { key: 'asset_id', label: 'Asset', type: 'select', required: true, optionsFrom: assetOpts },
      { key: 'disposal_type', label: 'Type', type: 'select', default: 'sold', options: TYPES },
      { key: 'amount', label: 'Amount Recovered (₦)', type: 'number' },
      { key: 'disposed_on', label: 'Date', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} createLabel="Record Disposal" />;
}

export function AssetAuditsPage() {
  const STATUSES = [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }];
  return <ResourcePage title="Asset Audits" subtitle="Physical verification exercises" resource="asset-audits"
    columns={[
      { key: 'audit_date', label: 'Date' }, { key: 'auditor', label: 'Auditor' }, { key: 'findings', label: 'Findings' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { open: C.brand, closed: GREEN }) },
    ]}
    fields={[
      { key: 'audit_date', label: 'Audit Date', type: 'date' },
      { key: 'auditor', label: 'Auditor' },
      { key: 'status', label: 'Status', type: 'select', default: 'open', options: STATUSES },
      { key: 'findings', label: 'Findings', type: 'textarea', full: true },
    ]} createLabel="New Audit" />;
}

export function AssetReportsPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/assets`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: naira(s.totalCost), label: 'Total Purchase Value', icon: Wallet, ti: 'ti-wallet', c: GREEN },
    { n: s.assets, label: 'Assets on Register', icon: Boxes, ti: 'ti-packages', c: BLUE, to: '/mgmt/asset-register' },
    { n: s.inUse, label: 'In Use', icon: BadgeCheck, ti: 'ti-rosette-discount-check', c: GREEN },
    { n: s.underMaintenance, label: 'Under Maintenance', icon: Wrench, ti: 'ti-tool', c: C.brand },
    { n: s.disposed, label: 'Disposed', icon: TrashIcon, ti: 'ti-trash', c: C.muted2 },
    { n: s.openAudits, label: 'Open Audits', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: RED, to: '/mgmt/asset-audits' },
  ] : [];
  return <PageLayout title="Asset Reports" subtitle="Register summary"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

/* ═══ REPORTS & ANALYTICS (cross-module overview) ═══ */
export function ReportsAnalyticsPage() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => {
    Promise.all(['students', 'finance', 'hr', 'library'].map((a) => apiGet(`${BASE}/dashboard/${a}`).then((r) => r.data).catch(() => ({}))))
      .then(([students, finance, hr, library]) => setD({ students, finance, hr, library }));
  }, []);
  const cards = d ? [
    { n: d.students.total, label: 'Students', icon: Users, ti: 'ti-users', c: BLUE, to: '/mgmt/student-dashboard' },
    { n: d.hr.staff, label: 'Staff', icon: Users, ti: 'ti-users', c: PURPLE, to: '/mgmt/hr-dashboard' },
    { n: naira(d.finance.collected), label: 'Fees Collected', icon: Wallet, ti: 'ti-wallet', c: GREEN, to: '/mgmt/fees-dashboard' },
    { n: naira(d.finance.outstanding), label: 'Fees Outstanding', icon: Wallet, ti: 'ti-wallet', c: RED, to: '/mgmt/search-due-fees' },
    { n: d.library.activeLoans, label: 'Library Books Out', icon: Library, ti: 'ti-books', c: C.brand, to: '/mgmt/library-dashboard' },
    { n: d.students.presentToday, label: 'Students Present Today', icon: BadgeCheck, ti: 'ti-rosette-discount-check', c: GREEN, to: '/mgmt/student-attendance' },
  ] : [];
  const DASHBOARDS = [
    ['Student Dashboard', '/mgmt/student-dashboard'], ['Academic Dashboard', '/mgmt/academic-dashboard'],
    ['Fees Dashboard', '/mgmt/fees-dashboard'], ['Accounts Dashboard', '/mgmt/accounts-dashboard'],
    ['HR Dashboard', '/mgmt/hr-dashboard'], ['Exam Dashboard', '/mgmt/exam-dashboard'],
    ['Front Office Dashboard', '/mgmt/front-office-dashboard'], ['CBC Dashboard', '/mgmt/cbc-dashboard'],
    ['PTM Dashboard', '/mgmt/ptm-dashboard'], ['Lesson Planner Dashboard', '/mgmt/lesson-planner-dashboard'],
    ['OSM Dashboard', '/mgmt/osm-dashboard'], ['Study Center Dashboard', '/mgmt/study-center-dashboard'],
    ['Library Dashboard', '/mgmt/library-dashboard'], ['Inventory Dashboard', '/mgmt/inventory-dashboard'],
    ['Transport Dashboard', '/mgmt/transport-dashboard'], ['Hostel Dashboard', '/mgmt/hostel-dashboard'],
    ['Asset Dashboard', '/mgmt/asset-dashboard'],
  ];
  return (
    <PageLayout title="Reports & Analytics" subtitle="A whole-school overview with links to every module report">
      <StatCards cards={cards} loading={!d} />
      <div style={{ marginTop: 22 }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7 }}><Ico ti="ti-chart-bar" size={15} color={C.brand} /> Module Dashboards</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {DASHBOARDS.map(([label, to]) => (
            <button key={to} onClick={() => navigate(to)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font, textAlign: 'left' }}>
              {label} <Ico ti="ti-arrow-right" size={13} color={C.muted2} />
            </button>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
