/** The profile drawer's rows for this learner → [{ key, icon, label, to, wallet? }]. Pure (tested without a browser). */
export function drawerItems({ higherEd = false, gradebookGated = false } = {}) {
  return [
    { key: 'orders', icon: 'ti-receipt', label: 'settings.order_history', to: '/orders' },
    higherEd
      ? { key: 'communities', icon: 'ti-users', label: 'settings.communities', to: '/communities' }
      : { key: 'activities', icon: 'ti-activity', label: 'settings.activities', to: '/activities' },
    ...(higherEd ? [] : [{ key: 'gradebook', icon: 'ti-notebook', label: 'settings.gradebook', to: gradebookGated ? '/upgrade?trigger=gradebook' : '/gradebook' }]),
    { key: 'library', icon: 'ti-books', label: 'settings.library', to: '/library' },
    { key: 'wallet', icon: 'ti-coins', label: 'nav.wallet', to: '/wallet', wallet: true },
  ];
}

/** The tier pill: free and trial learners get an upgrade nudge that opens the upgrade page; paid tiers open Plan & Usage. */
export function tierPill(plan) {
  const raw = String(plan || 'Free').trim() || 'Free';
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  const unpaid = /^(free|trial)$/i.test(name);
  return { name, unpaid, to: unpaid ? '/upgrade' : '/settings/plan' };
}
