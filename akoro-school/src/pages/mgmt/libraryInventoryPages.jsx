/** Library + Inventory module pages (mgmt schema). */
import { useState, useEffect, useCallback } from 'react';
import { Library, BookOpen, PackageOpen, Package, AlertTriangle, ShoppingCart, Truck, Undo2 } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};
const lbl = { fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 5 };

/* ═══ LIBRARY ═══ */
export function LibraryDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/library`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.titles, label: 'Book Titles', icon: Library, ti: 'ti-books', c: BLUE, to: '/mgmt/manage-books' },
    { n: s.totalCopies, label: 'Total Copies', icon: BookOpen, ti: 'ti-book', c: PURPLE, to: '/mgmt/manage-books' },
    { n: s.availableCopies, label: 'Available Copies', icon: BookOpen, ti: 'ti-book', c: GREEN, to: '/mgmt/manage-books' },
    { n: s.activeLoans, label: 'Books Out', icon: Undo2, ti: 'ti-arrow-back-up', c: C.brand, to: '/mgmt/issue-return-book' },
    { n: s.categories, label: 'Categories', icon: Library, ti: 'ti-books', c: BLUE, to: '/mgmt/book-categories' },
  ] : [];
  return <PageLayout title="Library Dashboard" subtitle="Collection and loans at a glance"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function IssueReturnBookPage() {
  const [books, setBooks] = useState([]);
  const [students, setStudents] = useState([]);
  const [loans, setLoans] = useState([]);
  const [bookId, setBookId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [borrower, setBorrower] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`${BASE}/books`).then((r) => setBooks(r.data || [])).catch(() => {});
    apiGet(`${BASE}/book-loans?status=issued`).then((r) => setLoans(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    apiGet(`${BASE}/students?status=active`).then((r) => setStudents(r.data || [])).catch(() => {});
    load();
  }, [load]);

  const issue = async () => {
    if (!bookId) return showToast('Pick a book');
    setBusy(true);
    try {
      await apiPost(`${BASE}/library/issue`, { book_id: bookId, student_id: studentId || undefined, borrower_name: borrower || undefined, due_on: dueOn || undefined });
      showToast('Book issued ✓'); setBookId(''); setStudentId(''); setBorrower(''); setDueOn(''); load();
    } catch (e) { showToast(e.message || 'Could not issue'); }
    finally { setBusy(false); }
  };

  const doReturn = async (loanId) => {
    try { await apiPost(`${BASE}/library/return/${loanId}`, {}); showToast('Book returned ✓'); load(); }
    catch (e) { showToast(e.message || 'Could not return'); }
  };

  return (
    <PageLayout title="Issue / Return Book" subtitle="Lend and collect library books">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxWidth: 400, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
          <p style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, margin: '0 0 14px', fontFamily: C.font }}>Issue a Book</p>
          <label style={lbl}>Book</label>
          <select value={bookId} onChange={(e) => setBookId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}>
            <option value="">— select book —</option>
            {books.map((b) => <option key={b.id} value={b.id} disabled={b.copies_available < 1}>{b.title} ({b.copies_available} avail.)</option>)}
          </select>
          <label style={lbl}>Student</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}>
            <option value="">— optional —</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.admission_no})</option>)}
          </select>
          <label style={lbl}>Or borrower name</label>
          <input value={borrower} onChange={(e) => setBorrower(e.target.value)} placeholder="Staff / external borrower" style={{ ...inputStyle, marginBottom: 12 }} />
          <label style={lbl}>Due Date</label>
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
          <button onClick={issue} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: C.font }}>
            {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-book" size={14} />} Issue Book
          </button>
        </div>

        <div style={{ flex: '1.4 1 380px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontFamily: C.font, fontSize: 13, fontWeight: 800, color: C.ink }}>Books Out ({loans.length})</div>
          {loans.length === 0 ? (
            <div style={{ padding: '26px', textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}>No books currently on loan.</div>
          ) : loans.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontFamily: C.font, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{l.book_name}</span>
                <span style={{ display: 'block', fontSize: 11, color: C.muted2 }}>{l.student_name || l.borrower_name || 'Unknown'} · due {l.due_on || '—'}</span>
              </div>
              <button onClick={() => doReturn(l.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', background: tint(8, GREEN), color: GREEN, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                <Ico ti="ti-arrow-back-up" size={12} /> Return
              </button>
            </div>
          ))}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function ManageBooksPage() {
  return <ResourcePage title="Manage Books" subtitle="The library catalogue" resource="books"
    columns={[
      { key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'category_name', label: 'Category' },
      { key: 'shelf', label: 'Shelf' }, { key: 'copies_available', label: 'Available', render: (r) => <b style={{ color: r.copies_available > 0 ? GREEN : RED }}>{r.copies_available}/{r.copies_total}</b> },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'author', label: 'Author' },
      { key: 'isbn', label: 'ISBN' },
      { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'book-categories' } },
      { key: 'shelf', label: 'Shelf' },
      { key: 'copies_total', label: 'Total Copies', type: 'number', default: 1 },
      { key: 'copies_available', label: 'Available Copies', type: 'number', default: 1 },
    ]} listFilters={[{ key: 'category_id', label: 'Category', optionsFrom: { resource: 'book-categories' } }]}
    searchKeys={['title', 'author', 'isbn']} createLabel="Add Book" />;
}

export function BookCategoriesPage() {
  return <ResourcePage title="Book Categories" subtitle="Organise the catalogue" resource="book-categories"
    columns={[{ key: 'name', label: 'Category' }]} fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

/* ═══ INVENTORY ═══ */
export function InventoryDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/inventory`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.items, label: 'Items', icon: Package, ti: 'ti-package', c: BLUE, to: '/mgmt/item-list' },
    { n: s.lowStock, label: 'Low Stock', icon: AlertTriangle, ti: 'ti-alert-triangle', c: RED, to: '/mgmt/item-list' },
    { n: naira(s.stockValue), label: 'Stock Value', icon: Package, ti: 'ti-package', c: GREEN },
    { n: naira(s.salesTotal), label: 'POS Sales', icon: ShoppingCart, ti: 'ti-shopping-cart', c: PURPLE, to: '/mgmt/sales-history' },
    { n: s.suppliers, label: 'Suppliers', icon: Truck, ti: 'ti-truck', c: C.brand, to: '/mgmt/suppliers' },
    { n: s.openOrders, label: 'Open Purchase Orders', icon: PackageOpen, ti: 'ti-package', c: BLUE, to: '/mgmt/purchase-orders' },
  ] : [];
  return <PageLayout title="Inventory Dashboard" subtitle="Stock, sales and suppliers"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

/* Shared inventory transaction page (stock in / issue out / POS sale). */
function InventoryTxnPage({ title, subtitle, endpoint, cta, fields, listResource, columns }) {
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({});
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`${BASE}/${listResource}`).then((r) => setRows(r.data || [])).catch(() => {});
    apiGet(`${BASE}/inventory-items`).then((r) => setItems(r.data || [])).catch(() => {});
  }, [listResource]);
  useEffect(() => {
    load();
    apiGet(`${BASE}/inventory-suppliers`).then((r) => setSuppliers(r.data || [])).catch(() => {});
  }, [load]);

  const submit = async () => {
    if (!form.item_id || !form.quantity) return showToast('Pick an item and quantity');
    setBusy(true);
    try {
      await apiPost(`${BASE}/${endpoint}`, form);
      showToast('Recorded ✓'); setForm({}); load();
    } catch (e) { showToast(e.message || 'Could not record'); }
    finally { setBusy(false); }
  };

  const opts = { item_id: items.map((i) => ({ value: i.id, label: `${i.name} (${i.quantity} ${i.unit || ''})` })), supplier_id: suppliers.map((s) => ({ value: s.id, label: s.name })) };

  return (
    <PageLayout title={title} subtitle={subtitle}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
          {fields.map((f) => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={lbl}>{f.label}</label>
              {f.type === 'select' ? (
                <select value={form[f.key] || ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">— select —</option>
                  {(opts[f.key] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type={f.type || 'text'} value={form[f.key] || ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inputStyle} />
              )}
            </div>
          ))}
          <button onClick={submit} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: C.font, marginTop: 4 }}>
            {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {cta}
          </button>
        </div>

        <div style={{ flex: '1.4 1 380px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font, minWidth: 460 }}>
            <thead><tr style={{ background: C.bg }}>
              {columns.map((c) => <th key={c.key} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2 }}>{c.label.toUpperCase()}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={columns.length} style={{ padding: '26px', textAlign: 'center', color: C.muted2, fontSize: 12.5 }}>No records yet.</td></tr>
              ) : rows.slice(0, 20).map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  {columns.map((c) => <td key={c.key} style={{ padding: '10px 14px', fontSize: 12.5, color: C.ink }}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function AddStockPage() {
  return <InventoryTxnPage title="Add Stock" subtitle="Receive stock into the store" endpoint="inventory/stock" cta="Add Stock" listResource="stock-entries"
    fields={[
      { key: 'item_id', label: 'Item', type: 'select' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unit_cost', label: 'Unit Cost (₦)', type: 'number' },
      { key: 'supplier_id', label: 'Supplier', type: 'select' },
      { key: 'note', label: 'Note' },
    ]}
    columns={[
      { key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'Qty' },
      { key: 'unit_cost', label: 'Unit Cost', render: (r) => naira(r.unit_cost) },
      { key: 'supplier_name', label: 'Supplier' }, { key: 'received_on', label: 'Date' },
    ]} />;
}

export function IssueItemPage() {
  return <InventoryTxnPage title="Issue Item" subtitle="Give stock out to staff/departments" endpoint="inventory/issue" cta="Issue Item" listResource="item-issues"
    fields={[
      { key: 'item_id', label: 'Item', type: 'select' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'issued_to', label: 'Issued To' },
      { key: 'purpose', label: 'Purpose' },
    ]}
    columns={[
      { key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'Qty' },
      { key: 'issued_to', label: 'Issued To' }, { key: 'purpose', label: 'Purpose' }, { key: 'issued_on', label: 'Date' },
    ]} />;
}

export function PointOfSalePage() {
  return <InventoryTxnPage title="Point of Sale" subtitle="Sell items (uniforms, books…)" endpoint="inventory/sale" cta="Record Sale" listResource="pos-sales"
    fields={[
      { key: 'item_id', label: 'Item', type: 'select' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unit_price', label: 'Unit Price (₦)', type: 'number' },
      { key: 'buyer', label: 'Buyer' },
    ]}
    columns={[
      { key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'Qty' },
      { key: 'total', label: 'Total', render: (r) => <b>{naira(r.total)}</b> }, { key: 'buyer', label: 'Buyer' }, { key: 'sold_on', label: 'Date' },
    ]} />;
}

export function ItemListPage() {
  return <ResourcePage title="Item List" subtitle="Everything in the store" resource="inventory-items"
    columns={[
      { key: 'name', label: 'Item' }, { key: 'category_name', label: 'Category' },
      { key: 'quantity', label: 'In Stock', render: (r) => <b style={{ color: Number(r.quantity) <= Number(r.reorder_level) ? RED : GREEN }}>{r.quantity} {r.unit}</b> },
      { key: 'reorder_level', label: 'Reorder At' }, { key: 'unit_price', label: 'Unit Price', render: (r) => naira(r.unit_price) },
    ]}
    fields={[
      { key: 'name', label: 'Item Name', required: true },
      { key: 'unit', label: 'Unit', placeholder: 'pcs / packs / litres' },
      { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'item-categories' } },
      { key: 'quantity', label: 'Opening Quantity', type: 'number' },
      { key: 'reorder_level', label: 'Reorder Level', type: 'number' },
      { key: 'unit_price', label: 'Unit Price (₦)', type: 'number' },
    ]} listFilters={[{ key: 'category_id', label: 'Category', optionsFrom: { resource: 'item-categories' } }]} createLabel="New Item" />;
}

export function ItemCategoriesPage() {
  return <ResourcePage title="Item Categories" subtitle="Group store items" resource="item-categories"
    columns={[{ key: 'name', label: 'Category' }]} fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function SuppliersPage() {
  return <ResourcePage title="Suppliers" subtitle="Who you buy from" resource="inventory-suppliers"
    columns={[{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }]}
    fields={[
      { key: 'name', label: 'Supplier Name', required: true },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address', type: 'textarea', full: true },
    ]} createLabel="New Supplier" />;
}

export function SalesHistoryPage() {
  return <ResourcePage title="Sales History" subtitle="All POS sales" resource="pos-sales"
    columns={[
      { key: 'item_name', label: 'Item' }, { key: 'quantity', label: 'Qty' },
      { key: 'unit_price', label: 'Unit Price', render: (r) => naira(r.unit_price) },
      { key: 'total', label: 'Total', render: (r) => <b>{naira(r.total)}</b> },
      { key: 'buyer', label: 'Buyer' }, { key: 'sold_on', label: 'Date' },
    ]} fields={[]} canCreate={false} canEdit={false} searchKeys={['item_name', 'buyer']} />;
}

export function PurchaseOrdersPage() {
  const STATUSES = ['draft', 'ordered', 'received', 'cancelled'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));
  return <ResourcePage title="Purchase Orders" subtitle="Orders placed with suppliers" resource="purchase-orders"
    columns={[
      { key: 'order_no', label: 'Order No' }, { key: 'supplier_name', label: 'Supplier' },
      { key: 'total_amount', label: 'Total', render: (r) => naira(r.total_amount) },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { draft: C.muted2, ordered: C.brand, received: GREEN, cancelled: RED }) },
      { key: 'ordered_on', label: 'Date' },
    ]}
    fields={[
      { key: 'order_no', label: 'Order No', required: true },
      { key: 'supplier_id', label: 'Supplier', type: 'select', optionsFrom: { resource: 'inventory-suppliers' } },
      { key: 'total_amount', label: 'Total Amount (₦)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', default: 'draft', options: STATUSES },
      { key: 'ordered_on', label: 'Ordered On', type: 'date' },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Order" />;
}

export function GoodsReceiptsPage() {
  return <ResourcePage title="Goods Receipts" subtitle="Deliveries against purchase orders" resource="goods-receipts"
    columns={[{ key: 'purchase_order_name', label: 'Order No' }, { key: 'received_on', label: 'Received' }, { key: 'note', label: 'Note' }]}
    fields={[
      { key: 'purchase_order_id', label: 'Purchase Order', type: 'select', optionsFrom: { resource: 'purchase-orders', labelKey: 'order_no' } },
      { key: 'received_on', label: 'Received On', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} createLabel="New Receipt" />;
}

export function SupplierPaymentsPage() {
  return <ResourcePage title="Supplier Payments" subtitle="Money paid to suppliers" resource="supplier-payments"
    columns={[
      { key: 'supplier_name', label: 'Supplier' }, { key: 'amount', label: 'Amount', render: (r) => <b>{naira(r.amount)}</b> },
      { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'paid_on', label: 'Date' },
    ]}
    fields={[
      { key: 'supplier_id', label: 'Supplier', type: 'select', optionsFrom: { resource: 'inventory-suppliers' } },
      { key: 'amount', label: 'Amount (₦)', type: 'number', required: true },
      { key: 'method', label: 'Method', placeholder: 'bank / cash / cheque' },
      { key: 'reference', label: 'Reference' },
      { key: 'paid_on', label: 'Paid On', type: 'date' },
    ]} createLabel="New Payment" />;
}
