import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Download, Loader2, Globe, AlertTriangle, MapPin, Sparkles } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Toast } from '../components/Primitives.jsx';
import { API, apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const TARGETS = [
  { key: 'osm',         label: 'OpenStreetMap',   note: 'Free — best school coverage', supported: true },
  { key: 'google_maps', label: 'Google Maps',     note: 'Needs Google Places key',     supported: true },
  { key: 'yelp',        label: 'Yelp',            note: 'Needs Yelp API key',           supported: true },
  { key: 'yellow_pages',label: 'Yellow Pages',    note: 'No API — will be skipped',     supported: false },
  { key: 'instagram',   label: 'Instagram',       note: 'Blocked — will be skipped',    supported: false },
  { key: 'facebook',    label: 'Facebook',        note: 'Blocked — will be skipped',    supported: false },
  { key: 'twitter',     label: 'X / Twitter',     note: 'Paid API — will be skipped',   supported: false },
];

const STATUS_STYLE = {
  none:     { bg: `${RED}18`,   fg: RED,   label: 'No website' },
  dead:     { bg: `${RED}12`,   fg: RED,   label: 'Dead site' },
  outdated: { bg: `${AMBER}18`, fg: '#B45309', label: 'Outdated' },
  ok:       { bg: `${GREEN}14`, fg: GREEN, label: 'Modern' },
};

export default function MarketingPage() {
  const [businessType, setBusinessType] = useState('Schools');
  const [location, setLocation] = useState('');
  const [targets, setTargets] = useState(['osm']);
  const [limit, setLimit] = useState(100);
  const [weakOnly, setWeakOnly] = useState(true);

  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const toggleTarget = (k) => setTargets((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));

  const poll = useCallback(async (id) => {
    try {
      const j = await apiGet(`/api/admin/marketing/jobs/${id}`);
      setJob(j);
      if (j.status === 'done' || j.status === 'error') { clearInterval(pollRef.current); pollRef.current = null; }
    } catch { /* keep polling */ }
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const start = async () => {
    if (!location.trim()) { showToast('Enter a location (city, state, country)', 'error'); return; }
    if (!targets.length)  { showToast('Pick at least one source', 'error'); return; }
    setStarting(true); setJob(null);
    try {
      const res = await apiPost('/api/admin/marketing/jobs', {
        business_type: businessType, location: location.trim(), targets, limit: Number(limit),
        weak_websites_only: weakOnly,
      });
      if (!res?.id) throw new Error(res?.message || 'Could not start job');
      setJob({ id: res.id, status: res.status || 'running', leads: [], warnings: [] });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(res.id), 3000);
    } catch (e) {
      showToast(e.message || 'Could not start job', 'error');
    } finally { setStarting(false); }
  };

  const downloadCsv = () => {
    if (job?.status !== 'done') return;
    window.open(`${API}/api/admin/marketing/jobs/${job.id}/csv`, '_blank');
  };

  const busy = job && job.status !== 'done' && job.status !== 'error';
  const leads = job?.leads || [];

  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, verticalAlign: 'top' };
  const inp = { width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };

  return (
    <PageLayout title="Marketing — Lead Finder" subtitle="Find schools to pitch — surfaces those with no website or an outdated one">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Search form */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED2, display: 'block', marginBottom: 5 }}>Business type</label>
              <input value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="Schools, colleges…" style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED2, display: 'block', marginBottom: 5 }}>Location</label>
              <div style={{ position: 'relative' }}>
                <MapPin size={14} color={MUTED2} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ikeja, Lagos, Nigeria" style={{ ...inp, paddingLeft: 32 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED2, display: 'block', marginBottom: 5 }}>Max results</label>
              <input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} style={inp} />
            </div>
          </div>

          <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED2, display: 'block', marginBottom: 8 }}>Sources</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {TARGETS.map((t) => {
              const on = targets.includes(t.key);
              return (
                <button key={t.key} onClick={() => toggleTarget(t.key)} title={t.note}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 700,
                    border: `1.5px solid ${on ? AMBER : BORDER}`, background: on ? `${AMBER}14` : WHITE, color: on ? '#B45309' : (t.supported ? INK : MUTED2), opacity: t.supported ? 1 : 0.7 }}>
                  {!t.supported && <AlertTriangle size={12} />}{t.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: INK, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} style={{ accentColor: AMBER }} />
              Weak / no website only (best pitch targets)
            </label>
            <button onClick={start} disabled={starting || busy}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: (starting || busy) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (starting || busy) ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: (starting || busy) ? 'default' : 'pointer', fontFamily: FONT }}>
              {starting || busy ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Sparkles size={15} />}
              {busy ? (job.status === 'auditing' ? 'Auditing websites…' : 'Finding leads…') : 'Find leads'}
            </button>
          </div>
        </div>

        {/* Warnings */}
        {job?.warnings?.length > 0 && (
          <div style={{ background: `${AMBER}0E`, border: `1px solid ${AMBER}44`, borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
            {job.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#92400E', fontFamily: FONT, display: 'flex', gap: 7, alignItems: 'center' }}>
                <AlertTriangle size={12} /> {w}
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {job && (
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>
                {busy ? 'Working…' : `${leads.length} lead${leads.length === 1 ? '' : 's'}`}
              </span>
              <button onClick={downloadCsv} disabled={job.status !== 'done' || !leads.length}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, border: `1px solid ${GREEN}44`, background: `${GREEN}0C`, color: GREEN, fontSize: 12, fontWeight: 700, cursor: (job.status === 'done' && leads.length) ? 'pointer' : 'not-allowed', opacity: (job.status === 'done' && leads.length) ? 1 : 0.5, fontFamily: FONT }}>
                <Download size={14} /> Export CSV
              </button>
            </div>

            {busy ? (
              <div style={{ padding: 48, textAlign: 'center', color: MUTED2 }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : leads.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontFamily: FONT, fontSize: 13 }}>No leads found. Try a broader location or different sources.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
                  <thead><tr>
                    <th style={th}>SCHOOL</th><th style={th}>WEBSITE</th><th style={th}>WHY PITCH</th>
                    <th style={{ ...th, textAlign: 'center' }}>SCORE</th><th style={th}>CONTACT</th><th style={th}>SOURCE</th>
                  </tr></thead>
                  <tbody>
                    {leads.map((l, i) => {
                      const st = STATUS_STYLE[l.website_status] || STATUS_STYLE.ok;
                      return (
                        <tr key={i}>
                          <td style={{ ...td, fontWeight: 700 }}>{l.name}<div style={{ fontSize: 11, color: MUTED2, fontWeight: 400 }}>{l.address || '—'}</div></td>
                          <td style={td}>
                            <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: st.bg, color: st.fg, fontSize: 11, fontWeight: 800 }}>{st.label}</span>
                            {l.website && <div style={{ marginTop: 4 }}><a href={l.website} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: BLUE, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Globe size={11} /> visit</a></div>}
                          </td>
                          <td style={{ ...td, maxWidth: 260, fontSize: 12, color: MUTED }}>{(l.reasons || []).join('; ') || '—'}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 800, color: l.pitch_score >= 70 ? RED : l.pitch_score >= 50 ? '#B45309' : MUTED2 }}>{l.pitch_score ?? '—'}</td>
                          <td style={{ ...td, fontSize: 12 }}>{l.phone || '—'}</td>
                          <td style={{ ...td, fontSize: 11.5, color: MUTED2 }}>{l.source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </PageLayout>
  );
}
