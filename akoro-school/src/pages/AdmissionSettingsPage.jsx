import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {Wallet, ListChecks, HelpCircle, Plus, Pencil, Trash2, Save, Loader2, Share2, Copy, ExternalLink, Info, Download, QrCode as QrCodeIcon, School } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, apiPost, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';
import { ADMISSION_BASE_URL } from '../config/urls.js';
import { WalletPanel } from '../shared/WalletShell.jsx';

const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'file', 'textarea', 'checkbox'];
const FIELD_TYPE_LABEL = { text: 'Text Input', number: 'Number', date: 'Date', dropdown: 'Dropdown', file: 'File', textarea: 'Textarea', checkbox: 'Checkbox' };

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : '#D8D5CE', position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}
const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${BORDER}`,
  outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
};

export default function AdmissionSettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState('');

  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState('');
  const [feeAmount, setFeeAmount] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [fields, setFields] = useState([]);
  const [copied, setCopied] = useState(false);

  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');
  const [newOptions, setNewOptions] = useState('');
  const [newRequired, setNewRequired] = useState(false);
  const [addingField, setAddingField] = useState(false);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/admission')
      .then((res) => {
        const s = res.data?.settings || {};
        setEnabled(!!s.enabled);
        setSlug(s.slug || '');
        setFeeAmount(s.feeAmount ?? 0);
        setQrCodeUrl(s.qrCodeUrl || null);
        setFields(res.data?.fields || []);
      })
      .catch((e) => showToast(e.message || 'Could not load admission settings'))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await apiPut('/api/school/admission/settings', { enabled, slug, feeAmount, qrCodeUrl });
      setSlug(res.data.slug || '');
      showToast('Settings saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSavingSettings(false); }
  };

  const addField = async () => {
    if (!newLabel.trim()) return;
    setAddingField(true);
    try {
      const res = await apiPost('/api/school/admission/fields', {
        label: newLabel.trim(), type: newType,
        options: newType === 'dropdown' ? newOptions.split(',').map((o) => o.trim()).filter(Boolean) : [],
        required: newRequired, sortOrder: fields.length,
      });
      setFields((prev) => [...prev, res.data]);
      setNewLabel(''); setNewType('text'); setNewOptions(''); setNewRequired(false);
    } catch (e) { showToast(e.message || 'Could not add field'); }
    finally { setAddingField(false); }
  };

  const removeField = async (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    try { await apiDelete(`/api/school/admission/fields/${id}`); } catch { /* already removed locally */ }
  };

  const admissionUrl = `${ADMISSION_BASE_URL}/${slug || 'your-school'}`;
  const copyLink = () => {
    navigator.clipboard?.writeText(admissionUrl);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <PageLayout title="Admission Form Configuration" subtitle="Set up your public admission form and fee">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <HelpCircle size={14} /> How it Works
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
      <>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 20 }}>
        {/* Fee & Payment Settings */}
        <WalletPanel style={{ flex: '1 1 320px', minWidth: 300, padding: '18px 20px', marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Wallet size={16} color={AMBER} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Fee &amp; Payment Settings</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Toggle on={enabled} onChange={setEnabled} />
            <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Enable Admission Fee</span>
          </div>

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Custom Public URL Slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-school-name" style={{ ...inputStyle, marginBottom: 6 }} />
          <p style={{ fontSize: 11, color: MUTED2, margin: '0 0 16px', fontFamily: FONT }}>
            This will be your admission link: {ADMISSION_BASE_URL.replace(/^https?:\/\//, '')}/<b style={{ color: INK }}>{slug || 'your-school'}</b>
          </p>

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Fee Amount (₦)</label>
          <input type="number" min={0} value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Payment QR Code (UPI)</label>
          <div style={{ width: 96, height: 96, borderRadius: 10, border: `1.5px dashed ${BORDER}`, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden' }}>
            {qrCodeUrl ? <img src={qrCodeUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <QrCodeIcon size={26} color={MUTED2} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <button style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${BORDER}`, background: LIGHT, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Choose file…</button>
            <button style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Browse</button>
          </div>
          <p style={{ fontSize: 11, color: MUTED2, margin: '0 0 18px', fontFamily: FONT }}>Upload your GPay/PhonePe/Paytm QR Code image. (png, jpg — max 2MB)</p>

          <button onClick={saveSettings} disabled={savingSettings} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, border: 'none', background: savingSettings ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: savingSettings ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: savingSettings ? 'default' : 'pointer', fontFamily: FONT }}>
            {savingSettings ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {savingSettings ? 'Saving…' : 'Save Settings'}
          </button>
        </WalletPanel>

        {/* Custom Form Fields */}
        <WalletPanel style={{ flex: '1.3 1 400px', minWidth: 320, padding: '18px 20px', marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ListChecks size={16} color={BLUE} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Custom Form Fields</span>
          </div>

          <div style={{ background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
            <p style={{ fontSize: 12, fontWeight: 800, color: INK, margin: '0 0 10px', fontFamily: FONT }}>Add New Field</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Field Label (e.g. Blood Group)" style={inputStyle} />
              <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </select>
              <input value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="Options (comma-sep)" disabled={newType !== 'dropdown'} style={{ ...inputStyle, background: newType !== 'dropdown' ? '#EFEDE8' : WHITE }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: INK, fontFamily: FONT, cursor: 'pointer' }}>
                <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} style={{ width: 14, height: 14, accentColor: AMBER, cursor: 'pointer' }} /> Required Field
              </label>
              <button onClick={addField} disabled={addingField || !newLabel.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: 'none', background: GREEN, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: newLabel.trim() ? 'pointer' : 'not-allowed', fontFamily: FONT, opacity: newLabel.trim() ? 1 : .6 }}>
                {addingField ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={13} />} Add
              </button>
            </div>
          </div>

          {fields.length === 0 ? (
            <div style={{ padding: '18px', textAlign: 'center', color: MUTED2, fontSize: 12.5, fontFamily: FONT, border: `1.5px dashed ${BORDER}`, borderRadius: 10 }}>No custom fields yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 420 }}>
                <thead>
                  <tr style={{ background: LIGHT }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>ORDER</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>LABEL</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>TYPE</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>REQUIRED</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '9px 10px', fontSize: 12.5, color: MUTED2 }}>{f.sortOrder}</td>
                      <td style={{ padding: '9px 10px', fontSize: 12.5, fontWeight: 700, color: INK }}>{f.label}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ padding: '3px 9px', borderRadius: 999, background: `${BLUE}12`, color: BLUE, fontSize: 11, fontWeight: 700 }}>{f.type}</span>
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ padding: '3px 9px', borderRadius: 999, background: f.required ? `${AMBER}15` : LIGHT, color: f.required ? AMBER : MUTED2, fontSize: 11, fontWeight: 700 }}>{f.required ? 'Yes' : 'No'}</span>
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: `${BLUE}15`, color: BLUE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Pencil size={12} /></button>
                          <button onClick={() => removeField(f.id)} style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: `${RED}12`, color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WalletPanel>
      </div>

      {/* Smart Share & Digital Card */}
      <WalletPanel style={{ borderTop: `3px solid ${AMBER}`, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Share2 size={16} color={AMBER} />
          <span style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: FONT }}>Smart Share &amp; Digital Card</span>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1.3 1 320px', minWidth: 280 }}>
            <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Direct Admission Link</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <input readOnly value={admissionUrl} style={{ ...inputStyle, flex: 1, minWidth: 200, color: MUTED }} />
              <button onClick={copyLink} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: 'none', background: '#7C3AED', color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                <Copy size={12} /> {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <button style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: WHITE, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, marginBottom: 18 }}>
              <ExternalLink size={13} /> Preview Admission Form
            </button>

            <div style={{ display: 'flex', gap: 9, background: `${BLUE}0A`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '12px 14px' }}>
              <Info size={15} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 6px', fontFamily: FONT }}>Instructions</p>
                <p style={{ fontSize: 12, color: MUTED, margin: '0 0 6px', lineHeight: 1.55, fontFamily: FONT }}>Use the Digital Card on the right to promote admissions. You can:</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: MUTED, lineHeight: 1.7, fontFamily: FONT }}>
                  <li>Share on WhatsApp Status or Groups.</li>
                  <li>Print and stick it on your Notice Board.</li>
                  <li>Attach it to your email signature.</li>
                </ul>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 260px', maxWidth: 300 }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, textAlign: 'center', margin: '0 0 10px', fontFamily: FONT }}>Digital Admission Card</p>
            <div style={{ background: `linear-gradient(160deg, #4338CA, #7C3AED)`, borderRadius: 16, padding: '20px 18px', textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: WHITE, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#7C3AED' }}><School size={18} color="#7C3AED" /></div>
              <p style={{ fontSize: 15, fontWeight: 800, color: WHITE, margin: '0 0 2px', fontFamily: FONT }}>Akoro Demo Academy</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', margin: '0 0 16px', fontFamily: FONT }}>Admissions Open 2026-27</p>
              <div style={{ background: WHITE, borderRadius: 10, padding: 12, display: 'inline-block', marginBottom: 12 }}>
                <QrCodeIcon size={100} color={INK} />
              </div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: WHITE, margin: '0 0 2px', fontFamily: FONT }}>Scan to Apply Online</p>
              <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,.65)', margin: '0 0 14px', fontFamily: FONT }}>Scan using Camera, Google Lens or UPI App</p>
              <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,.5)', margin: '0 0 14px', fontFamily: FONT }}>Powered by Akoro School Management</p>
              <button style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px', borderRadius: 9, border: 'none', background: GREEN, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                <Download size={13} /> Download Card Image
              </button>
            </div>
          </div>
        </div>
      </WalletPanel>
      </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
