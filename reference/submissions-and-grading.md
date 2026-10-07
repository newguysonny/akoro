<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Akoro Instructor — Grade Submission</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,600&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#F7F6F3;
    --paper-edge:#EAE6DD;
    --ink:#211F35;
    --ink-soft:#5B5876;
    --ink-faint:#8B88A3;
    --purple:#6C3BFF;
    --purple-dim:#5A2FE0;
    --purple-soft:#F1ECFF;
    --coral:#E4572E;
    --coral-soft:#FCE9E2;
    --green:#1F9D66;
    --green-soft:#E6F6EE;
    --line:#E1DEEA;
    --surface:#FFFFFF;
    --bg:#F1EFF6;
    --shadow-paper: 0 1px 2px rgba(33,31,53,0.04), 0 12px 28px -12px rgba(33,31,53,0.18);
    --radius-ui: 10px;
    --radius-pill: 999px;
  }

  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background:var(--bg);
    color:var(--ink);
    font-family:'Nunito', sans-serif;
    -webkit-font-smoothing:antialiased;
  }

  a{color:inherit;}
  button{font-family:inherit;}
  :focus-visible{outline:2.5px solid var(--purple); outline-offset:2px;}

  @media (prefers-reduced-motion: reduce){
    *{animation-duration:0.001ms !important; transition-duration:0.001ms !important;}
  }

  /* ---------- Top bar ---------- */
  .topbar{
    display:flex;
    align-items:center;
    gap:20px;
    padding:14px 24px;
    background:var(--surface);
    border-bottom:1px solid var(--line);
    position:sticky; top:0; z-index:40;
  }
  .brand{
    display:flex; align-items:center; gap:9px;
    font-weight:800; font-size:16px; letter-spacing:-0.01em;
    color:var(--purple);
    text-decoration:none;
    flex-shrink:0;
  }
  .brand-mark{
    width:26px; height:26px; border-radius:8px;
    background:var(--purple);
    display:flex; align-items:center; justify-content:center;
    color:white; font-size:14px; font-weight:800;
  }
  .topbar-divider{
    width:1px; height:26px; background:var(--line); flex-shrink:0;
  }
  .crumb{
    display:flex; flex-direction:column; gap:1px; min-width:0;
  }
  .crumb-back{
    font-size:12.5px; color:var(--ink-faint); text-decoration:none;
    display:flex; align-items:center; gap:4px; width:fit-content;
  }
  .crumb-back:hover{color:var(--ink-soft);}
  .crumb-title{
    font-size:14.5px; font-weight:700; color:var(--ink);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  .stepper{
    margin-left:auto;
    display:flex; align-items:center; gap:10px;
    flex-shrink:0;
  }
  .stepper-btn{
    width:32px; height:32px; border-radius:var(--radius-pill);
    border:1px solid var(--line); background:var(--surface);
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; color:var(--ink-soft);
    transition:background .15s, border-color .15s;
  }
  .stepper-btn:hover:not(:disabled){background:var(--purple-soft); border-color:var(--purple); color:var(--purple);}
  .stepper-btn:disabled{opacity:.35; cursor:not-allowed;}
  .stepper-count{font-size:13px; color:var(--ink-soft); font-weight:600; white-space:nowrap;}

  .status-pill{
    font-size:12px; font-weight:700; padding:5px 12px; border-radius:var(--radius-pill);
    white-space:nowrap;
  }
  .status-pill.graded{background:var(--green-soft); color:var(--green);}
  .status-pill.ungraded{background:var(--coral-soft); color:var(--coral);}

  /* ---------- Layout ---------- */
  .workspace{
    display:grid;
    grid-template-columns: 1.55fr 1fr;
    gap:22px;
    max-width:1440px;
    margin:0 auto;
    padding:26px 24px 60px;
    align-items:start;
  }

  /* ---------- Submission / paper column ---------- */
  .submission-col{ position:relative; }

  .student-header{
    display:flex; align-items:center; gap:12px; margin-bottom:14px;
  }
  .avatar{
    width:40px; height:40px; border-radius:var(--radius-pill);
    background:var(--purple-soft); color:var(--purple-dim);
    display:flex; align-items:center; justify-content:center;
    font-weight:800; font-size:14.5px; flex-shrink:0;
  }
  .student-meta h1{
    font-size:17px; margin:0 0 2px; font-weight:800; letter-spacing:-0.01em;
  }
  .student-meta p{
    margin:0; font-size:12.5px; color:var(--ink-faint); font-weight:600;
  }

  .paper-stack{ position:relative; }
  .paper-stack::before, .paper-stack::after{
    content:""; position:absolute; left:0; right:0; background:var(--paper-edge);
    border-radius:14px; z-index:0;
  }
  .paper-stack::before{ top:14px; height:100%; transform:translateX(10px) scale(.98); opacity:.7; }
  .paper-stack::after{ top:24px; height:100%; transform:translateX(20px) scale(.96); opacity:.45; }

  .paper-card{
    position:relative; z-index:1;
    background:var(--paper);
    border-radius:14px;
    box-shadow:var(--shadow-paper);
    overflow:hidden;
  }

  .toolbar{
    display:flex; align-items:center; gap:6px;
    padding:10px 14px;
    background:var(--surface);
    border-bottom:1px solid var(--line);
    flex-wrap:wrap;
  }
  .tool-btn{
    display:flex; align-items:center; gap:6px;
    border:1px solid transparent; background:transparent;
    color:var(--ink-soft); font-size:13px; font-weight:700;
    padding:7px 11px; border-radius:8px; cursor:pointer;
    transition:background .15s, color .15s;
  }
  .tool-btn svg{width:16px; height:16px; flex-shrink:0;}
  .tool-btn:hover{background:var(--paper);}
  .tool-btn.active{background:var(--coral-soft); color:var(--coral);}
  .toolbar-spacer{flex:1;}
  .tool-btn.undo{color:var(--ink-faint);}
  .tool-btn.undo:hover{background:var(--paper); color:var(--ink-soft);}

  .paper-body-wrap{
    position:relative;
    padding:34px 40px 44px;
    max-height:640px; overflow-y:auto;
  }
  #drawCanvas{
    position:absolute; inset:0; top:0; left:0; z-index:5;
    cursor:crosshair; touch-action:none;
  }
  #drawCanvas.inactive{ pointer-events:none; }

  .paper-body{
    font-family:'Lora', serif;
    font-size:16px;
    line-height:1.75;
    color:#2B2840;
    max-width:64ch;
    position:relative;
    z-index:3;
  }
  .paper-body h2{
    font-family:'Nunito', sans-serif;
    font-size:13px; text-transform:none; letter-spacing:0;
    color:var(--ink-faint); font-weight:700; margin:0 0 18px;
  }
  .paper-body p{margin:0 0 16px;}
  .paper-body mark{
    background:var(--coral-soft);
    color:inherit;
    padding:0.05em 0;
    border-radius:2px;
    box-decoration-break:clone;
  }

  .comment-pin{
    position:absolute; z-index:6;
    width:22px; height:22px; border-radius:50%;
    background:var(--coral); color:white;
    font-size:11.5px; font-weight:800;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; transform:translate(-50%,-50%);
    box-shadow:0 2px 6px rgba(228,87,46,.4);
  }
  .stamp-mark{
    position:absolute; z-index:6; transform:translate(-50%,-50%);
    font-size:26px; pointer-events:none;
  }

  .comment-popover{
    position:absolute; z-index:20;
    background:var(--surface); border:1px solid var(--line);
    border-radius:10px; box-shadow:var(--shadow-paper);
    padding:10px; width:220px; transform:translate(-16px, 10px);
  }
  .comment-popover textarea{
    width:100%; border:1px solid var(--line); border-radius:7px;
    padding:8px; font-family:inherit; font-size:12.5px; resize:vertical;
    min-height:52px; color:var(--ink);
  }
  .comment-popover .row{ display:flex; justify-content:flex-end; gap:6px; margin-top:7px; }
  .mini-btn{
    font-size:12px; font-weight:700; padding:5px 10px; border-radius:7px; cursor:pointer; border:1px solid transparent;
  }
  .mini-btn.primary{ background:var(--purple); color:white; }
  .mini-btn.ghost{ background:transparent; color:var(--ink-faint); }

  .stamp-picker{
    position:absolute; z-index:20;
    background:var(--surface); border:1px solid var(--line);
    border-radius:var(--radius-pill); box-shadow:var(--shadow-paper);
    padding:6px; display:flex; gap:3px; transform:translate(-50%,-140%);
  }
  .stamp-opt{
    width:34px; height:34px; border-radius:50%; border:none; background:transparent;
    font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center;
  }
  .stamp-opt:hover{ background:var(--purple-soft); }

  .comments-rail{
    margin-top:12px; display:flex; flex-direction:column; gap:8px;
  }
  .comments-rail h3{
    font-size:12px; font-weight:700; color:var(--ink-faint); margin:0 0 2px;
  }
  .comment-item{
    display:flex; gap:8px; background:var(--surface); border:1px solid var(--line);
    border-radius:9px; padding:9px 11px; font-size:12.5px;
  }
  .comment-item .dot{
    width:18px; height:18px; border-radius:50%; background:var(--coral); color:white;
    font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px;
  }
  .comment-item p{ margin:0; color:var(--ink-soft); }
  .comments-empty{ font-size:12.5px; color:var(--ink-faint); padding:4px 2px; }

  /* ---------- Grading column ---------- */
  .grading-col{
    display:flex; flex-direction:column; gap:16px;
    position:sticky; top:78px;
  }
  .panel{
    background:var(--surface); border:1px solid var(--line); border-radius:14px;
    padding:18px 18px 20px;
  }
  .panel-head{
    display:flex; align-items:baseline; justify-content:space-between; margin-bottom:4px;
  }
  .question-nav{
    display:flex; align-items:center; justify-content:center; gap:12px;
    margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid var(--line);
  }
  .q-nav-btn{
    width:26px; height:26px; border-radius:50%; border:1px solid var(--line); background:var(--surface);
    display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink-soft);
    transition:background .15s, border-color .15s;
  }
  .q-nav-btn:hover:not(:disabled){ background:var(--purple-soft); border-color:var(--purple); color:var(--purple); }
  .q-nav-btn:disabled{ opacity:.35; cursor:not-allowed; }
  .q-nav-label{ font-size:12.5px; font-weight:800; color:var(--ink); min-width:110px; text-align:center; }
  .panel-head h2{ font-size:14.5px; margin:0; font-weight:800; }
  .autosave{ font-size:11.5px; color:var(--ink-faint); font-weight:600; }
  .autosave.saving{ color:var(--purple); }

  .score-hero{
    display:flex; align-items:baseline; gap:6px; margin:10px 0 6px;
  }
  .score-hero .num{ font-size:38px; font-weight:800; color:var(--purple); letter-spacing:-0.02em; }
  .score-hero .max{ font-size:15px; color:var(--ink-faint); font-weight:700; }

  .mode-toggle{
    font-size:12px; color:var(--purple); font-weight:700; cursor:pointer; background:none; border:none; padding:0;
    text-decoration:underline; text-underline-offset:2px;
  }

  .rubric-list{ display:flex; flex-direction:column; gap:14px; margin-top:14px; }
  .rubric-row{ }
  .rubric-row-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
  .rubric-row-head .name{ font-size:13.5px; font-weight:700; }
  .rubric-row-head .desc{ font-size:11.5px; color:var(--ink-faint); display:block; font-weight:600; margin-top:1px; }
  .level-track{ display:flex; gap:6px; }
  .level-btn{
    flex:1; padding:8px 4px; border-radius:8px; border:1px solid var(--line);
    background:var(--paper); cursor:pointer; text-align:center;
    font-size:12px; font-weight:700; color:var(--ink-soft);
    transition:background .12s, border-color .12s, color .12s;
  }
  .level-btn:hover{ border-color:var(--purple); }
  .level-btn.selected{ background:var(--purple); border-color:var(--purple); color:white; }
  .level-label{ font-size:10.5px; color:var(--ink-faint); text-align:center; margin-top:5px; min-height:13px; font-weight:600; }

  .manual-score-block{ display:none; margin-top:14px; }
  .manual-score-block.visible{ display:block; }
  .manual-score-block input{
    width:100%; font-size:28px; font-weight:800; color:var(--purple);
    border:1px solid var(--line); border-radius:10px; padding:10px 14px;
    font-family:inherit;
  }
  .manual-score-block label{ font-size:11.5px; color:var(--ink-faint); font-weight:700; display:block; margin-bottom:6px; }

  .rubric-list.hidden{ display:none; }

  /* Feedback panel */
  .fb-tabs{ display:flex; gap:4px; background:var(--paper); border-radius:10px; padding:4px; margin-top:12px; }
  .fb-tab{
    flex:1; padding:7px 0; text-align:center; font-size:12.5px; font-weight:700;
    color:var(--ink-faint); border-radius:7px; cursor:pointer; border:none; background:none;
    display:flex; align-items:center; justify-content:center; gap:5px;
  }
  .fb-tab svg{ width:14px; height:14px; }
  .fb-tab.active{ background:var(--surface); color:var(--purple); box-shadow:0 1px 3px rgba(33,31,53,.08); }

  .fb-panel{ display:none; margin-top:13px; }
  .fb-panel.active{ display:block; }

  .fb-text textarea{
    width:100%; min-height:110px; border:1px solid var(--line); border-radius:10px;
    padding:11px 13px; font-family:inherit; font-size:13px; color:var(--ink); resize:vertical;
  }
  .fb-charcount{ font-size:11px; color:var(--ink-faint); margin-top:5px; text-align:right; }

  .record-block{
    display:flex; flex-direction:column; align-items:center; gap:10px;
    padding:22px 10px; border:1px dashed var(--line); border-radius:12px;
  }
  .record-btn{
    width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
    background:var(--coral); color:white; display:flex; align-items:center; justify-content:center;
    transition:transform .12s;
  }
  .record-btn:hover{ transform:scale(1.05); }
  .record-btn.recording{ background:var(--ink); }
  .record-btn svg{ width:20px; height:20px; }
  .record-timer{ font-size:12.5px; font-weight:700; color:var(--ink-soft); font-variant-numeric:tabular-nums; }
  .waveform{ display:flex; align-items:center; gap:2.5px; height:26px; }
  .waveform span{
    width:3px; border-radius:2px; background:var(--purple); opacity:.35;
    height:6px; transition:height .1s;
  }

  .drop-zone{
    border:1px dashed var(--line); border-radius:12px; padding:22px 12px;
    text-align:center; color:var(--ink-faint); font-size:12.5px; font-weight:600;
    cursor:pointer;
  }
  .drop-zone:hover{ border-color:var(--purple); color:var(--purple); background:var(--purple-soft); }
  .drop-zone input{ display:none; }
  .attach-list{ margin-top:10px; display:flex; flex-direction:column; gap:6px; }
  .attach-item{
    display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-soft);
    background:var(--paper); border-radius:8px; padding:7px 10px;
  }

  .panel-actions{
    display:flex; gap:10px; margin-top:4px;
  }
  .btn{
    flex:1; padding:11px 0; border-radius:10px; font-size:13.5px; font-weight:700;
    cursor:pointer; border:1px solid transparent; transition:background .15s, border-color .15s;
  }
  .btn.secondary{ background:var(--surface); border-color:var(--line); color:var(--ink-soft); }
  .btn.secondary:hover{ background:var(--paper); }
  .btn.primary{ background:var(--purple); color:white; }
  .btn.primary:hover{ background:var(--purple-dim); }

  @media (max-width: 980px){
    .workspace{ grid-template-columns:1fr; }
    .grading-col{ position:static; }
    .paper-stack::before, .paper-stack::after{ display:none; }
    .topbar{ flex-wrap:wrap; row-gap:10px; }
    .stepper{ margin-left:0; }
  }
</style>
</head>
<body>

<div class="topbar">
  <a class="brand" href="#">
    <span class="brand-mark">A</span> Akoro
  </a>
  <div class="topbar-divider"></div>
  <div class="crumb">
    <a class="crumb-back" href="akoro-submission-students.html" id="crumbBack">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      <span id="crumbClassLine">Basic Science — JSS2B</span>
    </a>
    <span class="crumb-title" id="assignmentTitle">Photosynthesis: Structure &amp; Function Quiz</span>
  </div>
  <div class="stepper">
    <span class="status-pill" id="statusPill">Ungraded</span>
    <button class="stepper-btn" id="prevBtn" aria-label="Previous submission">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <span class="stepper-count" id="stepperCount">1 of 4</span>
    <button class="stepper-btn" id="nextBtn" aria-label="Next submission">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>
</div>

<div class="workspace">

  <!-- ============ LEFT: SUBMISSION ============ -->
  <div class="submission-col">
    <div class="student-header">
      <div class="avatar" id="avatarInitials">NA</div>
      <div class="student-meta">
        <h1 id="studentName">Ngozi Adeyemi</h1>
        <p id="submissionMeta">Submitted Sept 8, 2:14 PM · On time</p>
      </div>
    </div>

    <div class="paper-stack">
      <div class="paper-card">
        <div class="toolbar" id="toolbar">
          <button class="tool-btn" data-tool="highlight" title="Highlight">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l6-6 4 4-6 6H9v-4z"/><path d="M4 20l3-3"/></svg>
            Highlight
          </button>
          <button class="tool-btn" data-tool="comment" title="Comment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 01-8.5 8.4 8.7 8.7 0 01-4-.9L3 20l1-5.3a8.4 8.4 0 01-1-4A8.4 8.4 0 0111.5 3a8.4 8.4 0 019.5 8.5z"/></svg>
            Comment
          </button>
          <button class="tool-btn" data-tool="stamp" title="Stamp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="5"/><path d="M8 20l4-4 4 4"/></svg>
            Stamp
          </button>
          <button class="tool-btn" data-tool="draw" title="Draw">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l4-1 11-11-3-3L4 17l-1 4z"/></svg>
            Draw
          </button>
          <div class="toolbar-spacer"></div>
          <button class="tool-btn undo" id="undoBtn" title="Undo last mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 010 10H8"/><path d="M7 5L3 10l4 5"/></svg>
            Undo
          </button>
        </div>

        <div class="paper-body-wrap" id="paperWrap">
          <canvas id="drawCanvas" class="inactive"></canvas>
          <div class="paper-body" id="paperBody">
            <!-- populated by JS per student -->
          </div>
        </div>
      </div>
    </div>

    <div class="comments-rail" id="commentsRail">
      <h3>Comments on this submission</h3>
      <div class="comments-empty" id="commentsEmpty">No comments yet — select the Comment tool and click anywhere on the page.</div>
    </div>
  </div>

  <!-- ============ RIGHT: GRADING ============ -->
  <div class="grading-col">

    <div class="panel">
      <div class="question-nav">
        <button class="q-nav-btn" id="qPrevBtn" aria-label="Previous question">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="q-nav-label" id="qNavLabel">Question 1 of 3</span>
        <button class="q-nav-btn" id="qNextBtn" aria-label="Next question">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="panel-head">
        <h2>Score</h2>
        <button class="mode-toggle" id="modeToggle">Enter score manually instead</button>
      </div>
      <div class="score-hero">
        <span class="num" id="scoreTotal">0</span>
        <span class="max" id="scoreMax">/ 12</span>
      </div>

      <div class="rubric-list" id="rubricList"></div>

      <div class="manual-score-block" id="manualBlock">
        <label for="manualInput">Score out of <span id="manualMax">12</span></label>
        <input type="number" id="manualInput" min="0" max="12" placeholder="0">
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>Feedback</h2>
        <span class="autosave" id="autosaveLabel">Saved 2 min ago</span>
      </div>

      <div class="fb-tabs">
        <button class="fb-tab active" data-fb="text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
          Text
        </button>
        <button class="fb-tab" data-fb="audio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>
          Audio
        </button>
        <button class="fb-tab" data-fb="video">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></svg>
          Video
        </button>
        <button class="fb-tab" data-fb="file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M6 9l6-6 6 6"/><path d="M4 21h16"/></svg>
          File
        </button>
      </div>

      <div class="fb-panel active fb-text" data-fb-panel="text">
        <textarea id="fbTextarea" maxlength="600" placeholder="Tell Ngozi what she did well and what to work on next…"></textarea>
        <div class="fb-charcount"><span id="fbCharCount">0</span>/600</div>
      </div>

      <div class="fb-panel fb-audio" data-fb-panel="audio">
        <div class="record-block">
          <button class="record-btn" id="audioRecordBtn">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="6" width="6" height="6" rx="1"/></svg>
          </button>
          <div class="waveform" id="audioWave"></div>
          <div class="record-timer" id="audioTimer">Tap to record</div>
        </div>
      </div>

      <div class="fb-panel fb-video" data-fb-panel="video">
        <div class="record-block">
          <button class="record-btn" id="videoRecordBtn">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="6" width="6" height="6" rx="1"/></svg>
          </button>
          <div class="waveform" id="videoWave"></div>
          <div class="record-timer" id="videoTimer">Tap to record a short clip</div>
        </div>
      </div>

      <div class="fb-panel fb-file" data-fb-panel="file">
        <label class="drop-zone" for="fileInput">
          Drop a file here, or click to attach<br>PDF, image, or audio up to 20MB
          <input type="file" id="fileInput">
        </label>
        <div class="attach-list" id="attachList"></div>
      </div>

      <div class="panel-actions" style="margin-top:16px;">
        <button class="btn secondary" id="mainCta">Save</button>
      </div>
    </div>

  </div>
</div>

<script>
/* ---------------- Mock data: a stack of 4 submissions ---------------- */
const students = [
  {
    initials:"NA", name:"Ngozi Adeyemi", meta:"Submitted Sept 8, 2:14 PM · On time", status:"ungraded",
    comments:[],
    questions:[
      { label:"Question 1", body:`<h2>Question 1 — Explain how a leaf is adapted for photosynthesis</h2>
        <p>The leaf is broad and flat so that it can trap as much sunlight as possible. Inside the leaf there are tiny openings called stomata which let carbon dioxide enter and oxygen leave the leaf. The leaf also has a network of veins that carry water up from the roots and carry glucose away to other parts of the plant.</p>
        <p>Chlorophyll is found inside the chloroplast and it is the substance that gives leaves their green colour. It absorbs sunlight and uses the energy to combine carbon dioxide and water into glucose and oxygen. This process is called photosynthesis and it mostly happens in the palisade layer near the top of the leaf where the most light reaches.</p>
        <p>Without enough sunlight, water, or carbon dioxide, a plant cannot make its own food and it will not grow well.</p>`, rubric:[null,null,null,null] },
      { label:"Question 2", body:`<h2>Question 2 — What would happen to a plant kept in a dark cupboard for two weeks?</h2>
        <p>The plant would slowly turn pale or yellow because it cannot make chlorophyll without light. It would also become weak and floppy because it is not making enough glucose for energy. If it stays in the dark for too long, the plant could die because photosynthesis cannot happen without sunlight.</p>`, rubric:[null,null,null,null] },
      { label:"Question 3", body:`<h2>Question 3 — List two adaptations of a leaf other than its shape, and explain their function</h2>
        <p>One adaptation is the stomata, which open and close to control the exchange of carbon dioxide and oxygen. Another adaptation is the thin waxy cuticle on top of the leaf, which reduces water loss from the leaf surface.</p>`, rubric:[null,null,null,null] },
    ]
  },
  {
    initials:"TO", name:"Tunde Okafor", meta:"Submitted Sept 8, 6:40 PM · On time", status:"ungraded",
    comments:[],
    questions:[
      { label:"Question 1", body:`<h2>Question 1 — Explain how a leaf is adapted for photosynthesis</h2>
        <p>Leaves are green because of a pigment. This pigment helps the plant use sunlight. The leaf is flat and thin so light can reach the cells inside easily. There are small holes on the underside of the leaf that let gas move in and out.</p>
        <p>Water moves up from the roots through the stem and into the leaf through tubes. The plant mixes water with carbon dioxide from the air using the energy from light to produce food and oxygen.</p>`, rubric:[null,null,null,null] },
      { label:"Question 2", body:`<h2>Question 2 — What would happen to a plant kept in a dark cupboard for two weeks?</h2>
        <p>The plant will not grow well and the leaves might change colour. It needs light to make food so without light it will get weaker.</p>`, rubric:[null,null,null,null] },
      { label:"Question 3", body:`<h2>Question 3 — List two adaptations of a leaf other than its shape, and explain their function</h2>
        <p>Stomata let air in and out. The waxy layer on the leaf stops water from escaping too fast.</p>`, rubric:[null,null,null,null] },
    ]
  },
  {
    initials:"FB", name:"Funmilayo Bello", meta:"Submitted Sept 9, 8:02 AM · 1 day late", status:"graded",
    comments:["Excellent use of scientific vocabulary throughout — well done."],
    questions:[
      { label:"Question 1", body:`<h2>Question 1 — Explain how a leaf is adapted for photosynthesis</h2>
        <p>A leaf is well adapted for photosynthesis in many ways. Firstly, its broad, flat shape increases the surface area exposed to sunlight. Secondly, the upper epidermis is transparent, allowing light to pass through to the palisade mesophyll layer, where chloroplasts are densely packed.</p>
        <p>The stomata, mostly located on the lower surface, regulate the exchange of carbon dioxide and oxygen while minimising water loss through transpiration. A network of xylem and phloem vessels within the veins transports water to the leaf and glucose away from it.</p>
        <p>Together, these adaptations allow the leaf to efficiently capture light energy and convert carbon dioxide and water into glucose through the light-dependent and light-independent reactions of photosynthesis.</p>`, rubric:[3,3,2,2] },
      { label:"Question 2", body:`<h2>Question 2 — What would happen to a plant kept in a dark cupboard for two weeks?</h2>
        <p>Without light, the plant cannot photosynthesise, so it cannot produce glucose for energy or growth. The leaves would likely turn pale yellow, a condition known as chlorosis, because chlorophyll production requires light. Over time, the plant would become weak, wilt, and eventually die if respiration continues to use up its remaining stored energy reserves.</p>`, rubric:[3,2,3,2] },
      { label:"Question 3", body:`<h2>Question 3 — List two adaptations of a leaf other than its shape, and explain their function</h2>
        <p>The stomata open and close via guard cells to regulate gas exchange and control water loss depending on environmental conditions. The waxy cuticle covering the upper epidermis reduces water loss through evaporation, helping the plant conserve water while still allowing light to pass through to the mesophyll.</p>`, rubric:[3,3,3,2] },
    ]
  },
  {
    initials:"EM", name:"Efe Momoh", meta:"Submitted Sept 9, 9:15 AM · 1 day late", status:"ungraded",
    comments:[],
    questions:[
      { label:"Question 1", body:`<h2>Question 1 — Explain how a leaf is adapted for photosynthesis</h2>
        <p>Leaf is flat so sun can reach it. Green colour help it take in light. It has small hole for air. Water go inside the leaf from root.</p>
        <p>Photosynthesis make food for the plant using sun, water and air.</p>`, rubric:[null,null,null,null] },
      { label:"Question 2", body:`<h2>Question 2 — What would happen to a plant kept in a dark cupboard for two weeks?</h2>
        <p>The plant go die because no sun.</p>`, rubric:[null,null,null,null] },
      { label:"Question 3", body:`<h2>Question 3 — List two adaptations of a leaf other than its shape, and explain their function</h2>
        <p>The leaf have hole and green colour.</p>`, rubric:[null,null,null,null] },
    ]
  }
];

const rubricDef = [
  { name:"Understanding of concept", desc:"Correctly explains the role of chlorophyll and light", max:4,
    labels:["Missing","Basic","Good","Excellent"] },
  { name:"Scientific vocabulary", desc:"Uses accurate terms: stomata, chloroplast, mesophyll…", max:3,
    labels:["None","Some","Consistent"] },
  { name:"Structure & clarity", desc:"Explanation is organised and easy to follow", max:3,
    labels:["Unclear","Adequate","Clear"] },
  { name:"Completeness", desc:"Covers all parts of the leaf's adaptation", max:2,
    labels:["Partial","Complete"] },
];
const maxTotal = rubricDef.reduce((s,r)=>s+r.max,0);

let current = 0;
let currentQuestion = 0;
let manualMode = false;
let activeTool = null;
let undoStack = [];

/* ---------------- Rubric rendering ---------------- */
const rubricListEl = document.getElementById('rubricList');
function renderRubric(){
  rubricListEl.innerHTML = "";
  rubricDef.forEach((crit, ci)=>{
    const row = document.createElement('div');
    row.className = 'rubric-row';
    const levels = Array.from({length: crit.max+1}, (_,i)=>i);
    row.innerHTML = `
      <div class="rubric-row-head">
        <div><span class="name">${crit.name}</span><span class="desc">${crit.desc}</span></div>
      </div>
      <div class="level-track">
        ${levels.map(l=>`<button class="level-btn" data-crit="${ci}" data-level="${l}">${l}</button>`).join("")}
      </div>
      <div class="level-label" data-crit-label="${ci}"></div>
    `;
    rubricListEl.appendChild(row);
  });
  rubricListEl.querySelectorAll('.level-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ci = +btn.dataset.crit, lvl = +btn.dataset.level;
      students[current].questions[currentQuestion].rubric[ci] = lvl;
      syncRubricUI();
      touchAutosave();
    });
  });
  syncRubricUI();
}
function syncRubricUI(){
  const r = students[current].questions[currentQuestion].rubric;
  rubricListEl.querySelectorAll('.rubric-row').forEach((row, ci)=>{
    row.querySelectorAll('.level-btn').forEach(btn=>{
      btn.classList.toggle('selected', +btn.dataset.level === r[ci]);
    });
    const labelEl = row.querySelector(`[data-crit-label="${ci}"]`);
    labelEl.textContent = r[ci] !== null ? rubricDef[ci].labels[r[ci]] : "";
  });
  updateTotal();
}
function updateTotal(){
  const r = students[current].questions[currentQuestion].rubric;
  const total = r.reduce((s,v)=> s + (v || 0), 0);
  document.getElementById('scoreTotal').textContent = manualMode
    ? (document.getElementById('manualInput').value || 0)
    : total;
  document.getElementById('scoreMax').textContent = `/ ${maxTotal}`;
}

/* ---------------- Manual vs rubric toggle ---------------- */
const modeToggle = document.getElementById('modeToggle');
const manualBlock = document.getElementById('manualBlock');
const manualInput = document.getElementById('manualInput');
manualInput.max = maxTotal;
document.getElementById('manualMax').textContent = maxTotal;

modeToggle.addEventListener('click', ()=>{
  manualMode = !manualMode;
  manualBlock.classList.toggle('visible', manualMode);
  rubricListEl.classList.toggle('hidden', manualMode);
  modeToggle.textContent = manualMode ? "Use rubric instead" : "Enter score manually instead";
  updateTotal();
});
manualInput.addEventListener('input', ()=>{ updateTotal(); touchAutosave(); });

/* ---------------- Feedback tabs ---------------- */
document.querySelectorAll('.fb-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.fb-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.fb-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-fb-panel="${tab.dataset.fb}"]`).classList.add('active');
  });
});

const fbTextarea = document.getElementById('fbTextarea');
fbTextarea.addEventListener('input', ()=>{
  document.getElementById('fbCharCount').textContent = fbTextarea.value.length;
  touchAutosave();
});

/* ---- record buttons (audio/video mock) ---- */
function setupRecorder(btnId, waveId, timerId){
  const btn = document.getElementById(btnId);
  const wave = document.getElementById(waveId);
  const timerEl = document.getElementById(timerId);
  for(let i=0;i<24;i++){ const bar=document.createElement('span'); wave.appendChild(bar); }
  let recording = false, seconds = 0, interval;
  btn.addEventListener('click', ()=>{
    recording = !recording;
    btn.classList.toggle('recording', recording);
    if(recording){
      seconds = 0;
      timerEl.textContent = "0:00";
      interval = setInterval(()=>{
        seconds++;
        const m = Math.floor(seconds/60), s = String(seconds%60).padStart(2,'0');
        timerEl.textContent = `${m}:${s}`;
        wave.querySelectorAll('span').forEach(bar=>{
          bar.style.height = (4 + Math.random()*22) + 'px';
          bar.style.opacity = .5 + Math.random()*.5;
        });
      }, 200);
      touchAutosave();
    } else {
      clearInterval(interval);
      timerEl.textContent = `Recorded ${timerEl.textContent}`;
      wave.querySelectorAll('span').forEach(bar=>{ bar.style.height='6px'; bar.style.opacity=.35; });
    }
  });
}
setupRecorder('audioRecordBtn','audioWave','audioTimer');
setupRecorder('videoRecordBtn','videoWave','videoTimer');

/* ---- file attach ---- */
const fileInput = document.getElementById('fileInput');
const attachList = document.getElementById('attachList');
fileInput.addEventListener('change', ()=>{
  attachList.innerHTML = "";
  Array.from(fileInput.files).forEach(f=>{
    const item = document.createElement('div');
    item.className = 'attach-item';
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M6 9l6-6 6 6"/><path d="M4 21h16"/></svg>
      ${f.name}`;
    attachList.appendChild(item);
  });
  touchAutosave();
});

/* ---------------- Autosave label ---------------- */
let autosaveTimeout;
function touchAutosave(){
  const label = document.getElementById('autosaveLabel');
  label.textContent = "Saving…";
  label.classList.add('saving');
  clearTimeout(autosaveTimeout);
  autosaveTimeout = setTimeout(()=>{
    label.textContent = "Saved just now";
    label.classList.remove('saving');
  }, 700);
}

document.getElementById('mainCta').addEventListener('click', ()=>{
  touchAutosave();
  const total = students[current].questions.length;
  if(currentQuestion < total - 1){
    currentQuestion++;
    loadQuestion();
  } else {
    students[current].status = "graded";
    document.getElementById('statusPill').textContent = "Graded";
    document.getElementById('statusPill').className = "status-pill graded";
  }
});

document.getElementById('qPrevBtn').addEventListener('click', ()=>{
  if(currentQuestion > 0){ currentQuestion--; loadQuestion(); }
});
document.getElementById('qNextBtn').addEventListener('click', ()=>{
  const total = students[current].questions.length;
  if(currentQuestion < total - 1){ currentQuestion++; loadQuestion(); }
});

function updateCtaLabel(){
  const total = students[current].questions.length;
  const isLast = currentQuestion === total - 1;
  const btn = document.getElementById('mainCta');
  btn.textContent = isLast ? "Publish grade" : "Save";
  btn.classList.toggle('primary', isLast);
  btn.classList.toggle('secondary', !isLast);
}

function loadQuestion(){
  const q = students[current].questions[currentQuestion];
  const total = students[current].questions.length;
  paperBody.innerHTML = q.body;
  document.getElementById('qNavLabel').textContent = `Question ${currentQuestion+1} of ${total}`;
  document.getElementById('qPrevBtn').disabled = currentQuestion === 0;
  document.getElementById('qNextBtn').disabled = currentQuestion === total - 1;

  manualMode = false;
  manualBlock.classList.remove('visible');
  rubricListEl.classList.remove('hidden');
  modeToggle.textContent = "Enter score manually instead";
  manualInput.value = "";

  document.querySelectorAll('.comment-pin, .stamp-mark, .comment-popover, .stamp-picker').forEach(n=>n.remove());
  strokes = [];

  renderRubric();
  updateCtaLabel();
  setTimeout(resizeCanvas, 30);
}

/* ---------------- Annotation tools ---------------- */
const toolbar = document.getElementById('toolbar');
const paperWrap = document.getElementById('paperWrap');
const paperBody = document.getElementById('paperBody');
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

toolbar.querySelectorAll('.tool-btn[data-tool]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tool = btn.dataset.tool;
    if(activeTool === tool){
      activeTool = null;
    } else {
      activeTool = tool;
    }
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
      b.classList.toggle('active', b.dataset.tool === activeTool);
    });
    canvas.classList.toggle('inactive', activeTool !== 'draw');
    paperBody.style.cursor = activeTool === 'comment' || activeTool === 'stamp' ? 'crosshair' : 'text';
  });
});

document.getElementById('undoBtn').addEventListener('click', ()=>{
  const last = undoStack.pop();
  if(!last) return;
  if(last.type === 'stroke'){ redrawCanvas(); }
  else if(last.el){ last.el.remove(); }
  if(last.type === 'comment') renderCommentsRail();
});

/* Highlight: wrap selection on mouseup when Highlight tool active */
paperBody.addEventListener('mouseup', ()=>{
  if(activeTool !== 'highlight') return;
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if(!paperBody.contains(range.commonAncestorContainer)) return;
  try{
    const mark = document.createElement('mark');
    range.surroundContents(mark);
    undoStack.push({type:'highlight', el:mark});
  }catch(e){ /* multi-element selection, skip for prototype */ }
  sel.removeAllRanges();
});

/* Comment: click to place a pin + popover */
paperWrap.addEventListener('click', (e)=>{
  if(activeTool === 'comment'){
    if(e.target.closest('.comment-pin') || e.target.closest('.comment-popover')) return;
    const rect = paperWrap.getBoundingClientRect();
    const x = e.clientX - rect.left + paperWrap.scrollLeft;
    const y = e.clientY - rect.top + paperWrap.scrollTop;
    openCommentComposer(x, y);
  } else if(activeTool === 'stamp'){
    if(e.target.closest('.stamp-picker')) return;
    const rect = paperWrap.getBoundingClientRect();
    const x = e.clientX - rect.left + paperWrap.scrollLeft;
    const y = e.clientY - rect.top + paperWrap.scrollTop;
    openStampPicker(x, y);
  }
});

function openCommentComposer(x, y){
  document.querySelectorAll('.comment-popover, .stamp-picker').forEach(n=>n.remove());
  const pop = document.createElement('div');
  pop.className = 'comment-popover';
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  pop.innerHTML = `
    <textarea placeholder="Add a comment…" autofocus></textarea>
    <div class="row">
      <button class="mini-btn ghost" data-act="cancel">Cancel</button>
      <button class="mini-btn primary" data-act="add">Add</button>
    </div>`;
  paperWrap.appendChild(pop);
  pop.querySelector('textarea').focus();
  pop.querySelector('[data-act="cancel"]').addEventListener('click', ()=> pop.remove());
  pop.querySelector('[data-act="add"]').addEventListener('click', ()=>{
    const text = pop.querySelector('textarea').value.trim();
    pop.remove();
    if(!text) return;
    const n = (paperWrap.querySelectorAll('.comment-pin').length) + 1;
    const pin = document.createElement('div');
    pin.className = 'comment-pin';
    pin.style.left = x + 'px';
    pin.style.top = y + 'px';
    pin.textContent = n;
    pin.title = text;
    paperWrap.appendChild(pin);
    undoStack.push({type:'comment', el:pin, text});
    students[current].comments = students[current].comments || [];
    students[current].comments.push(text);
    renderCommentsRail();
    touchAutosave();
  });
}

function openStampPicker(x, y){
  document.querySelectorAll('.comment-popover, .stamp-picker').forEach(n=>n.remove());
  const picker = document.createElement('div');
  picker.className = 'stamp-picker';
  picker.style.left = x + 'px';
  picker.style.top = y + 'px';
  const opts = ['✅','⭐','🔁'];
  picker.innerHTML = opts.map(o=>`<button class="stamp-opt">${o}</button>`).join('');
  paperWrap.appendChild(picker);
  picker.querySelectorAll('.stamp-opt').forEach((b,i)=>{
    b.addEventListener('click', ()=>{
      const stamp = document.createElement('div');
      stamp.className = 'stamp-mark';
      stamp.style.left = x + 'px';
      stamp.style.top = y + 'px';
      stamp.textContent = opts[i];
      paperWrap.appendChild(stamp);
      undoStack.push({type:'stamp', el:stamp});
      picker.remove();
      touchAutosave();
    });
  });
  setTimeout(()=>{
    document.addEventListener('click', function close(ev){
      if(!picker.contains(ev.target)){ picker.remove(); document.removeEventListener('click', close); }
    });
  });
}

function renderCommentsRail(){
  const rail = document.getElementById('commentsRail');
  const list = students[current].comments || [];
  const existingItems = rail.querySelectorAll('.comment-item');
  existingItems.forEach(n=>n.remove());
  document.getElementById('commentsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach((text,i)=>{
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.innerHTML = `<span class="dot">${i+1}</span><p>${text}</p>`;
    rail.appendChild(item);
  });
}

/* ---- Draw tool (freehand on canvas) ---- */
let drawing = false;
let strokes = [];
function resizeCanvas(){
  const rect = paperBody.parentElement.getBoundingClientRect();
  canvas.width = paperWrap.scrollWidth;
  canvas.height = paperWrap.scrollHeight;
  redrawCanvas();
}
function redrawCanvas(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#E4572E';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach(stroke=>{
    ctx.beginPath();
    stroke.forEach((pt,i)=> i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y));
    ctx.stroke();
  });
}
canvas.addEventListener('pointerdown', (e)=>{
  if(activeTool !== 'draw') return;
  drawing = true;
  const rect = canvas.getBoundingClientRect();
  const pt = {x:e.clientX-rect.left, y:e.clientY-rect.top};
  strokes.push([pt]);
});
canvas.addEventListener('pointermove', (e)=>{
  if(!drawing) return;
  const rect = canvas.getBoundingClientRect();
  const pt = {x:e.clientX-rect.left, y:e.clientY-rect.top};
  strokes[strokes.length-1].push(pt);
  redrawCanvas();
});
window.addEventListener('pointerup', ()=>{
  if(drawing){
    drawing = false;
    undoStack.push({type:'stroke'});
  }
});
// override undo for strokes specifically
document.getElementById('undoBtn').addEventListener('click', ()=>{
  const last = undoStack[undoStack.length-1];
  if(last && last.type === 'stroke'){ strokes.pop(); }
});

/* ---------------- Student navigation ---------------- */
function loadStudent(i){
  current = i;
  const s = students[i];
  document.getElementById('avatarInitials').textContent = s.initials;
  document.getElementById('studentName').textContent = s.name;
  document.getElementById('submissionMeta').textContent = s.meta;
  document.getElementById('stepperCount').textContent = `${i+1} of ${students.length}`;
  document.getElementById('prevBtn').disabled = i === 0;
  document.getElementById('nextBtn').disabled = i === students.length-1;
  const pill = document.getElementById('statusPill');
  pill.textContent = s.status === 'graded' ? 'Graded' : 'Ungraded';
  pill.className = 'status-pill ' + (s.status === 'graded' ? 'graded' : 'ungraded');

  paperBody.innerHTML = "";
  document.querySelectorAll('.comment-pin, .stamp-mark, .comment-popover, .stamp-picker').forEach(n=>n.remove());
  strokes = [];
  undoStack = [];
  activeTool = null;
  toolbar.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.remove('active'));
  canvas.classList.add('inactive');

  currentQuestion = 0;
  loadQuestion();
  renderCommentsRail();
}

document.getElementById('prevBtn').addEventListener('click', ()=>{ if(current>0) loadStudent(current-1); });
document.getElementById('nextBtn').addEventListener('click', ()=>{ if(current<students.length-1) loadStudent(current+1); });

/* ---------------- Incoming link from the Student Roster page ---------------- */
function applyActivityFromQuery(){
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title');
  const cls = params.get('cls');
  const subject = params.get('subject');
  const activity = params.get('activity');
  if(title){ document.getElementById('assignmentTitle').textContent = title; }
  if(cls || subject){
    document.getElementById('crumbClassLine').textContent =
      [subject, cls].filter(Boolean).join(' — ');
  }

  const back = new URLSearchParams();
  if(activity) back.set('activity', activity);
  if(title) back.set('title', title);
  if(cls) back.set('cls', cls);
  if(subject) back.set('subject', subject);
  const qs = back.toString();
  document.getElementById('crumbBack').href = 'akoro-submission-students.html' + (qs ? '?' + qs : '');

  const studentParam = params.get('student');
  const idx = studentParam !== null && !isNaN(+studentParam)
    ? Math.min(Math.max(+studentParam, 0), students.length - 1)
    : 0;
  return idx;
}

window.addEventListener('resize', resizeCanvas);
loadStudent(applyActivityFromQuery());
</script>
</body>
</html>



‎<!DOCTYPE html>
‎<html lang="en">
‎<head>
‎<meta charset="UTF-8">
‎<meta name="viewport" content="width=device-width, initial-scale=1.0">
‎<title>Akoro Instructor — Submissions</title>
‎<link rel="preconnect" href="https://fonts.googleapis.com">
‎<link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">
‎<style>
‎  :root{
‎    --paper:#F7F6F3;
‎    --ink:#211F35;
‎    --ink-soft:#5B5876;
‎    --ink-faint:#8B88A3;
‎    --purple:#6C3BFF;
‎    --purple-dim:#5A2FE0;
‎    --purple-soft:#F1ECFF;
‎    --coral:#E4572E;
‎    --coral-soft:#FCE9E2;
‎    --green:#1F9D66;
‎    --green-soft:#E6F6EE;
‎    --line:#E1DEEA;
‎    --surface:#FFFFFF;
‎    --bg:#F1EFF6;
‎    --shadow-paper: 0 1px 2px rgba(33,31,53,0.04), 0 12px 28px -12px rgba(33,31,53,0.18);
‎  }
‎  *{box-sizing:border-box;}
‎  html,body{margin:0;padding:0;}
‎  body{
‎    background:var(--bg); color:var(--ink);
‎    font-family:'Nunito', sans-serif; -webkit-font-smoothing:antialiased;
‎  }
‎  a{color:inherit; text-decoration:none;}
‎  button{font-family:inherit;}
‎  :focus-visible{outline:2.5px solid var(--purple); outline-offset:2px;}
‎  @media (prefers-reduced-motion: reduce){ *{animation-duration:.001ms !important; transition-duration:.001ms !important;} }
‎
‎  /* ---------- Top bar ---------- */
‎  .topbar{
‎    display:flex; align-items:center; gap:26px;
‎    padding:14px 24px; background:var(--surface); border-bottom:1px solid var(--line);
‎    position:sticky; top:0; z-index:40;
‎  }
‎  .brand{ display:flex; align-items:center; gap:9px; font-weight:800; font-size:16px; letter-spacing:-0.01em; color:var(--purple); flex-shrink:0; }
‎  .brand-mark{ width:26px; height:26px; border-radius:8px; background:var(--purple); display:flex; align-items:center; justify-content:center; color:white; font-size:14px; font-weight:800; }
‎  .topbar-nav{ display:flex; gap:22px; }
‎  .topbar-nav a{
‎    font-size:13.5px; font-weight:700; color:var(--ink-faint); padding:6px 0; border-bottom:2px solid transparent;
‎  }
‎  .topbar-nav a.active{ color:var(--purple); border-bottom-color:var(--purple); }
‎  .topbar-right{ margin-left:auto; display:flex; align-items:center; gap:10px; }
‎  .avatar-sm{
‎    width:32px; height:32px; border-radius:50%; background:var(--purple-soft); color:var(--purple-dim);
‎    display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12.5px;
‎  }
‎
‎  /* ---------- Page header ---------- */
‎  .page{ max-width:980px; margin:0 auto; padding:30px 24px 70px; }
‎  .page-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; flex-wrap:wrap; }
‎  .page-head h1{ font-size:22px; margin:0 0 4px; font-weight:800; letter-spacing:-0.01em; }
‎  .page-head p{ margin:0; font-size:13px; color:var(--ink-faint); font-weight:600; }
‎  .head-actions{ display:flex; gap:10px; align-items:center; }
‎
‎  select.class-select{
‎    font-family:inherit; font-size:13px; font-weight:700; color:var(--ink-soft);
‎    background:var(--surface); border:1px solid var(--line); border-radius:9px; padding:9px 30px 9px 12px;
‎    cursor:pointer; appearance:none;
‎    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B5876' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>");
‎    background-repeat:no-repeat; background-position:right 9px center; background-size:14px;
‎  }
‎  .btn-new{
‎    display:flex; align-items:center; gap:6px;
‎    background:var(--purple); color:white; font-size:13px; font-weight:700;
‎    border:none; border-radius:9px; padding:9px 15px; cursor:pointer;
‎  }
‎  .btn-new:hover{ background:var(--purple-dim); }
‎  .btn-new svg{ width:15px; height:15px; }
‎
‎  /* ---------- Filter tabs ---------- */
‎  .filter-tabs{ display:flex; gap:4px; background:var(--paper); border-radius:10px; padding:4px; width:fit-content; margin-bottom:18px; }
‎  .filter-tab{
‎    padding:8px 16px; border-radius:7px; font-size:13px; font-weight:700; color:var(--ink-faint);
‎    border:none; background:none; cursor:pointer; display:flex; align-items:center; gap:7px;
‎  }
‎  .filter-tab.active{ background:var(--surface); color:var(--purple); box-shadow:0 1px 3px rgba(33,31,53,.08); }
‎  .filter-tab .count{
‎    font-size:11px; background:var(--line); color:var(--ink-soft); border-radius:999px; padding:1px 7px; font-weight:800;
‎  }
‎  .filter-tab.active .count{ background:var(--purple-soft); color:var(--purple); }
‎
‎  /* ---------- Activity list ---------- */
‎  .activity-list{ background:var(--surface); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
‎  .activity-row{
‎    display:flex; align-items:center; gap:16px; padding:16px 18px;
‎    border-bottom:1px solid var(--line); cursor:pointer; background:var(--surface);
‎    transition:background .12s;
‎  }
‎  .activity-row:last-child{ border-bottom:none; }
‎  .activity-row:hover{ background:var(--paper); }
‎  .activity-row:hover .chevron{ transform:translateX(2px); color:var(--purple); }
‎
‎  .type-chip{
‎    width:42px; height:42px; border-radius:11px; background:var(--purple-soft); color:var(--purple-dim);
‎    display:flex; align-items:center; justify-content:center; flex-shrink:0;
‎  }
‎  .type-chip svg{ width:19px; height:19px; }
‎
‎  .activity-info{ flex:1; min-width:0; }
‎  .activity-info .title{ font-size:14.5px; font-weight:700; margin:0 0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
‎  .activity-info .meta{ font-size:12px; color:var(--ink-faint); font-weight:600; }
‎  .activity-info .meta .dot{ margin:0 6px; opacity:.6; }
‎  .due-soon{ color:var(--coral); }
‎
‎  .progress-block{ width:200px; flex-shrink:0; }
‎  .progress-bar{ display:flex; height:6px; border-radius:4px; overflow:hidden; background:var(--line); }
‎  .progress-bar span{ height:100%; }
‎  .seg-graded{ background:var(--green); }
‎  .seg-pending{ background:var(--coral); }
‎  .progress-label{ font-size:11px; color:var(--ink-faint); font-weight:600; margin-top:6px; }
‎
‎  .score-block{ width:64px; text-align:right; flex-shrink:0; }
‎  .score-block .val{ font-size:15px; font-weight:800; color:var(--purple); }
‎  .score-block .val.empty{ color:var(--ink-faint); font-weight:700; font-size:13px; }
‎  .score-block .lbl{ font-size:10.5px; color:var(--ink-faint); font-weight:600; margin-top:1px; }
‎
‎  .chevron{ color:var(--ink-faint); flex-shrink:0; transition:transform .12s, color .12s; }
‎  .chevron svg{ width:16px; height:16px; }
‎
‎  .empty-state{ padding:50px 20px; text-align:center; color:var(--ink-faint); font-size:13.5px; font-weight:600; }
‎
‎  @media (max-width: 720px){
‎    .progress-block{ display:none; }
‎    .topbar-nav{ display:none; }
‎    .page-head{ flex-direction:column; align-items:flex-start; }
‎  }
‎</style>
‎</head>
‎<body>
‎
‎<div class="topbar">
‎  <a class="brand" href="#"><span class="brand-mark">A</span> Akoro</a>
‎  <nav class="topbar-nav">
‎    <a href="#" class="active">Submissions</a>
‎    <a href="#">Gradebook</a>
‎    <a href="#">Students</a>
‎  </nav>
‎  <div class="topbar-right">
‎    <div class="avatar-sm">MO</div>
‎  </div>
‎</div>
‎
‎<div class="page">
‎  <div class="page-head">
‎    <div>
‎      <h1>Submissions</h1>
‎      <p id="pageSubtitle">Student work that's been turned in and is ready to grade</p>
‎    </div>
‎    <div class="head-actions">
‎      <select class="class-select" id="classSelect">
‎        <option value="all">All classes</option>
‎        <option value="JSS2A">JSS2A</option>
‎        <option value="JSS2B">JSS2B</option>
‎      </select>
‎    </div>
‎  </div>
‎
‎  <div class="filter-tabs" id="filterTabs">
‎    <button class="filter-tab active" data-filter="all">All <span class="count" id="countAll">0</span></button>
‎    <button class="filter-tab" data-filter="pending">To grade <span class="count" id="countPending">0</span></button>
‎    <button class="filter-tab" data-filter="graded">Graded <span class="count" id="countGraded">0</span></button>
‎  </div>
‎
‎  <div class="activity-list" id="activityList"></div>
‎</div>
‎
‎<script>
‎const ICONS = {
‎  quiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 1.8-2.5 3.5"/><circle cx="12" cy="16.8" r=".3" fill="currentColor"/></svg>`,
‎  assignment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3h6l4 4v14H8z"/><path d="M14 3v4h4M10 12h6M10 16h6"/></svg>`,
‎  exam: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
‎};
‎
‎const activities = [
‎  { id:1, title:"Photosynthesis: Structure & Function Quiz", type:"quiz", cls:"JSS2B", subject:"Basic Science", due:"Sept 8", dueSoon:false, total:24, submitted:23, graded:4, avg:null },
‎  { id:2, title:"States of Matter — Worksheet 4", type:"assignment", cls:"JSS2B", subject:"Basic Science", due:"Sept 10", dueSoon:true, total:24, submitted:12, graded:0, avg:null },
‎  { id:3, title:"Mid-Term Practical: Simple Machines", type:"exam", cls:"JSS2A", subject:"Basic Science", due:"Sept 3", dueSoon:false, total:28, submitted:28, graded:28, avg:74 },
‎  { id:4, title:"Human Digestive System — Diagram Labelling", type:"assignment", cls:"JSS2A", subject:"Basic Science", due:"Aug 29", dueSoon:false, total:28, submitted:26, graded:26, avg:81 },
‎  { id:5, title:"Forces & Motion Pop Quiz", type:"quiz", cls:"JSS2B", subject:"Basic Science", due:"Sept 11", dueSoon:true, total:24, submitted:6, graded:0, avg:null },
‎  { id:6, title:"Ecosystems Field Report", type:"assignment", cls:"JSS2A", subject:"Basic Science", due:"Sept 5", dueSoon:false, total:28, submitted:19, graded:9, avg:null },
‎  { id:7, title:"Simple Circuits Lab Report", type:"assignment", cls:"JSS2B", subject:"Basic Science", due:"Sept 15", dueSoon:false, total:24, submitted:0, graded:0, avg:null },
‎];
‎
‎const submitted = activities.filter(a=> a.submitted > 0);
‎
‎let currentFilter = "all";
‎let currentClass = "all";
‎
‎function statusOf(a){
‎  if(a.submitted === 0) return "none";
‎  if(a.graded >= a.submitted) return "graded";
‎  return "pending";
‎}
‎
‎function render(){
‎  const filtered = submitted.filter(a=>{
‎    const classOk = currentClass === "all" || a.cls === currentClass;
‎    if(!classOk) return false;
‎    if(currentFilter === "all") return true;
‎    return statusOf(a) === currentFilter;
‎  });
‎
‎  document.getElementById('countAll').textContent = submitted.filter(a=> currentClass==="all"||a.cls===currentClass).length;
‎  document.getElementById('countPending').textContent = submitted.filter(a=> (currentClass==="all"||a.cls===currentClass) && statusOf(a)==="pending").length;
‎  document.getElementById('countGraded').textContent = submitted.filter(a=> (currentClass==="all"||a.cls===currentClass) && statusOf(a)==="graded").length;
‎
‎  const list = document.getElementById('activityList');
‎  list.innerHTML = "";
‎
‎  if(filtered.length === 0){
‎    list.innerHTML = `<div class="empty-state">No submissions here yet — try a different filter or class.</div>`;
‎    return;
‎  }
‎
‎  filtered.forEach(a=>{
‎    const pendingCount = a.submitted - a.graded;
‎    const notSubmitted = a.total - a.submitted;
‎    const gradedPct = (a.graded / a.total) * 100;
‎    const pendingPct = (pendingCount / a.total) * 100;
‎
‎    const row = document.createElement('a');
‎    row.className = 'activity-row';
‎    row.href = `akoro-submission-students.html?activity=${a.id}&title=${encodeURIComponent(a.title)}&cls=${encodeURIComponent(a.cls)}&subject=${encodeURIComponent(a.subject)}`;
‎
‎    row.innerHTML = `
‎      <div class="type-chip">${ICONS[a.type]}</div>
‎      <div class="activity-info">
‎        <p class="title">${a.title}</p>
‎        <p class="meta">${a.subject} · ${a.cls}<span class="dot">·</span><span class="${a.dueSoon ? 'due-soon' : ''}">Due ${a.due}</span></p>
‎      </div>
‎      <div class="progress-block">
‎        <div class="progress-bar">
‎          <span class="seg-graded" style="width:${gradedPct}%"></span>
‎          <span class="seg-pending" style="width:${pendingPct}%"></span>
‎        </div>
‎        <div class="progress-label">${a.graded} graded · ${pendingCount} to grade · ${notSubmitted} not submitted</div>
‎      </div>
‎      <div class="score-block">
‎        ${a.avg !== null
‎          ? `<div class="val">${a.avg}%</div><div class="lbl">average</div>`
‎          : `<div class="val empty">—</div><div class="lbl">no grades yet</div>`}
‎      </div>
‎      <div class="chevron">
‎        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
‎      </div>
‎    `;
‎    list.appendChild(row);
‎  });
‎}
‎
‎document.getElementById('filterTabs').addEventListener('click', (e)=>{
‎  const btn = e.target.closest('.filter-tab');
‎  if(!btn) return;
‎  currentFilter = btn.dataset.filter;
‎  document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
‎  btn.classList.add('active');
‎  render();
‎});
‎
‎document.getElementById('classSelect').addEventListener('change', (e)=>{
‎  currentClass = e.target.value;
‎  render();
‎});
‎
‎render();
‎</script>
‎</body>
‎</html>
‎
‎<!DOCTYPE html>
‎<html lang="en">
‎<head>
‎<meta charset="UTF-8">
‎<meta name="viewport" content="width=device-width, initial-scale=1.0">
‎<title>Akoro Instructor — Submission Roster</title>
‎<link rel="preconnect" href="https://fonts.googleapis.com">
‎<link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">
‎<style>
‎  :root{
‎    --paper:#F7F6F3;
‎    --ink:#211F35;
‎    --ink-soft:#5B5876;
‎    --ink-faint:#8B88A3;
‎    --purple:#6C3BFF;
‎    --purple-dim:#5A2FE0;
‎    --purple-soft:#F1ECFF;
‎    --coral:#E4572E;
‎    --coral-soft:#FCE9E2;
‎    --green:#1F9D66;
‎    --green-soft:#E6F6EE;
‎    --line:#E1DEEA;
‎    --surface:#FFFFFF;
‎    --bg:#F1EFF6;
‎    --shadow-paper: 0 1px 2px rgba(33,31,53,0.04), 0 12px 28px -12px rgba(33,31,53,0.18);
‎  }
‎  *{box-sizing:border-box;}
‎  html,body{margin:0;padding:0;}
‎  body{ background:var(--bg); color:var(--ink); font-family:'Nunito', sans-serif; -webkit-font-smoothing:antialiased; }
‎  a{color:inherit; text-decoration:none;}
‎  button{font-family:inherit;}
‎  :focus-visible{outline:2.5px solid var(--purple); outline-offset:2px;}
‎  @media (prefers-reduced-motion: reduce){ *{animation-duration:.001ms !important; transition-duration:.001ms !important;} }
‎
‎  /* ---------- Top bar ---------- */
‎  .topbar{
‎    display:flex; align-items:center; gap:20px;
‎    padding:14px 24px; background:var(--surface); border-bottom:1px solid var(--line);
‎    position:sticky; top:0; z-index:40;
‎  }
‎  .brand{ display:flex; align-items:center; gap:9px; font-weight:800; font-size:16px; letter-spacing:-0.01em; color:var(--purple); flex-shrink:0; }
‎  .brand-mark{ width:26px; height:26px; border-radius:8px; background:var(--purple); display:flex; align-items:center; justify-content:center; color:white; font-size:14px; font-weight:800; }
‎  .topbar-divider{ width:1px; height:26px; background:var(--line); flex-shrink:0; }
‎  .crumb-back{
‎    font-size:12.5px; color:var(--ink-faint); text-decoration:none;
‎    display:flex; align-items:center; gap:4px;
‎  }
‎  .crumb-back:hover{ color:var(--ink-soft); }
‎
‎  /* ---------- Page ---------- */
‎  .page{ max-width:900px; margin:0 auto; padding:28px 24px 70px; }
‎
‎  .assignment-card{
‎    background:var(--surface); border:1px solid var(--line); border-radius:14px;
‎    padding:20px 22px; margin-bottom:22px;
‎    display:flex; align-items:center; gap:18px; flex-wrap:wrap;
‎  }
‎  .assignment-icon{
‎    width:48px; height:48px; border-radius:12px; background:var(--purple-soft); color:var(--purple-dim);
‎    display:flex; align-items:center; justify-content:center; flex-shrink:0;
‎  }
‎  .assignment-icon svg{ width:22px; height:22px; }
‎  .assignment-info{ flex:1; min-width:220px; }
‎  .assignment-info h1{ font-size:17px; margin:0 0 4px; font-weight:800; letter-spacing:-0.01em; }
‎  .assignment-info p{ margin:0; font-size:12.5px; color:var(--ink-faint); font-weight:600; }
‎  .assignment-stats{ display:flex; gap:22px; flex-shrink:0; }
‎  .stat{ text-align:center; }
‎  .stat .n{ font-size:19px; font-weight:800; color:var(--ink); display:block; }
‎  .stat .n.coral{ color:var(--coral); }
‎  .stat .n.green{ color:var(--green); }
‎  .stat .l{ font-size:10.5px; color:var(--ink-faint); font-weight:700; }
‎
‎  .filter-tabs{ display:flex; gap:4px; background:var(--paper); border-radius:10px; padding:4px; width:fit-content; margin-bottom:16px; }
‎  .filter-tab{
‎    padding:8px 16px; border-radius:7px; font-size:13px; font-weight:700; color:var(--ink-faint);
‎    border:none; background:none; cursor:pointer; display:flex; align-items:center; gap:7px;
‎  }
‎  .filter-tab.active{ background:var(--surface); color:var(--purple); box-shadow:0 1px 3px rgba(33,31,53,.08); }
‎  .filter-tab .count{ font-size:11px; background:var(--line); color:var(--ink-soft); border-radius:999px; padding:1px 7px; font-weight:800; }
‎  .filter-tab.active .count{ background:var(--purple-soft); color:var(--purple); }
‎
‎  .student-list{ background:var(--surface); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
‎  .student-row{
‎    display:flex; align-items:center; gap:14px; padding:14px 18px;
‎    border-bottom:1px solid var(--line); cursor:pointer; background:var(--surface);
‎    transition:background .12s;
‎  }
‎  .student-row:last-child{ border-bottom:none; }
‎  .student-row:hover{ background:var(--paper); }
‎  .student-row:hover .chevron{ transform:translateX(2px); color:var(--purple); }
‎
‎  .avatar{
‎    width:38px; height:38px; border-radius:50%; background:var(--purple-soft); color:var(--purple-dim);
‎    display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; flex-shrink:0;
‎  }
‎  .student-info{ flex:1; min-width:0; }
‎  .student-info .name{ font-size:14px; font-weight:700; margin:0 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
‎  .student-info .meta{ font-size:12px; color:var(--ink-faint); font-weight:600; }
‎
‎  .status-pill{ font-size:11.5px; font-weight:700; padding:5px 11px; border-radius:999px; white-space:nowrap; flex-shrink:0; }
‎  .status-pill.graded{ background:var(--green-soft); color:var(--green); }
‎  .status-pill.ungraded{ background:var(--coral-soft); color:var(--coral); }
‎
‎  .score-block{ width:56px; text-align:right; flex-shrink:0; }
‎  .score-block .val{ font-size:14px; font-weight:800; color:var(--purple); }
‎  .score-block .val.empty{ color:var(--ink-faint); font-weight:700; font-size:13px; }
‎
‎  .chevron{ color:var(--ink-faint); flex-shrink:0; transition:transform .12s, color .12s; }
‎  .chevron svg{ width:15px; height:15px; }
‎
‎  @media (max-width: 640px){
‎    .assignment-card{ flex-direction:column; align-items:flex-start; }
‎    .assignment-stats{ width:100%; justify-content:space-between; }
‎  }
‎</style>
‎</head>
‎<body>
‎
‎<div class="topbar">
‎  <a class="brand" href="#"><span class="brand-mark">A</span> Akoro</a>
‎  <div class="topbar-divider"></div>
‎  <a class="crumb-back" href="akoro-submissions-list.html" id="crumbBack">
‎    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
‎    Back to submissions
‎  </a>
‎</div>
‎
‎<div class="page">
‎
‎  <div class="assignment-card">
‎    <div class="assignment-icon">
‎      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 1.8-2.5 3.5"/><circle cx="12" cy="16.8" r=".3" fill="currentColor"/></svg>
‎    </div>
‎    <div class="assignment-info">
‎      <h1 id="assignmentTitle">Photosynthesis: Structure &amp; Function Quiz</h1>
‎      <p id="assignmentMeta">Basic Science — JSS2B · Due Sept 8</p>
‎    </div>
‎    <div class="assignment-stats">
‎      <div class="stat"><span class="n" id="statSubmitted">4</span><span class="l">SUBMITTED</span></div>
‎      <div class="stat"><span class="n coral" id="statPending">3</span><span class="l">TO GRADE</span></div>
‎      <div class="stat"><span class="n green" id="statGraded">1</span><span class="l">GRADED</span></div>
‎    </div>
‎  </div>
‎
‎  <div class="filter-tabs" id="filterTabs">
‎    <button class="filter-tab active" data-filter="all">All <span class="count" id="countAll">0</span></button>
‎    <button class="filter-tab" data-filter="pending">To grade <span class="count" id="countPending">0</span></button>
‎    <button class="filter-tab" data-filter="graded">Graded <span class="count" id="countGraded">0</span></button>
‎  </div>
‎
‎  <div class="student-list" id="studentList"></div>
‎
‎</div>
‎
‎<script>
‎const roster = [
‎  { index:0, initials:"NA", name:"Ngozi Adeyemi", meta:"Submitted Sept 8, 2:14 PM · On time", status:"ungraded", score:null },
‎  { index:1, initials:"TO", name:"Tunde Okafor", meta:"Submitted Sept 8, 6:40 PM · On time", status:"ungraded", score:null },
‎  { index:2, initials:"FB", name:"Funmilayo Bello", meta:"Submitted Sept 9, 8:02 AM · 1 day late", status:"graded", score:83 },
‎  { index:3, initials:"EM", name:"Efe Momoh", meta:"Submitted Sept 9, 9:15 AM · 1 day late", status:"ungraded", score:null },
‎];
‎
‎let currentFilter = "all";
‎let activityParams = { activity:"", title:"", cls:"", subject:"" };
‎
‎function applyAssignmentFromQuery(){
‎  const params = new URLSearchParams(window.location.search);
‎  activityParams.activity = params.get('activity') || "";
‎  activityParams.title = params.get('title') || document.getElementById('assignmentTitle').textContent;
‎  activityParams.cls = params.get('cls') || "JSS2B";
‎  activityParams.subject = params.get('subject') || "Basic Science";
‎
‎  document.getElementById('assignmentTitle').textContent = activityParams.title;
‎  document.getElementById('assignmentMeta').textContent =
‎    `${activityParams.subject} — ${activityParams.cls} · Due Sept 8`;
‎
‎  const back = new URLSearchParams();
‎  document.getElementById('crumbBack').href = "akoro-submissions-list.html";
‎}
‎
‎function counts(){
‎  document.getElementById('countAll').textContent = roster.length;
‎  document.getElementById('countPending').textContent = roster.filter(s=>s.status==="ungraded").length;
‎  document.getElementById('countGraded').textContent = roster.filter(s=>s.status==="graded").length;
‎  document.getElementById('statSubmitted').textContent = roster.length;
‎  document.getElementById('statPending').textContent = roster.filter(s=>s.status==="ungraded").length;
‎  document.getElementById('statGraded').textContent = roster.filter(s=>s.status==="graded").length;
‎}
‎
‎function render(){
‎  const filtered = roster.filter(s=> currentFilter === "all" || s.status === currentFilter);
‎  const list = document.getElementById('studentList');
‎  list.innerHTML = "";
‎
‎  filtered.forEach(s=>{
‎    const qs = new URLSearchParams();
‎    if(activityParams.activity) qs.set('activity', activityParams.activity);
‎    qs.set('title', activityParams.title);
‎    qs.set('cls', activityParams.cls);
‎    qs.set('subject', activityParams.subject);
‎    qs.set('student', s.index);
‎
‎    const row = document.createElement('a');
‎    row.className = 'student-row';
‎    row.href = `akoro-grading-submission-prototype.html?${qs.toString()}`;
‎    row.innerHTML = `
‎      <div class="avatar">${s.initials}</div>
‎      <div class="student-info">
‎        <p class="name">${s.name}</p>
‎        <p class="meta">${s.meta}</p>
‎      </div>
‎      <span class="status-pill ${s.status}">${s.status === 'graded' ? 'Graded' : 'Ungraded'}</span>
‎      <div class="score-block">
‎        ${s.score !== null ? `<span class="val">${s.score}%</span>` : `<span class="val empty">—</span>`}
‎      </div>
‎      <div class="chevron">
‎        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
‎      </div>
‎    `;
‎    list.appendChild(row);
‎  });
‎}
‎
‎document.getElementById('filterTabs').addEventListener('click', (e)=>{
‎  const btn = e.target.closest('.filter-tab');
‎  if(!btn) return;
‎  currentFilter = btn.dataset.filter;
‎  document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
‎  btn.classList.add('active');
‎  render();
‎});
‎
‎applyAssignmentFromQuery();
‎counts();
‎render();
‎</script>
‎</body>
‎</html>
‎
‎

1.Let's create a new page in the instructors app, submissionsworkbench..



We will mirror it like our activities workbench and tools workbench 



One side, submitted activities other side rooster/students list.. then the grading will be a full page modal..

So when we select an activity, on the side we can choose the student to grade then it opens a modal of the submission for grading..



2.We will retain the instructors app UI and branding



3.just like we have a now studying component in higherEd learners app, we will add a nowgrading component to instructors app, that way when we close or network issue we can always continue.. and it should auto save until publish..

