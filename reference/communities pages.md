<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro — Community</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  /* Real Akoro tokens, pulled from akoro-learner's tailwind.config.js + ThemeContext.jsx — not approximated. */
  :root {
    --ak-purple: #6C3BFF; --ak-purple-dark: #5A2FE0; --ak-purple-soft: #F1ECFF;
    --ak-coral: #FF6B57; --ak-green: #2BB673; --ak-green-soft: #E7F8EF;
    --ak-amber: #F59E0B; --ak-amber-soft: #FEF3DE; --ak-sky: #3BA7E0; --ak-sky-soft: #E7F3FC;
    --ak-danger: #EF4444; --ak-danger-text: #B91C1C; --ak-danger-soft: #FEF2F2;

    --ak-bg: #F9FAFB; --ak-surface: #FFFFFF; --ak-surface-hover: #F9FAFB;
    --ak-border: #F3F4F6; --ak-border2: #E5E7EB; --ak-border3: #D1D5DB;
    --ak-text: #111827; --ak-text-sec: #374151; --ak-text-sub: #6B7280; --ak-text-muted: #9CA3AF;
    --ak-overlay: rgba(17,24,39,0.45);

    /* Real shape/motion scale */
    --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 22px; --r-full: 999px;
    --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-6: 24px; --s-8: 32px;
    --ease-spring: cubic-bezier(.32, 1.2, .64, 1);
    box-sizing: border-box; padding-top: env(safe-area-inset-top,0px); padding-bottom: env(safe-area-inset-bottom,0px);
  }
  :root[data-theme="dark"] {
    --ak-bg: #0D1117; --ak-surface: #161B22; --ak-surface-hover: #1C2128;
    --ak-border: #21262D; --ak-border2: #30363D; --ak-border3: #484F58;
    --ak-text: #E6EDF3; --ak-text-sec: #C9D1D9; --ak-text-sub: #8B949E; --ak-text-muted: #6E7681;
    --ak-purple-soft: #231C3E; --ak-green-soft: #0F2A20; --ak-amber-soft: #2B2111; --ak-sky-soft: #0F2433; --ak-danger-soft: #2B1414;
    --ak-overlay: rgba(0,0,0,0.65);
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; margin: 0; }
  body { background: var(--ak-bg); color: var(--ak-text); font-family: 'Nunito', system-ui, sans-serif; display: flex; align-items: flex-start; justify-content: center; -webkit-font-smoothing: antialiased; }
  .phone { width: 100%; max-width: 430px; min-height: 100vh; background: var(--ak-bg); }
  .view { display: none; }
  .view.active { display: block; animation: rise .25s var(--ease-spring); }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  svg.icon { stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; display: block; }

  .header-group { position: sticky; top: 0; z-index: 10; background: var(--ak-surface); border-bottom: 1px solid var(--ak-border2); }
  .top-bar { background: var(--ak-surface); padding: var(--s-4) var(--s-4); display: flex; align-items: center; gap: var(--s-3); }
  .back-btn { width: 34px; height: 34px; border-radius: var(--r-full); border: 1px solid var(--ak-border2); background: var(--ak-surface); color: var(--ak-text-sub); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background .15s; }
  .back-btn:hover { background: var(--ak-surface-hover); }
  .comm-icon { width: 42px; height: 42px; border-radius: var(--r-lg); background: linear-gradient(145deg, var(--ak-purple), var(--ak-purple-dark)); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .top-title { flex: 1; min-width: 0; }
  .top-title h1 { font-size: 1.05rem; font-weight: 800; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
  .top-title .sub { font-size: 0.78rem; color: var(--ak-text-sub); font-weight: 700; margin-top: 1px; }
  .icon-row { display: flex; gap: var(--s-2); flex-shrink: 0; }
  .icon-btn { width: 36px; height: 36px; border-radius: var(--r-full); border: none; background: var(--ak-purple-soft); color: var(--ak-purple); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform .15s var(--ease-spring); }
  .icon-btn:active { transform: scale(0.92); }

  .follow-row { display: flex; align-items: center; justify-content: space-between; padding: var(--s-4) var(--s-4) 0; }
  .member-count { font-size: 0.82rem; color: var(--ak-text-sub); font-weight: 700; }
  .follow-btn { padding: 9px 20px; border-radius: var(--r-full); border: 1.5px solid var(--ak-border3); background: transparent; color: var(--ak-text); font-family: inherit; font-weight: 800; font-size: 0.84rem; cursor: pointer; transition: all .15s var(--ease-spring); }
  .follow-btn.following { background: var(--ak-text); border-color: var(--ak-text); color: var(--ak-bg); }
  .follow-btn:active { transform: scale(0.95); }

  .tabs { display: flex; gap: var(--s-2); overflow-x: auto; padding: var(--s-4); scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { flex-shrink: 0; padding: 9px 16px; border-radius: var(--r-full); border: 1px solid var(--ak-border2); background: var(--ak-surface); color: var(--ak-text-sub); font-family: inherit; font-weight: 700; font-size: 0.84rem; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all .15s; }
  .tab.active { background: var(--ak-text); border-color: var(--ak-text); color: var(--ak-bg); }
  .tab svg.icon { width: 15px; height: 15px; }

  .new-activity-btn { display: flex; align-items: center; justify-content: center; gap: var(--s-2); width: calc(100% - var(--s-8)); margin: var(--s-1) var(--s-4) var(--s-6); padding: 13px; border-radius: var(--r-lg); border: 1.5px dashed var(--ak-border3); background: transparent; color: var(--ak-text-sec); font-family: inherit; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: all .15s; }
  .new-activity-btn:hover { border-color: var(--ak-purple); color: var(--ak-purple); background: var(--ak-purple-soft); }

  .empty-state { text-align: center; padding: 36px 30px 60px; color: var(--ak-text-sub); }
  .empty-state .e-icon { width: 52px; height: 52px; border-radius: var(--r-lg); background: var(--ak-border); color: var(--ak-text-muted); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
  .empty-state .e-title { font-weight: 800; color: var(--ak-text); font-size: 0.95rem; margin-bottom: 3px; }
  .empty-state .e-sub { font-size: 0.83rem; }

  .section-title { padding: var(--s-4) var(--s-4) var(--s-2); font-size: 0.74rem; font-weight: 800; color: var(--ak-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

  /* People */
  .invite-btn { display: flex; align-items: center; justify-content: center; gap: var(--s-2); width: calc(100% - var(--s-8)); margin: var(--s-4); padding: 13px; border-radius: var(--r-full); border: none; background: var(--ak-purple); color: white; font-family: inherit; font-weight: 800; font-size: 0.88rem; cursor: pointer; transition: transform .15s var(--ease-spring); }
  .invite-btn:active { transform: scale(0.98); }
  .member-row { display: flex; align-items: center; gap: var(--s-3); padding: 11px var(--s-4); }
  .avatar { width: 40px; height: 40px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem; color: white; flex-shrink: 0; }
  .member-info { flex: 1; }
  .member-info .m-name { font-weight: 700; font-size: 0.9rem; color: var(--ak-text); }
  .member-info .m-meta { font-size: 0.76rem; color: var(--ak-text-sub); font-weight: 600; margin-top: 1px; }
  .role-badge { padding: 3px 10px; border-radius: var(--r-full); font-size: 0.64rem; font-weight: 900; letter-spacing: 0.04em; flex-shrink: 0; }
  .role-badge.owner { background: var(--ak-amber-soft); color: #92590B; }
  .role-badge.member { background: var(--ak-border); color: var(--ak-text-sub); }

  /* Settings */
  .settings-section { padding: var(--s-4); }
  .icon-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--s-2); margin-bottom: var(--s-6); }
  .icon-chip { aspect-ratio: 1; border-radius: var(--r-md); border: 1.5px solid var(--ak-border2); background: var(--ak-surface); display: flex; align-items: center; justify-content: center; color: var(--ak-text-sub); cursor: pointer; transition: all .15s var(--ease-spring); }
  .icon-chip.selected { border-color: var(--ak-purple); background: var(--ak-purple-soft); color: var(--ak-purple); transform: scale(1.04); }
  .field { margin-bottom: var(--s-4); }
  .field label { display: block; font-size: 0.78rem; font-weight: 800; color: var(--ak-text-sub); margin-bottom: 6px; }
  .field input, .field textarea { width: 100%; padding: 12px 14px; border-radius: var(--r-md); border: 1.5px solid var(--ak-border2); background: var(--ak-surface); color: var(--ak-text); font-family: inherit; font-size: 0.9rem; }
  .field input:focus, .field textarea:focus { outline: 2px solid var(--ak-purple); outline-offset: 1px; }
  .field textarea { resize: vertical; min-height: 76px; }
  .save-btn { width: 100%; padding: 14px; border-radius: var(--r-full); border: none; background: var(--ak-purple); color: white; font-family: inherit; font-weight: 800; font-size: 0.92rem; cursor: pointer; margin: var(--s-1) 0 var(--s-6); transition: transform .15s var(--ease-spring); }
  .save-btn:active { transform: scale(0.98); }
  .danger-zone { border: 1px solid var(--ak-danger-soft); background: var(--ak-danger-soft); border-radius: var(--r-lg); padding: var(--s-4); }
  .danger-zone .d-title { display: flex; align-items: center; gap: var(--s-2); color: var(--ak-danger-text); font-weight: 800; font-size: 0.86rem; margin-bottom: var(--s-3); }
  .delete-btn { width: 100%; padding: 11px; border-radius: var(--r-full); border: 1.5px solid var(--ak-danger); background: var(--ak-surface); color: var(--ak-danger-text); font-family: inherit; font-weight: 800; font-size: 0.86rem; cursor: pointer; transition: all .15s; }
  .delete-btn.armed { background: var(--ak-danger); color: white; }

  /* Popular materials (Spotify "Popular" track-row reference) */
  .material-row { display: flex; align-items: center; gap: var(--s-3); padding: 9px var(--s-4); }
  .material-rank { width: 18px; text-align: center; color: var(--ak-text-muted); font-weight: 800; font-size: 0.86rem; flex-shrink: 0; }
  .material-thumb { width: 42px; height: 42px; border-radius: var(--r-sm); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; }
  .material-info { flex: 1; min-width: 0; }
  .material-info .mt-name { font-weight: 700; font-size: 0.88rem; color: var(--ak-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .material-info .mt-stat { font-size: 0.76rem; color: var(--ak-text-sub); font-weight: 600; margin-top: 1px; }
  .row-more { background: none; border: none; color: var(--ak-text-muted); cursor: pointer; padding: 6px; flex-shrink: 0; }

  /* Popular folders (Spotify "Popular releases" reference) */
  .folder-row { display: flex; gap: var(--s-3); overflow-x: auto; padding: 0 var(--s-4) var(--s-2); scrollbar-width: none; }
  .folder-row::-webkit-scrollbar { display: none; }
  .folder-card { flex: 0 0 128px; cursor: pointer; }
  .folder-card .fc-art { width: 128px; height: 128px; border-radius: var(--r-lg); display: flex; align-items: center; justify-content: center; color: white; font-weight: 900; font-size: 1.1rem; margin-bottom: 8px; }
  .folder-card .fc-name { font-weight: 700; font-size: 0.85rem; color: var(--ak-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .folder-card .fc-meta { font-size: 0.76rem; color: var(--ak-text-sub); font-weight: 600; margin-top: 1px; }

  /* Folder detail (reused from course-library.html's folder page) */
  .cf-hero { padding: var(--s-4) var(--s-4) var(--s-6); }
  .cf-art { width: 100%; aspect-ratio: 1.7; border-radius: var(--r-xl); display: flex; align-items: center; justify-content: center; margin: var(--s-4) 0 var(--s-4); color: white; }
  .cf-art .cf-code { font-size: 2.2rem; font-weight: 900; }
  .cf-title { font-size: 1.3rem; font-weight: 900; margin: 0 0 8px; }
  .cf-author-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cf-avatar { width: 22px; height: 22px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-size: 0.66rem; font-weight: 900; color: white; }
  .cf-author-name { font-size: 0.84rem; font-weight: 800; color: var(--ak-text); }
  .cf-meta { color: var(--ak-text-sub); font-weight: 700; font-size: 0.82rem; margin: 0 0 var(--s-4); }
  .cf-action-row { display: flex; align-items: center; gap: var(--s-3); }
  .cf-start-btn { flex: 1; padding: 12px; border-radius: var(--r-full); border: none; background: var(--ak-purple); color: white; font-family: inherit; font-weight: 800; font-size: 0.9rem; cursor: pointer; }
  .cf-icon-btn { width: 40px; height: 40px; border-radius: var(--r-full); border: 1px solid var(--ak-border2); background: var(--ak-surface); color: var(--ak-text-sub); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .cf-topic-list { padding: var(--s-2) var(--s-2) var(--s-8); }
  .cf-topic-row { display: flex; align-items: center; gap: var(--s-3); padding: 11px var(--s-3); border-radius: var(--r-md); cursor: pointer; }
  .cf-topic-row:hover { background: var(--ak-surface-hover); }
  .cf-topic-num { width: 24px; text-align: center; color: var(--ak-text-muted); font-weight: 800; font-size: 0.84rem; flex-shrink: 0; }
  .cf-topic-info { flex: 1; }
  .cf-topic-info .ct-name { font-weight: 700; font-size: 0.9rem; }
  .cf-topic-info .ct-meta { font-size: 0.76rem; color: var(--ak-text-sub); font-weight: 600; margin-top: 1px; }

  /* Analytics */
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); padding: var(--s-4); }
  .stat-card { background: var(--ak-surface); border: 1px solid var(--ak-border2); border-radius: var(--r-lg); padding: var(--s-4); }
  .stat-card .s-icon { width: 36px; height: 36px; border-radius: var(--r-md); display: flex; align-items: center; justify-content: center; margin-bottom: var(--s-3); }
  .stat-card .s-value { font-size: 1.5rem; font-weight: 900; letter-spacing: -0.02em; }
  .stat-card .s-label { font-size: 0.78rem; color: var(--ak-text-sub); font-weight: 700; margin-top: 2px; }
</style>
</head>
<body>

<div class="phone">

  <!-- MAIN -->
  <div class="view active" id="view-main">
    <div class="header-group">
      <div class="top-bar">
      <button class="back-btn" onclick="alert('Would return to Communities list')"></button>
      <div class="comm-icon" id="header-comm-icon"></div>
      <div class="top-title"><h1>JSS 1 Study Circle</h1><div class="sub">2 members</div></div>
      <div class="icon-row">
        <button class="icon-btn" onclick="showView('settings')" id="btn-settings"></button>
        <button class="icon-btn" onclick="showView('people')" id="btn-people"></button>
        <button class="icon-btn" onclick="showView('analytics')" id="btn-analytics"></button>
      </div>
    </div>
    <div class="follow-row">
      <span class="member-count" id="follow-member-count">48 followers</span>
      <button class="follow-btn" id="follow-btn" onclick="toggleFollow()">Follow</button>
    </div>
    <div class="tabs" id="tabs-row"></div>
    </div>
    <button class="new-activity-btn" id="btn-new-activity" onclick="alert('Would open the new activity composer')"></button>
    <div class="empty-state">
      <div class="e-icon" id="empty-icon-main"></div>
      <div class="e-title" id="activity-empty-title">No activities yet</div>
      <div class="e-sub">Post the first one with "New activity".</div>
    </div>

    <div class="section-title">Popular materials</div>
    <div id="materials-list"></div>

    <div class="section-title">Popular folders</div>
    <div class="folder-row" id="folders-row"></div>
  </div>

  <!-- FOLDER DETAIL -->
  <div class="view" id="view-folder">
    <div class="header-group"><div class="top-bar">
      <button class="back-btn" onclick="showView('main')" id="btn-back-folder"></button>
      <div class="top-title"><h1>Folder</h1></div>
    </div></div>
    <div class="cf-hero">
      <div class="cf-art" id="cf-art"><span class="cf-code" id="cf-code"></span></div>
      <h2 class="cf-title" id="cf-title"></h2>
      <div class="cf-author-row">
        <div class="cf-avatar" id="cf-avatar"></div>
        <span class="cf-author-name" id="cf-author"></span>
      </div>
      <p class="cf-meta" id="cf-meta"></p>
      <div class="cf-action-row">
        <button class="cf-start-btn" onclick="alert('Would open the first topic')">Start learning</button>
        <button class="cf-icon-btn" id="cf-download-btn"></button>
        <button class="cf-icon-btn" onclick="alert('Mock only — would open folder options')" id="cf-more-btn"></button>
      </div>
    </div>
    <div class="cf-topic-list" id="cf-topic-list"></div>
  </div>

  <!-- PEOPLE -->
  <div class="view" id="view-people">
    <div class="header-group"><div class="top-bar">
      <button class="back-btn" onclick="showView('main')" id="btn-back-people"></button>
      <div class="top-title"><h1>People</h1><div class="sub">2 members</div></div>
    </div></div>
    <button class="invite-btn" onclick="alert('Would open an invite-link share sheet')" id="btn-invite"></button>
    <div id="member-list"></div>
  </div>

  <!-- SETTINGS -->
  <div class="view" id="view-settings">
    <div class="header-group"><div class="top-bar">
      <button class="back-btn" onclick="showView('main')" id="btn-back-settings"></button>
      <div class="top-title"><h1>Community settings</h1><div class="sub">JSS 1 Study Circle</div></div>
    </div></div>
    <div class="settings-section">
      <div class="icon-grid" id="icon-grid"></div>
      <div class="field"><label>Community name</label><input type="text" id="s-name" value="JSS 1 Study Circle"></div>
      <div class="field"><label>Description</label><textarea id="s-desc">A demo study group for sharing revision activities and supporting one another.</textarea></div>
      <button class="save-btn" onclick="saveSettings()">Save changes</button>
      <div class="danger-zone">
        <div class="d-title" id="danger-title"></div>
        <button class="delete-btn" id="delete-btn" onclick="deleteCommunity()">Delete this community</button>
      </div>
    </div>
  </div>

  <!-- ANALYTICS -->
  <div class="view" id="view-analytics">
    <div class="header-group"><div class="top-bar">
      <button class="back-btn" onclick="showView('main')" id="btn-back-analytics"></button>
      <div class="top-title"><h1>Analytics</h1><div class="sub">JSS 1 Study Circle</div></div>
    </div></div>
    <div class="stat-grid" id="stat-grid"></div>
    <div class="section-title">Recent submissions</div>
    <div class="empty-state">
      <div class="e-icon" id="empty-icon-sub"></div>
      <div class="e-sub">No submissions yet.</div>
    </div>
  </div>

</div>

<script>
  // Minimal Tabler-style line icons (24x24, 2px stroke) — replaces emoji throughout.
  const ICONS = {
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    barChart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    clipboard: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3h6v3H9z"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    puzzle: '<path d="M14 3v2.5a1.5 1.5 0 0 0 3 0V3h2a2 2 0 0 1 2 2v2h-2.5a1.5 1.5 0 0 0 0 3H21v2a2 2 0 0 1-2 2h-2v-2.5a1.5 1.5 0 0 0-3 0V14H9v2.5a1.5 1.5 0 0 1-3 0V14H4a2 2 0 0 1-2-2v-2h2.5a1.5 1.5 0 0 0 0-3H2V5a2 2 0 0 1 2-2h2v2.5a1.5 1.5 0 0 0 3 0V3z"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>',
    alertTriangle: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    trendUp: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    flask: '<path d="M9 2v6L4 18a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L15 8V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="7" y1="14" x2="17" y2="14"/>',
    headphones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="1.5"/><rect x="17" y="14" width="5" height="7" rx="1.5"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    sprout: '<path d="M7 20h10"/><path d="M12 20v-9"/><path d="M12 11C9 11 7 9 7 6c3 0 5 2 5 5z"/><path d="M12 11c3 0 5-3 5-6-3 0-5 2-5 6z"/>',
    flame: '<path d="M12 2c2 3-1 4-1 7a3 3 0 0 0 6 0c1 3-1 7-5 7a6 6 0 0 1-6-6c0-3 2-5 2-5s1 2 1 4c1-2 2-4 3-7z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    handshake: '<path d="M2 11l5-5 4 2 3-2 5 5"/><path d="M7 14l3 3 2-2 2 2 3-3"/>',
    rocket: '<path d="M14 3c3 1 6 4 7 7-3 1-6 0-8-2-2-2-2-5 1-5z"/><path d="M8 14c-2 0-5 3-5 6 3 0 6-3 6-5"/><path d="M12 15l-3-3 6-8c1-1 4 2 3 3z"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>',
  };
  function icon(name, size){
    size = size || 20;
    return '<svg class="icon" style="width:' + size + 'px;height:' + size + 'px" viewBox="0 0 24 24">' + ICONS[name] + '</svg>';
  }

  const ACCENTS = ['#6C3BFF', '#FF6B57', '#2BB673', '#3BA7E0'];
  const members = [
    { initials: 'PJ', name: 'Priya JSS1-1 (you)', joined: '25d ago', role: 'owner' },
    { initials: 'AJ', name: 'Amara JSS1-2', joined: '25d ago', role: 'member' },
  ];

  function showView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
  }

  function renderMembers(){
    document.getElementById('member-list').innerHTML = members.map(function(m, i){
      return '<div class="member-row">' +
        '<div class="avatar" style="background:' + ACCENTS[i % ACCENTS.length] + '">' + m.initials + '</div>' +
        '<div class="member-info"><div class="m-name">' + m.name + '</div><div class="m-meta">joined ' + m.joined + '</div></div>' +
        '<div class="role-badge ' + m.role + '">' + m.role.toUpperCase() + '</div>' +
      '</div>';
    }).join('');
  }

  const iconOptions = ['globe','book','flask','headphones','briefcase','sprout','flame','target','handshake','rocket'];
  let selectedIcon = 'book';
  function renderIconGrid(){
    document.getElementById('icon-grid').innerHTML = iconOptions.map(function(ic){
      return '<div class="icon-chip ' + (ic === selectedIcon ? 'selected' : '') + '" onclick="selectIcon(\'' + ic + '\')">' + icon(ic, 19) + '</div>';
    }).join('');
  }
  function selectIcon(ic){
    selectedIcon = ic;
    renderIconGrid();
  }

  function saveSettings(){
    const name = document.getElementById('s-name').value.trim();
    if (!name) { alert('Community name cannot be empty'); return; }
    document.querySelectorAll('.top-title h1').forEach(function(el){
      if (el.closest('.view') !== document.getElementById('view-settings')) el.textContent = name;
    });
    document.getElementById('header-comm-icon').innerHTML = icon(selectedIcon, 21);
    alert('Changes saved');
  }

  let deleteArmed = false;
  function deleteCommunity(){
    const btn = document.getElementById('delete-btn');
    if (!deleteArmed) {
      deleteArmed = true;
      btn.classList.add('armed');
      btn.textContent = 'Tap again to confirm deletion';
      return;
    }
    alert('Mock only — would delete this community');
  }

  const materials = [
    { name: 'Photosynthesis Explained', reads: 1245 },
    { name: 'Algebra Formulas Cheat Sheet', reads: 892 },
    { name: 'English Essay Structure Guide', reads: 634 },
    { name: 'Past Questions — JSS1 Mock Exam', reads: 521 },
  ];

  const folders = [
    { code: 'BIO', name: 'Biology Notes', topics: 8, author: 'Amara JSS1-2' },
    { code: 'PQ', name: 'Past Questions', topics: 15, author: 'Priya JSS1-1' },
    { code: 'EXM', name: 'Exam Prep Pack', topics: 6, author: 'Akoro' },
    { code: 'REV', name: 'Revision Summaries', topics: 10, author: 'Amara JSS1-2' },
  ];

  function renderMaterials(){
    document.getElementById('materials-list').innerHTML = materials.map(function(m, i){
      return '<div class="material-row">' +
        '<div class="material-rank">' + (i + 1) + '</div>' +
        '<div class="material-thumb" style="background:' + ACCENTS[i % ACCENTS.length] + '">' + icon('fileText', 18) + '</div>' +
        '<div class="material-info"><div class="mt-name">' + m.name + '</div><div class="mt-stat">' + m.reads.toLocaleString() + ' reads</div></div>' +
        '<button class="row-more" onclick="alert(\'Mock only — would open options for ' + m.name.replace(/'/g, "\\'") + '\')">' + icon('dots', 18) + '</button>' +
      '</div>';
    }).join('');
  }

  function renderFolders(){
    document.getElementById('folders-row').innerHTML = folders.map(function(f, i){
      return '<div class="folder-card" onclick="openFolder(' + i + ')">' +
        '<div class="fc-art" style="background:' + ACCENTS[i % ACCENTS.length] + '"><span>' + f.code + '</span></div>' +
        '<div class="fc-name">' + f.name + '</div>' +
        '<div class="fc-meta">' + f.topics + ' topics</div>' +
      '</div>';
    }).join('');
  }

  function openFolder(i){
    const f = folders[i];
    const accent = ACCENTS[i % ACCENTS.length];
    document.getElementById('cf-art').style.background = accent;
    document.getElementById('cf-code').textContent = f.code;
    document.getElementById('cf-title').textContent = f.name;
    document.getElementById('cf-avatar').style.background = accent;
    document.getElementById('cf-avatar').textContent = f.author.charAt(0);
    document.getElementById('cf-author').textContent = f.author;
    document.getElementById('cf-meta').textContent = f.topics + ' topics · JSS 1 Study Circle';
    document.getElementById('cf-topic-list').innerHTML = Array.from({ length: f.topics }).map(function(_, n){
      return '<div class="cf-topic-row" onclick="alert(\'Would open Topic ' + (n + 1) + '\')">' +
        '<div class="cf-topic-num">' + (n + 1) + '</div>' +
        '<div class="cf-topic-info"><div class="ct-name">Topic ' + (n + 1) + '</div><div class="ct-meta">' + (6 + n) + ' min read</div></div>' +
        '<button class="row-more" onclick="event.stopPropagation(); alert(\'Mock only — topic options\')">' + icon('dots', 17) + '</button>' +
      '</div>';
    }).join('');
    showView('folder');
  }

  const activityTabs = [
    { key: 'all', label: 'All', iconName: null, emptyText: 'No activities yet' },
    { key: 'assignment', label: 'Assignment', iconName: 'clipboard', emptyText: 'No assignments yet' },
    { key: 'project', label: 'Project', iconName: 'folder', emptyText: 'No projects yet' },
    { key: 'multistep', label: 'Multi-step', iconName: 'puzzle', emptyText: 'No multi-step activities yet' },
  ];
  let activeTab = 'all';

  function renderTabs(){
    document.getElementById('tabs-row').innerHTML = activityTabs.map(function(t){
      return '<button class="tab ' + (t.key === activeTab ? 'active' : '') + '" onclick="selectTab(\'' + t.key + '\')">' +
        (t.iconName ? icon(t.iconName, 15) : '') + '<span>' + t.label + '</span></button>';
    }).join('');
  }
  function selectTab(key){
    activeTab = key;
    renderTabs();
    const t = activityTabs.find(function(x){ return x.key === key; });
    document.getElementById('activity-empty-title').textContent = t.emptyText;
  }

  let isFollowing = false;
  function toggleFollow(){
    isFollowing = !isFollowing;
    const btn = document.getElementById('follow-btn');
    btn.textContent = isFollowing ? 'Following' : 'Follow';
    btn.classList.toggle('following', isFollowing);
    document.getElementById('follow-member-count').textContent = (48 + (isFollowing ? 1 : 0)) + ' followers';
  }

  function init(){
    document.getElementById('header-comm-icon').innerHTML = icon(selectedIcon, 21);
    document.getElementById('btn-settings').innerHTML = icon('gear', 17);
    document.getElementById('btn-people').innerHTML = icon('users', 17);
    document.getElementById('btn-analytics').innerHTML = icon('barChart', 17);
    document.querySelectorAll('.top-bar .back-btn').forEach(function(b){ b.innerHTML = icon('chevronLeft', 18); });
    document.getElementById('empty-icon-main').innerHTML = icon('clipboard', 24);
    document.getElementById('empty-icon-sub').innerHTML = icon('inbox', 24);
    document.getElementById('btn-invite').innerHTML = icon('userPlus', 17) + '<span>Invite members</span>';
    document.getElementById('btn-new-activity').innerHTML = icon('plus', 17) + '<span>New activity</span>';
    document.getElementById('danger-title').innerHTML = icon('alertTriangle', 16) + '<span>Danger zone</span>';

    renderTabs();

    document.getElementById('stat-grid').innerHTML =
      '<div class="stat-card"><div class="s-icon" style="background:var(--ak-purple-soft);color:var(--ak-purple)">' + icon('users',18) + '</div><div class="s-value">2</div><div class="s-label">Members</div></div>' +
      '<div class="stat-card"><div class="s-icon" style="background:var(--ak-amber-soft);color:#92590B">' + icon('clipboard',18) + '</div><div class="s-value">0</div><div class="s-label">Activities</div></div>' +
      '<div class="stat-card"><div class="s-icon" style="background:var(--ak-green-soft);color:var(--ak-green)">' + icon('inbox',18) + '</div><div class="s-value">0</div><div class="s-label">Submissions</div></div>' +
      '<div class="stat-card"><div class="s-icon" style="background:var(--ak-sky-soft);color:var(--ak-sky)">' + icon('trendUp',18) + '</div><div class="s-value">0</div><div class="s-label">Avg / activity</div></div>';

    document.getElementById('cf-download-btn').innerHTML = icon('download', 17);
    document.getElementById('cf-download-btn').onclick = function(){ alert('Would download all topics for offline access'); };
    document.getElementById('cf-more-btn').innerHTML = icon('dots', 17);

    renderMembers();
    renderIconGrid();
    renderMaterials();
    renderFolders();
  }
  init();
</script>
</body>
</html>
