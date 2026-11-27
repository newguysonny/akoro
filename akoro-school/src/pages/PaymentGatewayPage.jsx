import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPut } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const PROVIDERS = ['-- Select a Gateway --', 'Paystack', 'Flutterwave', 'Stripe', 'Razorpay', 'PayPal'];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : C.border, position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}
function SectionBanner({ color, title }) {
  return (
    <div style={{ background: color, borderRadius: '10px 10px 0 0', padding: '10px 16px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', fontFamily: C.font }}>{title}</span>
    </div>
  );
}
const inputStyle = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`,
  outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, background: C.surface, boxSizing: 'border-box',
};

export default function PaymentGatewayPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState('-- Select a Gateway --');
  const [mode, setMode] = useState('sandbox');
  const [liveKeyId, setLiveKeyId] = useState('');
  const [liveKeySecret, setLiveKeySecret] = useState('');
  const [hasLiveKeySecret, setHasLiveKeySecret] = useState(false);
  const [sandboxKeyId, setSandboxKeyId] = useState('');
  const [sandboxKeySecret, setSandboxKeySecret] = useState('');
  const [hasSandboxKeySecret, setHasSandboxKeySecret] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [surchargeType, setSurchargeType] = useState('percentage');
  const [surchargeAmount, setSurchargeAmount] = useState(0);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/payment-gateway')
      .then((res) => {
        const d = res.data || {};
        setEnabled(!!d.enabled);
        setProvider(d.provider || PROVIDERS[0]);
        setMode(d.mode || 'sandbox');
        setLiveKeyId(d.liveKeyId || '');
        setHasLiveKeySecret(!!d.hasLiveKeySecret);
        setSandboxKeyId(d.sandboxKeyId || '');
        setHasSandboxKeySecret(!!d.hasSandboxKeySecret);
        setHasWebhookSecret(!!d.hasWebhookSecret);
        setSurchargeType(d.surchargeType || 'percentage');
        setSurchargeAmount(d.surchargeAmount ?? 0);
      })
      .catch((e) => showToast(e.message || 'Could not load payment gateway settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        enabled, provider: provider === PROVIDERS[0] ? '' : provider, mode,
        liveKeyId, sandboxKeyId, surchargeType, surchargeAmount,
      };
      if (liveKeySecret) body.liveKeySecret = liveKeySecret;
      if (sandboxKeySecret) body.sandboxKeySecret = sandboxKeySecret;
      if (webhookSecret) body.webhookSecret = webhookSecret;
      const res = await apiPut('/api/school/payment-gateway', body);
      setLiveKeySecret(''); setSandboxKeySecret(''); setWebhookSecret('');
      setHasLiveKeySecret(res.data.hasLiveKeySecret);
      setHasSandboxKeySecret(res.data.hasSandboxKeySecret);
      setHasWebhookSecret(res.data.hasWebhookSecret);
      showToast('Payment gateway settings saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Payment Gateway Settings" subtitle="Let parents pay school fees online">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 }}>
        <BackButton onClick={() => navigate('/settings-billing')} label="Back to Settings" />
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 480px', minWidth: 320 }}>
          <div style={{ background: C.surface, border: `1.5px solid ${tint(27)}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
              <Ico ti="ti-credit-card" size={16} color={C.brand} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Online Fee Collection</span>
            </div>

            <div style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 18, borderBottom: `1px solid ${C.border}` }}>
                <Toggle on={enabled} onChange={setEnabled} />
                <span style={{ fontSize: 12.5, color: C.ink, fontFamily: C.font }}>Allow parents to pay school fees online through the Parent Portal.</span>
              </div>

              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Payment Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 16 }}>
                {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
              </select>

              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Payment Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', borderColor: mode === 'live' ? C.brand : C.border }}>
                <option value="sandbox">Sandbox (Test Payments)</option>
                <option value="live">Live (Accept Real Payments)</option>
              </select>
            </div>

            {/* Live credentials */}
            <div style={{ margin: '0 20px 18px' }}>
              <SectionBanner color={GREEN} title="Live Credentials" />
              <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '16px' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Live Key ID / API Key</label>
                <input value={liveKeyId} onChange={(e) => setLiveKeyId(e.target.value)} placeholder="pk_live_..." style={{ ...inputStyle, marginBottom: 12 }} />
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Live Key Secret / API Secret</label>
                <input type="password" value={liveKeySecret} onChange={(e) => setLiveKeySecret(e.target.value)} placeholder={hasLiveKeySecret ? '•••••••••••••• (saved — enter to replace)' : 'sk_live_...'} style={inputStyle} />
              </div>
            </div>

            {/* Sandbox credentials */}
            <div style={{ margin: '0 20px 18px' }}>
              <SectionBanner color={C.brand} title="Sandbox Credentials" />
              <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '16px' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Sandbox Key ID / API Key</label>
                <input value={sandboxKeyId} onChange={(e) => setSandboxKeyId(e.target.value)} placeholder="pk_test_..." style={{ ...inputStyle, marginBottom: 12 }} />
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Sandbox Key Secret / API Secret</label>
                <input type="password" value={sandboxKeySecret} onChange={(e) => setSandboxKeySecret(e.target.value)} placeholder={hasSandboxKeySecret ? '•••••••••••••• (saved — enter to replace)' : 'sk_test_...'} style={inputStyle} />
              </div>
            </div>

            {/* Webhook */}
            <div style={{ margin: '0 20px 18px' }}>
              <SectionBanner color="#0EA5E9" title="Webhook Settings" />
              <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '16px' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Webhook Secret</label>
                <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={hasWebhookSecret ? '•••••••••••••• (saved — enter to replace)' : 'whsec_...'} style={inputStyle} />
                <p style={{ fontSize: 11, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>This is required to securely confirm payments.</p>
              </div>
            </div>

            {/* Surcharge */}
            <div style={{ padding: '0 20px 20px' }}>
              <p style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, margin: '0 0 4px', fontFamily: C.font }}>Online Payment Surcharge (Optional)</p>
              <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px', lineHeight: 1.55, fontFamily: C.font }}>You can add a surcharge to online payments to cover gateway fees. This will be added to the amount the parent pays.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Charge Type</label>
                  <select value={surchargeType} onChange={(e) => setSurchargeType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="percentage">Percentage (%)</option>
                    <option value="flat">Flat Amount</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Charge Amount / Percentage</label>
                  <input type="number" min={0} value={surchargeAmount} onChange={(e) => setSurchargeAmount(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 20px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
              <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
                {saving ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={15} />} {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>

        {/* Instructions sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <div style={{ background: BLUE, borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico ti="ti-info-circle" size={15} color="#fff" />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: C.font }}>Instructions</span>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}><b style={{ color: C.ink }}>Enable Online Payments:</b> Use the toggle switch to activate or deactivate the online fee payment feature for the parent portal.</p>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}><b style={{ color: C.ink }}>Payment Provider:</b> Select the payment gateway you wish to use from the list of available providers configured by the platform administrator.</p>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}><b style={{ color: C.ink }}>Payment Mode:</b> Choose 'Sandbox' to test payments with fake card details. Switch to 'Live' to start accepting real money from parents.</p>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}><b style={{ color: C.ink }}>Credentials:</b> Enter the API Keys provided by your payment gateway for both Live and Sandbox modes. These are stored securely.</p>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}><b style={{ color: C.ink }}>Webhook Secret:</b> This is a crucial security key from your gateway's dashboard. It ensures that payment confirmation messages are authentic.</p>
          </div>
        </div>
      </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
