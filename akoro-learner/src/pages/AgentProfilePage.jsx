/**
 * AgentProfilePage — a dedicated page for a marketplace teaching-guide/agent
 * (replaces the old bottom-sheet modal). Route: /agent/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS, STUDENT_ID } from '../constants.js';
import { apiGet, apiPost } from '../services/api.js';
import { useLang } from '../contexts/LanguageContext.jsx';
import Toast from '../components/common/Toast.jsx';

const FONT = "'Nunito', sans-serif";
const MKT = '/api/adaptive/marketplace';
const fmtPrice = (kobo, currency = 'NGN', free = 'Free') => !kobo ? free : `${currency === 'NGN' ? '₦' : ''}${(kobo / 100).toLocaleString()}`;
const fmtCount = (n) => { const v = Number(n) || 0; return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v); };
const subjectColor = (s) => SUBJECT_COLORS[(s || '').toLowerCase()] || BRAND;

function Stars({ rating = 0, size = 13 }) {
  const r = Number(rating) || 0;
  return <span style={{ display: 'inline-flex', gap: 1 }}>{[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ fontSize: size, color: i <= Math.round(r) ? GOLD : 'var(--ak-border2)' }}>★</span>)}</span>;
}

export default function AgentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const [full, setFull] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [owned, setOwned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [myRating, setMyRating] = useState(0);
  const [myText, setMyText] = useState('');
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet(`${MKT}/listings/${id}`).then((d) => { if (alive) setFull(d.listing || null); }).catch(() => { if (alive) setFull(false); });
    apiGet(`${MKT}/reviews/${id}`).then((d) => { if (alive) setReviews(d.reviews || []); }).catch(() => {});
    apiGet(`${MKT}/my-agents/${STUDENT_ID}`).then((d) => { if (alive) setOwned((d.purchasedAgents || []).some((a) => a.agentId === (full?.agent_id))); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // re-check ownership once the listing (with agent_id) loads
  useEffect(() => {
    if (!full?.agent_id) return;
    apiGet(`${MKT}/my-agents/${STUDENT_ID}`).then((d) => setOwned((d.purchasedAgents || []).some((a) => a.agentId === full.agent_id))).catch(() => {});
  }, [full?.agent_id]);

  const purchase = async () => {
    setBusy(true);
    try {
      const d = await apiPost(`${MKT}/checkout`, { studentId: STUDENT_ID, listingId: full.id });
      if (d.authorization_url) { window.location.href = d.authorization_url; return; }
      setOwned(true); setToast({ msg: d.message || `${full.title} unlocked!`, color: GREEN });
    } catch (e) {
      setToast({ msg: String(e.message || '').includes('409') ? t('discovery.already_own') : t('discovery.checkout_failed'), color: RED });
    } finally { setBusy(false); }
  };
  const use = async () => {
    setBusy(true);
    try {
      await apiPost(`${MKT}/set-default`, { userId: STUDENT_ID, agentPairId: `trained:${full.agent_id}`, activeAgentId: full.agent_id });
      setToast({ msg: `${full.title} ${t('discovery.now_active')}`, color: GREEN });
    } catch { setToast({ msg: t('discovery.could_not_set'), color: RED }); }
    finally { setBusy(false); }
  };
  const submitReview = async () => {
    if (!myRating) return;
    try {
      await apiPost(`${MKT}/review`, { studentId: STUDENT_ID, listingId: full.id, rating: myRating, reviewText: myText.trim() });
      setPosted(true); setReviews((p) => [{ id: `me-${Date.now()}`, rating: myRating, review_text: myText.trim() }, ...p]);
    } catch (e) { setToast({ msg: String(e.message || '').includes('403') ? t('discovery.purchase_first') : t('discovery.could_not_review'), color: RED }); }
  };

  const shell = (children) => (
    <div style={{ minHeight: '100dvh', background: 'var(--ak-bg)', fontFamily: FONT }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ak-text)', display: 'flex' }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)' }}>Teaching Guide</span>
      </div>
      {children}
    </div>
  );

  if (full === null) return shell(<div style={{ padding: 60, textAlign: 'center', color: 'var(--ak-text-muted)' }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>);
  if (full === false) return shell(<div style={{ padding: 60, textAlign: 'center', color: 'var(--ak-text-muted)', fontSize: 14 }}>This agent is unavailable.</div>);

  const sc = subjectColor(full.subject);
  const useCases = full.topics_covered?.length ? full.topics_covered : full.concepts_taught?.length ? full.concepts_taught : full.preview_topics || [];

  return shell(
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 18px 120px' }}>
      {full.cover_image_url && (
        <div style={{ width: '100%', aspectRatio: '16/7', borderRadius: 16, overflow: 'hidden', marginBottom: 16, background: `${sc}12`, border: `1px solid ${sc}22` }}>
          <img src={full.cover_image_url} alt="" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, background: `${sc}14`, border: `1.5px solid ${sc}33` }}>{full.teacher_avatar || full.agent_avatar || '🎓'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>{full.title}</h1>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ak-text-sub)', marginTop: 3 }}>{t('discovery.by')} {full.teacher_name || t('discovery.teacher')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><Stars rating={full.avg_rating} /><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{Number(full.avg_rating || 0).toFixed(1)} · {full.rating_count || 0} {t('discovery.reviews')}</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 18 }}>
        {[{ l: t('discovery.learners'), v: fmtCount(full.total_students), i: '👥' }, { l: t('discovery.trained_on'), v: `${Math.round(full.total_hours_trained || 0)}h`, i: '🎓' }, { l: t('discovery.sessions'), v: fmtCount(full.training_sessions), i: '📈' }].map((s) => (
          <div key={s.l} style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 16 }}>{s.i}</div><div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', marginTop: 2 }}>{s.v}</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ak-text-muted)', textTransform: 'uppercase' }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: sc, background: `${sc}14`, padding: '4px 12px', borderRadius: 20, textTransform: 'capitalize' }}>{full.subject || t('discovery.general')}</span>
        <span style={{ fontSize: 21, fontWeight: 900, color: full.is_free ? GREEN : BRAND }}>{fmtPrice(full.price_kobo, full.currency, t('discovery.free'))}</span>
      </div>

      {full.description && <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ak-text-sec)', lineHeight: 1.65, marginTop: 14 }}>{full.description}</p>}

      {full.sample_tip && (
        <div style={{ background: 'rgba(108,59,255,.06)', border: '1px solid rgba(108,59,255,.15)', borderRadius: 12, padding: '12px 14px', marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: BRAND, letterSpacing: .4, marginBottom: 4 }}>{t('discovery.sample_tip')}</div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ak-text-sec)', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>"{full.sample_tip}"</p>
        </div>
      )}

      {useCases.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 8 }}>{t('discovery.what_learn')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{useCases.slice(0, 12).map((x, i) => <span key={i} style={{ fontSize: 12, fontWeight: 700, color: '#4B5563', background: 'var(--ak-border)', padding: '5px 11px', borderRadius: 9 }}>{x}</span>)}</div>
        </div>
      )}

      {owned && !posted && (
        <div style={{ marginTop: 20, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '13px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 9 }}>{t('discovery.rate_agent')}</div>
          <div style={{ display: 'inline-flex', gap: 4 }}>{[1, 2, 3, 4, 5].map((i) => <button key={i} onClick={() => setMyRating(i)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><span style={{ fontSize: 26, color: i <= myRating ? GOLD : 'var(--ak-border2)' }}>★</span></button>)}</div>
          <textarea value={myText} onChange={(e) => setMyText(e.target.value)} placeholder={t('discovery.review_ph')} rows={2} style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, padding: '10px 12px', borderRadius: 11, border: '1px solid var(--ak-border2)', background: 'var(--ak-bg)', fontSize: 13, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none', resize: 'none' }} />
          <button onClick={submitReview} disabled={!myRating} style={{ marginTop: 9, padding: '9px 16px', borderRadius: 11, border: 'none', background: myRating ? `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)` : '#E5E1F2', color: myRating ? '#fff' : 'var(--ak-text-muted)', fontSize: 12.5, fontWeight: 800, cursor: myRating ? 'pointer' : 'default', fontFamily: FONT }}>{t('discovery.submit_review')}</button>
        </div>
      )}

      {reviews.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 8 }}>{t('discovery.recent_reviews')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{reviews.slice(0, 6).map((r) => <div key={r.id} style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '10px 12px' }}><Stars rating={r.rating} size={11} />{r.review_text && <p style={{ fontSize: 13, fontWeight: 600, color: '#4B5563', margin: '5px 0 0', lineHeight: 1.45 }}>{r.review_text}</p>}</div>)}</div>
        </div>
      )}

      {/* Sticky action bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', padding: '12px 18px calc(12px + env(safe-area-inset-bottom,0px))', display: 'flex', maxWidth: 620, margin: '0 auto' }}>
        {owned ? (
          <button onClick={use} disabled={busy} style={actionBtn(GREEN, busy)}>{busy ? t('discovery.setting') : t('discovery.use_agent')}</button>
        ) : (
          <button onClick={purchase} disabled={busy} style={actionBtn(BRAND, busy)}>{busy ? t('discovery.processing') : full.is_free ? t('discovery.get_free') : `${t('discovery.unlock')} · ${fmtPrice(full.price_kobo, full.currency)}`}</button>
        )}
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}

const actionBtn = (color, busy) => ({ flex: 1, padding: '14px', borderRadius: 14, border: 'none', background: busy ? '#C7C2E0' : `linear-gradient(135deg, ${color}, ${color}CC)`, color: '#fff', fontSize: 15, fontWeight: 900, cursor: busy ? 'default' : 'pointer', fontFamily: FONT });
