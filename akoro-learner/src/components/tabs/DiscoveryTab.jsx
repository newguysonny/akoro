/**
 * DiscoveryTab.jsx
 * ─────────────────────────────────────────────────────────────
 * Browse, preview and purchase trained teacher agents.
 *
 * Data source: /api/adaptive/marketplace/* (edu.marketplace_summary view)
 *   GET  /listings?subject=&free=        — browse
 *   GET  /search?q=&subject=             — search
 *   GET  /listings/:id                   — full profile
 *   GET  /reviews/:listingId             — reviews
 *   GET  /my-agents/:userId              — owned agents (purchased + platform)
 *   POST /checkout { studentId, listingId } — free→grant, paid→Paystack URL
 *   POST /set-default { userId, agentPairId, activeAgentId } — adopt agent
 *
 * On purchase, the agent_id lands in
 * edu.user_agent_preferences.purchased_agents; "Use this agent" writes
 * default_pair_id = trained:<agentId> + active_agent_id.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { apiGet, apiPost } from '../../services/api.js';
import Toast from '../common/Toast.jsx';

const FONT  = "'Nunito', sans-serif";
const MKT    = '/api/adaptive/marketplace';

const fmtPrice = (kobo, currency = 'NGN') =>
  !kobo || kobo === 0
    ? 'Free'
    : `${currency === 'NGN' ? '₦' : ''}${(kobo / 100).toLocaleString()}`;

const fmtCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};

const subjectColor = (subject) =>
  SUBJECT_COLORS[(subject || '').toLowerCase()] || BRAND;

/* ── Stars ─────────────────────────────────────────────────── */
function Stars({ rating = 0, size = 12 }) {
  const r = Number(rating) || 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ fontSize: size, color: i <= Math.round(r) ? GOLD : '#E5E7EB' }}>★</span>
      ))}
    </span>
  );
}

/* ── Listing card ──────────────────────────────────────────── */
function AgentCard({ listing, owned, onOpen }) {
  const sc = subjectColor(listing.subject);
  return (
    <button
      onClick={() => onOpen(listing)}
      style={{
        textAlign: 'left', background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16,
        padding: 14, cursor: 'pointer', fontFamily: FONT, display: 'flex', flexDirection: 'column',
        gap: 10, width: '100%', boxShadow: '0 2px 10px rgba(108,59,255,.04)',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <div style={{
          width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 24,
          background: `${sc}14`, border: `1.5px solid ${sc}33`,
        }}>{listing.teacher_avatar || listing.agent_avatar || '🎓'}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</span>
            {owned && <span style={{ fontSize: 9, fontWeight: 900, color: GREEN, background: 'rgba(16,185,129,.12)', padding: '2px 6px', borderRadius: 6 }}>OWNED</span>}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6B7280', marginTop: 2 }}>
            by {listing.teacher_name || 'Teacher'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: sc, background: `${sc}14`, padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize' }}>{listing.subject || 'General'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Stars rating={listing.avg_rating} size={11} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9CA3AF' }}>{Number(listing.avg_rating || 0).toFixed(1)} ({listing.rating_count || 0})</span>
            </span>
          </div>
        </div>
      </div>

      {listing.style_summary && (
        <p style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', margin: 0, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {listing.style_summary}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F3F0FF', paddingTop: 9 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          👥 {fmtCount(listing.total_students)} learning
        </span>
        <span style={{ fontSize: 13, fontWeight: 900, color: listing.is_free ? GREEN : BRAND }}>
          {fmtPrice(listing.price_kobo, listing.currency)}
        </span>
      </div>
    </button>
  );
}

/* ── Detail sheet ──────────────────────────────────────────── */
function AgentSheet({ listing, owned, onClose, onPurchase, onUse, busy }) {
  const [full,    setFull]    = useState(listing);
  const [reviews, setReviews] = useState([]);
  const sc = subjectColor(listing.subject);

  useEffect(() => {
    let alive = true;
    apiGet(`${MKT}/listings/${listing.id}`).then(d => { if (alive && d.listing) setFull(prev => ({ ...prev, ...d.listing })); }).catch(() => {});
    apiGet(`${MKT}/reviews/${listing.id}`).then(d => { if (alive) setReviews(d.reviews || []); }).catch(() => {});
    return () => { alive = false; };
  }, [listing.id]);

  const useCases = full.topics_covered?.length ? full.topics_covered
    : full.concepts_taught?.length ? full.concepts_taught
    : full.preview_topics || [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', width: '100%', maxWidth: 540, maxHeight: '92vh', borderRadius: '22px 22px 0 0',
        overflowY: 'auto', fontFamily: FONT, animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)',
      }}>
        {/* grabber */}
        <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 0 4px', display: 'flex', justifyContent: 'center', zIndex: 2 }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: '#E5E7EB' }} />
        </div>

        <div style={{ padding: '8px 18px 20px' }}>
          {/* header */}
          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, background: `${sc}14`, border: `1.5px solid ${sc}33` }}>
              {full.teacher_avatar || full.agent_avatar || '🎓'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: '#111827', margin: 0 }}>{full.title}</h2>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#6B7280', marginTop: 3 }}>by {full.teacher_name || 'Teacher'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Stars rating={full.avg_rating} size={13} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#9CA3AF' }}>{Number(full.avg_rating || 0).toFixed(1)} · {full.rating_count || 0} reviews</span>
              </div>
            </div>
          </div>

          {/* stat strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 16 }}>
            {[
              { label: 'Learners',  value: fmtCount(full.total_students), icon: '👥' },
              { label: 'Trained on', value: `${Math.round(full.total_hours_trained || 0)}h`, icon: '🎓' },
              { label: 'Sessions',  value: fmtCount(full.training_sessions), icon: '📈' },
            ].map((s) => (
              <div key={s.label} style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 16 }}>{s.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#111827', marginTop: 2 }}>{s.value}</div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: .3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* subject + price row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: sc, background: `${sc}14`, padding: '4px 11px', borderRadius: 20, textTransform: 'capitalize' }}>{full.subject || 'General'}</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: full.is_free ? GREEN : BRAND }}>{fmtPrice(full.price_kobo, full.currency)}</span>
          </div>

          {full.description && (
            <p style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', lineHeight: 1.6, marginTop: 14 }}>{full.description}</p>
          )}

          {full.sample_tip && (
            <div style={{ background: 'rgba(108,59,255,.06)', border: '1px solid rgba(108,59,255,.15)', borderRadius: 12, padding: '11px 13px', marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 900, color: BRAND, letterSpacing: .4, marginBottom: 4 }}>💡 A SAMPLE TIP</div>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: '#4B3B7A', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>"{full.sample_tip}"</p>
            </div>
          )}

          {/* use cases */}
          {useCases.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: '#111827', marginBottom: 8 }}>What you can learn</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {useCases.slice(0, 12).map((t, i) => (
                  <span key={i} style={{ fontSize: 11.5, fontWeight: 700, color: '#4B5563', background: '#F3F4F6', padding: '5px 11px', borderRadius: 9 }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* reviews */}
          {reviews.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: '#111827', marginBottom: 8 }}>Recent reviews</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {reviews.slice(0, 5).map((r) => (
                  <div key={r.id} style={{ background: '#FBFAFF', border: '1px solid #F0ECFF', borderRadius: 12, padding: '10px 12px' }}>
                    <Stars rating={r.rating} size={11} />
                    {r.review_text && <p style={{ fontSize: 12.5, fontWeight: 600, color: '#4B5563', margin: '5px 0 0', lineHeight: 1.45 }}>{r.review_text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* sticky action bar */}
        <div style={{ position: 'sticky', bottom: 0, background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(8px)', borderTop: '1px solid #EDE9FE', padding: '12px 18px calc(12px + env(safe-area-inset-bottom,0px))', display: 'flex', gap: 10 }}>
          {owned ? (
            <button onClick={() => onUse(full)} disabled={busy} style={primaryBtn(GREEN, busy)}>
              {busy ? 'Setting…' : '✓ Use this agent'}
            </button>
          ) : (
            <button onClick={() => onPurchase(full)} disabled={busy} style={primaryBtn(BRAND, busy)}>
              {busy ? 'Processing…' : full.is_free ? 'Get free agent' : `Unlock · ${fmtPrice(full.price_kobo, full.currency)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtn = (color, busy) => ({
  flex: 1, padding: '14px', borderRadius: 14, border: 'none',
  background: busy ? '#C7C2E0' : `linear-gradient(135deg, ${color}, ${color}CC)`,
  color: '#fff', fontSize: 14, fontWeight: 900, cursor: busy ? 'default' : 'pointer',
  fontFamily: FONT,
});

/* ── Main tab ──────────────────────────────────────────────── */
export default function DiscoveryTab() {
  const [listings, setListings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [subject,  setSubject]  = useState('all');
  const [freeOnly, setFreeOnly] = useState(false);
  const [query,    setQuery]    = useState('');
  const [active,   setActive]   = useState(null);   // open listing
  const [ownedIds, setOwnedIds] = useState(new Set());
  const [busy,     setBusy]     = useState(false);
  const [toast,    setToast]    = useState(null);

  const loadOwned = useCallback(async () => {
    try {
      const d = await apiGet(`${MKT}/my-agents/${STUDENT_ID}`);
      const ids = (d.purchasedAgents || []).map(a => a.agentId).filter(Boolean);
      setOwnedIds(new Set(ids));
    } catch { /* not fatal */ }
  }, []);

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      let d;
      if (query.trim()) {
        const sub = subject !== 'all' ? `&subject=${subject}` : '';
        d = await apiGet(`${MKT}/search?q=${encodeURIComponent(query.trim())}${sub}`);
      } else {
        const params = new URLSearchParams();
        if (subject !== 'all') params.set('subject', subject);
        if (freeOnly) params.set('free', 'true');
        params.set('limit', '40');
        d = await apiGet(`${MKT}/listings?${params.toString()}`);
      }
      setListings(d.listings || []);
    } catch (e) {
      setToast({ msg: 'Could not load agents', color: RED });
      setListings([]);
    } finally { setLoading(false); }
  }, [subject, freeOnly, query]);

  useEffect(() => { loadOwned(); }, [loadOwned]);
  useEffect(() => {
    const t = setTimeout(loadListings, query ? 350 : 0);  // debounce search
    return () => clearTimeout(t);
  }, [loadListings, query]);

  // Detect a Paystack redirect return (?payment=success&agentId=…)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const pay = p.get('payment');
    if (!pay) return;
    if (pay === 'success') {
      setToast({ msg: '🎉 Agent unlocked! Find it in your agent picker.', color: GREEN });
      loadOwned();
    } else if (pay === 'failed' || pay === 'cancelled' || pay === 'error') {
      setToast({ msg: 'Payment not completed', color: RED });
    }
    // strip query so it doesn't re-fire
    window.history.replaceState({}, '', window.location.pathname);
  }, [loadOwned]);

  const ownedActive = active ? ownedIds.has(active.agent_id) : false;

  const handlePurchase = async (listing) => {
    setBusy(true);
    try {
      const d = await apiPost(`${MKT}/checkout`, { studentId: STUDENT_ID, listingId: listing.id });
      if (d.authorization_url) {
        window.location.href = d.authorization_url;   // → Paystack
        return;
      }
      // Free agent granted immediately
      setOwnedIds(prev => new Set(prev).add(listing.agent_id));
      setToast({ msg: d.message || `${listing.title} unlocked!`, color: GREEN });
      setActive(null);
    } catch (e) {
      const msg = String(e.message || '').includes('409') ? 'You already own this agent' : 'Checkout failed — try again';
      setToast({ msg, color: RED });
    } finally { setBusy(false); }
  };

  const handleUse = async (listing) => {
    setBusy(true);
    try {
      await apiPost(`${MKT}/set-default`, {
        userId:        STUDENT_ID,
        agentPairId:   `trained:${listing.agent_id}`,
        activeAgentId: listing.agent_id,
      });
      setToast({ msg: `${listing.title} is now your active agent`, color: GREEN });
      setActive(null);
    } catch {
      setToast({ msg: 'Could not set agent', color: RED });
    } finally { setBusy(false); }
  };

  const subjectKeys = useMemo(() => Object.keys(SUBJECTS), []);

  return (
    <div style={{ padding: '4px 14px 90px', fontFamily: FONT }}>
      <style>{`@keyframes sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {/* Search */}
      <div style={{ position: 'relative', marginTop: 8 }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teacher agents, subjects, topics…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px 11px 36px', borderRadius: 13, border: '1px solid #E5E0F5', background: '#fff', fontSize: 13, fontWeight: 600, color: '#111827', fontFamily: FONT, outline: 'none' }}
        />
      </div>

      {/* Subject pills + free toggle */}
      <div style={{ display: 'flex', gap: 7, marginTop: 11, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
        {subjectKeys.map((key) => {
          const s = SUBJECTS[key];
          const on = subject === key;
          return (
            <button key={key} onClick={() => setSubject(key)} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 100,
              border: on ? `1.5px solid ${s.color}` : '1.5px solid #E5E0F5', background: on ? `${s.color}12` : '#fff',
              cursor: 'pointer', fontFamily: FONT,
            }}>
              <span style={{ fontSize: 12 }}>{s.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? s.color : '#6B7280' }}>{s.label}</span>
            </button>
          );
        })}
        <button onClick={() => setFreeOnly(f => !f)} style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 100,
          border: freeOnly ? `1.5px solid ${GREEN}` : '1.5px solid #E5E0F5', background: freeOnly ? `${GREEN}12` : '#fff',
          cursor: 'pointer', fontFamily: FONT,
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: freeOnly ? GREEN : '#6B7280' }}>✨ Free</span>
        </button>
      </div>

      {/* Results */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
        {loading ? (
          [0, 1, 2].map(i => <div key={i} style={{ height: 120, borderRadius: 16, background: '#fff', opacity: .55 }} />)
        ) : listings.length === 0 ? (
          <div style={{ background: '#fff', border: '1px dashed #DDD3FF', borderRadius: 16, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 40, opacity: .3 }}>🔭</div>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#6B7280', margin: '10px 0 0' }}>No agents found</p>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF', margin: '4px 0 0' }}>Try a different subject or clear your search.</p>
          </div>
        ) : (
          listings.map((l) => (
            <AgentCard key={l.id} listing={l} owned={ownedIds.has(l.agent_id)} onOpen={setActive} />
          ))
        )}
      </div>

      {active && (
        <AgentSheet
          listing={active}
          owned={ownedActive}
          busy={busy}
          onClose={() => setActive(null)}
          onPurchase={handlePurchase}
          onUse={handleUse}
        />
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
