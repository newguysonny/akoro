/**
 * DiscoveryTab.jsx
 * ─────────────────────────────────────────────────────────────
 * Udemy-style discovery feed: a Categories chip row plus horizontal
 * "rails" of rich course cards for each content type.
 *
 *   · Teaching Guides — trained teacher agents  → /agent/:id
 *   · Live Classes    — published live courses  → /course/:slug
 *   · Video Courses   — published video courses → /course/:slug
 *
 * Data sources:
 *   GET /api/adaptive/marketplace/listings          — agents
 *   GET /api/courses/published?type=live|video      — course catalogue
 *   GET /api/adaptive/marketplace/my-agents/:userId — owned agents (badges)
 *   GET /api/adaptive/marketplace/purchases/:userId — purchase history sheet
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { API, apiGet } from '../../services/api.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import Toast from '../common/Toast.jsx';

const FONT = "'Nunito', sans-serif";
const MKT  = '/api/adaptive/marketplace';

const fmtPrice = (kobo, currency = 'NGN', freeLabel = 'Free') =>
  !kobo || kobo === 0
    ? freeLabel
    : `${currency === 'NGN' ? '₦' : ''}${(kobo / 100).toLocaleString()}`;

const fmtCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};

const subjectColor = (subject) =>
  SUBJECT_COLORS[(subject || '').toLowerCase()] || BRAND;

// Map a free-text subject ("Physics", "Further Mathematics") to one of our
// category keys so the Categories chips can filter every rail consistently.
const catOf = (subject) => {
  const s = (subject || '').toLowerCase();
  if (/math/.test(s)) return 'maths';
  if (/english|literatur|essay|writing/.test(s)) return 'english';
  if (/physic|chem|bio|science|comput|python|econom|account|data/.test(s)) return 'science';
  return 'other';
};
const matchCat = (subject, cat) => cat === 'all' || catOf(subject) === cat;

/* ── Stars ─────────────────────────────────────────────────── */
function Stars({ rating = 0, size = 12 }) {
  const r = Number(rating) || 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ fontSize: size, color: i <= Math.round(r) ? GOLD : 'var(--ak-border2)' }}>★</span>
      ))}
    </span>
  );
}

// Rating line in the Udemy style: bold score · stars · (count)
function RatingLine({ score, count }) {
  const s = Number(score) || 0;
  if (!s) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: '#B4690E' }}>{s.toFixed(1)}</span>
      <Stars rating={s} size={12} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)' }}>({fmtCount(count)})</span>
    </div>
  );
}

/* ── Course card (Udemy vertical) ──────────────────────────── */
const CARD_W = 172;
function CourseCard({ course, onOpen, wide }) {
  const { t } = useLang();
  const grad = Array.isArray(course.grad) ? course.grad : ['#EDE9FE', '#DDD3FF'];
  const isLive = course.type === 'live';
  const free = course.priceNum === 0;
  return (
    <button
      onClick={() => onOpen(course)}
      style={{
        textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 7,
        width: wide ? '100%' : CARD_W, flexShrink: 0,
      }}>
      {/* thumbnail */}
      <div style={{
        width: '100%', aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--ak-border)',
      }}>
        <span style={{ fontSize: 46 }}>{course.emoji || '📘'}</span>
        <span style={{
          position: 'absolute', top: 7, left: 7, fontSize: 9, fontWeight: 900, letterSpacing: .3,
          color: '#fff', background: isLive ? RED : 'rgba(17,12,40,.72)', padding: '3px 7px', borderRadius: 6,
        }}>{isLive ? `● ${t('discovery.live')}` : t('discovery.video')}</span>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>
        {course.title}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', textTransform: 'capitalize',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {course.subject || t('discovery.general')} · {course.level}
      </div>
      <RatingLine score={Number(course.rating)} count={course.rev} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: free ? GREEN : 'var(--ak-text)' }}>{course.price}</span>
        {free && <span style={{ fontSize: 9, fontWeight: 900, color: GREEN, background: 'rgba(16,185,129,.12)', padding: '2px 6px', borderRadius: 5 }}>{t('discovery.free').toUpperCase()}</span>}
      </div>
    </button>
  );
}

/* ── Agent card (Udemy vertical) ───────────────────────────── */
function AgentCard({ listing, owned, onOpen, wide }) {
  const { t } = useLang();
  const sc = subjectColor(listing.subject);
  return (
    <button
      onClick={() => onOpen(listing)}
      style={{
        textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 7,
        width: wide ? '100%' : CARD_W, flexShrink: 0,
      }}>
      <div style={{
        width: '100%', aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(135deg, ${sc}22, ${sc}0D)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${sc}33`,
      }}>
        <span style={{ fontSize: 46 }}>{listing.teacher_avatar || listing.agent_avatar || '🎓'}</span>
        {owned && <span style={{ position: 'absolute', top: 7, left: 7, fontSize: 9, fontWeight: 900, color: '#fff', background: GREEN, padding: '3px 7px', borderRadius: 6 }}>{t('discovery.owned')}</span>}
        <span style={{ position: 'absolute', bottom: 7, right: 7, fontSize: 9, fontWeight: 900, color: sc, background: '#fff', padding: '3px 7px', borderRadius: 6, textTransform: 'capitalize' }}>{listing.subject || t('discovery.general')}</span>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>
        {listing.title}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t('discovery.by')} {listing.teacher_name || t('discovery.teacher')}
      </div>
      <RatingLine score={Number(listing.avg_rating)} count={listing.rating_count} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: listing.is_free ? GREEN : 'var(--ak-text)' }}>
          {fmtPrice(listing.price_kobo, listing.currency, t('discovery.free'))}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>👥 {fmtCount(listing.total_students)}</span>
      </div>
    </button>
  );
}

/* ── Section rail: header + See all + horizontal scroll / grid ── */
function Rail({ title, accent, count, loading, expanded, onToggle, children, emptyText }) {
  const { t } = useLang();
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 14px', gap: 10 }}>
        <h2 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.15 }}>
          {title.pre}<span style={{ color: accent }}>{title.hi}</span>
        </h2>
        {count > 0 && (
          <button onClick={onToggle} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 13, fontWeight: 900, cursor: 'pointer', fontFamily: FONT, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {expanded ? t('discovery.show_less') : t('discovery.see_all')}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 12, padding: '14px 14px 4px', overflow: 'hidden' }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: CARD_W, flexShrink: 0, height: 170, borderRadius: 12, background: 'var(--ak-surface)', opacity: .55 }} />)}
        </div>
      ) : count === 0 ? (
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text-muted)', padding: '10px 14px 0', margin: 0 }}>{emptyText}</p>
      ) : expanded ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px 12px', padding: '14px 14px 4px' }}>
          {children}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, padding: '14px 14px 6px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      )}
    </section>
  );
}

/* ── Category chips ────────────────────────────────────────── */
function Categories({ value, onChange }) {
  const { t } = useLang();
  const keys = Object.keys(SUBJECTS);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
        <h2 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>{t('discovery.categories')}</h2>
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: '0 14px 2px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {keys.map((key) => {
          const s = SUBJECTS[key];
          const on = value === key;
          return (
            <button key={key} onClick={() => onChange(key)} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 100,
              border: on ? `1.5px solid ${s.color}` : '1.5px solid var(--ak-border3)',
              background: on ? `${s.color}12` : 'var(--ak-surface)', cursor: 'pointer', fontFamily: FONT,
            }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? s.color : 'var(--ak-text)', whiteSpace: 'nowrap' }}>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Purchase history sheet ────────────────────────────────── */
function PurchaseHistorySheet({ onClose }) {
  const { t } = useLang();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiGet(`${MKT}/purchases/${STUDENT_ID}`)
      .then(d => { if (alive) setRows(d.purchases || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const statusMeta = (s, granted) =>
    granted || s === 'success' ? { label: t('discovery.st_active'),   color: GREEN }
    : s === 'pending'          ? { label: t('discovery.st_pending'),  color: GOLD }
    : s === 'refunded'         ? { label: t('discovery.st_refunded'), color: 'var(--ak-text-muted)' }
    :                            { label: t('discovery.st_failed'),   color: RED };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 540, maxHeight: '80vh', borderRadius: '22px 22px 0 0', overflowY: 'auto', fontFamily: FONT, animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--ak-surface)', padding: '10px 0 4px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: 'var(--ak-border2)' }} />
        </div>
        <div style={{ padding: '6px 18px 24px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '4px 0 14px' }}>{t('discovery.my_purchases')}</h2>
          {loading ? (
            [0, 1].map(i => <div key={i} style={{ height: 64, borderRadius: 12, background: '#F3F1FF', opacity: .6, marginBottom: 9 }} />)
          ) : rows.length === 0 ? (
            <div style={{ background: '#FBFAFF', border: '1px dashed #DDD3FF', borderRadius: 14, padding: 30, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ak-text-muted)' }}>
              {t('discovery.no_purchases')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {rows.map((p) => {
                const listing = p['edu.marketplace_listings'] || p.marketplace_listings || {};
                const m = statusMeta(p.paystack_status, p.access_granted);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--ak-surface)', border: '1px solid #F0ECFF', borderRadius: 13, padding: '11px 13px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {listing.title || p.metadata?.listing_title || t('discovery.agent')}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>
                        {listing.teacher_name || p.metadata?.teacher_name || t('discovery.teacher')}
                        {p.purchased_at ? ` · ${new Date(p.purchased_at).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>{fmtPrice(p.amount_kobo, p.currency, t('discovery.free'))}</div>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: m.color, background: `${m.color}18`, padding: '2px 7px', borderRadius: 20 }}>{m.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main tab ──────────────────────────────────────────────── */
export default function DiscoveryTab() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [agents,  setAgents]  = useState([]);
  const [live,    setLive]    = useState([]);
  const [video,   setVideo]   = useState([]);
  const [lAgents, setLAgents] = useState(true);
  const [lLive,   setLLive]   = useState(true);
  const [lVideo,  setLVideo]  = useState(true);
  const [cat,     setCat]     = useState('all');
  const [query,   setQuery]   = useState('');
  const [ownedIds, setOwnedIds] = useState(new Set());
  const [expanded, setExpanded] = useState({});   // { live, video, guides }
  const [toast,    setToast]    = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadOwned = useCallback(async () => {
    try {
      const d = await apiGet(`${MKT}/my-agents/${STUDENT_ID}`);
      const ids = (d.purchasedAgents || []).map(a => a.agentId).filter(Boolean);
      setOwnedIds(new Set(ids));
    } catch { /* not fatal */ }
  }, []);

  const loadAll = useCallback(async () => {
    setLAgents(true); setLLive(true); setLVideo(true);
    apiGet(`${MKT}/listings?limit=40`)
      .then(d => setAgents(d.listings || [])).catch(() => setAgents([])).finally(() => setLAgents(false));
    apiGet(`/api/courses/published?type=live&limit=40`)
      .then(d => setLive(d.courses || [])).catch(() => setLive([])).finally(() => setLLive(false));
    apiGet(`/api/courses/published?type=video&limit=40`)
      .then(d => setVideo(d.courses || [])).catch(() => setVideo([])).finally(() => setLVideo(false));
  }, []);

  useEffect(() => { loadOwned(); loadAll(); }, [loadOwned, loadAll]);

  const loadAllRef   = useRef(loadAll);
  const loadOwnedRef = useRef(loadOwned);
  loadAllRef.current   = loadAll;
  loadOwnedRef.current = loadOwned;

  // Live refresh — backend pushes agent_purchased after a payment confirms.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.io) return;
    let socket;
    try {
      socket = window.io(API, { transports: ['websocket', 'polling'], withCredentials: true });
      const subscribe = () => socket.emit('subscribe-student', STUDENT_ID);
      subscribe();
      socket.on('connect', subscribe);
      const onPurchased = (data) => {
        if (data?.agentId) setOwnedIds(prev => new Set(prev).add(data.agentId));
        else loadOwnedRef.current();
        setToast({ msg: data?.message || t('discovery.new_unlocked'), color: GREEN });
        loadAllRef.current();
      };
      socket.on('agent_purchased', onPurchased);
      return () => { socket.off('agent_purchased', onPurchased); socket.off('connect', subscribe); };
    } catch { /* WS unavailable */ }
  }, []);

  // Paystack redirect return (?payment=success&agentId=…)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const pay = p.get('payment');
    if (!pay) return;
    if (pay === 'success') { setToast({ msg: t('discovery.unlocked_picker'), color: GREEN }); loadOwned(); }
    else if (['failed', 'cancelled', 'error'].includes(pay)) setToast({ msg: t('discovery.payment_incomplete'), color: RED });
    window.history.replaceState({}, '', window.location.pathname);
  }, [loadOwned]);

  const q = query.trim().toLowerCase();
  const byQuery = (text) => !q || (text || '').toLowerCase().includes(q);

  const fAgents = useMemo(() => agents.filter(a => matchCat(a.subject, cat) && byQuery(`${a.title} ${a.teacher_name} ${a.subject}`)), [agents, cat, q]);
  const fLive   = useMemo(() => live.filter(c => matchCat(c.subject, cat) && byQuery(`${c.title} ${c.subject}`)), [live, cat, q]);
  const fVideo  = useMemo(() => video.filter(c => matchCat(c.subject, cat) && byQuery(`${c.title} ${c.subject}`)), [video, cat, q]);

  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));

  return (
    <div style={{ padding: '4px 0 90px', fontFamily: FONT }}>
      <style>{`@keyframes sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {/* Search + purchases */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px 0' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('discovery.search')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px 11px 36px', borderRadius: 13, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none' }}
          />
        </div>
        <button onClick={() => setHistoryOpen(true)} title="My purchases"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 13, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 18, cursor: 'pointer' }}>
          🧾
        </button>
      </div>

      <Categories value={cat} onChange={setCat} />

      {/* Teaching Guides */}
      <Rail
        title={{ pre: t('discovery.rail_guides_pre'), hi: t('discovery.cat_guides') }}
        accent={BRAND} count={fAgents.length} loading={lAgents}
        expanded={!!expanded.guides} onToggle={() => toggle('guides')}
        emptyText={t('discovery.no_agents')}>
        {(expanded.guides ? fAgents : fAgents.slice(0, 10)).map((a) => (
          <AgentCard key={a.id} listing={a} owned={ownedIds.has(a.agent_id)} wide={expanded.guides} onOpen={(li) => navigate(`/agent/${li.id}`)} />
        ))}
      </Rail>

      {/* Live Classes */}
      <Rail
        title={{ pre: t('discovery.rail_live_pre'), hi: t('discovery.cat_live') }}
        accent={RED} count={fLive.length} loading={lLive}
        expanded={!!expanded.live} onToggle={() => toggle('live')}
        emptyText={t('discovery.no_courses')}>
        {(expanded.live ? fLive : fLive.slice(0, 10)).map((c) => (
          <CourseCard key={c.id} course={c} wide={expanded.live} onOpen={(co) => navigate(`/course/${co.slug}`)} />
        ))}
      </Rail>

      {/* Video Courses */}
      <Rail
        title={{ pre: t('discovery.rail_video_pre'), hi: t('discovery.cat_video') }}
        accent={GREEN} count={fVideo.length} loading={lVideo}
        expanded={!!expanded.video} onToggle={() => toggle('video')}
        emptyText={t('discovery.no_courses')}>
        {(expanded.video ? fVideo : fVideo.slice(0, 10)).map((c) => (
          <CourseCard key={c.id} course={c} wide={expanded.video} onOpen={(co) => navigate(`/course/${co.slug}`)} />
        ))}
      </Rail>

      {historyOpen && <PurchaseHistorySheet onClose={() => setHistoryOpen(false)} />}
      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
