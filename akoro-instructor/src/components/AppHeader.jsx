/**
 * AppHeader.jsx — the shared Akoro app header, ported from the approved
 * reference ("Akoro app [header]"): hamburger | spacer | [progress ring ·
 * agent chat · notifications · help] · avatar with an account menu.
 *
 * The reference is config-driven per role, and so is this: every console
 * now passes the full set — `progress` + `onSetup` (the ring navigates to
 * the app's setup surface), the actions it has a real destination for
 * (chat / messages, notifications, help), and the account menu.
 *
 * Keyboard + a11y are the reference's, exactly: the menu opens focused on
 * its first enabled item, ArrowUp/Down/Home/End move through it, Escape
 * closes (focus returns to the avatar), Tab dismisses, the scrim closes,
 * and aria-expanded/haspopup/controls describe the state.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import './AppHeader.css';

const ICON_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

/* The reference's progress-ring button — drawn only when `progress` is given. */
function ProgressRing({ value }) {
  const c = 2 * Math.PI * 8;
  const arc = Math.max(0, Math.min(1, value ?? 0)) * c;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={ICON_STROKE}>
      <circle className="akhdr-ring-track" cx="12" cy="12" r="8" style={{ stroke: 'var(--akhd-border3)', strokeWidth: 3 }} />
      <circle className="akhdr-ring-arc" cx="12" cy="12" r="8" style={{ stroke: 'var(--akhd-purple)', strokeWidth: 3, strokeDasharray: `${arc.toFixed(2)} ${c.toFixed(2)}`, transform: 'rotate(-90 12 12)' }} />
    </svg>
  );
}

export default function AppHeader({
  onMenu,
  user,
  progress = null,          // 0–1 → renders the ring button; null → omitted
  onSetup,                  // ring click → the app's setup surface
  actions = [],             // [{ key, icon: Icon, label, title, variant: 'circle'|'square'|'ghost', onClick }]
  menuItems = [],           // [{ key, label, icon: Icon, danger?, disabled?, badge?, to?, onClick? }]
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const avatarRef = useRef(null);
  const menuRef = useRef(null);

  const name = user?.fullName || user?.name || '';
  const email = user?.email || '';
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();

  const enabledItems = () =>
    menuRef.current
      ? Array.from(menuRef.current.querySelectorAll('.akhdr-item:not([aria-disabled="true"])'))
      : [];

  const closeMenu = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) avatarRef.current?.focus({ preventScroll: true });
  };

  const openMenu = () => {
    setOpen(true);
    // Focus lands after the menu mounts/animates in — the reference focuses
    // the first enabled item immediately on open.
    requestAnimationFrame(() => enabledItems()[0]?.focus({ preventScroll: true }));
  };

  // Reference keyboard model, on document while open: Escape closes (focus
  // returns), Tab dismisses, ArrowUp/Down/Home/End walk the enabled items.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
      if (e.key === 'Tab') { closeMenu(false); return; }
      const list = enabledItems();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowDown') next = (i + 1) % list.length;
      else if (e.key === 'ArrowUp') next = i <= 0 ? list.length - 1 : i - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      if (next !== null) { e.preventDefault(); list[next].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const runItem = (item) => {
    if (item.disabled) return;
    closeMenu(false);
    if (item.onClick) item.onClick();
    else if (item.to) navigate(item.to);
  };

  return (
    <header className="akhdr akhdr-header">
      <button type="button" className="akhdr-btn akhdr-ghost" onClick={onMenu} aria-label="Open navigation" title="Open navigation">
        <Menu size={20} strokeWidth={2} />
      </button>

      <div className="akhdr-spacer" />

      <div className="akhdr-actions">
        {progress != null && (
          <button type="button" className="akhdr-btn akhdr-circle" aria-label="Setup progress" title="Setup progress" onClick={onSetup}>
            <ProgressRing value={progress} />
          </button>
        )}
        {actions.map(({ key, icon: Icon, label, title, variant = 'square', onClick }) => (
          <button
            key={key} type="button"
            className={`akhdr-btn akhdr-${variant}`}
            aria-label={label} title={title || label}
            onClick={onClick}
          >
            <Icon size={20} strokeWidth={2} />
          </button>
        ))}
        <button
          type="button" ref={avatarRef} className="akhdr-avatar"
          onClick={() => (open ? closeMenu() : openMenu())}
          aria-label="Account menu" aria-haspopup="menu"
          aria-expanded={open} aria-controls="akhdrAccountMenu"
        >
          {initial}
        </button>
      </div>

      {/* The scrim is transparent — its only job is click-outside-to-close,
          exactly as in the reference. */}
      <div className={`akhdr-scrim${open ? ' show' : ''}`} onClick={() => closeMenu()} aria-hidden="true" />
      <div id="akhdrAccountMenu" ref={menuRef} className={`akhdr-menu${open ? ' open' : ''}`} role="menu" aria-label="Account menu">
        <div className="akhdr-menu-head">
          <div className="akhdr-menu-avatar" aria-hidden="true">{initial}</div>
          <div className="akhdr-menu-who">
            <div className="akhdr-menu-name">{name || 'Profile'}</div>
            {email && <div className="akhdr-menu-email">{email}</div>}
          </div>
        </div>
        {menuItems.length > 0 && <div className="akhdr-divider" role="separator" />}
        {menuItems.map((item, idx) => (
          item === 'divider' ? (
            <div key={`div-${idx}`} className="akhdr-divider" role="separator" />
          ) : (
            <button
              key={item.key} type="button" role="menuitem"
              className={`akhdr-item${item.danger ? ' danger' : ''}`}
              aria-disabled={item.disabled ? 'true' : undefined}
              tabIndex={item.disabled ? -1 : undefined}
              onClick={() => runItem(item)}
            >
              {item.icon && <item.icon size={20} strokeWidth={2} />}
              <span className="akhdr-mi-label">{item.label}</span>
              {item.badge && <span className="akhdr-badge">{item.badge}</span>}
            </button>
          )
        ))}
      </div>
    </header>
  );
}
