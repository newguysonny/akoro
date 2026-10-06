<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro — Add to Folder</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --purple: #6C3BFF; --bg: #0F0D1A; --surface: #1C1830; --surface-2: #171429;
    --border: #2E2A47; --text: #FFFFFF; --text-dim: #B4AFD1;
    box-sizing: border-box; padding-top: env(safe-area-inset-top,0px); padding-bottom: env(safe-area-inset-bottom,0px);
  }
  :root[data-theme="light"] { --bg:#FAFAFC; --surface:#FFFFFF; --surface-2:#F3F1FA; --border:#E7E4F0; --text:#221D33; --text-dim:#6B667E; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Nunito', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; }
  .phone { width: 100%; max-width: 430px; min-height: 100%; background: var(--bg); position: relative; }

  .back-btn { width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,0.08); color: var(--text); font-size: 1.1rem; font-weight: 700; cursor: pointer; }

  .atf-header { display: flex; align-items: center; gap: 12px; padding: 18px 16px 10px; }
  .atf-header h1 { flex: 1; text-align: center; font-size: 1.15rem; font-weight: 800; margin: 0; padding-right: 36px; }
  .new-folder-btn { display: block; margin: 18px auto 22px; padding: 13px 26px; border-radius: 100px; border: none; background: var(--text); color: var(--bg); font-family: inherit; font-weight: 800; font-size: 0.95rem; cursor: pointer; }
  .atf-search { display: flex; align-items: center; gap: 10px; background: var(--surface-2); border-radius: 10px; padding: 12px 14px; margin: 0 20px 18px; }
  .atf-search input { flex: 1; background: none; border: none; color: var(--text); font-family: inherit; font-size: 0.92rem; outline: none; }
  .atf-search input::placeholder { color: var(--text-dim); }
  .atf-search .s-icon { color: var(--text-dim); }
  .atf-sort { display: flex; align-items: center; gap: 10px; padding: 0 20px 14px; color: var(--text); font-weight: 800; font-size: 0.88rem; }
  .atf-list { padding-bottom: 100px; }
  .atf-row { display: flex; align-items: center; gap: 14px; padding: 10px 20px; cursor: pointer; }
  .atf-row:hover { background: var(--surface); }
  .atf-thumb { width: 54px; height: 54px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.3rem; }
  .atf-info { flex: 1; }
  .atf-info .f-name { font-weight: 700; font-size: 0.98rem; }
  .atf-info .f-count { font-size: 0.8rem; color: var(--text-dim); font-weight: 600; margin-top: 2px; }
  .atf-radio { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--text-dim); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .atf-radio.checked { border-color: var(--purple); background: var(--purple); color: white; font-size: 0.8rem; }
  .atf-done-wrap { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 18px 0 max(18px, env(safe-area-inset-bottom)); pointer-events: none; }
  .atf-done { pointer-events: auto; padding: 14px 40px; border-radius: 100px; border: none; background: var(--purple); color: white; font-family: inherit; font-weight: 800; font-size: 0.95rem; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
  .toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: var(--surface-2); color: var(--text); padding: 10px 18px; border-radius: 100px; font-weight: 700; font-size: 0.85rem; z-index: 50; box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
</style>
</head>
<body>

<div class="phone">
  <div class="atf-header">
    <button class="back-btn" onclick="alert('Would return to the previous screen')">←</button>
    <h1>Add to Folder</h1>
  </div>
  <button class="new-folder-btn" onclick="createFolder()">New folder</button>
  <div class="atf-search">
    <span class="s-icon">🔍</span>
    <input type="text" id="atf-search-input" placeholder="Find folder" oninput="renderFolderList()">
  </div>
  <div class="atf-sort">☰ Most relevant</div>
  <div class="atf-list" id="atf-list"></div>
  <div class="atf-done-wrap"><button class="atf-done" onclick="finish()">Done</button></div>
</div>

<script>
  const ACCENTS = [
    'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
    'linear-gradient(145deg, #FF6B57, #C13F2E)',
    'linear-gradient(145deg, #2BB673, #167A4A)',
    'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
  ];

  let folders = [
    { name: 'Revision List', count: 12 },
    { name: 'Exam Prep', count: 8 },
    { name: 'Bookmarked', count: 23 },
    { name: 'First Year Core', count: 34 },
    { name: 'Weak Topics', count: 5 },
  ];
  let selectedFolders = new Set();

  function toast(msg){
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function createFolder(){
    const name = prompt('Name your new folder');
    if (!name) return;
    folders.unshift({ name, count: 0 });
    selectedFolders.add(name);
    renderFolderList();
  }

  function toggleFolder(name){
    if (selectedFolders.has(name)) selectedFolders.delete(name); else selectedFolders.add(name);
    renderFolderList();
  }

  function renderFolderList(){
    const q = (document.getElementById('atf-search-input')?.value || '').toLowerCase();
    const filtered = folders.filter(f => f.name.toLowerCase().includes(q));
    document.getElementById('atf-list').innerHTML = filtered.length ? filtered.map((f, i) => {
      const checked = selectedFolders.has(f.name);
      return `
      <div class="atf-row" onclick="toggleFolder('${f.name.replace(/'/g, "\\'")}')">
        <div class="atf-thumb" style="background:${ACCENTS[i % ACCENTS.length]}">📁</div>
        <div class="atf-info">
          <div class="f-name">${f.name}</div>
          <div class="f-count">${f.count} ${f.count === 1 ? 'topic' : 'topics'}</div>
        </div>
        <div class="atf-radio ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</div>
      </div>`;
    }).join('') : `<p style="padding:0 20px;color:var(--text-dim)">No folders match.</p>`;
  }

  function finish(){
    if (selectedFolders.size) toast(`Added to ${selectedFolders.size} folder${selectedFolders.size === 1 ? '' : 's'}`);
    else alert('Would return to the previous screen');
  }

  renderFolderList();
</script>
</body>
</html>
