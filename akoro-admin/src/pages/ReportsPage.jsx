import { useState, useEffect, useCallback } from 'react';
import { Download, FileText, Users, TrendingUp } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const PERIODS = ['7d', '30d', '90d', '1y'];

function periodLabel(p) {
  const map = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last year' };
  return map[p] || p;
}

function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => {
      const v = row[h] ?? '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')),
  ];
  return lines.join('\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ExportCard({ icon: Icon, title, color, endpoint, filenamePrefix }) {
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await apiGet(`${endpoint}?period=${period}`);
      const rows = Array.isArray(res) ? res : (res?.data || res?.rows || []);
      setPreview(rows);
      if (rows.length === 0) {
        showToast('No data available for this period', 'error');
        return;
      }
      const csv = toCSV(rows);
      downloadCSV(csv, `${filenamePrefix}-${period}-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('CSV downloaded');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const CHIP = (active) => ({
    padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 11, fontWeight: active ? 700 : 500,
    background: active ? color : `${color}15`, color: active ? WHITE : color,
    transition: 'all .15s',
  });

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '8px 12px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 12, color: INK, padding: '10px 12px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const previewRows = preview ? preview.slice(0, 20) : [];
  const previewHeaders = previewRows.length > 0 ? Object.keys(previewRows[0]) : [];

  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={color} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, fontFamily: FONT }}>{title}</div>
          <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{periodLabel(period)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PERIODS.map(p => (
          <button key={p} style={CHIP(period === p)} onClick={() => setPeriod(p)}>{p}</button>
        ))}
      </div>

      <Btn variant="primary" onClick={handleDownload} disabled={loading} style={{ background: color, boxShadow: `0 2px 8px ${color}44` }}>
        <Download size={14} />
        {loading ? 'Fetching…' : 'Download CSV'}
      </Btn>

      {preview !== null && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, fontFamily: FONT, marginBottom: 8 }}>
            Preview — first {previewRows.length} of {preview.length} rows
          </div>
          {previewRows.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>No data to preview.</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
                <thead>
                  <tr style={{ background: LIGHT }}>
                    {previewHeaders.map(h => <th key={h} style={TH}>{h.replace(/_/g, ' ')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                      {previewHeaders.map(h => (
                        <td key={h} style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(row[h] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function ReportsPage() {
  const [topInstructors, setTopInstructors] = useState([]);
  const [tiLoading,      setTiLoading]      = useState(true);
  const [toast,          setToast]          = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    apiGet('/api/admin/analytics/top-instructors')
      .then(res => {
        const arr = Array.isArray(res) ? res : (res?.instructors || res?.data || []);
        setTopInstructors(arr);
      })
      .catch(() => showToast('Failed to load top instructors', 'error'))
      .finally(() => setTiLoading(false));
  }, []);

  const fmtMoney = (v) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0); }
    catch { return `$${(v || 0).toFixed(2)}`; }
  };

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  return (
    <PageLayout title="Reports" subtitle="Export data and view platform reports">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Export cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20, marginBottom: 40 }}>
          <ExportCard
            icon={FileText}
            title="Revenue Export"
            color={GREEN}
            endpoint="/api/admin/reports/revenue-export"
            filenamePrefix="revenue"
          />
          <ExportCard
            icon={Users}
            title="Enrollments Export"
            color={BLUE}
            endpoint="/api/admin/reports/enrollments-export"
            filenamePrefix="enrollments"
          />
        </div>

        {/* Top Instructors by Revenue */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>
            Top Instructors by Revenue
          </h2>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
            {tiLoading ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={48} />)}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: LIGHT }}>
                    <th style={{ ...TH, width: 48 }}>#</th>
                    <th style={TH}>Instructor</th>
                    <th style={TH}>Courses</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Students</th>
                  </tr>
                </thead>
                <tbody>
                  {topInstructors.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No data available</td></tr>
                  ) : topInstructors.map((inst, idx) => (
                    <tr key={inst.id || idx}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                      <td style={{ ...TD, color: MUTED, fontWeight: 700 }}>{idx + 1}</td>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700, color: AMBER, flexShrink: 0,
                          }}>
                            {(inst.full_name || inst.name || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{inst.full_name || inst.name || '—'}</div>
                            <div style={{ fontSize: 11, color: MUTED }}>{inst.email || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...TD, color: MUTED }}>
                        {(inst.courses_count ?? inst.total_courses ?? 0).toLocaleString()}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: GREEN }}>
                        {fmtMoney(inst.total_revenue || inst.revenue || 0)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', color: MUTED }}>
                        {(inst.total_students || inst.students || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
