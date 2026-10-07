/**
 * billing/bits.jsx — shared pieces for the Phase 2 billing pages
 * (Subscriptions, Customers, Invoices). Pure presentational helpers matching
 * the Admin prototype's shared components.
 */

export const SUB_STATUS_LABELS = { active: 'Active', trial: 'Trial', past_due: 'Past due', canceled: 'Canceled', paused: 'Paused' };
export const INV_STATUS_LABELS = { draft: 'Draft', open: 'Open', paid: 'Paid', void: 'Void' };

/** Human-friendly display id: SUB-3F2A91C4 (uuids are unwieldy in tables). */
export const refId = (prefix, uuid) => `${prefix}-${String(uuid ?? '').slice(0, 8).toUpperCase()}`;

/** ₦1,500/mo · ₦14,400/yr · Free */
export const subPrice = (s) => s.price === 0 ? 'Free' : `₦${Number(s.price).toLocaleString()}/${s.cycle === 'annual' ? 'yr' : 'mo'}`;

export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

export const fmtWhen = (iso) => {
  if (!iso) return '—';
  const s = String(iso);
  return s.length > 10 ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : s.slice(0, 10);
};

export function SubStatusBadge({ status }) {
  return <span className={`ak-badge ak-badge-s-${status}`}>{SUB_STATUS_LABELS[status] ?? status}</span>;
}

export function InvStatusBadge({ status }) {
  return <span className={`ak-badge ak-badge-i-${status}`}>{INV_STATUS_LABELS[status] ?? status}</span>;
}

/** Client-side pagination strip (32px numbered buttons, as in the prototype). */
export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="ak-pagination">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <button key={p} className={p === page ? 'ak-page-active' : ''} onClick={() => onPage(p)}>{p}</button>
      ))}
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}

/** Search + status filter bar. */
export function Filters({ search, onSearch, children }) {
  return (
    <div className="ak-filters">
      <input type="text" placeholder={search.placeholder} value={search.value} onChange={(e) => onSearch(e.target.value)} />
      {children}
    </div>
  );
}

export function Modal({ onClose, children }) {
  return (
    <div className="ak-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ak-modal">{children}</div>
    </div>
  );
}
