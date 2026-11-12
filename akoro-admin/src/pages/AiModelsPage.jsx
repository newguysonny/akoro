/**
 * AiModelsPage — the platform's AI model switch.
 *
 *   GET    /api/admin/ai/model   env default, runtime override, effective values, catalogue
 *   PUT    /api/admin/ai/model   { defaultModel, fallbackModel? }
 *   DELETE /api/admin/ai/model   back to the env defaults
 *
 * This is the SERVER default (what a call uses when nothing else decides).
 * The learner-facing picker is separate and unchanged. A change applies to new
 * calls immediately — in-flight calls finish on their model — and is persisted,
 * so it survives a restart. With the runtime switch turned off in the
 * environment (AI_RUNTIME_OVERRIDE), Save/Reset are disabled and the env value
 * is the only default.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, RefreshCw, Save, Undo2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPut, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 };
const label = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED2, marginBottom: 6 };
const field = { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, color: INK, background: WHITE };
const btn = (bg, color = WHITE) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 10, padding: '10px 14px', background: bg, color, fontSize: 12.5, fontWeight: 800, fontFamily: FONT, cursor: 'pointer' });

function Chip({ tone = 'ok', children }) {
  const map = { ok: [GREEN, 'rgba(16,185,129,.10)'], warn: [AMBER, 'rgba(245,158,11,.12)'], bad: [RED, 'rgba(239,68,68,.10)'], info: [BLUE, 'rgba(59,130,246,.10)'] };
  const [fg, bg] = map[tone] || map.info;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 100, background: bg, color: fg, fontSize: 11, fontWeight: 800 }}>{children}</span>;
}

export default function AiModelsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [defaultModel, setDefaultModel] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [roleDraft, setRoleDraft] = useState({});
  const [featureDraft, setFeatureDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await apiGet('/api/admin/ai/model');
      setData(d);
      setDefaultModel(d?.effective?.defaultModel || d?.env?.defaultModel || '');
      setFallbackModel(d?.runtime?.fallbackModel || '');
      setRoleDraft({ ...(d?.runtime?.roleModels || {}) });
      setFeatureDraft({ ...(d?.runtime?.featureModels || {}) });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const models = data?.models ?? [];
  const pickable = useMemo(() => models.filter((m) => m.selectable), [models]);
  const callable = useMemo(() => pickable.filter((m) => m.enabled && m.availability?.available), [pickable]);
  // Role/feature overrides may point at a hidden failover route too.
  const assignable = useMemo(() => models.filter((m) => m.enabled && m.availability?.available), [models]);
  const enabled = data?.runtimeOverrideEnabled !== false;
  const effective = data?.effective?.defaultModel || '—';
  const envDefault = data?.env?.defaultModel || '—';
  const runtimeDefault = data?.runtime?.defaultModel || '';
  const runtimeFallback = data?.runtime?.fallbackModel || '';
  const runtimeRoles = data?.runtime?.roleModels || {};
  const runtimeFeatures = data?.runtime?.featureModels || {};
  const sameMap = (a, b) => JSON.stringify(Object.entries(a).filter(([, v]) => v).sort()) ===
    JSON.stringify(Object.entries(b).filter(([, v]) => v).sort());
  const dirty = defaultModel !== (runtimeDefault || envDefault)
    || fallbackModel !== (runtimeFallback || '')
    || !sameMap(roleDraft, runtimeRoles)
    || !sameMap(featureDraft, runtimeFeatures);
  const invalid = !defaultModel || (fallbackModel && fallbackModel === defaultModel);

  const save = async () => {
    if (invalid) { setToast({ type: 'error', message: 'Pick a default model, and a fallback that is different from it.' }); return; }
    setSaving(true);
    try {
      const roleModels = Object.fromEntries(Object.entries(roleDraft).filter(([, v]) => v));
      const featureModels = Object.fromEntries(Object.entries(featureDraft).filter(([, v]) => v));
      await apiPut('/api/admin/ai/model', { defaultModel, fallbackModel: fallbackModel || null, roleModels, featureModels });
      setToast({ type: 'success', message: 'AI model settings updated — new calls use them now.' });
      await load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm('Clear the runtime override and go back to the environment default?')) return;
    setSaving(true);
    try {
      await apiDelete('/api/admin/ai/model');
      setRoleDraft({}); setFeatureDraft({});
      setToast({ type: 'success', message: 'All runtime overrides cleared — back to env defaults.' });
      await load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setSaving(false); }
  };

  const modelLabel = (id) => models.find((m) => m.id === id)?.label || id || '—';

  return (
    <PageLayout
      title="AI model"
      subtitle="The platform default used when a call does not choose a model. The learner picker is separate."
      action={<button onClick={load} style={btn(LIGHT, INK)}><RefreshCw size={14}/> Refresh</button>}
    >
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton height={110} /><Skeleton height={220} />
        </div>
      ) : error ? (
        <div style={{ ...card, borderColor: 'rgba(239,68,68,.35)', color: RED, fontSize: 13 }}>{error}</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {!enabled && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,.4)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color={AMBER} style={{ marginTop: 2 }} />
              <div style={{ fontSize: 13, color: INK, lineHeight: 1.5 }}>
                Runtime overrides are <strong>off</strong> (<code>AI_RUNTIME_OVERRIDE</code>).
                The environment default is in force and this page can only read it.
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
            {[
              { k: 'Effective default', v: modelLabel(effective), sub: runtimeDefault ? 'runtime override' : 'from the environment', tone: runtimeDefault ? 'info' : 'ok' },
              { k: 'Environment default', v: modelLabel(envDefault), sub: 'AI_MODEL_DEFAULT', tone: 'ok' },
              { k: 'Runtime override', v: runtimeDefault ? modelLabel(runtimeDefault) : 'none', sub: runtimeDefault ? 'persisted' : 'using env', tone: runtimeDefault ? 'info' : 'warn' },
              { k: 'Fallback', v: modelLabel(data?.effective?.fallbackModel), sub: 'when the provider fails', tone: 'ok' },
            ].map((x) => (
              <div key={x.k} style={card}>
                <div style={label}>{x.k}</div>
                <div style={{ fontSize: 19, fontWeight: 900, color: INK, fontFamily: FONT, marginBottom: 4 }}>{x.v}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{x.sub}</div>
                <div style={{ marginTop: 8 }}><Chip tone={x.tone}>{x.tone === 'warn' ? 'env' : x.tone === 'info' ? 'runtime' : 'active'}</Chip></div>
              </div>
            ))}
          </div>

          <div style={{ ...card, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={16} color={BLUE} />
              <strong style={{ fontSize: 14, color: INK, fontFamily: FONT }}>Change the default</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={label}>Default model</div>
                <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} disabled={!enabled} style={field}>
                  {pickable.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.enabled || !m.availability?.available}>
                      {m.label} ({m.id}){m.availability?.available ? '' : ` — ${m.availability?.reason || 'unavailable'}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={label}>Fallback (optional)</div>
                <select value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} disabled={!enabled} style={field}>
                  <option value="">Environment / global fallback</option>
                  {callable.filter((m) => m.id !== defaultModel).map((m) => (
                    <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={save} disabled={!enabled || saving || invalid || !dirty} style={{ ...btn(BLUE), opacity: (!enabled || saving || invalid || !dirty) ? .5 : 1 }}>
                <Save size={14}/> {saving ? 'Saving…' : 'Save default'}
              </button>
              <button onClick={reset} disabled={!enabled || saving || (!runtimeDefault && !runtimeFallback)} style={{ ...btn(LIGHT, INK), opacity: (!enabled || saving || (!runtimeDefault && !runtimeFallback)) ? .5 : 1 }}>
                <Undo2 size={14}/> Reset to env
              </button>
              {dirty && !invalid && <span style={{ fontSize: 11.5, color: AMBER }}>Unsaved change</span>}
              {invalid && <span style={{ fontSize: 11.5, color: RED }}>A fallback must differ from the default.</span>}
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55 }}>
              Applies to <strong>new calls only</strong>; in-flight calls finish on their model. Persisted in
              <code> edu.ai_runtime_settings</code> and audited. The environment default stays as the floor for a reset.
            </div>
          </div>

          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 13.5, color: INK, fontFamily: FONT }}>Catalogue</strong>
              <span style={{ fontSize: 11.5, color: MUTED }}>{callable.length} callable of {pickable.length} pickable</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: MUTED2 }}>
                    {['Model', 'id', 'Provider', 'Availability', 'Fallback', ''].map((h) => (
                      <th key={h} style={{ padding: '10px 14px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const isDefault = m.id === effective;
                    const hasRuntime = m.id === runtimeDefault;
                    return (
                      <tr key={m.id} style={{ background: isDefault ? 'rgba(59,130,246,.04)' : 'transparent' }}>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, fontWeight: 800, color: INK }}>{m.label}</td>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, color: MUTED, fontFamily: 'monospace' }}>{m.id}</td>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{m.provider}</td>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}` }}>
                          {m.availability?.available
                            ? <Chip tone="ok"><CheckCircle2 size={11}/> available</Chip>
                            : <Chip tone="bad"><XCircle size={11}/> {m.availability?.reason || 'unavailable'}</Chip>}
                          {!m.enabled && <Chip tone="warn">disabled</Chip>}
                        </td>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{m.fallbackModel || '—'}</td>
                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}` }}>
                          {isDefault && <Chip tone={hasRuntime ? 'info' : 'ok'}>{hasRuntime ? 'runtime default' : 'env default'}</Chip>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
                <strong style={{ fontSize: 13.5, color: INK, fontFamily: FONT }}>Roles</strong>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>What each kind of call resolves to. Locked roles ignore learner picks; they use their env or the platform default.</div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {(data?.roles || []).map((r) => (
                    <tr key={r.role}>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, fontWeight: 800, color: INK }}>{r.role}{r.locked && <Chip tone="warn">locked</Chip>}</td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{r.label} <span style={{ fontFamily: 'monospace', color: MUTED2 }}>({r.model})</span></td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, minWidth: 190 }}>
                        <select value={roleDraft[r.role] || ''} disabled={!enabled}
                          onChange={(e) => setRoleDraft((d) => ({ ...d, [r.role]: e.target.value }))}
                          style={{ ...field, padding: '6px 8px', fontSize: 11.5 }}>
                          <option value="">Env / default</option>
                          {assignable.filter((m) => (r.caps || []).every((c) => m.caps?.[c])).map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}><Chip tone={r.source === 'default' ? 'ok' : 'info'}>{r.source}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
                <strong style={{ fontSize: 13.5, color: INK, fontFamily: FONT }}>Feature models</strong>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>Helpers that name a model directly. “Pinned” ones do not follow the platform default.</div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {(data?.features || []).map((f) => (
                    <tr key={f.key}>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, fontWeight: 800, color: INK }}>{f.label}</td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{f.modelId || '—'}</td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, minWidth: 180 }}>
                        <select value={featureDraft[f.key] || ''} disabled={!enabled}
                          onChange={(e) => setFeatureDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          style={{ ...field, padding: '6px 8px', fontSize: 11.5 }}>
                          <option value="">Env / fallback</option>
                          {assignable.filter((m) => (f.requires || []).every((c) => m.caps?.[c])).map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}>
                        {f.source === "default" ? <Chip tone="ok">follows default</Chip>
                          : f.source === "env" ? <Chip tone="warn">env override</Chip>
                            : f.source === "preference" ? <Chip tone="info">prefers DeepSeek</Chip>
                              : <Chip tone="warn">pinned</Chip>}
                        {f.envSet && <span style={{ fontSize: 10.5, color: MUTED2, marginLeft: 6, fontFamily: 'monospace' }}>{f.env}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
