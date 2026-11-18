/**
 * ProfileDrawer — the phone's profile menu. Tapping the profile photo slides this in from the left (like the X app's
 * account drawer). Top row = the Settings page's header: avatar, name and @handle, the Settings icon (→ /settings) and
 * the "…" menu (Edit profile, Log out), then the tier pill. Below: the learner's own pages — Order history, Activities (Communities for
 * higher-ed), Gradebook (paywall kept), Library, Wallet — and a Log out row.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, MoreHorizontal, Pencil, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useLang } from '../contexts/LanguageContext.jsx';
import { Icon } from './common/Icons.jsx';
import { featureGated, effectivePlan } from '../utils/planOverride.js';
import { drawerItems, tierPill } from './drawerItems.js';
import { tr } from '../pages/settings/groups.js';
import { LogoutModal } from '../pages/settings/sheets.jsx';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import InstallInstructionsSheet from './common/InstallInstructionsSheet.jsx';

const BRAND = '#6C3BFF';

export default function ProfileDrawer({ open, onClose, profile, higherEd = false, coinBalance = 0 }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { t } = useLang();
  const [menu, setMenu] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { hidden: installHidden, canPrompt, platform, promptInstall } = usePwaInstall();

  useEffect(() => {
    if (!open) { setMenu(false); return undefined; }
    const onKey = (e) => { if (e.key === 'Escape') (menu ? setMenu(false) : onClose()); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, menu, onClose]);

  if (!open && !confirmOut && !sheetOpen) return null;
  const go = (to) => { onClose(); navigate(to); };
  const onInstall = async () => {
    if (canPrompt) { const p = promptInstall(); onClose(); await p; return; }
    setSheetOpen(true);   // no native prompt on this browser — show its exact steps
    onClose();
  };
  const name = profile?.fullName || profile?.username || '…';
  const items = drawerItems({ higherEd, gradebookGated: !!featureGated('Gradebook') });
  const label = (k) => tr(t, k, { 'nav.wallet': 'Wallet' }[k] || k);
  const tier = tierPill(effectivePlan(profile?.plan));
  const round = { width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ak-tag-bg)', border: '1px solid var(--ak-border2)', cursor: 'pointer', padding: 0 };

  return (
    <>
      {open && (
        <div data-testid="profile-drawer-backdrop" onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(10,10,25,.5)' }}>
          <aside role="dialog" aria-modal="true" aria-label={tr(t, 'drawer.account', 'Your account')} data-testid="profile-drawer" onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(84vw, 340px)', background: 'var(--ak-surface)', boxShadow: '8px 0 30px rgba(17,24,39,.25)', display: 'flex', flexDirection: 'column', fontFamily: "'Nunito',sans-serif", animation: 'ak-drawer-in .2s ease-out', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <style>{'@keyframes ak-drawer-in{from{transform:translateX(-100%)}to{transform:none}}'}</style>

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 18px 0' }}>
              {profile?.avatarUrl
                ? <img src={profile.avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${BRAND}` }}/>
                : <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 22, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{name.trim().charAt(0).toUpperCase()}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                <button type="button" onClick={() => go('/settings')} title="Settings" aria-label="Settings" data-testid="drawer-settings" style={round}>
                  <SettingsIcon size={16} color="var(--ak-text-sub)"/>
                </button>
                <button type="button" onClick={() => setMenu((m) => !m)} title="More" aria-label="More options" aria-haspopup="menu" aria-expanded={menu} style={round}>
                  <MoreHorizontal size={16} color="var(--ak-text-sub)"/>
                </button>
                {menu && (
                  <div role="menu" aria-label="More options" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 2, minWidth: 190, padding: '8px 0', background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)', borderRadius: 16, boxShadow: '0 16px 40px rgba(17,24,39,.18)' }}>
                    <button role="menuitem" type="button" onClick={() => go('/settings/profile')} style={menuBtn('var(--ak-text-sec)')}><Pencil size={16}/> {tr(t, 'drawer.edit_profile', 'Edit profile')}</button>
                    <button role="menuitem" type="button" onClick={() => { setMenu(false); setConfirmOut(true); }} style={menuBtn('var(--ak-danger-text, #B91C1C)')}><LogOut size={16}/> {tr(t, 'drawer.logout', 'Log out')}</button>
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: '12px 18px 14px' }}>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
              {profile?.username && <p style={{ margin: '2px 0 0', fontSize: 13.5, fontWeight: 600, color: 'var(--ak-text-muted)' }}>@{profile.username}</p>}
              <button type="button" onClick={() => go(tier.to)} data-testid="drawer-tier" aria-label={`Plan: ${tier.name}${tier.unpaid ? ' — upgrade' : ''}`}
                style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 900,
                  border: `1px solid ${BRAND}40`, background: tier.unpaid ? 'var(--ak-tag-bg)' : `${BRAND}14`, color: tier.unpaid ? 'var(--ak-text-sub)' : BRAND }}>
                <Icon name="ti-bolt" size={13} color={tier.unpaid ? 'var(--ak-text-sub)' : BRAND}/>
                {tier.name}
                {tier.unpaid && <span style={{ color: BRAND }}>· {tr(t, 'drawer.upgrade', 'Upgrade')} →</span>}
              </button>
            </div>

            <nav aria-label="Your pages" style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px', borderTop: '1px solid var(--ak-border)' }}>
              {items.map((it) => (
                <button key={it.key} type="button" onClick={() => go(it.to)} data-testid={`drawer-${it.key}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 18, width: '100%', padding: '15px 20px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito',sans-serif" }}>
                  <Icon name={it.icon} size={24} color="var(--ak-text)"/>
                  <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: 'var(--ak-text)' }}>{label(it.label)}</span>
                  {it.wallet && <span style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text-muted)' }}>{(coinBalance || 0).toLocaleString()}</span>}
                </button>
              ))}
              {!installHidden && (
                <button type="button" onClick={onInstall} data-testid="drawer-install"
                  style={{ display: 'flex', alignItems: 'center', gap: 18, width: '100%', padding: '15px 20px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito',sans-serif" }}>
                  <Icon name="ti-download" size={24} color="var(--ak-text)"/>
                  <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: 'var(--ak-text)' }}>{tr(t, 'drawer.install_app', 'Install app')}</span>
                </button>
              )}
            </nav>
            <div style={{ borderTop: '1px solid var(--ak-border)', padding: '6px 0' }}>
              <button type="button" onClick={() => setConfirmOut(true)} data-testid="drawer-logout"
                style={{ display: 'flex', alignItems: 'center', gap: 18, width: '100%', padding: '14px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", color: 'var(--ak-danger-text, #B91C1C)' }}>
                <LogOut size={22}/> <span style={{ fontSize: 17, fontWeight: 800 }}>{tr(t, 'drawer.logout', 'Log out')}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
      {confirmOut && <LogoutModal onClose={() => setConfirmOut(false)} onConfirm={() => { setConfirmOut(false); onClose(); logout(); }}/>}
      <InstallInstructionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} platform={platform} />
    </>
  );
}

const menuBtn = (color) => ({ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px', border: 'none', background: 'none', color, fontFamily: "'Nunito',sans-serif", fontSize: 13.5, fontWeight: 700, textAlign: 'left', cursor: 'pointer' });
