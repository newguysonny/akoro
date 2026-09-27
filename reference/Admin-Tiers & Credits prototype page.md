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
  <button class="nav-item active" data-panel="tiers">Tiers &amp; Credits</button>
  <button class="nav-item" data-panel="schools">Pilot Schools</button>
  <button class="nav-item" data-panel="usage">Usage</button>
</div>

<div class="main">

  <div id="tiers" class="panel active">
    <h1>Tiers &amp; Credits</h1>
    <p class="sub">Default credit caps and feature gating per tier. Changes apply platform-wide unless a school has its own pilot override.</p>
    <table>
      <thead><tr><th>Tier</th><th>Access</th><th>Credit cap / mo</th><th>Gated features</th><th>Actions</th></tr></thead>
      <tbody id="tier-body"></tbody>
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

    <div class="section-title">Usage</div>
    <div class="toolbar"><span></span><button class="btn ghost small" onclick="exportDetailCSV()">Export CSV</button></div>
    <table>
      <thead><tr><th>Account</th><th>Role</th><th>Usage</th></tr></thead>
      <tbody id="detail-usage"></tbody>
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
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="submitSchool()">Add school</button>
    </div>
  </div>
</div>

<div class="save-toast" id="toast">Saved</div>

<script>
  let tiers = [
    { name: 'Pilot', access: 'free', cap: 200, gated: [] },
    { name: 'Trial', access: 'free', cap: 500, gated: [] },
    { name: 'Freemium', access: 'free', cap: 50, gated: ['Gradebook','Battles','Rankings','Voice/audio'] },
    { name: 'Premium', access: 'paid', cap: 1000, gated: [] },
  ];

  const TODAY = '2026-09-27';

  let schools = [
    { name: 'Chrisland College', start: '2026-09-01', end: '2026-09-30', studentCap: 200, instructorCap: 400, status: 'active', archived: false },
    { name: 'St. Francis Xavier', start: '2026-08-01', end: '2026-08-31', studentCap: 180, instructorCap: 350, status: 'ended', archived: false },
    { name: 'Greenfield Academy', start: '2026-10-01', end: '2026-10-03', studentCap: 220, instructorCap: 400, status: 'active', archived: false },
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

  let editingTierIndex = null;
  let editing_focus_needed = false;

  function renderTiers(){
    const body = document.getElementById('tier-body');
    body.innerHTML = tiers.map((t, i) => {
      const editing = editingTierIndex === i;
      return `
      <tr>
        <td class="tier-name">${escapeHTML(t.name)}</td>
        <td><span class="badge ${t.access}">${t.access === 'free' ? 'Free' : 'Paid'}</span></td>
        <td>${
          editing
            ? `<input class="credit-input" id="tier-cap-input" type="number" min="0" value="${t.cap}"> / mo`
            : `${t.cap} / mo`
        }</td>
        <td><div class="tags">${
          t.gated.length
            ? t.gated.map(g => `<span class="tag">${escapeHTML(g)}</span>`).join('')
            : '<span class="tag none">No gating</span>'
        }</div></td>
        <td>${
          editing
            ? `<div class="detail-actions"><button class="btn small" onclick="saveTierCap(${i})">Save</button><button class="btn ghost small" onclick="cancelTierEdit()">Cancel</button></div>`
            : `<button class="btn ghost small" onclick="editTierCap(${i})">Edit</button>`
        }</td>
      </tr>
    `;
    }).join('');
    if (editing_focus_needed) { document.getElementById('tier-cap-input')?.focus(); editing_focus_needed = false; }
  }

  function editTierCap(i){
    editingTierIndex = i;
    editing_focus_needed = true;
    renderTiers();
  }
  function cancelTierEdit(){
    editingTierIndex = null;
    renderTiers();
  }
  function saveTierCap(i){
    const input = document.getElementById('tier-cap-input');
    const v = Math.max(0, Number(input.value) || 0);
    tiers[i].cap = v;
    editingTierIndex = null;
    renderTiers();
    toast(`${tiers[i].name} cap updated to ${v} credits/mo`);
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
    ['m-name','m-start','m-end'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('m-student-cap').value = 200;
    document.getElementById('m-instructor-cap').value = 400;
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('overlay').classList.contains('show')) closeModal();
  });
  function submitSchool(){
    const name = document.getElementById('m-name').value.trim();
    const start = document.getElementById('m-start').value;
    const end = document.getElementById('m-end').value;
    const studentCap = Math.max(0, Number(document.getElementById('m-student-cap').value) || 0);
    const instructorCap = Math.max(0, Number(document.getElementById('m-instructor-cap').value) || 0);
    if (!name || !start || !end) { toast('Fill in name, start, and end date'); return; }
    if (end < start) { toast('End date must be after start date'); return; }
    schools.push({ name, start, end, studentCap, instructorCap, status: 'active', archived: false });
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
    });
  });

  renderTiers();
  renderSchools();
  renderUsage();
</script>
</body>
</html>










Akoro Admin

# Tiers & Credits

Default credit caps and feature gating per tier. Changes apply platform-wide unless a school has its own pilot override.

| Tier | Access | Credit cap / mo | Gated features |
| --- | --- | --- | --- |

# Pilot Schools

Each pilot partner has its own start date, end date, and credit caps. Click a school to see its details.

Pilot settings

| Start date | End date | Student cap / mo | Instructor cap / mo |
| --- | --- | --- | --- |

Usage

| Account | Role | Usage |
| --- | --- | --- |

# Usage

Credits consumed this period across every account.

| Account | Tier | Usage |
| --- | --- | --- |

## Add pilot school

School name

Start date

End date

Student credit cap / mo

Instructor credit cap / mo

Saved
