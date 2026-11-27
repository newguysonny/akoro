/**
 * WebsiteAiSyncPage — AI website sync, one page/section at a time.
 *
 * The loop lives HERE rather than behind one big backend call, so the progress
 * bar reflects work that actually finished: each unit is its own request, and
 * stopping midway keeps everything already written.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { inputStyle } from '../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPatch } from '../services/api.js';
import { uploadFile } from '../services/uploadApi.js';
import { Link } from 'react-router-dom';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { confirmDialog } from '../components/ConfirmHost.jsx';

export default function WebsiteAiSyncPage() {
  const [plan, setPlan] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [done, setDone] = useState({});        // key -> 'ok' | 'error'
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(null);
  const [coins, setCoins] = useState(0);
  const [note, setNote] = useState('');
  const [openField, setOpenField] = useState(null);
  const [fieldValue, setFieldValue] = useState('');
  const [savingField, setSavingField] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [uploading, setUploading] = useState(null);   // field currently uploading
  const stopped = useRef(false);

  const load = useCallback(() => {
    setLoadErr('');
    apiGet('/api/school/website/ai-sync/plan')
      .then((r) => setPlan(r.data))
      .catch((e) => setLoadErr(e?.message || 'Could not load the sync plan'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const units = plan?.units || [];
  const completed = units.filter((u) => done[u.key] === 'ok').length;
  const pct = units.length ? Math.round((completed / units.length) * 100) : 0;

  const syncAll = async () => {
    stopped.current = false;
    setRunning(true); setNote('');
    for (const u of units) {
      if (stopped.current) break;
      if (done[u.key] === 'ok') continue;      // resume, don't redo (and re-charge)
      setCurrent(u.key);
      try {
        const r = await apiPost('/api/school/website/ai-sync/unit', { key: u.key, type: u.type });
        setDone((d) => ({ ...d, [u.key]: 'ok' }));
        setCoins((c) => c + (r.coinsCharged || 0));
      } catch (e) {
        // Out of coins is terminal — every remaining unit would fail the same
        // way, so stop instead of burning through the list.
        if (e?.status === 402) { setDone((d) => ({ ...d, [u.key]: 'error' })); setNote(e.message || 'The school wallet ran out of coins.'); break; }
        // 422 means the page was deliberately left alone (too large to rewrite
        // safely, or the rewrite lost its structure). That's a skip, not a
        // failure — the page is intact.
        const skipped = e?.status === 422;
        setDone((d) => ({ ...d, [u.key]: skipped ? 'skipped' : 'error' }));
        setNote(`${u.label}: ${e?.message || 'failed'} — continuing.`);
      }
    }
    setCurrent(null); setRunning(false);
  };

  const revert = async () => {
    if (!await confirmDialog({ title: 'Undo the AI sync?', message: 'Every page goes back to how it was before the sync ran.', detail: 'The copy the AI wrote is discarded and cannot be recovered.', confirmLabel: 'Restore pages' })) return;
    setReverting(true); setNote('');
    try {
      const r = await apiPost('/api/school/website/ai-sync/revert', {});
      setDone({}); setCoins(0);
      setNote(`Restored ${r.restored || 0} page${r.restored === 1 ? '' : 's'} to their pre-sync content.`);
      load();
    } catch (e) { setNote(e?.message || 'Could not restore the pages'); }
    finally { setReverting(false); }
  };

  // Images can't be written by the AI — a photo of the school can only come
  // from the school. Uploaded here straight into the same media storage the
  // website builder uses, so it's one step rather than a trip to another page.
  const uploadImage = async (f, file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) { setNote('That file is not an image.'); return; }
    setUploading(f.field); setNote('');
    try {
      const { fileUrl } = await uploadFile(file);
      await apiPatch('/api/school/website/ai-sync/info', { field: f.field, value: fileUrl });
      load();
    } catch (e) { setNote(e?.message || `Could not upload the ${f.label.toLowerCase()}`); }
    finally { setUploading(null); }
  };

  const saveField = async (e) => {
    e.preventDefault();
    setSavingField(true);
    try {
      await apiPatch('/api/school/website/ai-sync/info', { field: openField.field, value: fieldValue });
      setOpenField(null); setFieldValue(''); load();
    } catch (e2) { setNote(e2?.message || 'Could not save'); }
    finally { setSavingField(false); }
  };

  if (loadErr) return <PageLayout title="AI Website Sync"><div style={{ color: RED, fontSize: 13.5, fontWeight: 700 }}>{loadErr}</div></PageLayout>;
  if (!plan) return <PageLayout title="AI Website Sync"><div style={{ color: C.muted2 }}>Loading…</div></PageLayout>;

  return (
    <PageLayout title="AI Website Sync" subtitle="Rewrite your site from your school's own information, one page at a time">

      {/* Progress */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>
            {completed}/{units.length} {units.length === 1 ? 'page' : 'pages'}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {coins > 0 && <>{coins.toLocaleString()} coins used · </>}
            {running ? 'Working…' : completed === units.length && units.length > 0 ? 'All done' : 'Ready'}
          </div>
        </div>
        <div style={{ height: 10, borderRadius: 6, background: C.bg, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${C.brand}, ${C.brandDeep})`, borderRadius: 6, transition: 'width .35s ease' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {!running ? (
            <button onClick={syncAll} disabled={!plan.canSync || units.length === 0} style={primaryBtn}>
              <Ico ti="ti-sparkles" size={15} /> {completed > 0 ? 'Continue sync' : 'Start AI sync'}
            </button>
          ) : (
            <button onClick={() => { stopped.current = true; }} style={{ ...primaryBtn, background: C.muted }}>
              <Ico ti="ti-square" size={13} /> Stop after this page
            </button>
          )}
          {!running && plan.canRevert && (
            <button onClick={revert} disabled={reverting} style={ghostBtn}>
              <Ico ti="ti-arrow-back-up" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              {reverting ? 'Restoring…' : 'Undo AI sync'}
            </button>
          )}
          {!plan.canSync && <span style={{ fontSize: 12.5, color: C.muted, alignSelf: 'center' }}>Pick a website template or add a page first.</span>}
        </div>
        {note && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: note.includes('coins') ? RED : C.muted }}>{note}</div>}
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted2 }}>
          Charged to the school wallet per page, based on actual usage — the same as every other AI feature.
        </div>
      </div>

      {/* Missing information */}
      {plan.missing?.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Ico ti="ti-alert-circle" size={16} color={C.brand} />
            <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Missing information ({plan.missing.length})</div>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
            The AI only writes from facts you've given it. Anything missing here is simply left out of your site.
          </div>

          {plan.missing.map((f, i) => (
            <div key={f.field} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{i + 1}. {f.label}</div>
                  {f.hint && <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{f.hint}</div>}
                </div>
                {openField?.field !== f.field && (
                  <button onClick={() => { setOpenField(f); setFieldValue(''); }} style={addBtn}><Ico ti="ti-plus" size={14} /> Add</button>
                )}
              </div>

              {openField?.field === f.field && (
                <form onSubmit={saveField} style={{ marginTop: 10 }}>
                  {f.long ? (
                    <textarea value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} autoFocus rows={4}
                      placeholder={f.hint || f.label} style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: C.font }} />
                  ) : (
                    <input value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} autoFocus
                      type={f.type === 'number' ? 'number' : 'text'} placeholder={f.label}
                      style={{ ...inputStyle, width: '100%' }} />
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="submit" disabled={savingField || !fieldValue.trim()} style={primaryBtn}>
                      {savingField ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setOpenField(null)} style={ghostBtn}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Images */}
      {plan.images?.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Ico ti="ti-photo" size={16} color={plan.imagesMissing ? C.brand : GREEN} />
            <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>
              Images{plan.imagesMissing ? ` — ${plan.imagesMissing} missing` : ''}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
            The AI writes words, not pictures. Add your own here, or pick from{' '}
            <Link to="/website-builder/media" style={{ color: C.brand, fontWeight: 700 }}>Website Builder → Media</Link>.
          </div>

          {plan.images.map((f, i) => (
            <div key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, padding: '12px 0' }}>
              <div style={{ width: 64, height: 44, borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {f.value
                  ? <img src={f.value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Ico ti="ti-photo" size={16} color={C.muted2} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{f.label}</div>
                <div style={{ fontSize: 11.5, color: f.missing ? C.brand : C.muted2, marginTop: 2 }}>
                  {f.missing ? `Missing — ${f.hint}` : f.hint}
                </div>
              </div>
              <label style={{ ...addBtn, opacity: uploading === f.field ? 0.6 : 1 }}>
                {uploading === f.field
                  ? <><Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Uploading…</>
                  : <><Ico ti="ti-upload" size={13} /> {f.missing ? 'Add' : 'Replace'}</>}
                <input type="file" accept="image/*" disabled={uploading === f.field} style={{ display: 'none' }}
                  onChange={(e) => { uploadImage(f, e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          ))}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Per-page list */}
      <div style={{ ...card, padding: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, padding: '16px 18px 6px' }}>Pages &amp; sections</div>
        {units.length === 0 ? (
          <div style={{ padding: 26, textAlign: 'center', color: C.muted2, fontSize: 13 }}>Nothing to sync yet.</div>
        ) : units.map((u) => {
          const st = done[u.key];
          const isNow = current === u.key;
          return (
            <div key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: st === 'ok' ? `${GREEN}18` : st === 'error' ? `${RED}18` : C.bg }}>
                {isNow ? <Ico ti="ti-loader-2" size={13} color={C.brand} style={{ animation: 'spin .8s linear infinite' }} />
                  : st === 'ok' ? <Ico ti="ti-check" size={13} color={GREEN} />
                  : st === 'skipped' ? <Ico ti="ti-circle-minus" size={13} color={C.muted} />
                  : st === 'error' ? <Ico ti="ti-alert-circle" size={13} color={RED} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{u.label}</div>
                <div style={{ fontSize: 11.5, color: C.muted2 }}>
                  {u.type === 'section' ? 'Template section' : u.html ? 'Template page · wording only' : 'Website page'}
                  {u.thin && st !== 'ok' && ' · little or no content yet'}
                </div>
              </div>
              {st === 'error'   && <span style={{ fontSize: 11.5, color: RED, fontWeight: 700 }}>Failed</span>}
              {st === 'skipped' && <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700 }}>Left as is</span>}
            </div>
          );
        })}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </PageLayout>
  );
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 18 };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font };
const ghostBtn = { padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font };
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 9, border: `1px solid ${C.brand}`, background: tint(7), color: C.brand, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' };
