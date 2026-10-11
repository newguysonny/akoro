App header for kpemu-business, akoro admin, school, instructor 

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro — App Header</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  /* Akoro tokens (from akoro-learner tailwind.config.js + ThemeContext.jsx). Set data-theme="dark" on <html> for dark. */
  :root {
    --ak-purple: #6C3BFF; --ak-purple-soft: #F1ECFF;
    --ak-danger: #EF4444; --ak-danger-text: #B91C1C; --ak-danger-soft: #FEF2F2;
    --ak-bg: #F9FAFB; --ak-surface: #FFFFFF; --ak-surface-hover: #F9FAFB;
    --ak-border: #F3F4F6; --ak-border2: #E5E7EB; --ak-border3: #D1D5DB;
    --ak-text: #111827; --ak-text-sec: #374151; --ak-text-sub: #6B7280; --ak-text-muted: #9CA3AF;
    --r-md: 12px; --r-lg: 16px; --r-full: 999px;
    --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-6: 24px;
    --ease-spring: cubic-bezier(.32, 1.2, .64, 1);
  }
  :root[data-theme="dark"] {
    --ak-purple-soft: #231C3E; --ak-danger-soft: #2B1414;
    --ak-bg: #0D1117; --ak-surface: #161B22; --ak-surface-hover: #1C2128;
    --ak-border: #21262D; --ak-border2: #30363D; --ak-border3: #484F58;
    --ak-text: #E6EDF3; --ak-text-sec: #C9D1D9; --ak-text-sub: #8B949E; --ak-text-muted: #6E7681;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--ak-bg); color: var(--ak-text); font-family: 'Nunito', system-ui, sans-serif; display: flex; justify-content: center; align-items: flex-start; -webkit-font-smoothing: antialiased; }
  .phone { width: 100%; max-width: 430px; min-height: 100vh; background: var(--ak-surface); }

  svg.icon { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  svg.ring .track { stroke: var(--ak-border3); stroke-width: 3; }
  svg.ring .arc { stroke: var(--ak-purple); stroke-width: 3; }

  /* ---------- Header ---------- */
  .ak-header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: var(--s-2);
    padding: calc(var(--s-3) + env(safe-area-inset-top, 0px)) var(--s-4) var(--s-3);
    background: var(--ak-surface); border-bottom: 1px solid var(--ak-border); }
  .hdr-spacer { flex: 1; }
  .hdr-actions { display: flex; align-items: center; gap: var(--s-2); }
  .hdr-btn { width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 0; background: none; color: var(--ak-text); font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background .15s, border-color .15s, transform .15s var(--ease-spring); }
  .hdr-btn:active, .hdr-avatar:active { transform: scale(.93); }
  .hdr-ghost { color: var(--ak-text-sub); border-radius: var(--r-md); margin-left: -6px; }
  .hdr-circle { border-radius: var(--r-full); background: var(--ak-border); }
  .hdr-circle:hover { background: var(--ak-border2); }
  .hdr-square { border-radius: var(--r-md); border: 1.5px solid var(--ak-border2); background: var(--ak-surface); }
  .hdr-square:hover { background: var(--ak-surface-hover); border-color: var(--ak-border3); }
  .hdr-avatar { width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--r-full); background: var(--ak-purple); color: #fff; font: 800 .95rem/1 'Nunito', system-ui, sans-serif; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: box-shadow .15s, transform .15s var(--ease-spring); }
  .hdr-avatar[aria-expanded="true"] { box-shadow: 0 0 0 3px var(--ak-purple-soft), 0 0 0 4.5px var(--ak-purple); }
  .hdr-btn:focus-visible, .hdr-avatar:focus-visible, .menu-item:focus-visible { outline: 2px solid var(--ak-purple); outline-offset: 2px; }

  /* ---------- Profile dropdown ---------- */
  .menu-scrim { position: fixed; inset: 0; z-index: 1; display: none; }
  .menu-scrim.show { display: block; }
  .ak-menu { position: absolute; z-index: 2; top: calc(100% + 6px); right: var(--s-3); width: min(340px, calc(100% - var(--s-6)));
    padding: var(--s-2) 0; background: var(--ak-surface); border: 1px solid var(--ak-border2); border-radius: var(--r-lg);
    box-shadow: 0 16px 40px rgba(17, 24, 39, .14), 0 2px 8px rgba(17, 24, 39, .06);
    transform-origin: top right; opacity: 0; visibility: hidden; transform: translateY(-6px) scale(.96);
    transition: opacity .15s ease, transform .22s var(--ease-spring), visibility 0s linear .22s; }
  .ak-menu.open { opacity: 1; visibility: visible; transform: none; transition: opacity .15s ease, transform .22s var(--ease-spring), visibility 0s; }
  .menu-head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4) 14px; }
  .menu-avatar { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: var(--r-full); background: var(--ak-purple); color: #fff; font-weight: 800; font-size: 1rem; }
  .menu-who { min-width: 0; }
  .menu-name { font-weight: 800; font-size: 1rem; color: var(--ak-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu-email { margin-top: 1px; font-size: .84rem; font-weight: 600; color: var(--ak-text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu-divider { height: 1px; margin: var(--s-1) 0; background: var(--ak-border2); }
  .menu-item { display: flex; align-items: center; gap: 14px; width: 100%; padding: 13px 18px; border: 0; background: none; color: var(--ak-text-sec); font: 600 .95rem/1.2 'Nunito', system-ui, sans-serif; text-align: left; cursor: pointer; }
  .menu-item:hover { background: var(--ak-surface-hover); }
  .menu-item[aria-disabled="true"] { cursor: default; }
  .menu-item[aria-disabled="true"]:hover { background: none; }
  .menu-item.danger { color: var(--ak-danger-text); }
  .menu-item.danger:hover { background: var(--ak-danger-soft); }
  .menu-item .mi-label { flex: 1; }
  .mi-badge { padding: 4px 11px; border-radius: var(--r-full); background: var(--ak-border); color: var(--ak-text-sub); font-size: .76rem; font-weight: 800; }

  /* Demo-only feedback toast */
  .toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 50; padding: 10px 16px; border-radius: var(--r-full); background: var(--ak-text); color: var(--ak-bg); font-weight: 700; font-size: .85rem; opacity: 0; pointer-events: none; transform: translate(-50%, 8px); transition: opacity .18s, transform .22s var(--ease-spring); }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (prefers-reduced-motion: reduce) {
    .ak-menu, .ak-menu.open, .toast, .hdr-btn, .hdr-avatar { transition: none; }
  }
</style>
</head>
<body>

<div class="phone">
  <header class="ak-header" id="akHeader">
    <button class="hdr-btn hdr-ghost" data-action="menu" aria-label="Open navigation" data-icon="menu" data-size="22"></button>
    <div class="hdr-spacer"></div>
    <div class="hdr-actions">
      <button class="hdr-btn hdr-circle" data-action="progress" aria-label="Setup progress" id="ringBtn"></button>
      <button class="hdr-btn hdr-square" data-action="agent" aria-label="Agent chat" data-icon="chat"></button>
      <button class="hdr-btn hdr-square" data-action="notifications" aria-label="Notifications" data-icon="bell"></button>
      <button class="hdr-btn hdr-circle" data-action="help" aria-label="Help" data-icon="help"></button>
      <button class="hdr-avatar" id="avatarBtn" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" aria-controls="akMenu"></button>
    </div>
    <div class="menu-scrim" id="menuScrim"></div>
    <div class="ak-menu" id="akMenu" role="menu" aria-label="Account menu"></div>
  </header>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
  /* ------------------------------------------------------------------
     Reuse seam: change this object per role (instructor / admin / school).
     ------------------------------------------------------------------ */
  const HEADER_CONFIG = {
    user: { name: 'Folake Adeyemi', email: 'admin@chrisland.example.com' },
    progress: 0.28, // 0–1, drawn in the ring button
    menu: [
      { key: 'profile',   label: 'Profile',      icon: 'user' },
      { key: 'settings',  label: 'All Settings', icon: 'gear' },
      { key: 'referrals', label: 'Referrals',    icon: 'users', badge: 'Soon', disabled: true },
      'divider',
      { key: 'logout',    label: 'Log out',      icon: 'logout', danger: true },
    ],
    // Called for every header button and menu item. Demo just shows a toast.
    onAction(key, label) { showToast('Mock: ' + label); },
  };

  const ICONS = {
    menu: '<rect x="3" y="3.5" width="18" height="4.5" rx="1.6"/><rect x="3" y="9.75" width="18" height="4.5" rx="1.6"/><rect x="3" y="16" width="18" height="4.5" rx="1.6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    help: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  };
  const icon = (name, size = 20) =>
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

  function ringIcon(p) {
    const c = 2 * Math.PI * 8;
    const arc = Math.max(0, Math.min(1, p)) * c;
    return `<svg class="icon ring" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
      `<circle class="track" cx="12" cy="12" r="8"/>` +
      `<circle class="arc" cx="12" cy="12" r="8" stroke-dasharray="${arc.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/></svg>`;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const header = document.getElementById('akHeader');
  const avatarBtn = document.getElementById('avatarBtn');
  const menu = document.getElementById('akMenu');
  const scrim = document.getElementById('menuScrim');
  const toastEl = document.getElementById('toast');

  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  const isOpen = () => menu.classList.contains('open');
  const enabledItems = () => Array.from(menu.querySelectorAll('.menu-item:not([aria-disabled="true"])'));

  function openMenu() {
    menu.classList.add('open');
    scrim.classList.add('show');
    avatarBtn.setAttribute('aria-expanded', 'true');
    const first = enabledItems()[0];
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu(returnFocus = true) {
    menu.classList.remove('open');
    scrim.classList.remove('show');
    avatarBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) avatarBtn.focus({ preventScroll: true });
  }

  function render() {
    const u = HEADER_CONFIG.user;
    const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();

    header.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 20);
    });
    document.getElementById('ringBtn').innerHTML = ringIcon(HEADER_CONFIG.progress);
    avatarBtn.textContent = initial;

    menu.innerHTML =
      `<div class="menu-head">
        <div class="menu-avatar" aria-hidden="true">${esc(initial)}</div>
        <div class="menu-who">
          <div class="menu-name">${esc(u.name || 'Profile')}</div>
          <div class="menu-email">${esc(u.email || '')}</div>
        </div>
      </div>
      <div class="menu-divider" role="separator"></div>` +
      HEADER_CONFIG.menu.map((item) => {
        if (item === 'divider') return '<div class="menu-divider" role="separator"></div>';
        const disabled = item.disabled ? ' aria-disabled="true" tabindex="-1"' : '';
        return `<button class="menu-item${item.danger ? ' danger' : ''}" role="menuitem" type="button" data-key="${esc(item.key)}"${disabled}>` +
          icon(item.icon, 20) +
          `<span class="mi-label">${esc(item.label)}</span>` +
          (item.badge ? `<span class="mi-badge">${esc(item.badge)}</span>` : '') +
          `</button>`;
      }).join('');
  }

  header.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      HEADER_CONFIG.onAction(actionBtn.dataset.action, actionBtn.getAttribute('aria-label'));
    }
  });

  avatarBtn.addEventListener('click', () => (isOpen() ? closeMenu() : openMenu()));
  scrim.addEventListener('click', () => closeMenu());

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    closeMenu();
    HEADER_CONFIG.onAction(item.dataset.key, item.querySelector('.mi-label').textContent);
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
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
  });

  render();
</script>
</body>
</html>
