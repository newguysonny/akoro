import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, ArrowLeft, Copy, Pencil, Trash2, Plus, Info, ShieldCheck,
  CheckCircle2, Clock, RefreshCw, X, ArrowRight, Loader2,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

function DomainRow({ domain, sub, verified, onCopy, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', flexWrap: 'wrap' }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${BLUE}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Globe size={16} color={BLUE} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{ fontSize: 13.5, fontWeight: 800, color: INK, margin: 0, fontFamily: FONT }}>{domain}</p>
        <p style={{ fontSize: 11, color: MUTED2, margin: '2px 0 0', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ArrowRight size={10} /> {sub}
        </p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8, background: verified ? `${GREEN}15` : `${AMBER}15`, color: verified ? GREEN : AMBER, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>
        {verified ? <CheckCircle2 size={12} /> : <Clock size={12} />} {verified ? 'Verified' : 'Pending DNS'}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onCopy} title="Copy" style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Copy size={14} /></button>
        {onDelete && <button onClick={onDelete} title="Remove" style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}

export default function DomainPage() {
  const navigate = useNavigate();
  const [defaultDomain, setDefaultDomain] = useState('');
  const [customDomains, setCustomDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const inputStyle = {
    width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`,
    outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
  };

  const load = useCallback(() => {
    apiGet('/api/school/domains')
      .then((res) => { setDefaultDomain(res.data.defaultDomain); setCustomDomains(res.data.customDomains || []); })
      .catch((e) => showToast(e.message || 'Could not load domains'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const copyDefault = () => {
    navigator.clipboard?.writeText(`https://${defaultDomain}`);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const addDomain = async () => {
    const d = newDomain.trim().toLowerCase();
    if (!d) return;
    try {
      const res = await apiPost('/api/school/domains', { domain: d });
      setCustomDomains((prev) => [...prev, res.data]);
      setNewDomain(''); setAdding(false);
    } catch (e) { showToast(e.message || 'Could not add domain'); }
  };

  const verify = async (id) => {
    setBusyId(id);
    try {
      const res = await apiPost(`/api/school/domains/${id}/verify`, {});
      if (res.verified) setCustomDomains((prev) => prev.map((d) => (d.id === id ? { ...d, verified: true } : d)));
      showToast(res.message);
    } catch (e) { showToast(e.message || 'Could not verify domain'); }
    finally { setBusyId(null); }
  };

  const remove = async (id) => {
    setCustomDomains((prev) => prev.filter((d) => d.id !== id));
    try { await apiDelete(`/api/school/domains/${id}`); } catch { /* already removed locally */ }
  };

  return (
    <PageLayout title="Domain" subtitle="Manage your school website's domains">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 }}>
        <button onClick={() => navigate('/settings-billing')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Settings
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 420px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ background: WHITE, border: `1.5px solid ${BLUE}33`, borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Globe size={16} color={BLUE} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Public Networking</span>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', fontFamily: FONT, lineHeight: 1.6 }}>
              Access your school website over HTTPS with the following domain.
            </p>

            {loading ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : (
              <>
                <DomainRow domain={defaultDomain} sub="School Website" verified onCopy={copyDefault} />
                {copied && <p style={{ fontSize: 11.5, color: GREEN, margin: '8px 0 0', fontFamily: FONT, fontWeight: 700 }}>Copied to clipboard ✓</p>}

                {customDomains.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    {customDomains.map((d) => (
                      <div key={d.id}>
                        <DomainRow domain={d.domain} sub="School Website" verified={d.verified}
                          onCopy={() => { navigator.clipboard?.writeText(`https://${d.domain}`); }}
                          onDelete={() => remove(d.id)} />
                        {!d.verified && (
                          <div style={{ marginTop: 8, background: `${AMBER}0C`, border: `1px solid ${AMBER}33`, borderRadius: 10, padding: '10px 13px' }}>
                            <p style={{ fontSize: 11.5, color: INK, margin: '0 0 8px', fontFamily: FONT, fontWeight: 700 }}>Add this DNS record to verify ownership:</p>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, fontFamily: 'ui-monospace, Menlo, monospace', color: MUTED, marginBottom: 10 }}>
                              <span><b style={{ color: INK }}>Type:</b> CNAME</span>
                              <span><b style={{ color: INK }}>Name:</b> {d.domain.split('.')[0]}</span>
                              <span><b style={{ color: INK }}>Value:</b> {d.cnameTarget || 'cname.akoro.app'}</span>
                            </div>
                            <button onClick={() => verify(d.id)} disabled={busyId === d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, border: 'none', background: AMBER, color: WHITE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                              {busyId === d.id ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <RefreshCw size={12} />} Verify DNS
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 16 }}>
              {!adding ? (
                <button onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${AMBER}66`, background: `${AMBER}0C`, color: AMBER, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                  <Plus size={14} /> Custom Domain
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="www.yourschool.com" style={{ ...inputStyle, flex: 1, minWidth: 200 }} autoFocus />
                  <button onClick={addDomain} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Add</button>
                  <button onClick={() => { setAdding(false); setNewDomain(''); }} style={{ width: 38, height: 38, borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Setup guide sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: BLUE, borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color={WHITE} />
            <span style={{ fontSize: 13, fontWeight: 800, color: WHITE, fontFamily: FONT }}>Setup Guide</span>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px', marginTop: -14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 1:</b> Click “Custom Domain” and enter your domain (e.g. www.yourschool.com).</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 2:</b> Copy the CNAME record shown and add it in your domain registrar’s DNS settings.</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 3:</b> DNS changes can take up to 24 hours to propagate.</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 4:</b> Click “Verify DNS” once the record is live to activate HTTPS.</p>
            </div>
          </div>

          <div style={{ background: `${AMBER}0C`, border: `1px solid ${AMBER}33`, borderLeft: `3px solid ${AMBER}`, borderRadius: 10, padding: '13px 15px', display: 'flex', gap: 9 }}>
            <ShieldCheck size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}>
              <b style={{ color: INK }}>SSL:</b> Certificates are issued and renewed automatically once your domain is verified. No extra configuration needed.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
