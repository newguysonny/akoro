<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro Admin — Tiers &amp; Credits</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --purple: #6C3BFF;
    --purple-soft: #F1ECFF;
    --coral: #FF6B57;
    --green: #2BB673;
    --bg: #FAFAFC;
    --surface: #FFFFFF;
    --border: #E7E4F0;
    --text: #221D33;
    --text-dim: #6B667E;
    --radius: 18px;
    --radius-sm: 10px;
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  :root:not([data-theme="light"]) {
    @media (prefers-color-scheme: dark) {
      --bg: #17151F;
      --surface: #211E2C;
      --border: #34304400;
      --border: #322E40;
      --text: #F1EFF7;
      --text-dim: #A29CB8;
      --purple-soft: #2A2140;
    }
  }
  :root[data-theme="dark"] {
    --bg: #17151F;
    --surface: #211E2C;
    --border: #322E40;
    --text: #F1EFF7;
    --text-dim: #A29CB8;
    --purple-soft: #2A2140;
  }
  html { scroll-padding-top: env(safe-area-inset-top, 0px); }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: 'Nunito', system-ui, -apple-system, sans-serif;
    display: flex;
    min-height: 100vh;
  }
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 24px 16px;
  }
  .brand {
    font-weight: 800;
    font-size: 1.15rem;
    color: var(--purple);
    padding: 0 8px 20px;
  }
  .nav-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 11px 14px;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-dim);
    cursor: pointer;
    margin-bottom: 4px;
  }
  .nav-item:hover { background: var(--purple-soft); color: var(--text); }
  .nav-item.active { background: var(--purple); color: white; }

  .main {
    flex: 1;
    padding: 32px 40px;
    max-width: 980px;
  }
  h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 4px; }
  .sub { color: var(--text-dim); margin: 0 0 28px; font-size: 0.95rem; }
  .panel { display: none; }
  .panel.active { display: block; }

  table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); }
  th, td { padding: 14px 16px; text-align: left; font-size: 0.9rem; }
  th { color: var(--text-dim); font-weight: 700; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); }
  td { border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .tier-name { font-weight: 700; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 0.75rem; font-weight: 700; }
  .badge.free { background: var(--purple-soft); color: var(--purple); }
  .badge.paid { background: #FFE8E4; color: var(--coral); }
  .credit-input { width: 90px; padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-weight: 700; font-size: 0.9rem; }
  .credit-input:focus { outline: 2px solid var(--purple); outline-offset: 1px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { font-size: 0.75rem; padding: 3px 9px; border-radius: 100px; background: var(--purple-soft); color: var(--purple); font-weight: 600; }
  .tag.none { color: var(--text-dim); background: var(--bg); border: 1px dashed var(--border); }

  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .btn { padding: 10px 18px; border-radius: var(--radius-sm); border: none; background: var(--purple); color: white; font-family: inherit; font-weight: 700; font-size: 0.88rem; cursor: pointer; }
  .btn:hover { opacity: 0.92; }
  .btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; }
  .card h3 { margin: 0 0 3px; font-size: 1.02rem; }
  .card .status { font-size: 0.78rem; font-weight: 700; margin-bottom: 12px; }
  .status.active { color: var(--green); }
  .status.ended { color: var(--text-dim); }
  .card .row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 5px 0; color: var(--text-dim); }
  .card .row span:last-child { color: var(--text); font-weight: 600; }

  .bar-bg { width: 100%; height: 8px; border-radius: 100px; background: var(--purple-soft); overflow: hidden; margin-top: 6px; }
  .bar-fill { height: 100%; border-radius: 100px; background: var(--purple); }
  .bar-fill.warn { background: var(--coral); }
  .usage-row td { vertical-align: middle; }
  .usage-label { display: flex; flex-direction: column; gap: 2px; }
  .usage-label small { color: var(--text-dim); font-weight: 600; }

  .save-toast { position: fixed; bottom: 24px; right: 24px; background: var(--text); color: var(--bg); padding: 10px 18px; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 600; opacity: 0; transform: translateY(8px); transition: 0.25s; pointer-events: none; z-index: 20; }
  .save-toast.show { opacity: 1; transform: translateY(0); }

  .card.clickable { cursor: pointer; transition: 0.15s border-color; }
  .card.clickable:hover { border-color: var(--purple); }

  .overlay { position: fixed; inset: 0; background: rgba(20,17,30,0.45); display: none; align-items: center; justify-content: center; z-index: 30; padding: 20px; }
  .overlay.show { display: flex; }
  .modal { background: var(--surface); border-radius: var(--radius); padding: 26px; width: 100%; max-width: 420px; }
  .modal h2 { margin: 0 0 18px; font-size: 1.15rem; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.8rem; font-weight: 700; color: var(--text-dim); margin-bottom: 5px; }
  .field input { width: 100%; padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.92rem; }
  .field input:focus { outline: 2px solid var(--purple); outline-offset: 1px; }
  .field-row { display: flex; gap: 12px; }
  .field-row .field { flex: 1; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

  .back-link { background: none; border: none; color: var(--text-dim); font-family: inherit; font-weight: 700; font-size: 0.85rem; cursor: pointer; padding: 0; margin-bottom: 14px; }
  .back-link:hover { color: var(--purple); }
  .detail-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .stat-row { display: flex; gap: 14px; margin-bottom: 26px; flex-wrap: wrap; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; min-width: 150px; }
  .stat .label { font-size: 0.75rem; color: var(--text-dim); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 6px; }
  .stat .value { font-size: 1.3rem; font-weight: 800; }
  .section-title { font-size: 1rem; font-weight: 800; margin: 26px 0 12px; }

  .alert-banner { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .alert-item { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-radius: var(--radius-sm); background: #FFF1EE; border: 1px solid #FFD6CB; font-size: 0.85rem; font-weight: 600; color: #A6402B; }
  .alert-item.info { background: var(--purple-soft); border-color: #DCD0FF; color: var(--purple); }
  .alert-item button { margin-left: auto; background: none; border: none; font-family: inherit; font-weight: 700; font-size: 0.8rem; color: inherit; cursor: pointer; text-decoration: underline; }

  .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  .filters input[type="text"], .filters select { padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; font-size: 0.88rem; }
  .filters input[type="text"] { flex: 1; min-width: 160px; }

  .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 16px; }
  .pagination button { width: 32px; height: 32px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
  .pagination button.active { background: var(--purple); border-color: var(--purple); color: white; }
  .pagination button:disabled { opacity: 0.4; cursor: default; }

  .badge.archived { background: var(--bg); color: var(--text-dim); border: 1px dashed var(--border); }
  .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn.small { padding: 7px 13px; font-size: 0.8rem; }
  .btn.danger { background: transparent; border: 1px solid #FFD6CB; color: var(--coral); }
  .name-edit { display: flex; gap: 8px; align-items: center; }
  .name-edit input { font-size: 1.4rem; font-weight: 800; padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; }

  .subtabs { display: flex; gap: 6px; margin-bottom: 18px; background: var(--bg); padding: 4px; border-radius: var(--radius-sm); width: fit-content; }
  .subtab { padding: 8px 18px; border: none; background: transparent; border-radius: 8px; font-family: inherit; font-weight: 700; font-size: 0.88rem; color: var(--text-dim); cursor: pointer; }
  .subtab.active { background: var(--surface); color: var(--purple); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .price-cell { font-weight: 700; }
  .price-cell.free { color: var(--text-dim); font-weight: 600; }

  .settings-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; max-width: 420px; }
  .settings-card .field { margin-bottom: 14px; }
  .settings-card .field:last-of-type { margin-bottom: 18px; }
  .settings-card select { width: 100%; padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.9rem; }

  .feature-checks { display: flex; flex-direction: column; gap: 6px; text-align: left; }
  .feature-checks label { display: flex; align-items: center; gap: 7px; font-size: 0.82rem; font-weight: 600; color: var(--text); cursor: pointer; }

  .price-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .price-row .credit-input { width: 90px; }

  .diff-line { font-size: 0.85rem; }
  .diff-old { color: var(--text-dim); text-decoration: line-through; }
  .diff-new { color: var(--green); font-weight: 700; }

  .badge.s-active { background: var(--green-soft, #E7F8EF); color: var(--green); }
  .badge.s-trial { background: var(--purple-soft); color: var(--purple); }
  .badge.s-past_due { background: #FFE8E4; color: var(--coral); }
  .badge.s-paused { background: #FFF4D6; color: #A8770B; }
  .badge.s-canceled { background: var(--bg); color: var(--text-dim); border: 1px dashed var(--border); }
  .stat.link { cursor: pointer; transition: 0.15s border-color; }
  .stat.link:hover { border-color: var(--purple); }
  .stat .note { font-size: 0.75rem; color: var(--text-dim); margin-top: 4px; font-weight: 600; }
  .mix-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 0.88rem; font-weight: 600; }
  .mix-row:last-child { margin-bottom: 0; }
  .mix-row .mix-label { width: 90px; }
  .mix-row .bar-bg { flex: 1; margin-top: 0; }
  .mix-row .mix-count { width: 28px; text-align: right; font-weight: 800; }
  .link-btn { background: none; border: none; padding: 0; font-family: inherit; font-weight: 700; font-size: inherit; color: var(--purple); cursor: pointer; text-decoration: underline; }
  .badge.i-draft { background: var(--bg); color: var(--text-dim); border: 1px dashed var(--border); }
  .badge.i-open { background: var(--purple-soft); color: var(--purple); }
  .badge.i-paid { background: #E7F8EF; color: var(--green); }
  .badge.i-void { background: var(--bg); color: var(--text-dim); text-decoration: line-through; }
  .overdue { color: var(--coral); font-weight: 700; }
  .modal-select { width: 100%; padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.9rem; }
  tr.clickable-row { cursor: pointer; }
  tr.clickable-row:hover td { background: var(--purple-soft); }
  .notes-box { width: 100%; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.9rem; resize: vertical; }

  @media (max-width: 720px) {
    body { flex-direction: column; }
    .sidebar { width: 100%; display: flex; overflow-x: auto; padding: 12px; border-right: none; border-bottom: 1px solid var(--border); }
    .brand { display: none; }
    .nav-item { white-space: nowrap; margin-right: 6px; margin-bottom: 0; }
    .main { padding: 20px; }
  }
</style>
</head>
<body>

<div class="sidebar">
  <div class="brand">Akoro Admin</div>
  <button class="nav-item active" data-panel="overview">Overview</button>
  <button class="nav-item" data-panel="tiers">Tiers &amp; Credits</button>
  <button class="nav-item" data-panel="schools">Pilot Schools</button>
  <button class="nav-item" data-panel="subscriptions">Subscriptions</button>
  <button class="nav-item" data-panel="customers">Customers</button>
  <button class="nav-item" data-panel="invoices">Invoices</button>
  <button class="nav-item" data-panel="coupons">Coupons</button>
  <button class="nav-item" data-panel="usage">Usage</button>
  <button class="nav-item" data-panel="audit">Audit Log</button>
</div>

<div class="main">

  <div id="overview" class="panel active">
    <h1>Overview</h1>
    <p class="sub">Subscription health at a glance, computed from the mock Subscriptions data. Revenue metrics (MRR/ARR, LTV) are left out until there is real transaction history.</p>
    <div class="stat-row" id="ov-kpis"></div>
    <div class="section-title">Subscribers by plan</div>
    <div class="settings-card" style="max-width:none" id="ov-mix"></div>
    <div class="section-title">Needs attention</div>
    <table>
      <thead><tr><th>Subscription</th><th>Issue</th><th></th></tr></thead>
      <tbody id="ov-attention"></tbody>
    </table>
    <div class="section-title">Upcoming renewals (next 30 days)</div>
    <table>
      <thead><tr><th>Subscription</th><th>Learner</th><th>Renews</th><th>Amount</th></tr></thead>
      <tbody id="ov-renewals"></tbody>
    </table>
  </div>

  <div id="tiers" class="panel">
    <h1>Tiers &amp; Credits</h1>
    <p class="sub">Default credit caps and feature gating per tier, split by platform. Changes apply platform-wide unless a school has its own pilot override.</p>

    <div class="subtabs">
      <button class="subtab active" id="subtab-learner" onclick="switchTierPlatform('learner')">Learner</button>
      <button class="subtab" id="subtab-school" onclick="switchTierPlatform('school')">School</button>
    </div>

    <div id="learner-tier-view">
      <table>
        <thead><tr><th>Tier</th><th>Access</th><th>Price</th><th>Credit cap / mo</th><th>Duration</th><th>Gated features</th><th>Actions</th></tr></thead>
        <tbody id="learner-tier-body"></tbody>
      </table>
      <div class="toolbar"><span></span><button class="btn ghost small" onclick="openTierModal('learner')">+ Add tier</button></div>

      <div class="section-title">Subscription lifecycle</div>
      <div class="settings-card">
        <div class="field">
          <label for="sl-retries">Failed payment retry attempts</label>
          <input type="number" min="0" id="sl-retries" value="3">
        </div>
        <div class="field">
          <label for="sl-grace">Grace period before auto-downgrade to Freemium (days)</label>
          <input type="number" min="0" id="sl-grace" value="5">
        </div>
        <div class="field">
          <label for="sl-proration">Proration policy for mid-cycle plan changes</label>
          <select id="sl-proration">
            <option value="immediate">Charge full new price immediately</option>
            <option value="prorate">Prorate remaining days</option>
            <option value="next-cycle">Apply at next renewal</option>
          </select>
        </div>
        <button class="btn small" onclick="saveSubscriptionSettings()">Save settings</button>
      </div>
    </div>

    <div id="school-tier-view" style="display:none">
      <table>
        <thead><tr><th>Tier</th><th>Access</th><th>Student cap / mo</th><th>Instructor cap / mo</th><th>Duration</th><th>Gated features</th><th>Actions</th></tr></thead>
        <tbody id="school-tier-body"></tbody>
      </table>
      <div class="toolbar"><span></span><button class="btn ghost small" onclick="openTierModal('school')">+ Add tier</button></div>
      <p class="sub" style="margin-top:14px">School Premium/Enterprise pricing is negotiated per-school rather than set here — see Pilot Schools for individual terms.</p>
    </div>
  </div>

  <div id="subscriptions" class="panel">
    <h1>Subscriptions</h1>
    <p class="sub">One record per trialing or subscribed learner, billed to a parent or guardian. Pilot users have no subscription record.</p>
    <div class="filters">
      <input type="text" id="sub-search" placeholder="Search parent, learner, or ID…" oninput="subPage=1;renderSubs()">
      <select id="sub-status-filter" onchange="subPage=1;renderSubs()">
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="trial">Trial</option>
        <option value="past_due">Past due</option>
        <option value="paused">Paused</option>
        <option value="canceled">Canceled</option>
      </select>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Billing contact</th><th>Learner</th><th>Plan</th><th>Status</th><th>Next date</th><th></th></tr></thead>
      <tbody id="sub-body"></tbody>
    </table>
    <div class="pagination" id="sub-pagination"></div>
  </div>

  <div id="sub-detail" class="panel">
    <button class="back-link" onclick="backToSubs()">← Back to Subscriptions</button>
    <div class="detail-head">
      <div>
        <h1 id="sd-title"></h1>
        <p class="sub" id="sd-sub" style="margin:6px 0 20px"></p>
      </div>
      <div class="detail-actions" id="sd-actions"></div>
    </div>
    <div class="stat-row" id="sd-stats"></div>
    <div id="sd-coupon" style="margin:-6px 0 24px"></div>
    <div class="section-title">Timeline</div>
    <table>
      <thead><tr><th>When</th><th>Event</th></tr></thead>
      <tbody id="sd-timeline"></tbody>
    </table>
    <div class="section-title">Internal notes</div>
    <div class="field"><textarea id="sd-notes" rows="3" class="notes-box" placeholder="Notes visible to admins only"></textarea></div>
    <button class="btn ghost small" onclick="saveSubNotes()">Save notes</button>
  </div>

  <div id="customers" class="panel">
    <h1>Customers</h1>
    <p class="sub">The billing identity behind each subscription: the parent or guardian who pays, linked to one or more learners.</p>
    <div class="filters">
      <input type="text" id="cust-search" placeholder="Search customer, email, or learner…" oninput="custPage=1;renderCustomers()">
    </div>
    <table>
      <thead><tr><th>ID</th><th>Customer</th><th>Email</th><th>Learners</th><th>Billing status</th><th>Open balance</th><th></th></tr></thead>
      <tbody id="cust-body"></tbody>
    </table>
    <div class="pagination" id="cust-pagination"></div>
  </div>

  <div id="customer-detail" class="panel">
    <button class="back-link" onclick="backToCustomers()">← Back to Customers</button>
    <div class="detail-head">
      <div>
        <h1 id="cd-title"></h1>
        <p class="sub" id="cd-sub" style="margin:6px 0 20px"></p>
      </div>
    </div>
    <div class="stat-row" id="cd-stats"></div>

    <div class="section-title">Contact details</div>
    <div class="settings-card" style="max-width:520px">
      <div class="field-row">
        <div class="field"><label for="cd-email">Email</label><input type="text" id="cd-email"></div>
        <div class="field"><label for="cd-phone">Phone</label><input type="text" id="cd-phone"></div>
      </div>
      <button class="btn small" onclick="saveCustomerContact()">Save contact details</button>
    </div>

    <div class="section-title">Linked learners &amp; subscriptions</div>
    <table>
      <thead><tr><th>Subscription</th><th>Learner</th><th>Plan</th><th>Status</th><th>Next date</th></tr></thead>
      <tbody id="cd-subs"></tbody>
    </table>

    <div class="section-title">Payment methods on file</div>
    <div class="tags" id="cd-methods"></div>

    <div class="section-title">Messages</div>
    <table>
      <thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Regarding</th></tr></thead>
      <tbody id="cd-messages"></tbody>
    </table>

    <div class="section-title">Internal notes</div>
    <div class="field"><textarea id="cd-notes" rows="3" class="notes-box" placeholder="Notes visible to admins only"></textarea></div>
    <button class="btn ghost small" onclick="saveCustomerNotes()">Save notes</button>
  </div>

  <div id="invoices" class="panel">
    <h1>Invoices</h1>
    <p class="sub">Billing records per subscription. Statuses: draft, open (awaiting payment), paid, void.</p>
    <div class="filters">
      <input type="text" id="inv-search" placeholder="Search invoice, customer, or subscription…" oninput="invPage=1;renderInvoices()">
      <select id="inv-status-filter" onchange="invPage=1;renderInvoices()">
        <option value="all">All statuses</option>
        <option value="draft">Draft</option>
        <option value="open">Open</option>
        <option value="paid">Paid</option>
        <option value="void">Void</option>
      </select>
    </div>
    <table>
      <thead><tr><th>Invoice</th><th>Customer</th><th>Subscription</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody id="inv-body"></tbody>
    </table>
    <div class="pagination" id="inv-pagination"></div>
  </div>

  <div id="invoice-detail" class="panel">
    <button class="back-link" onclick="backToInvoices()">← Back to Invoices</button>
    <div class="detail-head">
      <div>
        <h1 id="id-title"></h1>
        <p class="sub" id="id-sub" style="margin:6px 0 20px"></p>
      </div>
      <div class="detail-actions" id="id-actions"></div>
    </div>
    <div class="stat-row" id="id-stats"></div>
    <div class="section-title">Line items</div>
    <table>
      <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody id="id-lines"></tbody>
    </table>
    <div class="section-title">Timeline</div>
    <table>
      <thead><tr><th>When</th><th>Event</th></tr></thead>
      <tbody id="id-timeline"></tbody>
    </table>
  </div>

  <div id="coupons" class="panel">
    <h1>Coupons</h1>
    <p class="sub">Discount codes for paid plans. Coupons are applied from a subscription's page.</p>
    <div class="filters">
      <input type="text" id="coup-search" placeholder="Search code or description…" oninput="coupPage=1;renderCoupons()">
      <select id="coup-status-filter" onchange="coupPage=1;renderCoupons()">
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="expired">Expired</option>
        <option value="exhausted">Fully redeemed</option>
      </select>
    </div>
    <div class="toolbar"><span></span><button class="btn" onclick="openCouponModal()">+ New coupon</button></div>
    <table>
      <thead><tr><th>Code</th><th>Discount</th><th>Redeemed</th><th>Expires</th><th>Status</th></tr></thead>
      <tbody id="coup-body"></tbody>
    </table>
    <div class="pagination" id="coup-pagination"></div>
  </div>

  <div id="coupon-detail" class="panel">
    <button class="back-link" onclick="backToCoupons()">← Back to Coupons</button>
    <div class="detail-head">
      <div>
        <h1 id="cp-title"></h1>
        <p class="sub" id="cp-sub" style="margin:6px 0 20px"></p>
      </div>
      <div class="detail-actions" id="cp-actions"></div>
    </div>
    <div class="stat-row" id="cp-stats"></div>
    <div class="section-title">Redemptions</div>
    <table>
      <thead><tr><th>Subscription</th><th>Learner</th><th>Customer</th><th>Applied</th></tr></thead>
      <tbody id="cp-redemptions"></tbody>
    </table>
  </div>

  <div id="audit" class="panel">
    <h1>Audit Log</h1>
    <p class="sub">Every pricing, tier, and credit change made from this dashboard, most recent first.</p>
    <table>
      <thead><tr><th>When</th><th>Actor</th><th>Change</th><th>Before → After</th></tr></thead>
      <tbody id="audit-body"></tbody>
    </table>
  </div>

  <div id="schools" class="panel">
    <h1>Pilot Schools</h1>
    <p class="sub">Each pilot partner has its own start date, end date, and credit caps. Click a school to see its details.</p>
    <div class="alert-banner" id="school-alerts"></div>
    <div class="filters">
      <input type="text" id="school-search" placeholder="Search schools…" oninput="renderSchools()">
      <select id="school-status-filter" onchange="renderSchools()">
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="ended">Ended</option>
        <option value="archived">Archived</option>
      </select>
    </div>
    <div class="toolbar">
      <span></span>
      <button class="btn" onclick="openModal()">+ Add pilot school</button>
    </div>
    <div class="cards" id="school-cards"></div>
    <div class="pagination" id="school-pagination"></div>
  </div>

  <div id="school-detail" class="panel">
    <button class="back-link" onclick="backToSchools()">← Back to Pilot Schools</button>
    <div class="detail-head">
      <div>
        <div class="name-edit" id="detail-name-wrap"></div>
        <p class="sub" id="detail-status" style="margin:6px 0 20px"></p>
      </div>
      <div class="detail-actions">
        <button class="btn small" onclick="openMessage('school', activeSchoolIndex)">Message school</button>
        <button class="btn ghost small" onclick="startEditName()">Rename</button>
        <button class="btn ghost small" onclick="endPilotNow()">End pilot now</button>
        <button class="btn danger small" onclick="archiveSchool()">Archive</button>
      </div>
    </div>

    <div class="stat-row" id="detail-stats"></div>

    <div class="section-title">Pilot settings</div>
    <table>
      <thead><tr><th>Start date</th><th>End date</th><th>Student cap / mo</th><th>Instructor cap / mo</th></tr></thead>
      <tbody id="detail-settings"></tbody>
    </table>

    <div class="section-title">Admin contact</div>
    <div class="settings-card" style="max-width:520px">
      <div class="field"><label for="sc-name">Name</label><input type="text" id="sc-name"></div>
      <div class="field-row">
        <div class="field"><label for="sc-email">Email</label><input type="text" id="sc-email"></div>
        <div class="field"><label for="sc-phone">Phone</label><input type="text" id="sc-phone"></div>
      </div>
      <button class="btn small" onclick="saveSchoolContact()">Save contact</button>
    </div>

    <div class="section-title">Usage</div>
    <div class="toolbar"><span></span><button class="btn ghost small" onclick="exportDetailCSV()">Export CSV</button></div>
    <table>
      <thead><tr><th>Account</th><th>Role</th><th>Usage</th></tr></thead>
      <tbody id="detail-usage"></tbody>
    </table>

    <div class="section-title">Messages</div>
    <table>
      <thead><tr><th>When</th><th>Channel</th><th>Audience</th><th>Message</th></tr></thead>
      <tbody id="detail-messages"></tbody>
    </table>
  </div>

  <div id="usage" class="panel">
    <h1>Usage</h1>
    <p class="sub">Credits consumed this period across every account.</p>
    <div class="alert-banner" id="usage-alerts"></div>
    <div class="toolbar"><span></span><button class="btn ghost small" onclick="exportUsageCSV()">Export CSV</button></div>
    <table>
      <thead><tr><th>Account</th><th>Tier</th><th>Usage</th></tr></thead>
      <tbody id="usage-body"></tbody>
    </table>
    <div class="pagination" id="usage-pagination"></div>
  </div>

</div>

<div class="overlay" id="overlay" onclick="if(event.target.id==='overlay') closeModal()">
  <div class="modal">
    <h2>Add pilot school</h2>
    <div class="field">
      <label for="m-name">School name</label>
      <input type="text" id="m-name" placeholder="e.g. Greenfield Academy">
    </div>
    <div class="field-row">
      <div class="field"><label for="m-start">Start date</label><input type="date" id="m-start"></div>
      <div class="field"><label for="m-end">End date</label><input type="date" id="m-end"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="m-student-cap">Student credit cap / mo</label><input type="number" id="m-student-cap" value="200"></div>
      <div class="field"><label for="m-instructor-cap">Instructor credit cap / mo</label><input type="number" id="m-instructor-cap" value="400"></div>
    </div>
    <div class="field"><label for="m-contact-name">Admin contact name (optional)</label><input type="text" id="m-contact-name" placeholder="e.g. Mrs. Adeyemi"></div>
    <div class="field-row">
      <div class="field"><label for="m-contact-email">Contact email</label><input type="text" id="m-contact-email"></div>
      <div class="field"><label for="m-contact-phone">Contact phone</label><input type="text" id="m-contact-phone"></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="submitSchool()">Add school</button>
    </div>
  </div>
</div>

<div class="overlay" id="confirm-overlay" onclick="if(event.target.id==='confirm-overlay') closeConfirmModal()">
  <div class="modal">
    <h2>Confirm price change</h2>
    <div id="confirm-diff" style="margin-bottom:16px"></div>
    <div class="field">
      <label>Apply this change to</label>
      <div class="feature-checks">
        <label><input type="radio" name="effective-scope" value="new" checked> New subscribers only</label>
        <label><input type="radio" name="effective-scope" value="all"> All existing subscribers, effective now</label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeConfirmModal()">Cancel</button>
      <button class="btn" onclick="confirmPriceChange()">Confirm change</button>
    </div>
  </div>
</div>

<div class="overlay" id="tier-overlay" onclick="if(event.target.id==='tier-overlay') closeTierModal()">
  <div class="modal">
    <h2>Add tier</h2>
    <div class="field">
      <label for="nt-name">Tier name</label>
      <input type="text" id="nt-name" placeholder="e.g. Family">
    </div>
    <div class="field">
      <label for="nt-access">Access</label>
      <select id="nt-access" onchange="toggleTierPriceFields()">
        <option value="free">Free</option>
        <option value="paid">Paid</option>
      </select>
    </div>
    <div class="field-row" id="nt-price-fields" style="display:none">
      <div class="field"><label for="nt-price-monthly">Price / month (₦)</label><input type="number" id="nt-price-monthly" value="0"></div>
      <div class="field"><label for="nt-price-annual">Price / year (₦)</label><input type="number" id="nt-price-annual" value="0"></div>
    </div>
    <div class="field-row" id="nt-cap-learner">
      <div class="field"><label for="nt-cap">Credit cap / mo</label><input type="number" id="nt-cap" value="100"></div>
      <div class="field"><label for="nt-duration">Duration (days, blank = standing)</label><input type="number" id="nt-duration" placeholder="e.g. 14"></div>
    </div>
    <div class="field-row" id="nt-cap-school" style="display:none">
      <div class="field"><label for="nt-student-cap">Student cap / mo</label><input type="number" id="nt-student-cap" value="100"></div>
      <div class="field"><label for="nt-instructor-cap">Instructor cap / mo</label><input type="number" id="nt-instructor-cap" value="200"></div>
    </div>
    <div class="field">
      <label>Gated features</label>
      <div class="feature-checks" id="nt-feature-checks"></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeTierModal()">Cancel</button>
      <button class="btn" onclick="submitNewTier()">Add tier</button>
    </div>
  </div>
</div>

<div class="overlay" id="msg-overlay" onclick="if(event.target.id==='msg-overlay') closeMessage()">
  <div class="modal" style="max-width:480px">
    <h2>Send message</h2>
    <p class="sub" id="msg-to" style="margin:0 0 14px"></p>
    <div class="field" id="msg-audience-wrap" style="display:none"><label for="msg-audience">Audience</label><select id="msg-audience" class="modal-select"></select></div>
    <div class="field-row">
      <div class="field"><label for="msg-channel">Channel</label>
        <select id="msg-channel" class="modal-select" onchange="toggleMsgSubject()">
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="inapp">In-app notice</option>
        </select></div>
      <div class="field"><label for="msg-template">Template</label>
        <select id="msg-template" class="modal-select" onchange="applyMsgTemplate()">
          <option value="">None</option>
          <option value="payment">Payment reminder</option>
          <option value="trial">Trial ending</option>
          <option value="general">General note</option>
        </select></div>
    </div>
    <div class="field" id="msg-subject-wrap"><label for="msg-subject">Subject</label><input type="text" id="msg-subject"></div>
    <div class="field"><label for="msg-body">Message</label><textarea id="msg-body" rows="5" class="notes-box"></textarea></div>
    <p class="sub" style="font-size:0.78rem;margin:0 0 4px">Mock only: nothing is actually sent, and the message is recorded in the log.</p>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeMessage()">Cancel</button>
      <button class="btn" onclick="sendMessage()">Send</button>
    </div>
  </div>
</div>

<div class="overlay" id="coupon-overlay" onclick="if(event.target.id==='coupon-overlay') closeCouponModal()">
  <div class="modal">
    <h2>New coupon</h2>
    <div class="field-row">
      <div class="field"><label for="nc-code">Code</label><input type="text" id="nc-code" placeholder="e.g. TERM2"></div>
      <div class="field"><label for="nc-max">Max redemptions</label><input type="number" min="1" id="nc-max" placeholder="Unlimited"></div>
    </div>
    <div class="field"><label for="nc-desc">Description</label><input type="text" id="nc-desc" placeholder="Internal note"></div>
    <div class="field-row">
      <div class="field"><label for="nc-type">Type</label>
        <select id="nc-type" class="modal-select"><option value="percent">Percentage</option><option value="fixed">Fixed (₦)</option></select></div>
      <div class="field"><label for="nc-value">Value</label><input type="number" min="1" id="nc-value"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="nc-duration">Duration</label>
        <select id="nc-duration" class="modal-select" onchange="toggleCouponMonths()"><option value="once">Once</option><option value="repeating">Repeating</option><option value="forever">Forever</option></select></div>
      <div class="field" id="nc-months-wrap" style="display:none"><label for="nc-months">Months</label><input type="number" min="1" id="nc-months" value="3"></div>
    </div>
    <div class="field"><label for="nc-expires">Expires (blank = never)</label><input type="date" id="nc-expires"></div>
    <div class="field feature-checks"><label><input type="checkbox" id="nc-first"> New customers only (no paid invoices yet)</label></div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeCouponModal()">Cancel</button>
      <button class="btn" onclick="submitCoupon()">Create coupon</button>
    </div>
  </div>
</div>

<div class="save-toast" id="toast">Saved</div>

<script>
  const LEARNER_FEATURES = ['Gradebook','Battles','Rankings','Voice/audio'];
  const SCHOOL_FEATURES = ['Teacher seats (limited)','Student/classroom limits','Course creation & live classes','Analytics','Integrations'];

  let learnerTiers = [
    { name: 'Trial', access: 'free', price: 0, annualPrice: 0, cap: 500, durationDays: 14, gated: [] },
    { name: 'Freemium', access: 'free', price: 0, annualPrice: 0, cap: 50, durationDays: null, gated: ['Gradebook','Battles','Rankings','Voice/audio'] },
    { name: 'Premium', access: 'paid', price: 1500, annualPrice: 14400, cap: 1000, durationDays: null, gated: [] },
  ];

  let schoolTiers = [
    { name: 'Pilot', access: 'free', studentCap: 200, instructorCap: 400, durationDays: 30, gated: [] },
    { name: 'Freemium', access: 'free', studentCap: 50, instructorCap: 100, durationDays: null, gated: ['Teacher seats (limited)','Student/classroom limits','Course creation & live classes','Analytics','Integrations'] },
    { name: 'Premium', access: 'paid', studentCap: 1000, instructorCap: 2000, durationDays: null, gated: [] },
  ];

  const CURRENT_ADMIN = 'Osio (You)';
  let auditLog = [
    { when: '3 days ago', actor: CURRENT_ADMIN, change: 'Premium (Learner) credit cap updated', before: '800 / mo', after: '1,000 / mo' },
    { when: '1 week ago', actor: CURRENT_ADMIN, change: 'Chrisland College pilot cap updated', before: '250', after: '200' },
  ];

  function logAudit(change, before, after){
    auditLog.unshift({ when: 'Just now', actor: CURRENT_ADMIN, change, before, after });
    renderAudit();
  }

  function renderAudit(){
    const body = document.getElementById('audit-body');
    if (!body) return;
    body.innerHTML = auditLog.map(a => `
      <tr>
        <td>${escapeHTML(a.when)}</td>
        <td>${escapeHTML(a.actor)}</td>
        <td>${escapeHTML(a.change)}</td>
        <td class="diff-line"><span class="diff-old">${escapeHTML(a.before)}</span> → <span class="diff-new">${escapeHTML(a.after)}</span></td>
      </tr>
    `).join('');
  }

  const TODAY = '2026-09-27';

  let schools = [
    { name: 'Chrisland College', contact: { name: 'Mrs. Folake Adeyemi', email: 'admin@chrisland.example.com', phone: '+234 803 111 0001' }, start: '2026-09-01', end: '2026-09-30', studentCap: 200, instructorCap: 400, status: 'active', archived: false },
    { name: 'St. Francis Xavier', contact: { name: 'Mr. Chidi Nwosu', email: 'office@sfx.example.com', phone: '+234 803 111 0002' }, start: '2026-08-01', end: '2026-08-31', studentCap: 180, instructorCap: 350, status: 'ended', archived: false },
    { name: 'Greenfield Academy', contact: { name: 'Mrs. Amina Yusuf', email: 'head@greenfield.example.com', phone: '+234 803 111 0003' }, start: '2026-10-01', end: '2026-10-03', studentCap: 220, instructorCap: 400, status: 'active', archived: false },
  ];

  let usage = [
    { name: 'Amara O.', role: 'Student', school: 'Chrisland College', tier: 'Pilot', used: 140, cap: 200 },
    { name: 'Ngozi F.', role: 'Instructor', school: 'Chrisland College', tier: 'Pilot', used: 310, cap: 400 },
    { name: 'Deji M.', role: 'Student', school: 'Greenfield Academy', tier: 'Pilot', used: 205, cap: 220 },
    { name: 'Tunde A.', role: 'Student', school: null, tier: 'Trial', used: 480, cap: 500 },
    { name: 'Ifeoma K.', role: 'Student', school: null, tier: 'Freemium', used: 48, cap: 50 },
    { name: 'Bola S.', role: 'Student', school: null, tier: 'Premium', used: 310, cap: 1000 },
  ];

  let activeSchoolIndex = null;
  let schoolPage = 1, usagePage = 1;
  const PAGE_SIZE = 4, USAGE_PAGE_SIZE = 4;
  let activeTierPlatform = 'learner';

  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=> t.classList.remove('show'), 1400);
  }

  function daysUntil(dateStr){
    return Math.round((new Date(dateStr) - new Date(TODAY)) / 86400000);
  }

  function switchTierPlatform(platform){
    activeTierPlatform = platform;
    document.getElementById('subtab-learner').classList.toggle('active', platform === 'learner');
    document.getElementById('subtab-school').classList.toggle('active', platform === 'school');
    document.getElementById('learner-tier-view').style.display = platform === 'learner' ? '' : 'none';
    document.getElementById('school-tier-view').style.display = platform === 'school' ? '' : 'none';
    editingTierIndex = null;
    renderTiers();
  }

  let editingTierIndex = null;
  let editing_focus_needed = false;

  function featureChecksHTML(allFeatures, gated, idPrefix){
    return `<div class="feature-checks">${allFeatures.map(f => `
      <label><input type="checkbox" id="${idPrefix}-${f.replace(/\W+/g,'')}" value="${escapeHTML(f)}" ${gated.includes(f) ? 'checked' : ''}> ${escapeHTML(f)}</label>
    `).join('')}</div>`;
  }

  function readCheckedFeatures(allFeatures, idPrefix){
    return allFeatures.filter(f => document.getElementById(`${idPrefix}-${f.replace(/\W+/g,'')}`)?.checked);
  }

  function gatedTagsHTML(gated){
    return `<div class="tags">${
      gated.length
        ? gated.map(g => `<span class="tag">${escapeHTML(g)}</span>`).join('')
        : '<span class="tag none">No gating</span>'
    }</div>`;
  }

  function renderTiers(){
    renderLearnerTiers();
    renderSchoolTiers();
  }

  function renderLearnerTiers(){
    const body = document.getElementById('learner-tier-body');
    body.innerHTML = learnerTiers.map((t, i) => {
      const editing = activeTierPlatform === 'learner' && editingTierIndex === i;
      const priceCell = t.access === 'free'
        ? `<span class="price-cell free">Free</span>`
        : editing
          ? `<div class="price-row"><input class="credit-input" id="tier-price-input" type="number" min="0" value="${t.price}">/mo <input class="credit-input" id="tier-annual-price-input" type="number" min="0" value="${t.annualPrice}">/yr</div>`
          : `<span class="price-cell">₦${t.price.toLocaleString()}/mo<br><small>₦${t.annualPrice.toLocaleString()}/yr</small></span>`;
      const durationCell = t.durationDays === null
        ? '—'
        : editing
          ? `<input class="credit-input" id="tier-duration-input" type="number" min="1" value="${t.durationDays}"> days`
          : `${t.durationDays} days`;
      return `
      <tr>
        <td class="tier-name">${escapeHTML(t.name)}</td>
        <td><span class="badge ${t.access}">${t.access === 'free' ? 'Free' : 'Paid'}</span></td>
        <td>${priceCell}</td>
        <td>${
          editing
            ? `<input class="credit-input" id="tier-cap-input" type="number" min="0" value="${t.cap}"> / mo`
            : `${t.cap} / mo`
        }</td>
        <td>${durationCell}</td>
        <td>${editing ? featureChecksHTML(LEARNER_FEATURES, t.gated, 'lf') : gatedTagsHTML(t.gated)}</td>
        <td>${
          editing
            ? `<div class="detail-actions"><button class="btn small" onclick="saveLearnerTier(${i})">Save</button><button class="btn ghost small" onclick="cancelTierEdit()">Cancel</button></div>`
            : `<button class="btn ghost small" onclick="editLearnerTier(${i})">Edit</button>`
        }</td>
      </tr>
    `;
    }).join('');
    if (editing_focus_needed && activeTierPlatform === 'learner') {
      (document.getElementById('tier-price-input') || document.getElementById('tier-cap-input'))?.focus();
      editing_focus_needed = false;
    }
  }

  function renderSchoolTiers(){
    const body = document.getElementById('school-tier-body');
    body.innerHTML = schoolTiers.map((t, i) => {
      const editing = activeTierPlatform === 'school' && editingTierIndex === i;
      const durationCell = t.durationDays === null
        ? '—'
        : editing
          ? `<input class="credit-input" id="tier-duration-input" type="number" min="1" value="${t.durationDays}"> days`
          : `${t.durationDays} days (default)`;
      return `
      <tr>
        <td class="tier-name">${escapeHTML(t.name)}</td>
        <td><span class="badge ${t.access}">${t.access === 'free' ? 'Free' : 'Paid'}</span></td>
        <td>${
          editing
            ? `<input class="credit-input" id="tier-student-cap-input" type="number" min="0" value="${t.studentCap}"> / mo`
            : `${t.studentCap} / mo`
        }</td>
        <td>${
          editing
            ? `<input class="credit-input" id="tier-instructor-cap-input" type="number" min="0" value="${t.instructorCap}"> / mo`
            : `${t.instructorCap} / mo`
        }</td>
        <td>${durationCell}</td>
        <td>${editing ? featureChecksHTML(SCHOOL_FEATURES, t.gated, 'sf') : gatedTagsHTML(t.gated)}</td>
        <td>${
          editing
            ? `<div class="detail-actions"><button class="btn small" onclick="saveSchoolTier(${i})">Save</button><button class="btn ghost small" onclick="cancelTierEdit()">Cancel</button></div>`
            : `<button class="btn ghost small" onclick="editSchoolTier(${i})">Edit</button>`
        }</td>
      </tr>
    `;
    }).join('');
    if (editing_focus_needed && activeTierPlatform === 'school') {
      document.getElementById('tier-student-cap-input')?.focus();
      editing_focus_needed = false;
    }
  }

  function editLearnerTier(i){ editingTierIndex = i; editing_focus_needed = true; renderTiers(); }
  function editSchoolTier(i){ editingTierIndex = i; editing_focus_needed = true; renderTiers(); }
  function cancelTierEdit(){ editingTierIndex = null; renderTiers(); }

  let pendingPriceChange = null;

  function saveLearnerTier(i){
    const t = learnerTiers[i];
    const newCap = Math.max(0, Number(document.getElementById('tier-cap-input').value) || 0);
    const newDurationInput = document.getElementById('tier-duration-input');
    const newDuration = newDurationInput ? Math.max(1, Number(newDurationInput.value) || 1) : t.durationDays;
    const newGated = readCheckedFeatures(LEARNER_FEATURES, 'lf');

    const priceInput = document.getElementById('tier-price-input');
    const annualInput = document.getElementById('tier-annual-price-input');
    const priceChanged = priceInput && (Number(priceInput.value) !== t.price || Number(annualInput.value) !== t.annualPrice);

    if (priceChanged) {
      pendingPriceChange = {
        type: 'learner', index: i,
        oldMonthly: t.price, oldAnnual: t.annualPrice,
        newMonthly: Math.max(0, Number(priceInput.value) || 0),
        newAnnual: Math.max(0, Number(annualInput.value) || 0),
        cap: newCap, durationDays: newDuration, gated: newGated,
      };
      document.getElementById('confirm-diff').innerHTML = `
        <p class="diff-line"><b>${escapeHTML(t.name)} monthly:</b> <span class="diff-old">₦${t.price.toLocaleString()}</span> → <span class="diff-new">₦${pendingPriceChange.newMonthly.toLocaleString()}</span></p>
        <p class="diff-line"><b>${escapeHTML(t.name)} annual:</b> <span class="diff-old">₦${t.annualPrice.toLocaleString()}</span> → <span class="diff-new">₦${pendingPriceChange.newAnnual.toLocaleString()}</span></p>
      `;
      document.getElementById('confirm-overlay').classList.add('show');
      return;
    }

    t.cap = newCap; t.durationDays = newDuration; t.gated = newGated;
    editingTierIndex = null;
    renderTiers();
    logAudit(`${t.name} (Learner) cap/features updated`, '—', `${newCap}/mo, ${newGated.length} gated`);
    toast(`${t.name} (Learner) updated`);
  }

  function confirmPriceChange(){
    if (!pendingPriceChange) return;
    const scope = document.querySelector('input[name="effective-scope"]:checked').value;
    const p = pendingPriceChange;
    const t = learnerTiers[p.index];
    t.price = p.newMonthly; t.annualPrice = p.newAnnual;
    t.cap = p.cap; t.durationDays = p.durationDays; t.gated = p.gated;
    editingTierIndex = null;
    closeConfirmModal();
    renderTiers();
    logAudit(
      `${t.name} price changed (${scope === 'all' ? 'all existing subscribers' : 'new subscribers only'})`,
      `₦${p.oldMonthly}/mo, ₦${p.oldAnnual}/yr`,
      `₦${p.newMonthly}/mo, ₦${p.newAnnual}/yr`
    );
    toast(`${t.name} price updated — applies to ${scope === 'all' ? 'everyone' : 'new subscribers only'}`);
    pendingPriceChange = null;
  }

  function closeConfirmModal(){
    document.getElementById('confirm-overlay').classList.remove('show');
  }

  function saveSchoolTier(i){
    const t = schoolTiers[i];
    const before = `${t.studentCap}/${t.instructorCap}`;
    t.studentCap = Math.max(0, Number(document.getElementById('tier-student-cap-input').value) || 0);
    t.instructorCap = Math.max(0, Number(document.getElementById('tier-instructor-cap-input').value) || 0);
    const durationInput = document.getElementById('tier-duration-input');
    if (durationInput) t.durationDays = Math.max(1, Number(durationInput.value) || 1);
    t.gated = readCheckedFeatures(SCHOOL_FEATURES, 'sf');
    editingTierIndex = null;
    renderTiers();
    logAudit(`${t.name} (School) updated`, before, `${t.studentCap}/${t.instructorCap}`);
    toast(`${t.name} (School) updated`);
  }

  function saveSubscriptionSettings(){
    const retries = document.getElementById('sl-retries').value;
    const grace = document.getElementById('sl-grace').value;
    const proration = document.getElementById('sl-proration').value;
    logAudit('Subscription lifecycle settings updated', '—', `${retries} retries, ${grace}d grace, ${proration}`);
    toast('Subscription settings saved');
  }

  let newTierPlatform = 'learner';
  function openTierModal(platform){
    newTierPlatform = platform;
    document.getElementById('nt-cap-learner').style.display = platform === 'learner' ? '' : 'none';
    document.getElementById('nt-cap-school').style.display = platform === 'school' ? '' : 'none';
    const features = platform === 'learner' ? LEARNER_FEATURES : SCHOOL_FEATURES;
    document.getElementById('nt-feature-checks').innerHTML = features.map(f => `
      <label><input type="checkbox" value="${escapeHTML(f)}"> ${escapeHTML(f)}</label>
    `).join('');
    document.getElementById('nt-access').value = 'free';
    toggleTierPriceFields();
    document.getElementById('tier-overlay').classList.add('show');
  }
  function closeTierModal(){
    document.getElementById('tier-overlay').classList.remove('show');
  }
  function toggleTierPriceFields(){
    const isPaid = document.getElementById('nt-access').value === 'paid';
    document.getElementById('nt-price-fields').style.display = (isPaid && newTierPlatform === 'learner') ? '' : 'none';
  }
  function submitNewTier(){
    const name = document.getElementById('nt-name').value.trim();
    if (!name) { toast('Give the tier a name'); return; }
    const access = document.getElementById('nt-access').value;
    const durationVal = document.getElementById('nt-duration').value;
    const durationDays = durationVal ? Math.max(1, Number(durationVal)) : null;
    const gated = Array.from(document.querySelectorAll('#nt-feature-checks input:checked')).map(cb => cb.value);

    if (newTierPlatform === 'learner') {
      learnerTiers.push({
        name, access,
        price: access === 'paid' ? Math.max(0, Number(document.getElementById('nt-price-monthly').value) || 0) : 0,
        annualPrice: access === 'paid' ? Math.max(0, Number(document.getElementById('nt-price-annual').value) || 0) : 0,
        cap: Math.max(0, Number(document.getElementById('nt-cap').value) || 0),
        durationDays, gated,
      });
    } else {
      schoolTiers.push({
        name, access,
        studentCap: Math.max(0, Number(document.getElementById('nt-student-cap').value) || 0),
        instructorCap: Math.max(0, Number(document.getElementById('nt-instructor-cap').value) || 0),
        durationDays, gated,
      });
    }
    logAudit(`New ${newTierPlatform} tier "${name}" created`, '—', access === 'paid' ? 'Paid' : 'Free');
    closeTierModal();
    renderTiers();
    toast(`${name} tier added`);
  }


  function usageBarHTML(used, cap){
    const pct = Math.min(100, Math.round((used / cap) * 100));
    const warn = pct >= 90 ? ' warn' : '';
    return `
      <div class="usage-label">
        <span>${used} / ${cap} credits<small> (${pct}%)</small></span>
        <div class="bar-bg"><div class="bar-fill${warn}" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  function renderPagination(containerId, page, totalPages, onClick){
    const el = document.getElementById(containerId);
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    let html = `<button ${page===1?'disabled':''} onclick="${onClick}(${page-1})">‹</button>`;
    for (let p=1; p<=totalPages; p++){
      html += `<button class="${p===page?'active':''}" onclick="${onClick}(${p})">${p}</button>`;
    }
    html += `<button ${page===totalPages?'disabled':''} onclick="${onClick}(${page+1})">›</button>`;
    el.innerHTML = html;
  }

  function getFilteredSchools(){
    const q = (document.getElementById('school-search')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('school-status-filter')?.value || 'all';
    return schools
      .map((s, i) => ({ s, i }))
      .filter(({s}) => s.name.toLowerCase().includes(q))
      .filter(({s}) => statusFilter === 'all' ? !s.archived : (statusFilter === 'archived' ? s.archived : (!s.archived && s.status === statusFilter)));
  }

  function renderSchoolAlerts(){
    const alerts = [];
    schools.forEach((s, i) => {
      if (s.archived) return;
      const rows = usage.filter(u => u.school === s.name);
      const used = rows.reduce((sum,u)=>sum+u.used,0);
      const cap = s.studentCap + s.instructorCap;
      if (cap > 0 && used/cap >= 0.85) {
        alerts.push({ type: 'warn', i, text: `${escapeHTML(s.name)} has used ${Math.round(used/cap*100)}% of its combined credit cap` });
      }
      if (s.status === 'active') {
        const d = daysUntil(s.end);
        if (d >= 0 && d <= 7) alerts.push({ type: 'info', i, text: `${escapeHTML(s.name)}'s pilot ends in ${d} day${d===1?'':'s'}` });
      }
    });
    document.getElementById('school-alerts').innerHTML = alerts.map(a => `
      <div class="alert-item${a.type==='info'?' info':''}">${a.text}<button onclick="showSchoolDetail(${a.i})">View</button></div>
    `).join('');
  }

  function renderUsageAlerts(){
    const near = usage.filter(u => u.used/u.cap >= 0.9);
    document.getElementById('usage-alerts').innerHTML = near.length ? `
      <div class="alert-item">${near.length} account${near.length===1?'':'s'} near their credit cap this period</div>
    ` : '';
  }

  function renderSchools(){
    renderSchoolAlerts();
    const filtered = getFilteredSchools();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    schoolPage = Math.min(schoolPage, totalPages);
    const pageItems = filtered.slice((schoolPage-1)*PAGE_SIZE, schoolPage*PAGE_SIZE);
    const wrap = document.getElementById('school-cards');
    wrap.innerHTML = pageItems.length ? pageItems.map(({s, i}) => `
      <div class="card clickable" onclick="showSchoolDetail(${i})">
        <h3>${escapeHTML(s.name)}</h3>
        <div class="status ${s.archived ? '' : s.status}">${s.archived ? '● Archived' : (s.status === 'active' ? '● Pilot active' : '● Pilot ended')}</div>
        <div class="row"><span>Start</span><span>${s.start}</span></div>
        <div class="row"><span>End</span><span>${s.end}</span></div>
        <div class="row"><span>Student cap</span><span>${s.studentCap}/mo</span></div>
        <div class="row"><span>Instructor cap</span><span>${s.instructorCap}/mo</span></div>
      </div>
    `).join('') : `<p style="color:var(--text-dim)">No schools match your search.</p>`;
    renderPagination('school-pagination', schoolPage, totalPages, 'goToSchoolPage');
  }

  function goToSchoolPage(p){ schoolPage = p; renderSchools(); }

  function openModal(){
    document.getElementById('overlay').classList.add('show');
    document.getElementById('m-name').focus();
  }
  function closeModal(){
    document.getElementById('overlay').classList.remove('show');
    ['m-name','m-start','m-end','m-contact-name','m-contact-email','m-contact-phone'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('m-student-cap').value = 200;
    document.getElementById('m-instructor-cap').value = 400;
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('overlay').classList.contains('show')) closeModal();
    if (document.getElementById('confirm-overlay').classList.contains('show')) closeConfirmModal();
    if (document.getElementById('tier-overlay').classList.contains('show')) closeTierModal();
    if (document.getElementById('msg-overlay').classList.contains('show')) closeMessage();
    if (document.getElementById('coupon-overlay').classList.contains('show')) closeCouponModal();
  });
  function submitSchool(){
    const name = document.getElementById('m-name').value.trim();
    const start = document.getElementById('m-start').value;
    const end = document.getElementById('m-end').value;
    const studentCap = Math.max(0, Number(document.getElementById('m-student-cap').value) || 0);
    const instructorCap = Math.max(0, Number(document.getElementById('m-instructor-cap').value) || 0);
    if (!name || !start || !end) { toast('Fill in name, start, and end date'); return; }
    if (end < start) { toast('End date must be after start date'); return; }
    const cEmail = document.getElementById('m-contact-email').value.trim();
    if (cEmail && !cEmail.includes('@')) { toast('Enter a valid contact email'); return; }
    const contact = { name: document.getElementById('m-contact-name').value.trim(), email: cEmail, phone: document.getElementById('m-contact-phone').value.trim() };
    schools.push({ name, contact, start, end, studentCap, instructorCap, status: 'active', archived: false });
    schoolPage = 1;
    renderSchools();
    closeModal();
    toast(`${name} added as a pilot school`);
  }

  function showSchoolDetail(i){
    activeSchoolIndex = i;
    const s = schools[i];
    document.getElementById('detail-name-wrap').innerHTML = `<h1>${escapeHTML(s.name)}</h1>`;
    document.getElementById('detail-status').textContent = s.archived ? 'Archived' : (s.status === 'active' ? 'Pilot active' : 'Pilot ended');

    const rows = usage.filter(u => u.school === s.name);
    const studentUsage = rows.filter(u => u.role === 'Student');
    const instructorUsage = rows.filter(u => u.role === 'Instructor');
    const totalUsed = rows.reduce((sum, u) => sum + u.used, 0);

    document.getElementById('detail-stats').innerHTML = `
      <div class="stat"><div class="label">Students</div><div class="value">${studentUsage.length}</div></div>
      <div class="stat"><div class="label">Instructors</div><div class="value">${instructorUsage.length}</div></div>
      <div class="stat"><div class="label">Credits used this period</div><div class="value">${totalUsed}</div></div>
    `;

    document.getElementById('detail-settings').innerHTML = `
      <tr>
        <td><input class="credit-input" style="width:130px" type="date" value="${s.start}" onchange="updateSchoolField(${i},'start',this.value)"></td>
        <td><input class="credit-input" style="width:130px" type="date" value="${s.end}" onchange="updateSchoolField(${i},'end',this.value)"></td>
        <td><input class="credit-input" type="number" min="0" value="${s.studentCap}" onchange="updateSchoolField(${i},'studentCap',Math.max(0,Number(this.value)||0))"> / mo</td>
        <td><input class="credit-input" type="number" min="0" value="${s.instructorCap}" onchange="updateSchoolField(${i},'instructorCap',Math.max(0,Number(this.value)||0))"> / mo</td>
      </tr>
    `;

    document.getElementById('detail-usage').innerHTML = rows.length ? rows.map(u => `
      <tr class="usage-row">
        <td>${escapeHTML(u.name)}</td>
        <td>${u.role}</td>
        <td style="min-width:220px">${usageBarHTML(u.used, u.cap)}</td>
      </tr>
    `).join('') : `<tr><td colspan="3" style="color:var(--text-dim)">No usage recorded yet.</td></tr>`;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const ct = s.contact || { name: '', email: '', phone: '' };
    document.getElementById('sc-name').value = ct.name;
    document.getElementById('sc-email').value = ct.email;
    document.getElementById('sc-phone').value = ct.phone;
    renderSchoolMessages(s);
    document.getElementById('school-detail').classList.add('active');
  }

  function updateSchoolField(i, field, value){
    schools[i][field] = value;
    if (field === 'end' && schools[i].status === 'active' && daysUntil(value) < 0) schools[i].status = 'ended';
    toast(`${schools[i].name} updated`);
    showSchoolDetail(i);
  }

  function startEditName(){
    const s = schools[activeSchoolIndex];
    document.getElementById('detail-name-wrap').innerHTML = `
      <input type="text" id="name-input" value="${escapeHTML(s.name)}">
      <button class="btn small" onclick="saveEditName()">Save</button>
    `;
    document.getElementById('name-input').focus();
  }
  function saveEditName(){
    const val = document.getElementById('name-input').value.trim();
    if (!val) { toast('Name cannot be empty'); return; }
    const oldName = schools[activeSchoolIndex].name;
    schools[activeSchoolIndex].name = val;
    usage.forEach(u => { if (u.school === oldName) u.school = val; });
    messages.forEach(m => { if (m.schoolName === oldName) m.schoolName = val; });
    toast('School renamed');
    showSchoolDetail(activeSchoolIndex);
  }
  function endPilotNow(){
    schools[activeSchoolIndex].status = 'ended';
    schools[activeSchoolIndex].end = TODAY;
    toast(`${schools[activeSchoolIndex].name}'s pilot ended`);
    showSchoolDetail(activeSchoolIndex);
  }
  function archiveSchool(){
    schools[activeSchoolIndex].archived = true;
    toast(`${schools[activeSchoolIndex].name} archived`);
    backToSchools();
  }

  function backToSchools(){
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('schools').classList.add('active');
    document.querySelector('.nav-item[data-panel="schools"]').classList.add('active');
    renderSchools();
  }

  function renderUsage(){
    renderUsageAlerts();
    const totalPages = Math.max(1, Math.ceil(usage.length / USAGE_PAGE_SIZE));
    usagePage = Math.min(usagePage, totalPages);
    const pageItems = usage.slice((usagePage-1)*USAGE_PAGE_SIZE, usagePage*USAGE_PAGE_SIZE);
    const body = document.getElementById('usage-body');
    body.innerHTML = pageItems.map(u => `
      <tr class="usage-row">
        <td>${escapeHTML(u.name)}${u.school ? ` — ${u.role.toLowerCase()}, ${escapeHTML(u.school)}` : ` — ${u.role.toLowerCase()}`}</td>
        <td>${u.tier}</td>
        <td style="min-width:220px">${usageBarHTML(u.used, u.cap)}</td>
      </tr>
    `).join('');
    renderPagination('usage-pagination', usagePage, totalPages, 'goToUsagePage');
  }

  function goToUsagePage(p){ usagePage = p; renderUsage(); }

  function toCSV(rows){
    const header = 'Account,Role,School,Tier,Used,Cap\n';
    const body = rows.map(u => [u.name, u.role, u.school||'', u.tier, u.used, u.cap].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    return header + body;
  }

  async function downloadCSV(filename, rows){
    const csv = toCSV(rows);
    const dl = await claude.use('downloads');
    if (!dl) { toast('Downloads are not available in this view'); return; }
    try {
      await dl.save({ filename, data: csv });
    } catch (e) {
      toast('Download was not saved');
    }
  }

  function exportUsageCSV(){ downloadCSV('akoro-usage.csv', usage); }
  function exportDetailCSV(){
    const s = schools[activeSchoolIndex];
    downloadCSV(`${s.name.replace(/\s+/g,'-').toLowerCase()}-usage.csv`, usage.filter(u => u.school === s.name));
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
      if (btn.dataset.panel === 'overview') renderOverview();
    });
  });

  let subs = [
    { id: 'SUB-1001', parent: 'Mrs. Adebayo', customerId: 'CUS-201', learner: 'Amara O.', tier: 'Premium', status: 'active', cycle: 'monthly', price: 1500, next: '2026-10-12', method: 'Card •••• 4242', notes: '', timeline: [{when:'2026-09-12', text:'Renewed successfully'},{when:'2026-08-12', text:'Upgraded from Trial to Premium'}] },
    { id: 'SUB-1002', parent: 'Mr. Okafor', customerId: 'CUS-202', learner: 'Tunde A.', tier: 'Trial', status: 'trial', cycle: 'monthly', price: 0, next: '2026-10-05', method: 'None on file', notes: '', timeline: [{when:'2026-09-21', text:'Trial started (14 days)'}] },
    { id: 'SUB-1003', parent: 'Mrs. Bello', customerId: 'CUS-203', learner: 'Ifeoma K.', tier: 'Freemium', status: 'active', cycle: 'monthly', price: 0, next: '—', method: 'None on file', notes: '', timeline: [{when:'2026-09-01', text:'Trial ended, moved to Freemium'}] },
    { id: 'SUB-1004', parent: 'Mr. Sani', customerId: 'CUS-204', learner: 'Bola S.', tier: 'Premium', status: 'past_due', cycle: 'annual', price: 14400, next: '2026-09-25', method: 'Card •••• 1881', notes: 'Parent said card was replaced.', timeline: [{when:'2026-09-25', text:'Renewal payment failed (attempt 1 of 3)'},{when:'2025-09-25', text:'Subscribed annually'}] },
    { id: 'SUB-1005', parent: 'Mrs. Eze', customerId: 'CUS-205', learner: 'Chidi E.', tier: 'Premium', status: 'paused', cycle: 'monthly', price: 1500, next: '—', method: 'Card •••• 7710', notes: '', timeline: [{when:'2026-09-10', text:'Paused at parent request (school break)'}] },
    { id: 'SUB-1006', parent: 'Mr. Balogun', customerId: 'CUS-206', learner: 'Kemi B.', tier: 'Premium', status: 'canceled', cycle: 'monthly', price: 1500, next: '—', method: 'Card •••• 9023', notes: '', timeline: [{when:'2026-09-02', text:'Canceled by parent'}] },
    { id: 'SUB-1007', parent: 'Mrs. Danjuma', customerId: 'CUS-207', learner: 'Sade D.', tier: 'Premium', status: 'active', cycle: 'annual', price: 14400, next: '2027-03-01', method: 'Card •••• 3356', notes: '', timeline: [{when:'2026-03-01', text:'Subscribed annually'}] },
    { id: 'SUB-1008', parent: 'Mrs. Adebayo', customerId: 'CUS-201', learner: 'Femi A.', tier: 'Premium', status: 'active', cycle: 'monthly', price: 1500, next: '2026-10-20', method: 'Card •••• 4242', notes: '', timeline: [{when:'2026-09-20', text:'Subscribed monthly'}] },
  ];
  let subPage = 1, activeSubIndex = null, cancelArmed = false;
  const SUB_PAGE_SIZE = 5;
  const STATUS_LABELS = { active:'Active', trial:'Trial', past_due:'Past due', canceled:'Canceled', paused:'Paused' };

  function subPrice(s){
    if (s.price === 0) return 'Free';
    return `₦${s.price.toLocaleString()}/${s.cycle === 'annual' ? 'yr' : 'mo'}`;
  }
  function addDays(dateStr, n){
    const d = new Date(dateStr); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0,10);
  }

  function renderSubs(){
    const q = (document.getElementById('sub-search')?.value || '').toLowerCase();
    const f = document.getElementById('sub-status-filter')?.value || 'all';
    const filtered = subs.map((s,i)=>({s,i}))
      .filter(({s}) => [s.id, s.parent, s.learner].some(v => v.toLowerCase().includes(q)))
      .filter(({s}) => f === 'all' || s.status === f);
    const totalPages = Math.max(1, Math.ceil(filtered.length / SUB_PAGE_SIZE));
    subPage = Math.min(subPage, totalPages);
    const items = filtered.slice((subPage-1)*SUB_PAGE_SIZE, subPage*SUB_PAGE_SIZE);
    document.getElementById('sub-body').innerHTML = items.length ? items.map(({s,i}) => `
      <tr class="clickable-row" onclick="showSub(${i})">
        <td>${escapeHTML(s.id)}</td>
        <td>${escapeHTML(s.parent)}</td>
        <td>${escapeHTML(s.learner)}</td>
        <td>${escapeHTML(s.tier)} <small style="color:var(--text-dim)">${subPrice(s)}</small></td>
        <td><span class="badge s-${s.status}">${STATUS_LABELS[s.status]}</span></td>
        <td>${escapeHTML(s.next)}</td>
        <td><button class="btn ghost small" onclick="event.stopPropagation();openMessage('sub',${i})">Message</button></td>
      </tr>
    `).join('') : `<tr><td colspan="7" style="color:var(--text-dim)">No subscriptions match.</td></tr>`;
    renderPagination('sub-pagination', subPage, totalPages, 'goToSubPage');
  }
  function goToSubPage(p){ subPage = p; renderSubs(); }

  function showSub(i){
    activeSubIndex = i; cancelArmed = false;
    const s = subs[i];
    document.getElementById('sd-title').textContent = `${s.id} · ${s.learner}`;
    document.getElementById('sd-sub').innerHTML = `Billed to <button class="link-btn" onclick="showCustomerById('${s.customerId}')">${escapeHTML(s.parent)}</button> &nbsp;<span class="badge s-${s.status}">${STATUS_LABELS[s.status]}</span>`;
    const dateLabel = s.status === 'trial' ? 'Trial ends' : s.status === 'past_due' ? 'Payment due since' : 'Next renewal';
    document.getElementById('sd-stats').innerHTML = `
      <div class="stat"><div class="label">Plan</div><div class="value">${escapeHTML(s.tier)}</div></div>
      <div class="stat"><div class="label">Price</div><div class="value">${subPrice(s)}</div></div>
      <div class="stat"><div class="label">${dateLabel}</div><div class="value">${escapeHTML(s.next)}</div></div>
      <div class="stat"><div class="label">Payment method</div><div class="value" style="font-size:1rem">${escapeHTML(s.method)}</div></div>
      <div class="stat"><div class="label">Discount</div><div class="value" style="font-size:1rem">${s.discount ? escapeHTML(s.discount.code) : 'None'}</div>${s.discount ? `<div class="note">${escapeHTML(couponText(coupons.find(c => c.code === s.discount.code)))}</div>` : ''}</div>
    `;
    renderSubActions();
    renderSubCoupon();
    document.getElementById('sd-timeline').innerHTML = s.timeline.map(t => `<tr><td>${escapeHTML(t.when)}</td><td>${escapeHTML(t.text)}</td></tr>`).join('');
    document.getElementById('sd-notes').value = s.notes;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('sub-detail').classList.add('active');
  }

  function renderSubActions(){
    const s = subs[activeSubIndex];
    const btn = (label, fn, cls='ghost') => `<button class="btn ${cls} small" onclick="${fn}">${label}</button>`;
    const cancelBtn = cancelArmed
      ? btn('Confirm cancel', 'subAction("cancel")', 'danger') + btn('Keep', 'disarmCancel()')
      : btn('Cancel subscription', 'armCancel()', 'danger');
    let html = '';
    if (s.tier === 'Freemium') html = '<span class="sub" style="margin:0">Free plan, no billing actions.</span>';
    else if (s.status === 'active') html = btn('Pause', 'subAction("pause")') + cancelBtn;
    else if (s.status === 'trial') html = btn('Extend trial +7 days', 'subAction("extend")') + cancelBtn;
    else if (s.status === 'past_due') html = btn('Retry payment', 'subAction("retry")') + cancelBtn;
    else if (s.status === 'paused') html = btn('Resume', 'subAction("resume")') + cancelBtn;
    else if (s.status === 'canceled') html = btn('Reactivate', 'subAction("reactivate")');
    document.getElementById('sd-actions').innerHTML = html;
  }
  function armCancel(){ cancelArmed = true; renderSubActions(); }
  function disarmCancel(){ cancelArmed = false; renderSubActions(); }

  function subAction(action){
    const s = subs[activeSubIndex];
    const old = s.status;
    const set = (status, text, audit) => {
      s.status = status;
      s.timeline.unshift({ when: TODAY, text });
      logAudit(`${s.id} ${audit}`, STATUS_LABELS[old], STATUS_LABELS[status]);
    };
    if (action === 'pause') { set('paused', 'Paused by admin', 'paused'); s.next = '—'; }
    else if (action === 'resume') { set('active', 'Resumed by admin', 'resumed'); s.next = addDays(TODAY, s.cycle === 'annual' ? 365 : 30); }
    else if (action === 'cancel') { set('canceled', 'Canceled by admin', 'canceled'); s.next = '—'; }
    else if (action === 'reactivate') { set('active', 'Reactivated by admin', 'reactivated'); s.next = addDays(TODAY, s.cycle === 'annual' ? 365 : 30); }
    else if (action === 'retry') { set('active', 'Payment retry succeeded', 'payment retried'); s.next = addDays(TODAY, s.cycle === 'annual' ? 365 : 30); markSubInvoicesPaid(s.id); }
    else if (action === 'extend') {
      s.next = addDays(s.next, 7);
      s.timeline.unshift({ when: TODAY, text: 'Trial extended by 7 days' });
      logAudit(`${s.id} trial extended`, 'ends earlier', `ends ${s.next}`);
    }
    toast(`${s.id} updated`);
    renderSubs();
    renderOverview();
    renderCustomers();
    showSub(activeSubIndex);
  }

  function saveSubNotes(){
    subs[activeSubIndex].notes = document.getElementById('sd-notes').value;
    toast('Notes saved');
  }
  function backToSubs(){
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('subscriptions').classList.add('active');
    document.querySelector('.nav-item[data-panel="subscriptions"]').classList.add('active');
    renderSubs();
  }

  function openPanel(name){
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(name).classList.add('active');
    if (name === 'overview') renderOverview();
  }
  function goSubsFiltered(status){
    document.getElementById('sub-status-filter').value = status;
    document.getElementById('sub-search').value = '';
    subPage = 1;
    renderSubs();
    openPanel('subscriptions');
  }

  function renderOverview(){
    const paying = subs.filter(s => s.tier === 'Premium' && s.status === 'active');
    const trials = subs.filter(s => s.status === 'trial');
    const pastDue = subs.filter(s => s.status === 'past_due');
    const trialsEnding = trials.filter(s => { const d = daysUntil(s.next); return d >= 0 && d <= 7; });
    const concluded = subs.filter(s => s.timeline.some(t => /Trial ended|Upgraded from Trial/.test(t.text)));
    const converted = subs.filter(s => s.timeline.some(t => /Upgraded from Trial/.test(t.text)));
    const convPct = concluded.length ? Math.round(converted.length / concluded.length * 100) : null;
    const atRisk = pastDue.reduce((sum, s) => sum + s.price, 0);
    const pilotSchools = schools.filter(s => s.status === 'active' && !s.archived).length;

    document.getElementById('ov-kpis').innerHTML = `
      <div class="stat link" onclick="goSubsFiltered('active')"><div class="label">Paying subscribers</div><div class="value">${paying.length}</div><div class="note">Active Premium</div></div>
      <div class="stat link" onclick="goSubsFiltered('trial')"><div class="label">Trials in progress</div><div class="value">${trials.length}</div><div class="note">${trialsEnding.length} ending within 7 days</div></div>
      <div class="stat"><div class="label">Trial conversion</div><div class="value">${convPct === null ? '—' : convPct + '%'}</div><div class="note">${converted.length} of ${concluded.length} concluded trials</div></div>
      <div class="stat link" onclick="goSubsFiltered('past_due')"><div class="label">Past due</div><div class="value">${pastDue.length}</div><div class="note">₦${atRisk.toLocaleString()} at risk</div></div>
      <div class="stat link" onclick="openPanel('schools')"><div class="label">Active pilot schools</div><div class="value">${pilotSchools}</div><div class="note">No subscription records</div></div>
    `;

    const mix = [
      { label: 'Trial', n: trials.length },
      { label: 'Freemium', n: subs.filter(s => s.tier === 'Freemium' && s.status === 'active').length },
      { label: 'Premium', n: paying.length },
    ];
    const total = mix.reduce((sum, m) => sum + m.n, 0) || 1;
    document.getElementById('ov-mix').innerHTML = mix.map(m => `
      <div class="mix-row"><span class="mix-label">${m.label}</span><div class="bar-bg"><div class="bar-fill" style="width:${Math.round(m.n / total * 100)}%"></div></div><span class="mix-count">${m.n}</span></div>
    `).join('');

    const rows = [];
    subs.forEach((s, i) => {
      if (s.status === 'past_due') rows.push({ i, s, issue: `Payment failed, ${subPrice(s)} unpaid` });
      else if (s.status === 'trial' && trialsEnding.includes(s)) rows.push({ i, s, issue: `Trial ends ${s.next}` });
    });
    document.getElementById('ov-attention').innerHTML = rows.length ? rows.map(r => `
      <tr><td>${escapeHTML(r.s.id)} · ${escapeHTML(r.s.learner)}</td><td>${escapeHTML(r.issue)}</td><td><button class="btn ghost small" onclick="showSub(${r.i})">View</button></td></tr>
    `).join('') : `<tr><td colspan="3" style="color:var(--text-dim)">Nothing needs attention right now.</td></tr>`;

    const upcoming = subs.filter(s => s.status === 'active' && s.price > 0 && daysUntil(s.next) >= 0 && daysUntil(s.next) <= 30);
    document.getElementById('ov-renewals').innerHTML = upcoming.length ? upcoming.map(s => `
      <tr><td>${escapeHTML(s.id)}</td><td>${escapeHTML(s.learner)}</td><td>${escapeHTML(s.next)}</td><td>${subPrice(s)}</td></tr>
    `).join('') : `<tr><td colspan="4" style="color:var(--text-dim)">No renewals in the next 30 days.</td></tr>`;
  }

  let customers = [
    { id: 'CUS-201', name: 'Mrs. Adebayo', email: 'adebayo@example.com', phone: '+234 803 000 0101', notes: 'Two children on Akoro.' },
    { id: 'CUS-202', name: 'Mr. Okafor', email: 'okafor@example.com', phone: '+234 803 000 0102', notes: '' },
    { id: 'CUS-203', name: 'Mrs. Bello', email: 'bello@example.com', phone: '+234 803 000 0103', notes: '' },
    { id: 'CUS-204', name: 'Mr. Sani', email: 'sani@example.com', phone: '+234 803 000 0104', notes: 'Card was replaced, waiting on new details.' },
    { id: 'CUS-205', name: 'Mrs. Eze', email: 'eze@example.com', phone: '+234 803 000 0105', notes: '' },
    { id: 'CUS-206', name: 'Mr. Balogun', email: 'balogun@example.com', phone: '+234 803 000 0106', notes: '' },
    { id: 'CUS-207', name: 'Mrs. Danjuma', email: 'danjuma@example.com', phone: '+234 803 000 0107', notes: '' },
  ];
  let custPage = 1, activeCustIndex = null;
  const CUST_PAGE_SIZE = 5;

  function custSubs(c){ return subs.map((s, i) => ({ s, i })).filter(({ s }) => s.customerId === c.id); }
  function custStanding(c){
    const list = custSubs(c).map(x => x.s);
    if (list.some(s => s.status === 'past_due')) return { key: 'past_due', label: 'Past due' };
    if (list.some(s => s.status === 'active' && s.price > 0)) return { key: 'active', label: 'Good standing' };
    if (list.some(s => s.status === 'trial')) return { key: 'trial', label: 'On trial' };
    return { key: 'canceled', label: 'No active paid plan' };
  }
  function custBalance(c){
    return custSubs(c).filter(x => x.s.status === 'past_due').reduce((sum, x) => sum + x.s.price, 0);
  }

  function renderCustomers(){
    const q = (document.getElementById('cust-search')?.value || '').toLowerCase();
    const filtered = customers.map((c, i) => ({ c, i })).filter(({ c }) =>
      [c.id, c.name, c.email, ...custSubs(c).map(x => x.s.learner)].some(v => v.toLowerCase().includes(q)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / CUST_PAGE_SIZE));
    custPage = Math.min(custPage, totalPages);
    const items = filtered.slice((custPage - 1) * CUST_PAGE_SIZE, custPage * CUST_PAGE_SIZE);
    document.getElementById('cust-body').innerHTML = items.length ? items.map(({ c, i }) => {
      const st = custStanding(c), bal = custBalance(c);
      return `
      <tr class="clickable-row" onclick="showCustomer(${i})">
        <td>${escapeHTML(c.id)}</td>
        <td>${escapeHTML(c.name)}</td>
        <td>${escapeHTML(c.email)}</td>
        <td>${custSubs(c).map(x => escapeHTML(x.s.learner)).join(', ')}</td>
        <td><span class="badge s-${st.key}">${st.label}</span></td>
        <td>${bal ? '₦' + bal.toLocaleString() : '—'}</td>
        <td><button class="btn ghost small" onclick="event.stopPropagation();openMessage('customer',${i})">Message</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" style="color:var(--text-dim)">No customers match.</td></tr>`;
    renderPagination('cust-pagination', custPage, totalPages, 'goToCustPage');
  }
  function goToCustPage(p){ custPage = p; renderCustomers(); }

  function showCustomerById(id){ const i = customers.findIndex(c => c.id === id); if (i >= 0) showCustomer(i); }

  function showCustomer(i){
    activeCustIndex = i;
    const c = customers[i], st = custStanding(c), linked = custSubs(c), bal = custBalance(c);
    document.getElementById('cd-title').textContent = `${c.id} · ${c.name}`;
    document.getElementById('cd-sub').innerHTML = `<span class="badge s-${st.key}">${st.label}</span>`;
    const methods = [...new Set(linked.map(x => x.s.method).filter(m => m !== 'None on file'))];
    document.getElementById('cd-stats').innerHTML = `
      <div class="stat"><div class="label">Linked learners</div><div class="value">${linked.length}</div></div>
      <div class="stat"><div class="label">Active paid plans</div><div class="value">${linked.filter(x => x.s.status === 'active' && x.s.price > 0).length}</div></div>
      <div class="stat"><div class="label">Open balance</div><div class="value">${bal ? '₦' + bal.toLocaleString() : '—'}</div></div>
    `;
    document.getElementById('cd-email').value = c.email;
    document.getElementById('cd-phone').value = c.phone;
    document.getElementById('cd-subs').innerHTML = linked.length ? linked.map(({ s, i: si }) => `
      <tr class="clickable-row" onclick="showSub(${si})">
        <td>${escapeHTML(s.id)}</td><td>${escapeHTML(s.learner)}</td>
        <td>${escapeHTML(s.tier)} <small style="color:var(--text-dim)">${subPrice(s)}</small></td>
        <td><span class="badge s-${s.status}">${STATUS_LABELS[s.status]}</span></td>
        <td>${escapeHTML(s.next)}</td>
      </tr>`).join('') : `<tr><td colspan="5" style="color:var(--text-dim)">No linked subscriptions.</td></tr>`;
    document.getElementById('cd-methods').innerHTML = methods.length
      ? methods.map(m => `<span class="tag">${escapeHTML(m)}</span>`).join('')
      : '<span class="tag none">None on file</span>';
    document.getElementById('cd-notes').value = c.notes;
    renderCustomerMessages(c);
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('customer-detail').classList.add('active');
  }

  function saveCustomerContact(){
    const c = customers[activeCustIndex];
    const email = document.getElementById('cd-email').value.trim();
    const phone = document.getElementById('cd-phone').value.trim();
    if (!email.includes('@')) { toast('Enter a valid email address'); return; }
    const before = `${c.email}, ${c.phone}`;
    c.email = email; c.phone = phone;
    logAudit(`${c.id} contact details updated`, before, `${email}, ${phone}`);
    toast('Contact details saved');
    renderCustomers();
  }
  function saveCustomerNotes(){
    customers[activeCustIndex].notes = document.getElementById('cd-notes').value;
    toast('Notes saved');
  }
  function backToCustomers(){
    openPanel('customers');
    renderCustomers();
  }

  let invoices = [
    { id: 'INV-3001', customerId: 'CUS-201', subId: 'SUB-1001', issued: '2026-09-12', due: '2026-09-12', status: 'paid', paidOn: '2026-09-12', lines: [{ desc: 'Premium, monthly (Amara O.)', amount: 1500 }], timeline: [{ when: '2026-09-12', text: 'Paid by card' }, { when: '2026-09-12', text: 'Invoice issued' }] },
    { id: 'INV-3002', customerId: 'CUS-201', subId: 'SUB-1001', issued: '2026-08-12', due: '2026-08-12', status: 'paid', paidOn: '2026-08-12', lines: [{ desc: 'Premium, monthly (Amara O.)', amount: 1500 }], timeline: [{ when: '2026-08-12', text: 'Paid by card' }] },
    { id: 'INV-3003', customerId: 'CUS-204', subId: 'SUB-1004', issued: '2026-09-25', due: '2026-09-25', status: 'open', paidOn: null, lines: [{ desc: 'Premium, annual (Bola S.)', amount: 14400 }], timeline: [{ when: '2026-09-25', text: 'Payment attempt 1 failed' }, { when: '2026-09-25', text: 'Invoice issued' }] },
    { id: 'INV-3004', customerId: 'CUS-201', subId: 'SUB-1008', issued: '2026-09-20', due: '2026-09-20', status: 'paid', paidOn: '2026-09-20', lines: [{ desc: 'Premium, monthly (Femi A.)', amount: 1500 }], timeline: [{ when: '2026-09-20', text: 'Paid by card' }] },
    { id: 'INV-3005', customerId: 'CUS-207', subId: 'SUB-1007', issued: '2026-03-01', due: '2026-03-01', status: 'paid', paidOn: '2026-03-01', lines: [{ desc: 'Premium, annual (Sade D.)', amount: 14400 }], timeline: [{ when: '2026-03-01', text: 'Paid by card' }] },
    { id: 'INV-3006', customerId: 'CUS-201', subId: 'SUB-1001', issued: '2026-10-12', due: '2026-10-12', status: 'draft', paidOn: null, lines: [{ desc: 'Premium, monthly (Amara O.)', amount: 1500 }], timeline: [{ when: '2026-09-27', text: 'Draft created for upcoming renewal' }] },
    { id: 'INV-3007', customerId: 'CUS-206', subId: 'SUB-1006', issued: '2026-09-02', due: '2026-09-02', status: 'void', paidOn: null, lines: [{ desc: 'Premium, monthly (Kemi B.)', amount: 1500 }], timeline: [{ when: '2026-09-02', text: 'Voided after subscription was canceled' }] },
    { id: 'INV-3008', customerId: 'CUS-205', subId: 'SUB-1005', issued: '2026-08-10', due: '2026-08-10', status: 'paid', paidOn: '2026-08-10', lines: [{ desc: 'Premium, monthly (Chidi E.)', amount: 1500 }], timeline: [{ when: '2026-08-10', text: 'Paid by card' }] },
  ];
  let invPage = 1, activeInvIndex = null, invVoidArmed = false;
  const INV_PAGE_SIZE = 5;
  const INV_LABELS = { draft: 'Draft', open: 'Open', paid: 'Paid', void: 'Void' };

  function invTotal(inv){ return inv.lines.reduce((sum, l) => sum + l.amount, 0); }
  function invCustomerName(inv){ return customers.find(c => c.id === inv.customerId)?.name || inv.customerId; }
  function invOverdueDays(inv){ return inv.status === 'open' ? -daysUntil(inv.due) : 0; }

  function renderInvoices(){
    const q = (document.getElementById('inv-search')?.value || '').toLowerCase();
    const f = document.getElementById('inv-status-filter')?.value || 'all';
    const filtered = invoices.map((inv, i) => ({ inv, i }))
      .filter(({ inv }) => [inv.id, invCustomerName(inv), inv.subId].some(v => v.toLowerCase().includes(q)))
      .filter(({ inv }) => f === 'all' || inv.status === f);
    const totalPages = Math.max(1, Math.ceil(filtered.length / INV_PAGE_SIZE));
    invPage = Math.min(invPage, totalPages);
    const items = filtered.slice((invPage - 1) * INV_PAGE_SIZE, invPage * INV_PAGE_SIZE);
    document.getElementById('inv-body').innerHTML = items.length ? items.map(({ inv, i }) => `
      <tr class="clickable-row" onclick="showInvoice(${i})">
        <td>${escapeHTML(inv.id)}</td>
        <td>${escapeHTML(invCustomerName(inv))}</td>
        <td>${escapeHTML(inv.subId)}</td>
        <td>${inv.issued}</td>
        <td>${inv.due}${invOverdueDays(inv) > 0 ? ' <span class="overdue">overdue</span>' : ''}</td>
        <td>₦${invTotal(inv).toLocaleString()}</td>
        <td><span class="badge i-${inv.status}">${INV_LABELS[inv.status]}</span></td>
      </tr>`).join('') : `<tr><td colspan="7" style="color:var(--text-dim)">No invoices match.</td></tr>`;
    renderPagination('inv-pagination', invPage, totalPages, 'goToInvPage');
  }
  function goToInvPage(p){ invPage = p; renderInvoices(); }

  function showInvoice(i){
    activeInvIndex = i; invVoidArmed = false;
    const inv = invoices[i];
    const od = invOverdueDays(inv);
    document.getElementById('id-title').textContent = inv.id;
    const subIdx = subs.findIndex(s => s.id === inv.subId);
    document.getElementById('id-sub').innerHTML = `<span class="badge i-${inv.status}">${INV_LABELS[inv.status]}</span> &nbsp;Billed to <button class="link-btn" onclick="showCustomerById('${inv.customerId}')">${escapeHTML(invCustomerName(inv))}</button> · <button class="link-btn" onclick="showSub(${subIdx})">${escapeHTML(inv.subId)}</button>${od > 0 ? ` &nbsp;<span class="overdue">Overdue by ${od} day${od === 1 ? '' : 's'}</span>` : ''}`;
    document.getElementById('id-stats').innerHTML = `
      <div class="stat"><div class="label">Amount</div><div class="value">₦${invTotal(inv).toLocaleString()}</div></div>
      <div class="stat"><div class="label">Issued</div><div class="value" style="font-size:1.05rem">${inv.issued}</div></div>
      <div class="stat"><div class="label">Due</div><div class="value" style="font-size:1.05rem">${inv.due}</div></div>
      <div class="stat"><div class="label">Paid on</div><div class="value" style="font-size:1.05rem">${inv.paidOn || '—'}</div></div>
    `;
    renderInvoiceActions();
    document.getElementById('id-lines').innerHTML = inv.lines.map(l => `<tr><td>${escapeHTML(l.desc)}</td><td style="text-align:right">₦${l.amount.toLocaleString()}</td></tr>`).join('')
      + `<tr><td><b>Total</b></td><td style="text-align:right"><b>₦${invTotal(inv).toLocaleString()}</b></td></tr>`;
    document.getElementById('id-timeline').innerHTML = inv.timeline.map(t => `<tr><td>${escapeHTML(t.when)}</td><td>${escapeHTML(t.text)}</td></tr>`).join('');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('invoice-detail').classList.add('active');
  }

  function renderInvoiceActions(){
    const inv = invoices[activeInvIndex];
    const btn = (label, fn, cls = 'ghost') => `<button class="btn ${cls} small" onclick="${fn}">${label}</button>`;
    const voidBtn = invVoidArmed
      ? btn('Confirm void', 'invAction("void")', 'danger') + btn('Keep', 'disarmVoid()')
      : btn('Void invoice', 'armVoid()', 'danger');
    let html = '';
    if (inv.status === 'draft') html = btn('Finalize', 'invAction("finalize")', '') + voidBtn;
    else if (inv.status === 'open') html = btn('Mark paid', 'invAction("paid")', '') + voidBtn;
    else html = '<span class="sub" style="margin:0">No actions available.</span>';
    document.getElementById('id-actions').innerHTML = html;
  }
  function armVoid(){ invVoidArmed = true; renderInvoiceActions(); }
  function disarmVoid(){ invVoidArmed = false; renderInvoiceActions(); }

  function invAction(action){
    const inv = invoices[activeInvIndex];
    const old = inv.status;
    if (action === 'finalize') { inv.status = 'open'; inv.timeline.unshift({ when: TODAY, text: 'Finalized and sent to customer' }); }
    else if (action === 'paid') { inv.status = 'paid'; inv.paidOn = TODAY; inv.timeline.unshift({ when: TODAY, text: 'Marked paid by admin' }); }
    else if (action === 'void') { inv.status = 'void'; inv.timeline.unshift({ when: TODAY, text: 'Voided by admin' }); }
    logAudit(`${inv.id} ${action === 'paid' ? 'marked paid' : action === 'void' ? 'voided' : 'finalized'}`, INV_LABELS[old], INV_LABELS[inv.status]);
    toast(`${inv.id} updated`);
    renderInvoices();
    showInvoice(activeInvIndex);
  }

  function markSubInvoicesPaid(subId){
    invoices.filter(inv => inv.subId === subId && inv.status === 'open').forEach(inv => {
      inv.status = 'paid'; inv.paidOn = TODAY;
      inv.timeline.unshift({ when: TODAY, text: 'Paid via payment retry' });
    });
    renderInvoices();
  }
  function backToInvoices(){ openPanel('invoices'); renderInvoices(); }

  let messages = [
    { when: '2026-09-26', customerId: 'CUS-204', subId: 'SUB-1004', channel: 'email', subject: 'Payment reminder for Bola S.', body: 'Hi Mr. Sani, we could not process the latest payment for Bola S.\'s Akoro plan.' },
  ];
  messages.push({ when: '2026-09-20', customerId: null, subId: null, schoolName: 'Chrisland College', audience: 'instructors', channel: 'email', subject: 'Pilot wrap-up next week', body: 'A short note ahead of the pilot ending.' });
  let msgCtx = null;
  const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', inapp: 'In-app notice' };

  const CUSTOMER_TEMPLATES = [['payment', 'Payment reminder'], ['trial', 'Trial ending'], ['general', 'General note']];
  const SCHOOL_TEMPLATES = [['pilot-end', 'Pilot ending'], ['cap', 'Credit usage update'], ['general', 'General note']];
  const AUDIENCE_LABELS = { admins: 'School administrators', instructors: 'Instructors', students: 'Students', all: 'Everyone at the school' };

  function setTemplateOptions(list){
    document.getElementById('msg-template').innerHTML = '<option value="">None</option>' + list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  }

  function openMessage(kind, i){
    const wrap = document.getElementById('msg-audience-wrap');
    if (kind === 'school') {
      const sc = schools[i];
      const inst = usage.filter(u => u.school === sc.name && u.role === 'Instructor').length;
      const stud = usage.filter(u => u.school === sc.name && u.role === 'Student').length;
      const ct = sc.contact || {};
      msgCtx = { kind: 'school', schoolName: sc.name, end: sc.end };
      document.getElementById('msg-to').innerHTML = `To the <b>${escapeHTML(sc.name)}</b> pilot · Admin contact: ` + ((ct.name || ct.email || ct.phone) ? [ct.name, ct.email, ct.phone].filter(Boolean).map(escapeHTML).join(' · ') : '<span class="overdue">none on file</span>');
      document.getElementById('msg-audience').innerHTML = `
        <option value="admins">${AUDIENCE_LABELS.admins}</option>
        <option value="instructors">${AUDIENCE_LABELS.instructors} (${inst})</option>
        <option value="students">${AUDIENCE_LABELS.students} (${stud})</option>
        <option value="all">${AUDIENCE_LABELS.all}</option>`;
      wrap.style.display = '';
      setTemplateOptions(SCHOOL_TEMPLATES);
    } else {
      let c, subId = null, learner;
      if (kind === 'sub') { const sb = subs[i]; c = customers.find(x => x.id === sb.customerId); subId = sb.id; learner = sb.learner; }
      else { c = customers[i]; learner = custSubs(c).map(x => x.s.learner).join(' and ') || 'your learner'; }
      msgCtx = { kind: 'customer', customerId: c.id, subId, learner, parent: c.name };
      document.getElementById('msg-to').innerHTML = `To <b>${escapeHTML(c.name)}</b> · ${escapeHTML(c.email)} · ${escapeHTML(c.phone)}${subId ? ` · regarding ${escapeHTML(subId)}` : ''}`;
      wrap.style.display = 'none';
      setTemplateOptions(CUSTOMER_TEMPLATES);
    }
    document.getElementById('msg-channel').value = 'email';
    document.getElementById('msg-subject').value = '';
    document.getElementById('msg-body').value = '';
    toggleMsgSubject();
    document.getElementById('msg-overlay').classList.add('show');
    document.getElementById('msg-subject').focus();
  }
  function closeMessage(){ document.getElementById('msg-overlay').classList.remove('show'); msgCtx = null; }
  function toggleMsgSubject(){
    document.getElementById('msg-subject-wrap').style.display = document.getElementById('msg-channel').value === 'sms' ? 'none' : '';
  }
  function applyMsgTemplate(){
    const t = document.getElementById('msg-template').value;
    if (!t) return;
    const T = {
      payment: ['Payment reminder for {learner}', 'Hi {parent}, we could not process the latest payment for {learner}\'s Akoro plan. Please update your payment details so learning is not interrupted. Thank you.'],
      trial: ['{learner}\'s Akoro trial is ending soon', 'Hi {parent}, {learner}\'s free trial ends soon. Upgrade to Premium to keep Battles, voice tutoring and the full AI credit allowance.'],
      general: ['A note from Akoro', 'Hi {parent}, '],
      'pilot-end': ['The Akoro pilot for {school} ends on {end}', 'Hello from Akoro. The pilot for {school} ends on {end}. Let us know if you would like to continue on Freemium or Premium so nobody loses access.'],
      cap: ['Credit usage update for {school}', 'Hello from Akoro. {school} has used most of its pilot AI credits for this period. Let us know if you would like to discuss adjusting the allowance.'],
    };
    const fill = str => str
      .replace(/{parent}/g, msgCtx.parent || '')
      .replace(/{learner}/g, msgCtx.learner || '')
      .replace(/{school}/g, msgCtx.schoolName || '')
      .replace(/{end}/g, msgCtx.end || '');
    let [subject, body] = T[t];
    if (msgCtx.kind === 'school' && t === 'general') body = 'Hello, ';
    document.getElementById('msg-subject').value = fill(subject);
    document.getElementById('msg-body').value = fill(body);
  }
  function sendMessage(){
    const channel = document.getElementById('msg-channel').value;
    const subject = document.getElementById('msg-subject').value.trim();
    const body = document.getElementById('msg-body').value.trim();
    if (channel !== 'sms' && !subject) { toast('Add a subject'); return; }
    if (!body) { toast('Write a message first'); return; }

    if (msgCtx.kind === 'school') {
      const audience = document.getElementById('msg-audience').value;
      const name = msgCtx.schoolName;
      const ctc = (schools.find(x => x.name === name) || {}).contact || {};
      if ((audience === 'admins' || audience === 'all') && channel === 'email' && !ctc.email) { toast('No admin contact email on file'); return; }
      if (audience === 'admins' && channel === 'sms' && !ctc.phone) { toast('No admin contact phone on file'); return; }
      messages.unshift({ when: TODAY, customerId: null, subId: null, schoolName: name, audience, channel, subject, body });
      logAudit(`${CHANNEL_LABELS[channel]} sent to ${name} (${AUDIENCE_LABELS[audience]})`, '—', subject || body.slice(0, 40));
      closeMessage();
      toast('Message logged (mock, not actually sent)');
      if (document.getElementById('school-detail').classList.contains('active')) renderSchoolMessages(schools[activeSchoolIndex]);
      return;
    }

    const c = customers.find(x => x.id === msgCtx.customerId);
    if (channel === 'email' && !c.email) { toast('No email on file'); return; }
    if (channel === 'sms' && !c.phone) { toast('No phone number on file'); return; }
    messages.unshift({ when: TODAY, customerId: c.id, subId: msgCtx.subId, channel, subject, body });
    if (msgCtx.subId) {
      const sb = subs.find(x => x.id === msgCtx.subId);
      sb.timeline.unshift({ when: TODAY, text: `${CHANNEL_LABELS[channel]} sent to ${c.name}: ${subject || body.slice(0, 40)}` });
    }
    logAudit(`${CHANNEL_LABELS[channel]} sent to ${c.name}${msgCtx.subId ? ' (' + msgCtx.subId + ')' : ''}`, '—', subject || body.slice(0, 40));
    closeMessage();
    toast('Message logged (mock, not actually sent)');
    if (document.getElementById('customer-detail').classList.contains('active')) renderCustomerMessages(customers[activeCustIndex]);
  }
  function saveSchoolContact(){
    const sc = schools[activeSchoolIndex];
    const email = document.getElementById('sc-email').value.trim();
    if (email && !email.includes('@')) { toast('Enter a valid email address'); return; }
    const before = sc.contact ? [sc.contact.name, sc.contact.email, sc.contact.phone].filter(Boolean).join(', ') || '—' : '—';
    sc.contact = { name: document.getElementById('sc-name').value.trim(), email, phone: document.getElementById('sc-phone').value.trim() };
    logAudit(`${sc.name} admin contact updated`, before, [sc.contact.name, sc.contact.email, sc.contact.phone].filter(Boolean).join(', ') || '—');
    toast('Contact saved');
  }
  function renderSchoolMessages(sc){
    const list = messages.filter(m => m.schoolName === sc.name);
    document.getElementById('detail-messages').innerHTML = list.length ? list.map(m => `
      <tr><td>${m.when}</td><td>${CHANNEL_LABELS[m.channel]}</td><td>${AUDIENCE_LABELS[m.audience]}</td>
      <td>${escapeHTML(m.subject || m.body.slice(0, 60))}</td></tr>`).join('')
      : `<tr><td colspan="4" style="color:var(--text-dim)">No messages sent yet.</td></tr>`;
  }
  function renderCustomerMessages(c){
    const list = messages.filter(m => m.customerId === c.id);
    document.getElementById('cd-messages').innerHTML = list.length ? list.map(m => `
      <tr><td>${m.when}</td><td>${CHANNEL_LABELS[m.channel]}</td>
      <td>${escapeHTML(m.subject || m.body.slice(0, 60))}</td><td>${m.subId ? escapeHTML(m.subId) : 'Account'}</td></tr>`).join('')
      : `<tr><td colspan="4" style="color:var(--text-dim)">No messages sent yet.</td></tr>`;
  }

  let coupons = [
    { code: 'WELCOME20', desc: 'Welcome offer for new families', type: 'percent', value: 20, duration: 'repeating', months: 3, max: 100, expires: '2027-01-31', firstTimeOnly: true, paused: false },
    { code: 'SCHOOLBREAK', desc: 'Term-break goodwill credit', type: 'fixed', value: 500, duration: 'once', months: null, max: null, expires: '2026-09-15', firstTimeOnly: false, paused: false },
    { code: 'LOYAL10', desc: 'Loyalty discount', type: 'percent', value: 10, duration: 'forever', months: null, max: 50, expires: null, firstTimeOnly: false, paused: true },
    { code: 'FRIEND1000', desc: 'Refer-a-friend credit', type: 'fixed', value: 1000, duration: 'once', months: null, max: 2, expires: '2026-12-31', firstTimeOnly: false, paused: false },
  ];
  let redemptions = [
    { code: 'WELCOME20', subId: 'SUB-1007', when: '2026-03-01' },
    { code: 'SCHOOLBREAK', subId: 'SUB-1005', when: '2026-08-10' },
    { code: 'FRIEND1000', subId: 'SUB-1001', when: '2026-08-12' },
    { code: 'FRIEND1000', subId: 'SUB-1008', when: '2026-09-20' },
  ];
  redemptions.forEach(r => { const sb = subs.find(x => x.id === r.subId); if (sb) sb.discount = { code: r.code }; });

  let coupPage = 1, activeCoupIndex = null, couponEndArmed = false;
  const COUP_PAGE_SIZE = 5;
  const COUPON_STATUS = { active: ['Active', 's-active'], paused: ['Paused', 's-paused'], expired: ['Expired', 's-canceled'], exhausted: ['Fully redeemed', 's-trial'] };

  function couponRedeemed(c){ return redemptions.filter(r => r.code === c.code).length; }
  function couponStatus(c){
    if (c.paused) return 'paused';
    if (c.expires && c.expires < TODAY) return 'expired';
    if (c.max && couponRedeemed(c) >= c.max) return 'exhausted';
    return 'active';
  }
  function couponText(c){
    if (!c) return '';
    const amt = c.type === 'percent' ? `${c.value}% off` : `₦${c.value.toLocaleString()} off`;
    const dur = c.duration === 'once' ? 'first payment' : c.duration === 'forever' ? 'forever' : `for ${c.months} months`;
    return `${amt}, ${dur}`;
  }

  function renderCoupons(){
    const q = (document.getElementById('coup-search')?.value || '').toLowerCase();
    const f = document.getElementById('coup-status-filter')?.value || 'all';
    const filtered = coupons.map((c, i) => ({ c, i }))
      .filter(({ c }) => c.code.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
      .filter(({ c }) => f === 'all' || couponStatus(c) === f);
    const totalPages = Math.max(1, Math.ceil(filtered.length / COUP_PAGE_SIZE));
    coupPage = Math.min(coupPage, totalPages);
    const items = filtered.slice((coupPage - 1) * COUP_PAGE_SIZE, coupPage * COUP_PAGE_SIZE);
    document.getElementById('coup-body').innerHTML = items.length ? items.map(({ c, i }) => {
      const st = COUPON_STATUS[couponStatus(c)];
      return `
      <tr class="clickable-row" onclick="showCoupon(${i})">
        <td><b>${escapeHTML(c.code)}</b><br><small style="color:var(--text-dim)">${escapeHTML(c.desc)}</small></td>
        <td>${escapeHTML(couponText(c))}</td>
        <td>${couponRedeemed(c)}${c.max ? ' / ' + c.max : ''}</td>
        <td>${c.expires || 'Never'}</td>
        <td><span class="badge ${st[1]}">${st[0]}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" style="color:var(--text-dim)">No coupons match.</td></tr>`;
    renderPagination('coup-pagination', coupPage, totalPages, 'goToCoupPage');
  }
  function goToCoupPage(p){ coupPage = p; renderCoupons(); }

  function showCoupon(i){
    activeCoupIndex = i; couponEndArmed = false;
    const c = coupons[i], st = COUPON_STATUS[couponStatus(c)];
    document.getElementById('cp-title').textContent = c.code;
    document.getElementById('cp-sub').innerHTML = `<span class="badge ${st[1]}">${st[0]}</span> &nbsp;${escapeHTML(c.desc)}${c.firstTimeOnly ? ' · new customers only' : ''}`;
    document.getElementById('cp-stats').innerHTML = `
      <div class="stat"><div class="label">Discount</div><div class="value" style="font-size:1.05rem">${escapeHTML(couponText(c))}</div></div>
      <div class="stat"><div class="label">Redeemed</div><div class="value">${couponRedeemed(c)}${c.max ? ' / ' + c.max : ''}</div></div>
      <div class="stat"><div class="label">Expires</div><div class="value" style="font-size:1.05rem">${c.expires || 'Never'}</div></div>
    `;
    renderCouponActions();
    const list = redemptions.filter(r => r.code === c.code);
    document.getElementById('cp-redemptions').innerHTML = list.length ? list.map(r => {
      const sb = subs.find(x => x.id === r.subId);
      const idx = subs.findIndex(x => x.id === r.subId);
      return `<tr class="clickable-row" onclick="showSub(${idx})"><td>${escapeHTML(r.subId)}</td><td>${escapeHTML(sb.learner)}</td><td>${escapeHTML(sb.parent)}</td><td>${r.when}</td></tr>`;
    }).join('') : `<tr><td colspan="4" style="color:var(--text-dim)">Not redeemed yet.</td></tr>`;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('coupon-detail').classList.add('active');
  }
  function renderCouponActions(){
    const c = coupons[activeCoupIndex], st = couponStatus(c);
    const btn = (label, fn, cls = 'ghost') => `<button class="btn ${cls} small" onclick="${fn}">${label}</button>`;
    const endBtn = couponEndArmed ? btn('Confirm end', 'couponAction("end")', 'danger') + btn('Keep', 'disarmCouponEnd()') : btn('End coupon now', 'armCouponEnd()', 'danger');
    let html = '';
    if (st === 'active') html = btn('Pause', 'couponAction("pause")') + endBtn;
    else if (st === 'paused') html = btn('Resume', 'couponAction("resume")') + endBtn;
    else html = '<span class="sub" style="margin:0">No actions available.</span>';
    document.getElementById('cp-actions').innerHTML = html;
  }
  function armCouponEnd(){ couponEndArmed = true; renderCouponActions(); }
  function disarmCouponEnd(){ couponEndArmed = false; renderCouponActions(); }
  function couponAction(action){
    const c = coupons[activeCoupIndex], old = COUPON_STATUS[couponStatus(c)][0];
    if (action === 'pause') c.paused = true;
    else if (action === 'resume') c.paused = false;
    else if (action === 'end') { c.paused = false; c.expires = addDays(TODAY, -1); }
    logAudit(`Coupon ${c.code} ${action === 'end' ? 'ended' : action === 'pause' ? 'paused' : 'resumed'}`, old, COUPON_STATUS[couponStatus(c)][0]);
    toast(`${c.code} updated`);
    renderCoupons();
    showCoupon(activeCoupIndex);
  }
  function backToCoupons(){ openPanel('coupons'); renderCoupons(); }

  function openCouponModal(){
    ['nc-code','nc-desc','nc-value','nc-max','nc-expires'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('nc-type').value = 'percent';
    document.getElementById('nc-duration').value = 'once';
    document.getElementById('nc-months').value = 3;
    document.getElementById('nc-first').checked = false;
    toggleCouponMonths();
    document.getElementById('coupon-overlay').classList.add('show');
    document.getElementById('nc-code').focus();
  }
  function closeCouponModal(){ document.getElementById('coupon-overlay').classList.remove('show'); }
  function toggleCouponMonths(){
    document.getElementById('nc-months-wrap').style.display = document.getElementById('nc-duration').value === 'repeating' ? '' : 'none';
  }
  function submitCoupon(){
    const code = document.getElementById('nc-code').value.trim().toUpperCase();
    const type = document.getElementById('nc-type').value;
    const value = Number(document.getElementById('nc-value').value);
    const duration = document.getElementById('nc-duration').value;
    const months = Number(document.getElementById('nc-months').value);
    const maxRaw = document.getElementById('nc-max').value;
    const expires = document.getElementById('nc-expires').value || null;
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) { toast('Code: 3-20 letters, numbers, - or _'); return; }
    if (coupons.some(c => c.code === code)) { toast('That code already exists'); return; }
    if (!(value > 0) || (type === 'percent' && value > 100)) { toast('Enter a valid discount value'); return; }
    if (duration === 'repeating' && !(months >= 1)) { toast('Enter the number of months'); return; }
    coupons.unshift({
      code, desc: document.getElementById('nc-desc').value.trim() || 'No description', type, value, duration,
      months: duration === 'repeating' ? months : null, max: maxRaw ? Math.max(1, Number(maxRaw)) : null,
      expires, firstTimeOnly: document.getElementById('nc-first').checked, paused: false,
    });
    logAudit(`Coupon ${code} created`, '—', couponText(coupons[0]));
    closeCouponModal();
    coupPage = 1;
    renderCoupons();
    toast(`${code} created`);
  }

  function couponEligibility(c, sb){
    const st = couponStatus(c);
    if (st !== 'active') return `${c.code} is ${COUPON_STATUS[st][0].toLowerCase()}`;
    if (sb.price === 0) return 'Coupons apply to paid plans only';
    if (sb.status === 'canceled') return 'Subscription is canceled';
    if (sb.discount) return 'This subscription already has a coupon';
    if (c.firstTimeOnly && invoices.some(inv => inv.customerId === sb.customerId && inv.status === 'paid')) return 'Only for customers with no paid invoices';
    return null;
  }
  function renderSubCoupon(){
    const sb = subs[activeSubIndex], box = document.getElementById('sd-coupon');
    if (sb.discount) {
      box.innerHTML = `<button class="btn ghost small" onclick="removeCoupon()">Remove coupon ${escapeHTML(sb.discount.code)}</button>`;
      return;
    }
    const usable = coupons.filter(c => couponStatus(c) === 'active');
    if (sb.price === 0 || sb.status === 'canceled' || !usable.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="price-row"><select id="sd-coupon-select" class="modal-select" style="width:auto">${usable.map(c => `<option value="${c.code}">${escapeHTML(c.code)} · ${escapeHTML(couponText(c))}</option>`).join('')}</select><button class="btn ghost small" onclick="applyCoupon()">Apply coupon</button></div>`;
  }
  function applyCoupon(){
    const sb = subs[activeSubIndex];
    const c = coupons.find(x => x.code === document.getElementById('sd-coupon-select').value);
    const err = couponEligibility(c, sb);
    if (err) { toast(err); return; }
    redemptions.unshift({ code: c.code, subId: sb.id, when: TODAY });
    sb.discount = { code: c.code };
    sb.timeline.unshift({ when: TODAY, text: `Coupon ${c.code} applied (${couponText(c)})` });
    logAudit(`${sb.id} coupon applied`, 'No coupon', c.code);
    toast(`${c.code} applied`);
    renderCoupons();
    showSub(activeSubIndex);
  }
  function removeCoupon(){
    const sb = subs[activeSubIndex], code = sb.discount.code;
    const at = redemptions.findIndex(r => r.code === code && r.subId === sb.id);
    if (at >= 0) redemptions.splice(at, 1);
    sb.discount = null;
    sb.timeline.unshift({ when: TODAY, text: `Coupon ${code} removed` });
    logAudit(`${sb.id} coupon removed`, code, 'No coupon');
    toast(`${code} removed`);
    renderCoupons();
    showSub(activeSubIndex);
  }

  renderTiers();
  renderSchools();
  renderUsage();
  renderAudit();
  renderSubs();
  renderOverview();
  renderCustomers();
  renderInvoices();
  renderCoupons();
</script>
</body>
</html>
