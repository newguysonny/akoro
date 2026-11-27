import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DatabaseBackup,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPost, apiDelete, apiPut } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const FREQUENCIES = ['daily', 'weekly', 'monthly'];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : C.border, position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

const formatSize = (bytes) => {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
};
const formatDate = (iso) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function BackupManagementPage() {
  const navigate = useNavigate();
  const [backups, setBackups] = useState([]);
  const [schedule, setSchedule] = useState({ autoBackup: true, frequency: 'daily', retentionDays: 30 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    Promise.all([
      apiGet('/api/school/backups'),
      apiGet('/api/school/settings'),
    ]).then(([bRes, sRes]) => {
      setBackups(bRes.data || []);
      if (sRes.data?.backupSchedule) setSchedule(sRes.data.backupSchedule);
    }).catch((e) => showToast(e.message || 'Could not load backups'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const createBackup = async () => {
    setCreating(true);
    try {
      const res = await apiPost('/api/school/backups', {});
      setBackups((prev) => [res.data, ...prev]);
      showToast('Backup created ✓');
    } catch (e) { showToast(e.message || 'Could not create backup'); }
    finally { setCreating(false); }
  };

  const removeBackup = async (id) => {
    setBusyId(id);
    try {
      await apiDelete(`/api/school/backups/${id}`);
      setBackups((prev) => prev.filter((b) => b.id !== id));
      showToast('Backup deleted');
    } catch (e) { showToast(e.message || 'Could not delete'); }
    finally { setBusyId(null); }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await apiPut('/api/school/settings/backup', schedule);
      showToast('Backup schedule saved ✓');
    } catch (e) { showToast(e.message || 'Could not save schedule'); }
    finally { setSavingSchedule(false); }
  };

  const totalSize = backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);

  return (
    <PageLayout title="Backup Management" subtitle="Snapshot and restore your school's data">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <BackButton onClick={() => navigate('/settings-billing')} label="Back to Settings" />
        <button onClick={createBackup} disabled={creating} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: creating ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: creating ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: creating ? 'default' : 'pointer', fontFamily: C.font }}>
          {creating ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-plus" size={14} />} Create Backup
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { n: backups.length, label: 'Total Backups', color: C.ink, icon: DatabaseBackup, ti: 'ti-database-export' },
          { n: formatSize(totalSize), label: 'Storage Used', color: BLUE, icon: HardDrive, ti: 'ti-server' },
          { n: schedule.autoBackup ? 'ON' : 'OFF', label: 'Auto Backup', color: schedule.autoBackup ? GREEN : C.muted2, icon: RefreshCw, ti: 'ti-refresh' },
        ].map((s) => (
          <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', minWidth: 150, flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: tint(8, s.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ico lucide={s.icon} ti={s.ti} size={17} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: C.font }}>{s.n}</div>
              <div style={{ fontSize: 11.5, color: C.muted2, fontFamily: C.font }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Backup history */}
        <div style={{ flex: '2 1 480px', minWidth: 320 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
              <Ico ti="ti-database-export" size={16} color={C.brand} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Backup History</span>
            </div>

            {loading ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : backups.length === 0 ? (
              <div style={{ padding: '30px 18px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No backups yet — click "Create Backup" to make one.</div>
            ) : (
              <div>
                {backups.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: b.type === 'auto' ? `${BLUE}14` : tint(8), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Ico ti="ti-database-export" size={16} color={b.type === 'auto' ? BLUE : C.brand} />
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <p style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: 0, fontFamily: C.font }}>{b.label}</p>
                      <p style={{ fontSize: 11, color: C.muted2, margin: '2px 0 0', fontFamily: C.font }}>
                        {formatDate(b.createdAt)} &nbsp;·&nbsp; {formatSize(b.sizeBytes)} &nbsp;·&nbsp; {b.recordCount} records
                      </p>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: b.status === 'completed' ? `${GREEN}15` : `${RED}12`, color: b.status === 'completed' ? GREEN : RED, fontSize: 11, fontWeight: 800, fontFamily: C.font, textTransform: 'capitalize' }}>
                      {b.status === 'completed' ? <Ico ti="ti-circle-check" size={11} /> : <Ico ti="ti-circle-x" size={11} />} {b.status}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: .5 }}>{b.type}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button title="Download" style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-download" size={13} /></button>
                      <button onClick={() => removeBackup(b.id)} disabled={busyId === b.id} title="Delete" style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {busyId === b.id ? <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-trash" size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Schedule sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Ico ti="ti-clock" size={15} color={BLUE} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Auto Backup Schedule</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>Enable Auto Backup</span>
              <Toggle on={schedule.autoBackup} onChange={(v) => setSchedule((s) => ({ ...s, autoBackup: v }))} />
            </div>

            <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Frequency</label>
            <select value={schedule.frequency} onChange={(e) => setSchedule((s) => ({ ...s, frequency: e.target.value }))} style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, boxSizing: 'border-box', marginBottom: 14, cursor: 'pointer' }}>
              {FREQUENCIES.map((f) => <option key={f} value={f} style={{ textTransform: 'capitalize' }}>{f[0].toUpperCase() + f.slice(1)}</option>)}
            </select>

            <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Retain backups for (days)</label>
            <input type="number" min={1} value={schedule.retentionDays} onChange={(e) => setSchedule((s) => ({ ...s, retentionDays: e.target.value }))} style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, boxSizing: 'border-box', marginBottom: 16 }} />

            <button onClick={saveSchedule} disabled={savingSchedule} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, border: 'none', background: savingSchedule ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: savingSchedule ? C.muted2 : '#fff', fontSize: 13, fontWeight: 800, cursor: savingSchedule ? 'default' : 'pointer', fontFamily: C.font }}>
              {savingSchedule ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {savingSchedule ? 'Saving…' : 'Save Schedule'}
            </button>
          </div>

          <div style={{ background: `${BLUE}0A`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '13px 15px', display: 'flex', gap: 9 }}>
            <Ico ti="ti-info-circle" size={15} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}>
              Backups older than your retention window are automatically pruned. Manual backups are never auto-deleted.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
