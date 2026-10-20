/**
 * Shell.jsx — the shared app frame: the learner app's sidebar, header and
 * phone bottom nav, for any console (reference/Akoro Console Rebuild — Plan.md).
 *
 *   <Shell
 *     brand="Instructor"
 *     nav={[{ section: null | 'Teaching', items: [Item…] }]}
 *     bottom={['home', 'courses', 'battles', 'agent']}   // phone: these four + More
 *     user={{ name, role, initial }}
 *     headerRight={<…chips…/>}
 *     title subtitle action                               // the page heading
 *   >page</Shell>
 *
 *   Item: { key, label, to, end?, icon? (NavIcon name) | ti? ('ti-*'), badge?, badgeColor?, dot?,
 *           children?: [{ label, to, end?, badge? }] }  — a group: a dropdown in the
 *           open sidebar, a flyout beside its icon on the collapsed rail (the admin app's
 *           pattern), a section in the phone's More sheet.
 *
 * Tablet + desktop: the sidebar, open or the icon rail (the header's
 * hamburger; remembered; the rail by default below 1100px). Phone (≤768px):
 * no sidebar — four destinations and More in the bottom nav.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import AkoroLogo from './AkoroLogo.jsx';
import { Icon } from './Icon.jsx';
import { NavIcon } from './NavIcons.jsx';
import { BRAND, GREEN, RED, GOLD, FONT } from './tokens.js';
import './shell.css';

const COLLAPSE_KEY = 'akoro_console_sidebar_collapsed';
const initialCollapsed = () => {
  try { const v = localStorage.getItem(COLLAPSE_KEY); if (v != null) return v === '1'; } catch { /* private mode */ }
  return typeof window !== 'undefined' && window.innerWidth < 1100;
};

/** PURE: is this route (pathname) the item's page? `end` = exact. */
export const routeActive = (pathname, to, end = false) => (to === '/' || end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`));
const groupActive = (pathname, item) => (item.children || []).some((c) => routeActive(pathname, c.to, c.end));

function Badge({ count, color = BRAND, className = 'ak-sb-badge' }) {
  if (!count) return null;
  return <span className={className} style={{ minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: color, color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>{count > 99 ? '99+' : count}</span>;
}

const Glyph = ({ item, active, size = 21 }) => (item.icon
  ? <NavIcon name={item.icon} size={size} active={active}/>
  : <Icon name={item.ti || 'ti-point'} size={size - 2} color={active ? BRAND : 'var(--ak-text-sub)'}/>);

const itemStyle = (lit, open) => ({
  display: 'flex', alignItems: 'center', gap: 11, width: 'calc(100% - 20px)', padding: '10px 13px', margin: '2px 10px',
  borderRadius: 12, border: 'none', cursor: 'pointer', textDecoration: 'none', position: 'relative',
  background: lit ? `${BRAND}14` : open ? 'var(--ak-surface-hover)' : 'transparent',
  color: lit ? BRAND : open ? 'var(--ak-text)' : 'var(--ak-text-sub)',
  fontFamily: FONT, fontSize: 13.5, fontWeight: lit || open ? 800 : 600, textAlign: 'left', transition: 'background .15s, color .15s',
});

function ItemInner({ item, lit, chevron, open }) {
  return (
    <>
      <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph item={item} active={lit || open}/>
        {item.dot && <span style={{ position: 'absolute', top: -2, right: -3, width: 8, height: 8, borderRadius: '50%', background: GREEN, border: '1.5px solid var(--ak-surface)' }}/>}
      </span>
      <span className="ak-sb-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
      <Badge count={item.badge} color={item.badgeColor || BRAND}/>
      {chevron && <span className="ak-sb-chevron" style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--ak-text-muted)' }}><Icon name="ti-chevron-down" size={15}/></span>}
    </>
  );
}

/** A page inside a group: indented, a purple bar on the current page. */
function ChildLink({ child, onPick }) {
  return (
    <NavLink to={child.to} end={!!child.end} onClick={onPick} className={({ isActive }) => `ak-sb-child${isActive ? ' ak-active' : ''}`}
      style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10, textDecoration: 'none', fontFamily: FONT,
        fontSize: 13, fontWeight: isActive ? 800 : 600, color: isActive ? BRAND : 'var(--ak-text-sub)', background: isActive ? `${BRAND}12` : 'transparent' })}>
      {({ isActive }) => (
        <>
          <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: isActive ? BRAND : 'transparent' }}/>
          <span style={{ flex: 1 }}>{child.label}</span>
          <Badge count={child.badge} className="" />
        </>
      )}
    </NavLink>
  );
}

/** The collapsed rail's flyout: the group's label, then its pages, beside the icon. */
function Flyout({ group, anchor, onClose }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const a = anchor; const el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    el.style.left = `${r.right + 10}px`;
    el.style.top = `${Math.max(12, Math.min(r.top - 6, window.innerHeight - el.offsetHeight - 16))}px`;
  });
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);
  return (
    <div ref={ref} role="menu" aria-label={group.label} style={{ position: 'fixed', zIndex: 'var(--z-sheet, 2100)', minWidth: 220, background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)',
      borderRadius: 14, boxShadow: '0 14px 36px rgba(15,10,40,.18)', padding: 6, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 6px', fontSize: 10.5, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ak-text-muted)' }}>
        <Glyph item={group} active size={19}/>{group.label}
      </div>
      {group.children.map((c) => <ChildLink key={c.to} child={c} onPick={onClose}/>)}
    </div>
  );
}

function Sidebar({ brand, nav, collapsed }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => Object.fromEntries(nav.flatMap((s) => s.items).filter((i) => i.children && groupActive(pathname, i)).map((i) => [i.key, true])));
  const [fly, setFly] = useState(null);   // { item, anchor }
  useEffect(() => { if (!collapsed) setFly(null); }, [collapsed]);
  useEffect(() => { setFly(null); }, [pathname]);
  return (
    <aside className={`ak-sidebar${collapsed ? ' ak-collapsed' : ''}`} style={{ fontFamily: FONT }}>
      <div className="ak-sb-brand" style={{ padding: '20px 18px 14px', borderBottom: '1px solid var(--ak-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <AkoroLogo size={34} radius={10}/>
        <div className="ak-sb-brand-text" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.15 }}>Akoro</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', letterSpacing: '.09em', textTransform: 'uppercase' }}>{brand}</div>
        </div>
      </div>
      <nav aria-label="Main menu" style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
        {nav.map((s) => (
          <div key={s.section || 'main'}>
            {s.section && <div className="ak-sb-section" style={{ padding: '16px 23px 6px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ak-text-muted)' }}>{s.section}</div>}
            {s.items.map((item) => {
              if (!item.children) {
                return (
                  <NavLink key={item.key} to={item.to} end={item.to === '/' || !!item.end} title={item.label}
                    className={({ isActive }) => `ak-sb-item${isActive ? ' ak-active' : ''}`} style={({ isActive }) => itemStyle(isActive, false)}>
                    {({ isActive }) => <ItemInner item={item} lit={isActive}/>}
                  </NavLink>
                );
              }
              const here = groupActive(pathname, item);
              const isOpen = !collapsed && !!open[item.key];
              const flying = collapsed && fly?.item.key === item.key;
              const badge = item.children.reduce((n, c) => n + (c.badge || 0), 0);
              return (
                <div key={item.key}>
                  <button type="button" title={item.label} aria-expanded={collapsed ? flying : isOpen}
                    className={`ak-sb-item${here || flying ? ' ak-active' : ''}`} style={itemStyle(here || flying, isOpen)}
                    onClick={(e) => (collapsed
                      ? setFly(flying ? null : { item, anchor: e.currentTarget })
                      : setOpen((o) => ({ ...o, [item.key]: !o[item.key] })))}>
                    <ItemInner item={{ ...item, badge: isOpen ? 0 : badge }} lit={here || flying} open={isOpen} chevron/>
                  </button>
                  {isOpen && (
                    <div style={{ margin: '2px 12px 6px 30px', paddingLeft: 8, borderLeft: '1px solid var(--ak-border2)' }}>
                      {item.children.map((c) => <ChildLink key={c.to} child={c}/>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      {fly && <Flyout group={fly.item} anchor={fly.anchor} onClose={() => setFly(null)}/>}
    </aside>
  );
}

const roundBtn = { width: 34, height: 34, borderRadius: 100, flexShrink: 0, cursor: 'pointer', background: `${BRAND}12`, border: `1px solid ${BRAND}3D`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' };

/** A round header button (the learner's style): <HeaderButton ti="ti-bell" badge={3} onClick/> */
export function HeaderButton({ ti, label, badge = 0, onClick }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} style={roundBtn}>
      <Icon name={ti} size={17}/>
      {badge > 0 && <span style={{ position: 'absolute', top: -5, right: -6, background: RED, color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 9, padding: '1px 5px', border: '1.5px solid var(--ak-surface)' }}>{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

const pillBtn = { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${BRAND}12`, border: `1px solid ${BRAND}3D`, borderRadius: 100, width: 34, height: 34, cursor: 'pointer', flexShrink: 0 };
const countDot = (n) => n > 0 && (
  <span style={{ position: 'absolute', top: -3, right: -3, background: RED, color: '#fff', borderRadius: '50%', minWidth: 16, height: 16, padding: '0 4px', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--ak-surface)' }}>{n > 9 ? '9+' : n}</span>
);

/** The coin balance pill (the learner header's; red when low). */
export function CoinPill({ coins, low = false, onClick }) {
  return (
    <button type="button" onClick={onClick} title={low ? 'Low balance — tap to top up' : 'Coin balance'} className="ak-hdr-wide"
      style={{ display: 'flex', alignItems: 'center', gap: 5, background: low ? `${RED}14` : `${GOLD}1F`, border: `1px solid ${low ? `${RED}55` : `${GOLD}55`}`, borderRadius: 100, height: 34, padding: '0 12px', cursor: 'pointer', flexShrink: 0 }}>
      <Icon name="ti-coins" size={15} color={GOLD}/>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: low ? 'var(--ak-danger-text)' : 'var(--ak-warn-text)', fontFamily: FONT }}>{(coins || 0).toLocaleString()}</span>
    </button>
  );
}

/** The cart button (the learner header's). */
export function CartButton({ count = 0, onClick }) {
  return (
    <button type="button" onClick={onClick} title="Cart" aria-label="Cart" style={pillBtn}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      {countDot(count)}
    </button>
  );
}

/** The notifications bell (the learner header's). */
export function BellButton({ count = 0, onClick }) {
  return (
    <button type="button" onClick={onClick} title="Notifications" aria-label="Notifications" style={pillBtn}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      {countDot(count)}
    </button>
  );
}

/** "Agent online / offline" — the learner header's toggle; it switches the agent's proactive work. */
export function AgentToggle({ online, loaded = true, saving = false, onToggle, onTitle, offTitle }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={online} disabled={!loaded || saving}
      aria-label={online ? 'Turn autonomous Agent offline' : 'Turn autonomous Agent online'}
      title={online ? onTitle : offTitle}
      style={{ display: 'flex', alignItems: 'center', background: `${BRAND}12`, borderRadius: 100, padding: 4, cursor: loaded && !saving ? 'pointer' : 'wait', border: `1px solid ${BRAND}3D`, opacity: loaded ? 1 : 0.7, flexShrink: 0 }}>
      <span style={{ padding: '4px 12px', borderRadius: 100, background: online ? BRAND : 'transparent', color: online ? '#fff' : 'var(--ak-text-muted)', fontSize: 11, fontWeight: 700, transition: 'all .22s ease', display: 'flex', alignItems: 'center', gap: 5, fontFamily: FONT, whiteSpace: 'nowrap' }}>
        {online && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }}/>}
        {saving ? 'Saving…' : online ? 'Agent online' : 'Agent offline'}
      </span>
    </button>
  );
}

function Header({ user, headerRight, onToggle, collapsed, onProfile, online }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))', background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', flexShrink: 0, fontFamily: FONT }}>
      <button type="button" onClick={onToggle} className="ak-sb-toggle" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} style={roundBtn}>
        <Icon name="ti-menu-2" size={17}/>
      </button>
      <button type="button" onClick={onProfile} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0, textAlign: 'left', fontFamily: FONT }}>
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${BRAND}, #8B5CF6)`, color: '#fff', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{user?.initial || 'A'}</span>
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', background: online === false ? 'var(--ak-text-muted)' : GREEN, border: '2px solid var(--ak-surface)' }}/>
        </span>
        <span style={{ lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 900, fontSize: 14.5, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || ''}</span>
          {(user?.sub || user?.role) && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.sub || user.role}</span>}
        </span>
      </button>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerRight}</div>
    </div>
  );
}

const MORE = { key: '__more', label: 'More', ti: 'ti-layout-grid' };

function BottomNav({ nav, bottom, onMore, moreOpen }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const all = nav.flatMap((s) => s.items);
  const picks = bottom.map((k) => all.find((i) => i.key === k)).filter(Boolean);
  const anyPicked = picks.some((i) => (i.children ? groupActive(pathname, i) : routeActive(pathname, i.to, i.end)));
  return (
    <div className="ak-bottom-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 'var(--z-nav, 200)', background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)',
      padding: '8px 0 env(safe-area-inset-bottom, 14px)', justifyContent: 'space-around', minHeight: 62, fontFamily: FONT }}>
      {[...picks, MORE].map((item) => {
        const active = item === MORE ? moreOpen || !anyPicked : (item.children ? groupActive(pathname, item) : routeActive(pathname, item.to, item.end));
        return (
          <button type="button" key={item.key} onClick={() => (item === MORE ? onMore() : navigate(item.to))}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', color: active ? BRAND : 'var(--ak-text-muted)', minWidth: 56, padding: '2px 0', background: 'none', border: 'none', fontFamily: FONT }}>
            <span style={{ position: 'relative', display: 'inline-flex', height: 24, alignItems: 'center' }}>
              {item.icon ? <NavIcon name={item.icon} size={24} active={active}/> : <Icon name={item.ti} size={22} color={active ? BRAND : 'var(--ak-text-sub)'}/>}
              {item.badge > 0 && <span style={{ position: 'absolute', top: -3, right: -6, minWidth: 14, height: 14, borderRadius: 7, background: item.badgeColor || BRAND, color: '#fff', fontSize: 8, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{item.badge}</span>}
              {item.dot && <span style={{ position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: '50%', background: GREEN, border: '1.5px solid var(--ak-surface)' }}/>}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: active ? 800 : 600 }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Phone: everything the bottom nav doesn't carry, as a sheet — groups as their own sections. */
function MoreSheet({ nav, bottom, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rest = nav.map((s) => ({ ...s, items: s.items.filter((i) => !bottom.includes(i.key)) })).filter((s) => s.items.length);
  const row = (to, label, glyph, badge, end) => (
    <NavLink key={to} to={to} end={!!end} onClick={onClose} style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, textDecoration: 'none',
      fontSize: 14, fontWeight: isActive ? 800 : 700, color: isActive ? BRAND : 'var(--ak-text)', background: isActive ? `${BRAND}12` : 'transparent' })}>
      <span style={{ width: 24, display: 'inline-flex', justifyContent: 'center' }}>{glyph}</span><span style={{ flex: 1 }}>{label}</span><Badge count={badge} className=""/>
    </NavLink>
  );
  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet-back, 2000)', background: 'var(--ak-overlay)' }}/>
      <div role="dialog" aria-label="More" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-sheet, 2100)', maxHeight: '82vh', overflowY: 'auto', background: 'var(--ak-surface)',
        borderRadius: '22px 22px 0 0', padding: '10px 12px calc(18px + env(safe-area-inset-bottom, 0px))', fontFamily: FONT, animation: 'ak-sheet-up .22s var(--ease-spring)' }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--ak-border2)', margin: '2px auto 10px' }}/>
        {rest.map((s) => (
          <div key={s.section || 'main'} style={{ marginBottom: 6 }}>
            {s.section && <div style={{ padding: '10px 14px 4px', fontSize: 10, fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ak-text-muted)' }}>{s.section}</div>}
            {s.items.map((item) => (item.children
              ? (
                <div key={item.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px 4px', fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)' }}>
                    <span style={{ width: 24, display: 'inline-flex', justifyContent: 'center' }}><Glyph item={item} active size={20}/></span>{item.label}
                  </div>
                  <div style={{ marginLeft: 36 }}>{item.children.map((c) => row(c.to, c.label, null, c.badge, c.end))}</div>
                </div>
              )
              : row(item.to, item.label, <Glyph item={item} active size={22}/>, item.badge, item.end)))}
          </div>
        ))}
      </div>
      <style>{'@keyframes ak-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }'}</style>
    </>
  );
}

/**
 * bare: the page owns the whole content area (a chat): no gutter, no heading.
 * wide (default): lift the old layouts' width caps so lists and cards use the
 * full width, like the learner app; false keeps a page's own readable width (forms).
 */
export default function Shell({ brand, nav, bottom = [], user, online, headerRight, onProfile, title, subtitle, action, bare = false, wide = true, children }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* private mode */ } return !c; });
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--ak-bg)', fontFamily: FONT, color: 'var(--ak-text)' }}>
      <Sidebar brand={brand} nav={nav} collapsed={collapsed}/>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <Header user={user} online={online} headerRight={headerRight} onToggle={toggle} collapsed={collapsed} onProfile={onProfile}/>
        <main className={`ak-shell-main${bare ? ' ak-bare' : ''}${wide && !bare ? ' ak-wide' : ''}`}
          style={bare ? { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : { flex: 1, overflowY: 'auto', padding: 16 }}>
          {!bare && (title || subtitle || action) && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {title && <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 3px' }}>{title}</h1>}
                {subtitle && <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ak-text-sub)', margin: 0 }}>{subtitle}</p>}
              </div>
              {action && <div style={{ flexShrink: 0 }}>{action}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
      <BottomNav nav={nav} bottom={bottom} onMore={() => setMoreOpen((o) => !o)} moreOpen={moreOpen}/>
      {moreOpen && <MoreSheet nav={nav} bottom={bottom} onClose={() => setMoreOpen(false)}/>}
    </div>
  );
}
