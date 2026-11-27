/** Shared mgmt helpers: ModuleSettingsForm (jsonb per-module settings) + GuidePage. */
import { useState, useEffect } from 'react';
import { PageLayout } from '../Layout.jsx';
import { FieldInput } from './ResourcePage.jsx';
import { apiGet, apiPut } from '../../services/api.js';
import { BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';

export function ModuleSettingsForm({ module, title, subtitle, fields }) {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet(`${BASE}/module-settings/${module}`)
      .then((r) => setForm(r.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [module]);

  const save = async () => {
    setSaving(true);
    try { await apiPut(`${BASE}/module-settings/${module}`, form); showToast('Settings saved ✓'); }
    catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title={title} subtitle={subtitle}>
      <div style={{ maxWidth: 520, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', fontFamily: C.font }}>
        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : (
          <>
            {fields.map((f) => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 5 }}>{f.label}</label>
                <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))} optionLists={{}} />
                {f.hint && <p style={{ fontSize: 11, color: C.muted2, margin: '5px 0 0' }}>{f.hint}</p>}
              </div>
            ))}
            <button onClick={save} disabled={saving} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
              {saving ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </>
        )}
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function GuidePage({ title, subtitle, sections }) {
  return (
    <PageLayout title={title} subtitle={subtitle}>
      <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sections.map((s, i) => (
          <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', fontFamily: C.font }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ico ti="ti-book" size={15} color={BLUE} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{s.h}</span>
            </div>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.65, margin: 0 }}>{s.p}</p>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
