```
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Gradebook — Akoro Demo Academy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{
    --brand:#6C3BFF;
    --brand-end:#4C1DCC;
    --green:#10B981;
    --gold:#F59E0B;
    --red:#EF4444;
    --blue:#3B82F6;

    --ak-bg:#F5F4FB;
    --ak-surface:#ffffff;
    --ak-surface-hover:#F9FAFB;
    --ak-border:#F3F4F6;
    --ak-border2:#E5E7EB;
    --ak-border3:#D1D5DB;
    --ak-text:#111827;
    --ak-text-sub:#6B7280;
    --ak-text-muted:#9CA3AF;
  }

  *{ box-sizing: border-box; }
  html,body{ margin:0; height:100%; }
  body{
    font-family:'Nunito', sans-serif;
    color: var(--ak-text);
    background: var(--ak-bg);
    display:flex;
    flex-direction:column;
    min-height:100vh;
  }

  /* ── Top app bar ── */
  .app-topbar{
    display:flex;
    align-items:center;
    gap: 26px;
    height: 52px;
    padding: 0 20px;
    background: var(--ak-surface);
    border-bottom: 1px solid var(--ak-border2);
    flex-shrink:0;
  }
  .app-logo{
    width: 26px; height:26px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .app-logo svg{ width:14px; height:14px; }
  .app-nav{ display:flex; align-items:center; gap:22px; height:100%; }
  .app-nav a{
    font-size: 13px;
    font-weight: 700;
    color: var(--ak-text-sub);
    text-decoration:none;
    height:100%;
    display:flex; align-items:center;
    border-bottom: 2px solid transparent;
  }
  .app-nav a.active{
    color: var(--brand);
    font-weight: 800;
    border-bottom-color: var(--brand);
  }
  .app-nav a:hover{ color: var(--ak-text); }

  /* ── Shell ── */
  .gb-shell{ display:flex; flex:1; min-height:0; }

  /* ── Sidebar ── */
  .gb-sidebar{
    width: 240px;
    flex-shrink:0;
    background: var(--ak-surface);
    border-right: 1px solid var(--ak-border2);
    padding: 14px 14px 20px;
    overflow-y: auto;
  }
  .add-assignment-btn{
    display:flex; align-items:center; justify-content:center; gap:6px;
    width:100%;
    padding: 9px 0;
    border-radius: 12px;
    border:none;
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    color:#fff;
    font-family:'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    cursor:pointer;
    box-shadow: 0 8px 16px -6px rgba(108,59,255,0.5);
    margin-bottom: 16px;
  }

  .filter-panel{
    background: var(--ak-surface-hover);
    border-radius: 14px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .filter-panel-label{
    font-size: 11px;
    font-weight: 800;
    color: var(--ak-text-muted);
    margin: 0 0 9px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .filter-select{
    width: 100%;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1px solid var(--ak-border2);
    background: var(--ak-surface);
    font-family:'Nunito', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--ak-text);
    margin-bottom: 7px;
    cursor: pointer;
  }
  .filter-select:last-of-type{ margin-bottom:0; }
  .range-row{
    display:flex;
    align-items:center;
    gap: 6px;
    margin-top: 8px;
  }
  .range-text{
    flex:1;
    font-size: 11px;
    font-weight: 700;
    color: var(--ak-text-sub);
  }
  .range-btn{
    width: 22px; height:22px;
    border-radius: 6px;
    border: 1px solid var(--ak-border2);
    background: var(--ak-surface);
    display:flex; align-items:center; justify-content:center;
    cursor:pointer;
    color: var(--ak-text-sub);
    flex-shrink:0;
  }
  .range-btn:hover{ background: var(--ak-surface-hover); }

  .rail-label{
    font-size: 11px;
    font-weight: 800;
    color: var(--ak-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 0 4px;
    margin: 0 0 8px;
  }
  .rail-item{
    display:flex;
    align-items:center;
    gap: 9px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 10px;
    border: none;
    background: none;
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ak-text-sub);
    cursor: pointer;
    text-align: left;
    margin-bottom: 2px;
  }
  .rail-item:hover{ background: var(--ak-surface-hover); }
  .rail-item.active{
    background: #6C3BFF12;
    color: var(--brand);
    font-weight: 800;
  }
  .rail-dot{ width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .add-class-link{
    display:flex; align-items:center; gap:7px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 800;
    color: var(--brand);
    cursor: pointer;
    margin-top: 4px;
  }

  /* ── Main ── */
  .gb-main{ flex:1; min-width:0; padding: 18px 24px 40px; overflow-x:auto; }

  .tab-row{
    display:flex;
    gap: 22px;
    border-bottom: 1px solid var(--ak-border2);
    margin-bottom: 18px;
  }
  .tab-row button{
    background:none; border:none;
    font-family:'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ak-text-muted);
    padding: 0 0 10px;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor:pointer;
  }
  .tab-row button.active{
    color: var(--brand);
    font-weight: 800;
    border-bottom-color: var(--brand);
  }
  .tab-row button:hover:not(.active){ color: var(--ak-text); }

  .class-header-row{
    display:flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .class-header-row h1{
    font-size: 19px;
    font-weight: 900;
    margin: 0 0 3px;
    color: var(--ak-text);
    letter-spacing: -0.01em;
  }
  .class-header-row .term{
    font-size: 12px;
    font-weight: 700;
    color: var(--ak-text-muted);
  }
  .toolbar{ display:flex; gap:8px; flex-shrink:0; }
  .btn{
    padding: 8px 18px;
    border-radius: 10px;
    border: none;
    font-family:'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    cursor: pointer;
  }
  .btn-cancel{ background: var(--ak-surface-hover); border:1px solid var(--ak-border2); color: var(--ak-text-sub); }
  .btn-cancel:hover{ background: var(--ak-border2); }
  .btn-save{
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    color:#fff;
    box-shadow: 0 8px 16px -6px rgba(108,59,255,0.5);
  }

  /* ── Table ── */
  .matrix-card{
    background: var(--ak-surface);
    border-radius: 16px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
    overflow: hidden;
  }
  .matrix-scroll{ overflow-x: auto; }
  table.gb-table{
    width: 100%;
    border-collapse: collapse;
    min-width: 760px;
  }
  table.gb-table th, table.gb-table td{
    padding: 9px 14px;
    text-align: center;
    font-size: 12.5px;
    white-space: nowrap;
    border-bottom: 1px solid var(--ak-border);
  }
  table.gb-table thead th{
    vertical-align: top;
    text-align: center;
    padding-top: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ak-border2);
    background: var(--ak-surface-hover);
  }
  table.gb-table thead th:first-child,
  table.gb-table tbody td:first-child{
    text-align: left;
    position: sticky;
    left: 0;
    background: var(--ak-surface-hover);
    z-index: 2;
  }
  table.gb-table tbody td:first-child{ background: var(--ak-surface); font-weight: 800; color: var(--ak-text); }
  table.gb-table tbody tr:hover td{ background: var(--ak-surface-hover); }
  table.gb-table tbody tr:hover td:first-child{ background: var(--ak-surface-hover); }

  .col-final{ font-size:10.5px; font-weight:800; color:var(--ak-text-muted); text-transform:uppercase; letter-spacing:.03em; }
  .final-badge{
    display:inline-flex;
    font-size: 12.5px;
    font-weight: 900;
    padding: 4px 12px;
    border-radius: 20px;
  }

  .a-name{ font-size: 12px; font-weight: 800; color: var(--ak-text); }
  .a-meta{ font-size: 10px; font-weight: 700; color: var(--ak-text-muted); margin-top: 2px; }
  .a-pts{ font-size: 10px; font-weight: 700; color: var(--ak-text-muted); margin-top: 1px; }

  .score-input{
    width: 52px;
    text-align: center;
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ak-text);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 4px 2px;
    background: transparent;
  }
  .score-input:hover{ border-color: var(--ak-border2); }
  .score-input:focus{ outline:none; border-color: var(--brand); background: #6C3BFF08; }

  .toast{
    position: fixed;
    bottom: 22px; right: 22px;
    background: var(--ak-text);
    color: #fff;
    padding: 11px 18px;
    border-radius: 12px;
    font-size: 12.5px;
    font-weight: 800;
    display:flex; align-items:center; gap:8px;
    box-shadow: 0 12px 28px rgba(17,24,39,0.25);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity .2s ease, transform .2s ease;
    pointer-events:none;
    z-index: 200;
  }
  .toast.show{ opacity:1; transform:translateY(0); }
  .toast svg{ width:15px; height:15px; color:#10B981; flex-shrink:0; }

  /* ── Weights button + modal ── */
  .set-weights-row{
    display:flex;
    justify-content:flex-end;
    gap: 8px;
    margin-bottom: 10px;
  }
  .set-weights-btn{
    display:inline-flex;
    align-items:center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--ak-border2);
    background: var(--ak-surface);
    font-family:'Nunito', sans-serif;
    font-size: 12px;
    font-weight: 800;
    color: var(--ak-text-sub);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(17,24,39,0.04);
  }
  .set-weights-btn:hover{ background: var(--ak-surface-hover); color: var(--ak-text); }
  .set-weights-btn svg{ width:14px; height:14px; }

  .modal-overlay-center{
    position: fixed; inset:0;
    background: rgba(17,24,39,0.45);
    display:none;
    align-items:center;
    justify-content:center;
    z-index: 300;
    padding: 20px;
  }
  .modal-overlay-center.open{ display:flex; }
  .weight-modal{
    background: var(--ak-surface);
    border-radius: 18px;
    width: 420px;
    max-width: 100%;
    max-height: 88vh;
    overflow-y: auto;
    padding: 20px;
    box-shadow: 0 24px 60px rgba(17,24,39,0.28);
  }
  .weight-modal-head{
    display:flex; justify-content:space-between; align-items:flex-start;
    margin-bottom: 3px;
  }
  .weight-modal-head h3{ font-size:15.5px; font-weight:900; margin:0; color:var(--ak-text); }
  .weight-modal-close{
    border:none; background:none; cursor:pointer;
    color: var(--ak-text-muted);
    padding: 2px;
  }
  .weight-modal-sub{
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ak-text-muted);
    margin: 0 0 16px;
  }
  .weight-modal-sub strong{ color: var(--ak-text-sub); }

  .settings-section-label{
    font-size: 11px;
    font-weight: 800;
    color: var(--ak-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin: 0 0 10px;
  }

  .radio-option{
    display:flex;
    align-items:flex-start;
    gap: 9px;
    padding: 9px 10px;
    border-radius: 12px;
    margin-bottom: 6px;
    background: var(--ak-surface-hover);
    cursor: pointer;
  }
  .radio-option input{ margin-top: 3px; accent-color: var(--brand); flex-shrink:0; cursor:pointer; }
  .radio-option label{ cursor:pointer; display:flex; flex-direction:column; gap:2px; }
  .radio-option .ro-title{ font-size:12.5px; font-weight:800; color:var(--ak-text); }
  .radio-option .ro-desc{ font-size:11px; font-weight:600; color:var(--ak-text-muted); line-height:1.4; }
  .radio-option:has(input:checked){ background:#6C3BFF10; }

  .weight-row{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--ak-border);
  }
  .weight-row:last-of-type{ border-bottom:none; }
  .wr-label{
    display:flex; align-items:center; gap:8px;
    font-size: 12.5px; font-weight: 800; color: var(--ak-text);
  }
  .wr-dot{ width:9px; height:9px; border-radius:50%; flex-shrink:0; }
  .weight-input-wrap{ display:flex; align-items:center; gap:5px; }
  .weight-input{
    width: 56px;
    text-align: right;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--ak-border2);
    font-family:'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    color: var(--ak-text);
  }
  .weight-input:focus{ outline:none; border-color: var(--brand); }
  .weight-pct-sign{ font-size:12px; font-weight:800; color:var(--ak-text-muted); }
  .weight-total-row{
    display:flex; justify-content:space-between; align-items:baseline;
    margin-top: 14px; padding-top: 12px;
    border-top: 1px solid var(--ak-border2);
  }
  .weight-total-label{ font-size:12px; font-weight:800; color:var(--ak-text-sub); }
  .weight-total-value{ font-size:14px; font-weight:900; }
  .weight-total-value.ok{ color:#047857; }
  .weight-total-value.warn{ color:#B45309; }
  .weight-hint{ font-size:10.5px; font-weight:600; color:var(--ak-text-muted); margin-top:5px; }

  .scope-row{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--ak-border2);
    font-size: 12px;
    font-weight: 700;
    color: var(--ak-text-sub);
    cursor: pointer;
  }
  .scope-row input{ accent-color: var(--brand); cursor:pointer; }

  .weight-row-delete{
    border:none; background:none; cursor:pointer;
    color: var(--ak-text-muted);
    width:20px; height:20px;
    display:flex; align-items:center; justify-content:center;
    border-radius: 6px;
    flex-shrink:0;
  }
  .weight-row-delete:hover{ background:#EF444414; color:#B91C1C; }
  .weight-row-delete:disabled{ opacity:0.3; cursor:default; }
  .weight-row-delete:disabled:hover{ background:none; color:var(--ak-text-muted); }

  .add-category-row{
    display:flex;
    gap: 6px;
    margin-top: 10px;
  }
  .add-category-row input{
    flex:1;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1.5px dashed var(--ak-border2);
    font-family:'Nunito', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--ak-text);
  }
  .add-category-row input:focus{ outline:none; border-color: var(--brand); border-style:solid; }
  .add-category-row input::placeholder{ color: var(--ak-text-muted); font-weight:600; }
  .add-category-btn{
    display:flex; align-items:center; gap:5px;
    padding: 7px 12px;
    border-radius: 9px;
    border: none;
    background: #6C3BFF12;
    color: var(--brand);
    font-family:'Nunito', sans-serif;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    flex-shrink:0;
  }
  .add-category-btn:hover{ background:#6C3BFF1E; }
  .category-hint{ font-size:10.5px; font-weight:600; color:var(--ak-text-muted); margin:6px 0 0; }

  /* ── Grading Scale modal ── */
  .scale-row{
    display:flex;
    align-items:center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--ak-border);
  }
  .scale-row:last-of-type{ border-bottom:none; }
  .scale-letter{
    width: 30px; height:30px;
    border-radius: 9px;
    display:flex; align-items:center; justify-content:center;
    font-size: 12.5px;
    font-weight: 900;
    color: #fff;
    flex-shrink:0;
  }
  .scale-range{
    flex:1;
    font-size: 12px;
    font-weight: 700;
    color: var(--ak-text-sub);
  }
  .scale-input-wrap{ display:flex; align-items:center; gap:4px; }
  .scale-input{
    width: 52px;
    text-align: right;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--ak-border2);
    font-family:'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    color: var(--ak-text);
  }
  .scale-input:focus{ outline:none; border-color: var(--brand); }
  .scale-input:disabled{ background:var(--ak-surface-hover); color:var(--ak-text-muted); }

  .weight-modal-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }

  @media (max-width: 860px){
    .app-nav{ display:none; }
    .gb-sidebar{ width: 200px; }
  }
</style>
</head>
<body>

<div class="app-topbar">
  <div class="app-logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>
  </div>
  <nav class="app-nav">
    <a href="#">Dashboard</a>
    <a href="#">Students</a>
    <a href="#">Classes</a>
    <a href="#" class="active">Gradebook</a>
    <a href="#">Attendance</a>
    <a href="#">Reports</a>
    <a href="#">Setup</a>
  </nav>
</div>

<div class="gb-shell">

  <aside class="gb-sidebar">
    <button class="add-assignment-btn">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Assignment
    </button>

    <div class="filter-panel">
      <p class="filter-panel-label">Classes</p>
      <select class="filter-select" id="termSelect">
        <option>1st Term</option>
        <option>2nd Term</option>
        <option>3rd Term</option>
      </select>
      <select class="filter-select" id="typeSelect">
        <option>All Types</option>
        <option>Quiz</option>
        <option>Classwork</option>
        <option>Homework</option>
        <option>Test</option>
      </select>
      <div class="range-row">
        <button class="range-btn" id="rangePrev" aria-label="Previous">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="range-text" id="rangeText">Sep 8 – Oct 3</span>
        <button class="range-btn" id="rangeNext" aria-label="Next">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>

    <p class="rail-label">Classes</p>
    <div id="railList"></div>
    <div class="add-class-link">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Class
    </div>
  </aside>

  <main class="gb-main">
    <div class="tab-row">
      <button class="active">Overall</button>
      <button>By Assignment</button>
      <button>By Student</button>
      <button>Assignments</button>
      <button>Final Grades by Student</button>
      <button>Final Grades by Class</button>
    </div>

    <div class="class-header-row">
      <div>
        <h1 id="classTitle">Algebra I (H)</h1>
        <p class="term">1st Term  ·  September 8 – December 12, 2026</p>
      </div>
      <div class="toolbar">
        <button class="btn btn-cancel" id="cancelBtn">Cancel</button>
        <button class="btn btn-save" id="saveBtn">Save</button>
      </div>
    </div>

    <div class="set-weights-row">
      <button class="set-weights-btn" id="scaleBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"/><path d="M4 5v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V5"/><path d="M12 13v6M8 19h8"/></svg>
        Grading Scale
      </button>
      <button class="set-weights-btn" id="weightsBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 7l-4 8a4 4 0 0 0 8 0l-4-8Z"/><path d="M17 7l-4 8a4 4 0 0 0 8 0l-4-8Z"/><path d="M5 7h14"/></svg>
        Grading System
      </button>
    </div>

    <div class="matrix-card">
      <div class="matrix-scroll">
        <table class="gb-table" id="gbTable"></table>
      </div>
    </div>
  </main>
</div>

<div class="toast" id="toast">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  Grades saved
</div>

<div class="modal-overlay-center" id="weightModalOverlay">
  <div class="weight-modal">
    <div class="weight-modal-head">
      <h3>Grading System</h3>
      <button class="weight-modal-close" id="weightModalClose" aria-label="Close">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p class="weight-modal-sub">Settings apply to <strong id="weightModalClassName">this subject</strong> unless you choose to apply them everywhere below.</p>

    <p class="settings-section-label">Assessment system</p>
    <div class="radio-option">
      <input type="radio" name="aggregation" id="aggEqual" value="equal" />
      <label for="aggEqual">
        <span class="ro-title">Equal-weight</span>
        <span class="ro-desc">Every assignment in a category counts the same, no matter how many points it's out of.</span>
      </label>
    </div>
    <div class="radio-option">
      <input type="radio" name="aggregation" id="aggPoints" value="points" />
      <label for="aggPoints">
        <span class="ro-title">Points-based</span>
        <span class="ro-desc">Points are pooled within a category — a 20-point test naturally counts more than a 5-point quiz.</span>
      </label>
    </div>

    <p class="settings-section-label" style="margin-top:16px;">Category weights</p>
    <div id="weightRows"></div>

    <div class="add-category-row">
      <input type="text" id="newCategoryInput" placeholder="New category — e.g. Exam, Monthly Test" maxlength="24" />
      <button class="add-category-btn" id="addCategoryBtn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add
      </button>
    </div>
    <p class="category-hint">A new category only affects the grade once assignments are tagged with that type.</p>

    <div class="weight-total-row">
      <span class="weight-total-label">Total</span>
      <span class="weight-total-value" id="weightTotal">100%</span>
    </div>
    <p class="weight-hint">Doesn't need to add up to 100 — it'll scale automatically when you save.</p>

    <label class="scope-row">
      <input type="checkbox" id="applyAllClasses" />
      <span>Apply to all subjects, not just this one</span>
    </label>

    <div class="weight-modal-actions">
      <button class="btn btn-cancel" id="weightModalCancel">Cancel</button>
      <button class="btn btn-save" id="weightModalSave">Save</button>
    </div>
  </div>
</div>

<div class="modal-overlay-center" id="scaleModalOverlay">
  <div class="weight-modal">
    <div class="weight-modal-head">
      <h3>Grading Scale</h3>
      <button class="weight-modal-close" id="scaleModalClose" aria-label="Close">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p class="weight-modal-sub">How a Final percentage maps to a letter grade — applies school-wide.</p>

    <div id="scaleRows"></div>

    <div class="weight-modal-actions">
      <button class="btn btn-cancel" id="scaleModalCancel">Cancel</button>
      <button class="btn btn-save" id="scaleModalSave">Save</button>
    </div>
  </div>
</div>

<script>
  (function(){
    const CLASSES = [
      { id:'algebra',  name:'Algebra I (H)',            color:'#6C3BFF' },
      { id:'english',  name:'English Language',         color:'#3B82F6' },
      { id:'biology',  name:'Biology',                  color:'#10B981' },
      { id:'geography',name:'Geography',                color:'#0D9488' },
      { id:'pe',       name:'Physical & Health Ed.',    color:'#F59E0B' },
      { id:'reading',  name:'Reading',                  color:'#8B5CF6' },
      { id:'social',   name:'Social Studies',            color:'#EF4444' },
    ];

    const ASSIGNMENT_TEMPLATE = [
      { key:'prequiz',  name:'Pre-Quiz',   type:'Quiz',      due:'Sep 10', points:10,  letter:false },
      { key:'classwork',name:'Class Work', type:'Classwork', due:'Sep 12', points:null,letter:true  },
      { key:'homework', name:'Homework',   type:'Homework',  due:'Sep 15', points:10,  letter:false },
      { key:'popquiz',  name:'Pop Quiz',   type:'Quiz',      due:'Sep 22', points:20,  letter:false },
      { key:'worksheet',name:'Worksheet',  type:'Homework',  due:'Sep 29', points:15,  letter:false },
    ];
    const NAME_OVERRIDES = {
      biology:  { worksheet:'Lab Report' },
      pe:       { worksheet:'Fitness Test', popquiz:'Skills Check' },
      geography:{ worksheet:'Map Assignment' },
      reading:  { worksheet:'Book Report' },
    };

    const STUDENTS = [
      'Amara JSS1-2', 'Chidi Okafor', 'Ngozi Eze', 'Tunde Bello',
      'Fatima Ibrahim', 'Emeka Nwosu', 'Blessing Adeyemi', 'Ibrahim Musa', 'Grace Okonkwo'
    ];
    const LETTERS = ['A','A','B','B','C','D'];
    const LETTER_PCT = { A:95, B:85, C:75, D:65, F:50 };

    // "let" (not const) — categories can be created/removed at runtime.
    let CATEGORY_TYPES = [
      { type:'Quiz',      color:'#3B82F6' },
      { type:'Classwork', color:'#6C3BFF' },
      { type:'Homework',  color:'#F59E0B' },
      { type:'Test',      color:'#EF4444' },
    ];
    const CATEGORY_PALETTE = ['#0D9488', '#8B5CF6', '#EC4899', '#059669', '#0891B2', '#D97706', '#DC2626', '#4F46E5'];
    function nextCategoryColor(){
      return CATEGORY_PALETTE[CATEGORY_TYPES.length % CATEGORY_PALETTE.length];
    }
    function addCategory(name){
      const exists = CATEGORY_TYPES.some(c => c.type.toLowerCase() === name.toLowerCase());
      if (exists) return false;
      CATEGORY_TYPES.push({ type:name, color: nextCategoryColor() });
      // New category starts at 0% everywhere until a teacher assigns it weight.
      Object.values(classSettings).forEach(s => { s.weights[name] = 0; });
      return true;
    }
    function removeCategory(name){
      if (CATEGORY_TYPES.length <= 1) return false;
      CATEGORY_TYPES = CATEGORY_TYPES.filter(c => c.type !== name);
      Object.values(classSettings).forEach(s => { delete s.weights[name]; });
      return true;
    }

    // Per-class grading settings — "per-subject weighting": each class carries
    // its own category weights and its own aggregation method by default.
    const classSettings = {};
    function defaultSettings(){
      const weights = {};
      const even = Math.round(100 / CATEGORY_TYPES.length);
      CATEGORY_TYPES.forEach(c => { weights[c.type] = even; });
      return { weights, aggregation:'equal' };
    }
    function settingsFor(classId){
      if (!classSettings[classId]) classSettings[classId] = defaultSettings();
      return classSettings[classId];
    }

    let currentClass = 'algebra';

    // Grading scale — percentage → letter grade, school-wide (not per-class).
    let GRADE_SCALE = [
      { grade:'A', min:90, color:'#10B981' },
      { grade:'B', min:80, color:'#3B82F6' },
      { grade:'C', min:70, color:'#F59E0B' },
      { grade:'D', min:60, color:'#F97316' },
      { grade:'F', min:0,  color:'#EF4444' },
    ];
    function sortedScale(){ return [...GRADE_SCALE].sort((a, b) => b.min - a.min); }
    function bandForPct(pct){
      const scale = sortedScale();
      return scale.find(s => pct >= s.min) || scale[scale.length - 1];
    }
    const overrides = {}; // overrides[classId][student][assignKey] = value

    function hash(str){
      let h = 0;
      for (let i = 0; i < str.length; i++){ h = (h * 31 + str.charCodeAt(i)) >>> 0; }
      return h;
    }
    function assignmentsFor(classId){
      const over = NAME_OVERRIDES[classId] || {};
      return ASSIGNMENT_TEMPLATE.map(a => over[a.key] ? { ...a, name: over[a.key] } : a);
    }
    function baseValue(classId, student, a){
      const h = hash(classId + student + a.key);
      if (a.letter) return LETTERS[h % LETTERS.length];
      const pct = 0.6 + (h % 40) / 100; // 60%–99%
      return Math.round(a.points * pct * 10) / 10;
    }
    function getValue(classId, student, a){
      const o = overrides[classId] && overrides[classId][student] && overrides[classId][student][a.key];
      return o !== undefined ? o : baseValue(classId, student, a);
    }
    function setValue(classId, student, key, value){
      overrides[classId] = overrides[classId] || {};
      overrides[classId][student] = overrides[classId][student] || {};
      overrides[classId][student][key] = value;
    }

    // Questions → Assessment → Category → Course:
    // each assignment (assessment) resolves to earned/possible points,
    // independent of how many questions it has or what it's out of.
    function pointsFor(a, value){
      if (a.letter) return { earned: LETTER_PCT[value] ?? 75, possible: 100 };
      return { earned: Number(value) || 0, possible: a.points };
    }
    function pctFor(a, value){
      const p = pointsFor(a, value);
      return p.possible ? (p.earned / p.possible) * 100 : 0;
    }

    function currentClassObj(){ return CLASSES.find(c => c.id === currentClass); }

    function renderRail(){
      const rail = document.getElementById('railList');
      rail.innerHTML = '';
      CLASSES.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'rail-item' + (c.id === currentClass ? ' active' : '');
        btn.innerHTML = `<span class="rail-dot" style="background:${c.color};"></span>${c.name}`;
        btn.addEventListener('click', () => { currentClass = c.id; renderAll(); });
        rail.appendChild(btn);
      });
    }

    function renderTable(){
      const table = document.getElementById('gbTable');
      const assignments = assignmentsFor(currentClass);

      let thead = '<thead><tr><th style="text-align:left;">Student</th><th class="col-final">Final</th>';
      assignments.forEach(a => {
        thead += `<th>
          <div class="a-name">${a.name}</div>
          <div class="a-meta">${a.type} · ${a.due}</div>
          <div class="a-pts">${a.letter ? 'Letter grade' : a.points + ' pts'}</div>
        </th>`;
      });
      thead += '</tr></thead>';

      let tbody = '<tbody>';
      STUDENTS.forEach(student => {
        tbody += `<tr><td>${student}</td><td data-final-for="${student}"></td>`;
        assignments.forEach(a => {
          const val = getValue(currentClass, student, a);
          tbody += `<td><input class="score-input" type="text" value="${val}"
            data-student="${student}" data-key="${a.key}" data-letter="${a.letter}" ${a.letter ? '' : 'inputmode="decimal"'} /></td>`;
        });
        tbody += '</tr>';
      });
      tbody += '</tbody>';

      table.innerHTML = thead + tbody;

      table.querySelectorAll('.score-input').forEach(input => {
        input.addEventListener('change', () => {
          const isLetter = input.dataset.letter === 'true';
          let v = input.value.trim();
          if (!isLetter){
            v = Math.max(0, Number(v) || 0);
            input.value = v;
          } else {
            v = v.toUpperCase().slice(0, 1) || 'A';
            input.value = v;
          }
          setValue(currentClass, input.dataset.student, input.dataset.key, v);
          updateFinal(input.dataset.student);
        });
      });

      STUDENTS.forEach(updateFinal);
    }

    function updateFinal(student){
      const assignments = assignmentsFor(currentClass);
      const settings = settingsFor(currentClass);
      const byType = {};
      assignments.forEach(a => {
        (byType[a.type] = byType[a.type] || []).push({ a, value: getValue(currentClass, student, a) });
      });

      const presentTypes = Object.keys(byType);
      const totalWeight = presentTypes.reduce((sum, t) => sum + (settings.weights[t] || 0), 0) || 1;

      const avg = presentTypes.reduce((sum, t) => {
        const items = byType[t];
        let typePct;
        if (settings.aggregation === 'points'){
          // Points-based: pool earned/possible across every assignment in the category —
          // a 20-point test naturally counts more than a 5-point quiz.
          const earned = items.reduce((s, it) => s + pointsFor(it.a, it.value).earned, 0);
          const possible = items.reduce((s, it) => s + pointsFor(it.a, it.value).possible, 0);
          typePct = possible ? (earned / possible) * 100 : 0;
        } else {
          // Equal-weight: every assignment counts the same regardless of its points.
          typePct = items.reduce((s, it) => s + pctFor(it.a, it.value), 0) / items.length;
        }
        return sum + typePct * ((settings.weights[t] || 0) / totalWeight);
      }, 0);

      const rounded = Math.round(avg * 10) / 10;
      const band = bandForPct(rounded);
      const cell = document.querySelector(`[data-final-for="${CSS.escape(student)}"]`);
      if (cell){
        cell.innerHTML = `<span class="final-badge" style="background:${band.color}14;color:${band.color};">${rounded} <small style="opacity:.75;">· ${band.grade}</small></span>`;
      }
    }

    function renderHeader(){
      document.getElementById('classTitle').textContent = currentClassObj().name;
      document.documentElement.style.setProperty('--brand-rail', currentClassObj().color);
    }

    function renderAll(){
      renderRail();
      renderHeader();
      renderTable();
    }

    // ── Cancel / Save ──
    document.getElementById('cancelBtn').addEventListener('click', () => {
      overrides[currentClass] = {};
      renderTable();
    });
    const toast = document.getElementById('toast');
    document.getElementById('saveBtn').addEventListener('click', () => {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1800);
    });

    // ── Date range nav (cosmetic) ──
    const RANGES = ['Sep 8 – Oct 3', 'Oct 6 – Oct 31', 'Nov 3 – Nov 28', 'Dec 1 – Dec 12'];
    let rangeIdx = 0;
    function renderRange(){ document.getElementById('rangeText').textContent = RANGES[rangeIdx]; }
    document.getElementById('rangePrev').addEventListener('click', () => { rangeIdx = Math.max(0, rangeIdx - 1); renderRange(); });
    document.getElementById('rangeNext').addEventListener('click', () => { rangeIdx = Math.min(RANGES.length - 1, rangeIdx + 1); renderRange(); });

    // ── Grading System modal ──
    const weightOverlay = document.getElementById('weightModalOverlay');
    const weightRowsEl = document.getElementById('weightRows');
    const weightTotalEl = document.getElementById('weightTotal');
    const applyAllEl = document.getElementById('applyAllClasses');
    const newCategoryInput = document.getElementById('newCategoryInput');

    function collectWeightInputs(){
      const out = {};
      weightRowsEl.querySelectorAll('.weight-input').forEach(i => { out[i.dataset.type] = Number(i.value) || 0; });
      return out;
    }

    function renderWeightRows(weights){
      weightRowsEl.innerHTML = '';
      CATEGORY_TYPES.forEach(wt => {
        const row = document.createElement('div');
        row.className = 'weight-row';
        row.innerHTML = `
          <span class="wr-label"><span class="wr-dot" style="background:${wt.color};"></span>${wt.type}</span>
          <span class="weight-input-wrap">
            <input class="weight-input" type="number" min="0" max="100" step="1"
              value="${weights[wt.type] ?? 0}" data-type="${wt.type}" />
            <span class="weight-pct-sign">%</span>
            <button class="weight-row-delete" data-remove="${wt.type}" ${CATEGORY_TYPES.length <= 1 ? 'disabled' : ''} aria-label="Remove ${wt.type}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </span>`;
        weightRowsEl.appendChild(row);
      });
      weightRowsEl.querySelectorAll('.weight-input').forEach(input => {
        input.addEventListener('input', updateWeightTotal);
      });
      weightRowsEl.querySelectorAll('.weight-row-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const preserved = collectWeightInputs();
          if (removeCategory(btn.dataset.remove)){
            delete preserved[btn.dataset.remove];
            renderWeightRows(preserved);
          }
        });
      });
      updateWeightTotal();
    }

    function updateWeightTotal(){
      const inputs = weightRowsEl.querySelectorAll('.weight-input');
      let total = 0;
      inputs.forEach(i => total += Number(i.value) || 0);
      weightTotalEl.textContent = total + '%';
      weightTotalEl.classList.toggle('ok', total === 100);
      weightTotalEl.classList.toggle('warn', total !== 100);
    }

    document.getElementById('addCategoryBtn').addEventListener('click', () => {
      const name = newCategoryInput.value.trim();
      if (!name) return;
      const preserved = collectWeightInputs();
      if (addCategory(name)){
        preserved[name] = 0;
        renderWeightRows(preserved);
        newCategoryInput.value = '';
      }
    });
    newCategoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); document.getElementById('addCategoryBtn').click(); }
    });

    function openWeightModal(){
      const settings = settingsFor(currentClass);
      document.getElementById('weightModalClassName').textContent = currentClassObj().name;
      document.getElementById(settings.aggregation === 'points' ? 'aggPoints' : 'aggEqual').checked = true;
      applyAllEl.checked = false;
      newCategoryInput.value = '';
      renderWeightRows(settings.weights);
      weightOverlay.classList.add('open');
    }
    function closeWeightModal(){ weightOverlay.classList.remove('open'); }

    document.getElementById('weightsBtn').addEventListener('click', openWeightModal);
    document.getElementById('weightModalClose').addEventListener('click', closeWeightModal);
    document.getElementById('weightModalCancel').addEventListener('click', closeWeightModal);
    weightOverlay.addEventListener('click', (e) => { if (e.target === weightOverlay) closeWeightModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && weightOverlay.classList.contains('open')) closeWeightModal(); });

    document.getElementById('weightModalSave').addEventListener('click', () => {
      const raw = collectWeightInputs();
      let sum = Object.values(raw).reduce((s, v) => s + Math.max(0, v), 0);
      if (sum <= 0){
        const even = Math.round(100 / CATEGORY_TYPES.length);
        CATEGORY_TYPES.forEach(wt => raw[wt.type] = even);
        sum = even * CATEGORY_TYPES.length;
      }
      const normalized = {};
      CATEGORY_TYPES.forEach(wt => {
        normalized[wt.type] = Math.round((Math.max(0, raw[wt.type] || 0) / sum) * 1000) / 10; // scales to sum to 100
      });
      const aggregation = document.querySelector('input[name="aggregation"]:checked').value;
      const newSettings = { weights: normalized, aggregation };

      if (applyAllEl.checked){
        CLASSES.forEach(c => { classSettings[c.id] = { weights: { ...normalized }, aggregation }; });
      } else {
        classSettings[currentClass] = newSettings;
      }

      closeWeightModal();
      STUDENTS.forEach(updateFinal);
      toast.lastChild.textContent = ' Grading system updated';
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); toast.lastChild.textContent = ' Grades saved'; }, 1800);
    });

    // ── Grading Scale modal ──
    const scaleOverlay = document.getElementById('scaleModalOverlay');
    const scaleRowsEl = document.getElementById('scaleRows');

    function renderScaleRows(){
      scaleRowsEl.innerHTML = '';
      const scale = sortedScale();
      scale.forEach((band, i) => {
        const next = scale[i - 1]; // the band above this one, for the range's upper bound
        const upper = next ? (next.min - 1) : 100;
        const row = document.createElement('div');
        row.className = 'scale-row';
        row.innerHTML = `
          <span class="scale-letter" style="background:${band.color};">${band.grade}</span>
          <span class="scale-range" data-range-for="${band.grade}">${band.min}–${upper}%</span>
          <span class="scale-input-wrap">
            <input class="scale-input" type="number" min="0" max="100" step="1"
              value="${band.min}" data-grade="${band.grade}" ${band.grade === 'F' ? 'disabled' : ''} />
            <span class="weight-pct-sign">% min</span>
          </span>`;
        scaleRowsEl.appendChild(row);
      });
      scaleRowsEl.querySelectorAll('.scale-input').forEach(input => {
        input.addEventListener('input', () => {
          // live-update the range text of the band directly below this one
          const grade = input.dataset.grade;
          const idx = scale.findIndex(s => s.grade === grade);
          const below = scale[idx + 1];
          if (below){
            const span = scaleRowsEl.querySelector(`[data-range-for="${below.grade}"]`);
            if (span) span.textContent = `${below.min}–${Math.max(below.min, Number(input.value) - 1)}%`;
          }
        });
      });
    }

    function openScaleModal(){ renderScaleRows(); scaleOverlay.classList.add('open'); }
    function closeScaleModal(){ scaleOverlay.classList.remove('open'); }

    document.getElementById('scaleBtn').addEventListener('click', openScaleModal);
    document.getElementById('scaleModalClose').addEventListener('click', closeScaleModal);
    document.getElementById('scaleModalCancel').addEventListener('click', closeScaleModal);
    scaleOverlay.addEventListener('click', (e) => { if (e.target === scaleOverlay) closeScaleModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && scaleOverlay.classList.contains('open')) closeScaleModal(); });

    document.getElementById('scaleModalSave').addEventListener('click', () => {
      scaleRowsEl.querySelectorAll('.scale-input').forEach(input => {
        const grade = input.dataset.grade;
        const band = GRADE_SCALE.find(s => s.grade === grade);
        if (band && grade !== 'F') band.min = Math.max(0, Math.min(100, Number(input.value) || 0));
      });
      closeScaleModal();
      STUDENTS.forEach(updateFinal);
      toast.lastChild.textContent = ' Grading scale updated';
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); toast.lastChild.textContent = ' Grades saved'; }, 1800);
    });

    renderAll();
    renderRange();
  })();
</script>
</body>
</html>
