<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro — Course Library</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --purple: #6C3BFF; --purple-dark: #4C2BB8; --purple-deep: #2E1A6E;
    --coral: #FF6B57; --green: #2BB673; --sky: #3BA7E0;
    --bg: #0F0D1A; --surface: #1C1830; --surface-2: #171429;
    --border: #2E2A47; --text: #FFFFFF; --text-dim: #B4AFD1;
    box-sizing: border-box; padding-top: env(safe-area-inset-top,0px); padding-bottom: env(safe-area-inset-bottom,0px);
  }
  :root[data-theme="light"] { --bg:#FAFAFC; --surface:#FFFFFF; --surface-2:#F3F1FA; --border:#E7E4F0; --text:#221D33; --text-dim:#6B667E; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Nunito', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; }
  .phone { width: 100%; max-width: 430px; min-height: 100%; background: var(--bg); overflow-x: hidden; }
  .view { display: none; }
  .view.active { display: block; }

  /* --- Browse view --- */
  .hero { background: linear-gradient(160deg, var(--purple) 0%, var(--purple-deep) 75%); padding: 20px 22px 28px; }
  .back-btn { width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,0.14); color: white; font-size: 1.1rem; font-weight: 700; cursor: pointer; margin-bottom: 20px; }
  .hero h1 { font-size: 2.1rem; font-weight: 900; margin: 0; }
  .hero .sub { color: rgba(255,255,255,0.75); font-weight: 700; font-size: 0.85rem; margin-top: 6px; }

  .section { padding: 22px 0 4px; }
  .section h2 { font-size: 1.15rem; font-weight: 800; margin: 0 0 14px; padding: 0 22px; }
  .row { display: flex; gap: 14px; overflow-x: auto; padding: 0 22px 10px; scrollbar-width: none; }
  .row::-webkit-scrollbar { display: none; }
  .card { flex: 0 0 132px; cursor: pointer; }
  .card .art { width: 132px; height: 132px; border-radius: 14px; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px; position: relative; overflow: hidden; }
  .card .art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%); }
  .card .code { position: relative; z-index: 1; font-weight: 900; font-size: 1.05rem; color: white; }
  .card .name { font-size: 0.85rem; font-weight: 700; margin-top: 8px; }
  .card .meta { font-size: 0.74rem; color: var(--text-dim); font-weight: 600; margin-top: 2px; }
  .card .reads { font-size: 0.74rem; color: var(--text-dim); font-weight: 600; margin-top: 1px; }

  .empty-row { flex: 0 0 auto; width: 100%; padding: 18px 22px; }
  .empty-card { border: 1.5px dashed var(--border); border-radius: 14px; padding: 18px; text-align: center; color: var(--text-dim); font-weight: 700; font-size: 0.85rem; }

  /* --- Folder (course) view --- */
  .folder-hero { padding: 20px 22px 24px; position: relative; }
  .folder-art { width: 100%; aspect-ratio: 1.6; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 18px 0 20px; position: relative; overflow: hidden; }
  .folder-art .code-big { font-size: 2.6rem; font-weight: 900; color: rgba(255,255,255,0.92); letter-spacing: 0.02em; }
  .folder-title { font-size: 1.5rem; font-weight: 900; margin: 0 0 4px; }
  .author-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; cursor: pointer; }
  .author-avatar { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 900; color: white; }
  .author-name { font-size: 0.86rem; font-weight: 800; color: var(--text); }
  .folder-meta { color: var(--text-dim); font-weight: 700; font-size: 0.85rem; margin: 0 0 20px; }

  .action-row { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  .start-btn { flex: 1; padding: 13px; border-radius: 100px; border: none; background: var(--purple); color: white; font-family: inherit; font-weight: 800; font-size: 0.95rem; cursor: pointer; }
  .icon-btn { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }

  .topic-list { padding: 18px 10px 30px; }
  .topic-row { display: flex; align-items: center; gap: 14px; padding: 13px 12px; border-radius: 12px; cursor: pointer; }
  .topic-row:hover { background: var(--surface); }
  .topic-num { width: 30px; text-align: center; color: var(--text-dim); font-weight: 800; font-size: 0.9rem; flex-shrink: 0; }
  .topic-info { flex: 1; }
  .topic-info .t-name { font-weight: 700; font-size: 0.95rem; }
  .topic-info .t-meta { font-size: 0.76rem; color: var(--text-dim); font-weight: 600; margin-top: 2px; }
  .topic-check { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: var(--green); }
  .topic-check.done { background: var(--green); border-color: var(--green); color: white; }
  .chev { color: var(--text-dim); font-size: 1.1rem; }
  .more-btn { background: none; border: none; color: var(--text-dim); font-size: 1.2rem; font-weight: 900; padding: 6px 4px; cursor: pointer; line-height: 1; flex-shrink: 0; }

  .upload-btn { position: absolute; width: 30px; height: 30px; border-radius: 50%; background: rgba(0,0,0,0.5); border: 1.5px solid rgba(255,255,255,0.5); color: white; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; }
  .card .art { position: relative; }
  .card .upload-btn { width: 24px; height: 24px; font-size: 0.7rem; top: 6px; right: 6px; }
  .folder-art .upload-btn { bottom: 10px; right: 10px; }

  .sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: none; align-items: flex-end; justify-content: center; z-index: 40; }
  .sheet-overlay.show { display: flex; }
  .sheet { width: 100%; max-width: 430px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 10px 0 max(18px, env(safe-area-inset-bottom)); max-height: 80vh; overflow-y: auto; }
  .sheet-handle { width: 36px; height: 4px; border-radius: 100px; background: var(--border); margin: 6px auto 14px; }
  .sheet-head { display: flex; align-items: center; gap: 12px; padding: 0 20px 16px; border-bottom: 1px solid var(--border); }
  .sheet-art { width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.85rem; color: white; }
  .sheet-head .t-title { font-weight: 800; font-size: 0.95rem; }
  .sheet-head .t-sub { font-size: 0.78rem; color: var(--text-dim); font-weight: 600; margin-top: 2px; }
  .sheet-actions { padding: 8px 0; }
  .sheet-action { display: flex; align-items: center; gap: 16px; padding: 13px 20px; cursor: pointer; }
  .sheet-action:hover { background: var(--surface-2); }
  .sheet-action .s-icon { width: 22px; text-align: center; font-size: 1.05rem; }
  .sheet-action .s-label { font-size: 0.92rem; font-weight: 700; }

  /* --- Topic content view --- */
  .topic-header { padding: 20px 22px 0; }
  .breadcrumb { font-size: 0.78rem; color: var(--text-dim); font-weight: 700; margin: 16px 0 8px; }
  .topic-content-title { font-size: 1.4rem; font-weight: 900; margin: 0 0 18px; }
  .content-body { padding: 0 22px 100px; font-size: 0.95rem; line-height: 1.7; color: var(--text-dim); }
  .content-body p { margin: 0 0 16px; }
  .content-body h3 { color: var(--text); font-size: 1rem; font-weight: 800; margin: 22px 0 8px; }

  .topic-footer { position: sticky; bottom: 0; background: var(--bg); border-top: 1px solid var(--border); padding: 14px 22px; display: flex; gap: 10px; }
  .nav-btn { flex: 1; padding: 13px; border-radius: 100px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; font-weight: 800; font-size: 0.88rem; cursor: pointer; }
  .nav-btn.primary { background: var(--purple); border: none; }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }
</style>
</head>
<body>

<div class="phone">

  <!-- VIEW 1: Browse -->
  <div class="view active" id="view-browse">
    <div class="hero">
      <button class="back-btn" onclick="alert('Would return to Learn')">←</button>
      <h1>PHARM.D</h1>
      <div class="sub">Doctor of Pharmacy</div>
    </div>
    <div id="years-container"></div>
  </div>

  <!-- VIEW 2: Folder (course) -->
  <div class="view" id="view-folder">
    <div class="folder-hero">
      <button class="back-btn" onclick="showView('browse')">←</button>
      <div class="folder-art" id="folder-art">
        <button class="upload-btn" onclick="event.stopPropagation(); uploadPhoto('folder', currentCourse && currentCourse.code)">📷</button>
        <span class="code-big" id="folder-code-big"></span>
      </div>
      <h2 class="folder-title" id="folder-title"></h2>
      <div class="author-row">
        <div class="author-avatar" id="author-avatar"></div>
        <span class="author-name" id="author-name"></span>
      </div>
      <p class="folder-meta" id="folder-meta"></p>
      <div class="action-row">
        <button class="start-btn" id="start-btn">Start learning</button>
        <button class="icon-btn" onclick="alert('Would download all topics for offline access')">⬇</button>
        <button class="icon-btn" onclick="openSheet('course')">⋯</button>
      </div>
    </div>
    <div class="topic-list" id="topic-list"></div>
  </div>

  <!-- VIEW 3: Topic content -->
  <div class="view" id="view-topic">
    <div class="topic-header">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <button class="back-btn" onclick="showView('folder')">←</button>
        <button class="more-btn" style="font-size:1.4rem;" onclick="openSheet('topic', currentTopicIndex)">⋮</button>
      </div>
      <div class="breadcrumb" id="topic-breadcrumb"></div>
      <h2 class="topic-content-title" id="topic-content-title"></h2>
    </div>
    <div class="content-body" id="topic-body"></div>
    <div class="topic-footer">
      <button class="nav-btn" id="prev-btn" onclick="gotoAdjacentTopic(-1)">← Previous</button>
      <button class="nav-btn primary" id="next-btn" onclick="gotoAdjacentTopic(1)">Next →</button>
    </div>
  </div>

</div>

<div class="sheet-overlay" id="sheet-overlay" onclick="if(event.target.id==='sheet-overlay') closeSheet()">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <div class="sheet-art" id="sheet-art"></div>
      <div>
        <div class="t-title" id="sheet-title"></div>
        <div class="t-sub" id="sheet-sub"></div>
      </div>
    </div>
    <div class="sheet-actions" id="sheet-actions"></div>
  </div>
</div>

<script>
  const ACCENTS = [
    'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
    'linear-gradient(145deg, #FF6B57, #C13F2E)',
    'linear-gradient(145deg, #2BB673, #167A4A)',
    'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
  ];

  const program = {
    name: 'PHARM.D',
    years: [
      {
        label: 'First Year',
        courses: [
          'BIO 111', 'BIO 121', 'CSC 111', 'GST 111', 'GST 113',
          'GST 121', 'ICH 111', 'MAT 111', 'PHY 111',
        ],
      },
      {
        label: 'Second Year',
        courses: [],
      },
    ],
  };

  // Shared placeholder topic set per course, since specific syllabi weren't provided.
  function topicsFor(code){
    return [1,2,3,4,5].map(n => ({
      name: `Topic ${n}`,
      meta: `${8 + n} min read`,
      done: n === 1,
      body: `<p>This is placeholder lesson content for <b>${code} — Topic ${n}</b>. Replace with the real syllabus content for this topic once it's ready.</p><h3>Key points</h3><p>Outline the two or three ideas a student should take away from this topic before moving on.</p>`,
    }));
  }

  let currentCourse = null;
  let currentTopicIndex = 0;

  function accentFor(code){
    let hash = 0;
    for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) % ACCENTS.length;
    return ACCENTS[hash];
  }

  // Deterministic mock read count per course, stable across re-renders — not real usage data.
  function readsFor(code){
    let hash = 0;
    for (const ch of code) hash = (hash * 37 + ch.charCodeAt(0)) >>> 0;
    const count = 800 + (hash % 42000);
    return count.toLocaleString();
  }

  function renderBrowse(){
    const wrap = document.getElementById('years-container');
    wrap.innerHTML = program.years.map(year => {
      if (!year.courses.length) {
        return `
          <div class="section">
            <h2>${year.label}</h2>
            <div class="empty-row"><div class="empty-card">Courses for ${year.label} are coming soon.</div></div>
          </div>`;
      }
      return `
        <div class="section">
          <h2>${year.label}</h2>
          <div class="row">
            ${year.courses.map(code => `
              <div class="card" onclick="openCourse('${code}')">
                <div class="art" style="background:${accentFor(code)}">
                  <button class="upload-btn" onclick="event.stopPropagation(); uploadPhoto('card', '${code}')">📷</button>
                  <span class="code">${code}</span>
                </div>
                <div class="name">${code}</div>
                <div class="meta">Course. by Akoro</div>
                <div class="reads">${readsFor(code)} reads</div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function showView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    window.scrollTo(0, 0);
  }

  function openCourse(code){
    const author = 'Akoro'; // default creator; swap per-course if real authorship data exists
    currentCourse = { code, topics: topicsFor(code) };
    document.getElementById('folder-art').style.background = accentFor(code);
    document.getElementById('folder-code-big').textContent = code;
    document.getElementById('folder-title').textContent = code;
    document.getElementById('author-avatar').style.background = accentFor(code);
    document.getElementById('author-avatar').textContent = author.charAt(0);
    document.getElementById('author-name').textContent = author;
    document.getElementById('folder-meta').textContent = `${currentCourse.topics.length} topics · PHARM.D`;
    document.getElementById('start-btn').onclick = () => openTopic(0);

    document.getElementById('topic-list').innerHTML = currentCourse.topics.map((t, i) => `
      <div class="topic-row" onclick="openTopic(${i})">
        <div class="topic-num">${i + 1}</div>
        <div class="topic-info">
          <div class="t-name">${t.name}</div>
          <div class="t-meta">${t.meta}</div>
        </div>
        <div class="topic-check ${t.done ? 'done' : ''}">${t.done ? '✓' : ''}</div>
        <button class="more-btn" onclick="event.stopPropagation(); openSheet('topic', ${i})">⋮</button>
      </div>
    `).join('');
    showView('folder');
  }

  function openTopic(i){
    currentTopicIndex = i;
    const t = currentCourse.topics[i];
    document.getElementById('topic-breadcrumb').textContent = `${currentCourse.code} · Topic ${i + 1} of ${currentCourse.topics.length}`;
    document.getElementById('topic-content-title').textContent = t.name;
    document.getElementById('topic-body').innerHTML = t.body;
    document.getElementById('prev-btn').disabled = i === 0;
    document.getElementById('next-btn').textContent = i === currentCourse.topics.length - 1 ? 'Finish' : 'Next →';
    showView('topic');
  }

  function gotoAdjacentTopic(dir){
    const next = currentTopicIndex + dir;
    if (next < 0) return;
    if (next >= currentCourse.topics.length) { showView('folder'); return; }
    openTopic(next);
  }

  function sheetActionsFor(kind){
    if (kind === 'topic') {
      return [
        ['🔗', 'Share'],
        ['➕', 'Add to Library'],
        ['⬇', 'Download'],
        ['✓', 'Mark as complete'],
        ['📘', 'Go to course'],
      ];
    }
    // course
    return [
      ['🔗', 'Share'],
      ['➕', 'Add to Library'],
      ['⬇', 'Download all topics'],
      ['👤', 'Go to creator'],
      ['🎓', 'Go to program'],
    ];
  }

  function runSheetAction(kind, label, topicIdx){
    closeSheet();
    if (kind === 'topic' && label === 'Mark as complete') {
      currentCourse.topics[topicIdx].done = !currentCourse.topics[topicIdx].done;
      // Re-render whichever view is currently showing this data
      openCourse(currentCourse.code);
      if (document.getElementById('view-topic').classList.contains('active')) openTopic(topicIdx);
      return;
    }
    if (label === 'Go to course' || label === 'Go to program') { showView(label === 'Go to course' ? 'folder' : 'browse'); return; }
    alert(`Mock only — would ${label.toLowerCase()}`);
  }

  function openSheet(kind, topicIdx){
    const art = document.getElementById('sheet-art');
    const title = document.getElementById('sheet-title');
    const sub = document.getElementById('sheet-sub');
    art.style.background = accentFor(currentCourse.code);

    if (kind === 'topic') {
      const t = currentCourse.topics[topicIdx];
      art.textContent = String(topicIdx + 1);
      title.textContent = t.name;
      sub.textContent = `${currentCourse.code} · ${t.meta}`;
    } else {
      art.textContent = currentCourse.code.slice(0, 2);
      title.textContent = currentCourse.code;
      sub.textContent = `Course · by Akoro`;
    }

    document.getElementById('sheet-actions').innerHTML = sheetActionsFor(kind).map(([icon, label]) => `
      <div class="sheet-action" onclick="runSheetAction('${kind}', '${label}', ${topicIdx})">
        <span class="s-icon">${icon}</span>
        <span class="s-label">${label}</span>
      </div>
    `).join('');

    document.getElementById('sheet-overlay').classList.add('show');
  }
  function closeSheet(){
    document.getElementById('sheet-overlay').classList.remove('show');
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('sheet-overlay').classList.contains('show')) closeSheet();
  });

  function uploadPhoto(target, code){
    alert(`Mock only — would open photo picker to set the ${target === 'folder' ? 'course cover' : 'card thumbnail'} for ${code || 'this course'}`);
  }

  renderBrowse();
</script>
</body>
</html>
