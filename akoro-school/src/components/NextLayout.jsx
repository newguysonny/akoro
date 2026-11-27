/**
 * NextLayout — the school app in the shared frame (the "next" look): the
 * learner app's sidebar, header and phone bottom nav, from the UI kit
 * (src/ui, synced from design-system/ui). Same destinations as the legacy
 * Layout.jsx: NAV_SECTIONS stays the nav's data source (Layout.jsx) and is
 * converted here; the module gates (owned + enabled) are the legacy
 * Sidebar's, unchanged. See reference/Akoro Console Rebuild — Plan.md.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Banknote, Landmark, Users, GraduationCap, DoorOpen,
  ClipboardList, Layers, Laptop, UserCog, UserCheck, CalendarClock, NotebookPen,
  ClipboardCheck, QrCode, BookOpenCheck, Award, Megaphone, Library, Package,
  Bus, BedDouble, LifeBuoy, Boxes, BarChart3, CreditCard, LayoutGrid,
  MessageSquare, Coins, PanelsTopLeft, BookOpen, Swords, ListTodo, FileCheck,
  Store, User, ShieldQuestion,
} from 'lucide-react';
import { Shell, BellButton, HeaderButton } from '../ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet } from '../services/api.js';
import { NAV_SECTIONS } from './Layout.jsx';

/* The legacy nav's lucide glyphs → the learner look's Tabler names (checked
   against the installed @tabler/icons-webfont by the console-ui-kit
   contract test). A few destinations use the kit's drawn NavIcons instead. */
const TI_BY_ICON = new Map([
  [LayoutDashboard, 'ti-layout-dashboard'],
  [Banknote, 'ti-cash-banknote'],
  [Landmark, 'ti-building-bank'],
  [Users, 'ti-users'],
  [GraduationCap, 'ti-school'],
  [DoorOpen, 'ti-door-enter'],
  [ClipboardList, 'ti-clipboard-list'],
  [Layers, 'ti-stack-2'],
  [Laptop, 'ti-device-laptop'],
  [UserCog, 'ti-user-cog'],
  [UserCheck, 'ti-user-check'],
  [CalendarClock, 'ti-calendar-clock'],
  [NotebookPen, 'ti-notebook'],
  [ClipboardCheck, 'ti-clipboard-check'],
  [QrCode, 'ti-qrcode'],
  [BookOpenCheck, 'ti-bookmark-check'],
  [Award, 'ti-award'],
  [Megaphone, 'ti-speakerphone'],
  [Library, 'ti-library'],
  [Package, 'ti-package'],
  [Bus, 'ti-bus'],
  [BedDouble, 'ti-bed'],
  [LifeBuoy, 'ti-lifebuoy'],
  [Boxes, 'ti-packages'],
  [BarChart3, 'ti-chart-bar'],
  [CreditCard, 'ti-credit-card'],
  [LayoutGrid, 'ti-layout-grid'],
  [MessageSquare, 'ti-message'],
  [Coins, 'ti-coins'],
  [PanelsTopLeft, 'ti-layout-board'],
  [BookOpen, 'ti-book'],
  [Swords, 'ti-swords'],
  [ListTodo, 'ti-list-check'],
  [FileCheck, 'ti-file-check'],
  [Store, 'ti-building-store'],
  [User, 'ti-user'],
  [ShieldQuestion, 'ti-shield-question'],
]);

/* Destinations the kit draws a brand icon for (src/ui/NavIcons.jsx). */
const DRAWN_BY_KEY = {
  academics: 'gradebook',
  battles: 'battles',
  'ai-chat': 'agent',
  'content-library': 'library',
  'settings-billing': 'settings',
  'wallet-ai-credits': 'wallet',
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** PURE: NAV_SECTIONS (Layout.jsx) → the shared frame's nav data.
 *  The legacy module gates, unchanged: a moduleKey item shows only when the
 *  school owns the module (moduleAccess) and hasn't switched it off
 *  (modules); until settings load (modules == null) nothing is hidden. */
export function schoolNav({ modules = null, access = null } = {}) {
  const isModuleOn = (key) => {
    if (!key || !modules) return true;
    if (access && access[key] !== true) return false;
    return modules[key] !== false;
  };
  const convert = (item) => {
    const key = slug(item.label);
    const out = { key, label: item.label };
    if (DRAWN_BY_KEY[key]) out.icon = DRAWN_BY_KEY[key];
    else out.ti = TI_BY_ICON.get(item.icon) || 'ti-point';
    if (item.children) {
      // String children are the legacy tree's inert placeholders ("pages not
      // built yet"); the shared frame's children are links, so they are
      // left out here (they navigated nowhere in the legacy frame either).
      out.children = item.children
        .filter((c) => typeof c !== 'string')
        .map((c) => ({ label: c.label, to: c.to }));
      return out.children.length ? out : null;
    }
    // An inert leaf (to '#') has no page; the shared frame has no inert
    // item, so it is left out (it navigated nowhere in the legacy frame).
    if (!item.to || item.to === '#') return null;
    out.to = item.to;
    return out;
  };
  return NAV_SECTIONS
    .map((sec) => ({
      section: sec.section,
      items: sec.items.filter((item) => isModuleOn(item.moduleKey)).map(convert).filter(Boolean),
    }))
    .filter((sec) => sec.items.length);
}
export const SCHOOL_BOTTOM = ['dashboard', 'courses', 'ai-chat', 'wallet-ai-credits'];

/* The school's enabled/disabled modules — the legacy Sidebar's loader,
   kept fresh on focus and on the Module Management page's event. */
function useSchoolModules() {
  const [state, setState] = useState({ modules: null, access: null });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiGet('/api/school/settings')
        .then((res) => {
          if (cancelled) return;
          setState({ modules: res.data?.modules || {}, access: res.data?.moduleAccess || {} });
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('akoro:modules-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
      window.removeEventListener('akoro:modules-updated', load);
    };
  }, []);
  return state;
}

/* Unread notifications for the bell — the legacy BellButton's poll. */
function useUnreadNotifications() {
  const [unread, setUnread] = useState(0);
  const poll = useCallback(async () => {
    try { const res = await apiGet('/api/notifications?limit=1'); setUnread(res.unread ?? 0); } catch { /* offline: keep last count */ }
  }, []);
  useEffect(() => {
    poll();
    const t = setInterval(poll, 60_000);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [poll]);
  return unread;
}

export default function NextLayout({ children, title, subtitle, action }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { modules, access } = useSchoolModules();
  const unread = useUnreadNotifications();
  const name = user?.fullName || 'School Admin';
  return (
    <Shell
      brand="School Portal"
      nav={schoolNav({ modules, access })}
      bottom={SCHOOL_BOTTOM}
      user={{ name, initial: name[0].toUpperCase(), sub: user?.email || '' }}
      onProfile={() => navigate('/profile')}
      title={title} subtitle={subtitle} action={action}
      headerRight={(
        <>
          <BellButton count={unread} onClick={() => navigate('/notifications')}/>
          <HeaderButton ti="ti-logout" label="Sign out" onClick={logout}/>
        </>
      )}
    >
      {children}
    </Shell>
  );
}
