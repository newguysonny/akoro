<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Activity Details — Preview</title>
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
    --teal:#0D9488;
    --indigo:#4338CA;

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
  html,body{ margin:0; }
  body{
    font-family:'Nunito', sans-serif;
    color: var(--ak-text);
    background:
      radial-gradient(circle, #E4E1F5 1px, transparent 1px) 0 0/22px 22px,
      var(--ak-bg);
  }

  /* ── Top nav (page identity + back navigation) — fixed, compact ── */
  .top-nav-wrap{
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100;
  }
  .accent-bar{
    height: 3px;
    background: linear-gradient(90deg, var(--brand), var(--brand-end));
  }
  .top-nav{
    display:flex;
    align-items:center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--ak-surface);
    border-bottom: 1px solid var(--ak-border2);
  }
  .back-btn{
    display:flex; align-items:center; justify-content:center;
    width: 24px; height: 24px;
    flex-shrink:0;
    border:none; background:none;
    color: var(--ak-text);
    cursor:pointer;
    padding:0;
  }
  .nav-icon{
    width: 30px; height: 30px;
    border-radius: 50%;
    background: #6C3BFF12;
    border: 2px solid var(--brand);
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .nav-icon svg{ width:14px; height:14px; }
  .nav-title{
    font-size: 13.5px;
    font-weight: 800;
    color: var(--ak-text);
    line-height: 1.2;
  }
  .nav-subtitle{
    font-size: 10.5px;
    font-weight: 700;
    color: var(--ak-text-muted);
  }

  .page{
    max-width: 760px;
    margin: 0 auto;
    padding: 58px 20px 72px;
  }

  /* ── Hero header ── */
  .hero{
    position: relative;
    overflow: hidden;
    border-radius: 24px;
    padding: 24px 24px 22px;
    margin-bottom: 22px;
    background: radial-gradient(130% 170% at 12% -10%, #8B5CF6 0%, var(--brand) 45%, var(--brand-end) 100%);
    color: #fff;
    box-shadow: 0 16px 32px -12px rgba(76, 29, 204, 0.45);
  }
  .hero-motif{
    position: absolute;
    right: -30px;
    bottom: -40px;
    width: 200px;
    height: 200px;
    opacity: 0.16;
    pointer-events: none;
  }
  .hero-top{
    display:flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    flex-wrap: wrap;
    position: relative;
  }
  .class-tag{
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding: 4px 12px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.32);
    background: rgba(255,255,255,0.14);
    color: #fff;
    font-size: 11.5px;
    font-weight: 800;
    margin-bottom: 10px;
  }
  .hero h1{
    font-size: 26px;
    font-weight: 900;
    margin: 0 0 4px;
    letter-spacing: -0.015em;
  }
  .hero .subtitle{
    font-size: 12.5px;
    font-weight: 700;
    color: rgba(255,255,255,0.75);
    margin: 0;
  }

  .history-link{
    display:inline-flex;
    align-items:center;
    gap: 3px;
    background:none;
    border:none;
    color: rgba(255,255,255,0.9);
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    padding: 4px 0;
    flex-shrink: 0;
  }
  .history-link svg{ width:14px; height:14px; }

  .hero-stats{
    display:flex;
    gap: 8px;
    margin-top: 18px;
    position: relative;
    flex-wrap: wrap;
  }
  .hero-stat{
    display:flex;
    align-items:center;
    gap: 8px;
    padding: 9px 13px;
    border-radius: 14px;
    background: rgba(255,255,255,0.14);
    border: 1px solid rgba(255,255,255,0.2);
    flex: 1;
    min-width: 108px;
  }
  .hero-stat .icon{
    width: 26px; height: 26px;
    border-radius: 8px;
    background: rgba(255,255,255,0.18);
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .hero-stat .icon svg{ width:14px; height:14px; }
  .hero-stat strong{ display:block; font-size: 15px; font-weight: 900; line-height:1.15; }
  .hero-stat span{ display:block; font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.72); }

  .hero-progress{
    margin-top: 16px;
    position: relative;
  }
  .hero-progress-label{
    display:flex; justify-content:space-between;
    font-size: 11px; font-weight: 800;
    color: rgba(255,255,255,0.8);
    margin-bottom: 6px;
  }
  .hero-progress-track{
    height: 7px;
    border-radius: 4px;
    background: rgba(255,255,255,0.18);
    overflow:hidden;
  }
  .hero-progress-fill{
    height: 100%;
    border-radius: 4px;
    background: #fff;
    width: 50%;
  }

  /* ── Filter chips ── */
  .tabs{
    display:flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 4px;
    margin-bottom: 22px;
  }
  .tabs::-webkit-scrollbar{ display:none; }
  .tab-chip{
    flex-shrink:0;
    white-space:nowrap;
    padding: 7px 15px;
    border-radius: 20px;
    border: 1px solid var(--ak-border2);
    background: var(--ak-surface);
    color: var(--ak-text-sub);
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
  }
  .tab-chip.active{
    border-color: transparent;
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    color: #fff;
    box-shadow: 0 6px 14px -4px rgba(108,59,255,0.5);
  }

  /* ── Groups ── */
  .group{ margin-bottom: 22px; }
  .group-head{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-bottom: 11px;
    padding-left: 2px;
  }
  .group-dot{
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink:0;
  }
  .group-label{
    font-size: 13px;
    font-weight: 800;
    color: var(--ak-text);
  }
  .group-count{
    font-size: 11px;
    font-weight: 800;
    color: var(--ak-text-muted);
    background: var(--ak-surface);
    border: 1px solid var(--ak-border2);
    padding: 2px 9px;
    border-radius: 10px;
    margin-left: auto;
  }

  /* ── Activity card ── */
  .activity{
    display:flex;
    gap: 11px;
    padding: 12px 13px;
    background: var(--ak-surface);
    border: none;
    border-radius: 18px;
    margin-bottom: 8px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
  }

  .icon-badge{
    flex-shrink:0;
    width: 34px; height: 34px;
    border-radius: 11px;
    display:flex; align-items:center; justify-content:center;
    border: none;
  }
  .icon-badge svg{ width:16px; height:16px; }

  /* type accents — icon tint carries the type color now (no border stripe) */
  .activity.type-assignment .icon-badge{ background:#6C3BFF14; }
  .activity.type-quiz .icon-badge{        background:#3B82F614; }
  .activity.type-project .icon-badge{     background:#F59E0B14; }
  .activity.type-reading .icon-badge{     background:#10B98114; }
  .activity.type-self-study .icon-badge{  background:#0D948814; }
  .activity.type-agent-battle .icon-badge{background:#EF444414; }
  .activity.type-multi-stage .icon-badge{ background:#4338CA14; }

  .activity .body{ flex:1; min-width:0; }

  .title-row{
    display:flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    flex-wrap: wrap;
  }
  .activity h3{
    font-size: 13.5px;
    font-weight: 800;
    margin: 0;
    color: var(--ak-text);
    line-height: 1.3;
  }

  .due-chip{
    display:inline-flex;
    align-items:center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 800;
    padding: 3px 9px;
    border-radius: 8px;
    white-space: nowrap;
    background: var(--ak-surface-hover);
    color: var(--ak-text-muted);
  }
  .due-chip.soon{ background:#F59E0B14; color:#B45309; }
  .due-chip.late{ background:#EF444414; color:#B91C1C; }

  .activity p.desc{
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ak-text-sub);
    margin: 4px 0 9px;
    line-height: 1.45;
  }

  .foot{
    display:flex;
    align-items:center;
    gap: 7px;
    flex-wrap: wrap;
  }

  .status{
    display:inline-flex;
    align-items:center;
    font-size: 10.5px;
    font-weight: 800;
    padding: 3.5px 10px;
    border-radius: 20px;
    border: none;
  }
  .status.pending{ background:#F59E0B14; color:#B45309; }
  .status.done{    background:#10B98114; color:#047857; }
  .status.review{  background:#3B82F614; color:#1D4ED8; }
  .status.late{    background:#EF444414; color:#B91C1C; }
  .status.neutral{ background: var(--ak-surface-hover); color: var(--ak-text-sub); }

  .points{
    font-size: 11px;
    font-weight: 700;
    color: var(--ak-text-muted);
  }

  .vs-chip{
    display:inline-flex;
    align-items:center;
    gap: 5px;
    font-size: 11px;
    font-weight: 800;
    color: #B91C1C;
  }
  .vs-avatar{
    width: 18px; height:18px;
    border-radius: 50%;
    background: #EF444420;
    color: #B91C1C;
    display:flex; align-items:center; justify-content:center;
    font-size: 10px;
    font-weight: 900;
  }

  .action-btn{
    margin-left: auto;
    padding: 6px 13px;
    border-radius: 20px;
    border: none;
    font-family: 'Nunito', sans-serif;
    font-size: 11.5px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
  }
  .action-btn.c-purple{ background:#6C3BFF14; color:var(--brand); }
  .action-btn.c-blue{   background:#3B82F614; color:var(--blue); }
  .action-btn.c-gold{   background:#F59E0B14; color:#B45309; }
  .action-btn.c-green{  background:#10B98114; color:#047857; }
  .action-btn.c-teal{   background:#0D948814; color:var(--teal); }
  .action-btn.c-red{    background:#EF444414; color:#B91C1C; }
  .action-btn.c-indigo{ background:#4338CA14; color:var(--indigo); }
  .action-btn.primary{
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    color: #fff;
    box-shadow: 0 6px 14px -5px rgba(108,59,255,0.55);
  }

  /* multi-stage summary progress bar */
  .stage-tag{
    display:inline-flex;
    align-items:center;
    gap:5px;
    padding: 4px 11px;
    border-radius: 20px;
    background: #4338CA14;
    color: #4338CA;
    font-size: 11px;
    font-weight: 800;
  }
  .stage-progress-wrap{
    display:flex;
    align-items:center;
    gap: 8px;
    margin: 2px 0 11px;
  }
  .stage-progress-track{
    flex:1;
    display:flex;
    gap:4px;
  }
  .stage-progress-track i{
    flex:1; height:6px; border-radius:3px;
    background: var(--ak-border2);
    font-style: normal;
  }
  .stage-progress-track i.filled{
    background: linear-gradient(135deg, var(--indigo), #6D5CE8);
  }
  .stage-progress-text{
    font-size: 11px;
    font-weight: 800;
    color: var(--indigo);
    white-space: nowrap;
  }

  /* ── Activity detail modal (full-screen, premium hero + sheet) ── */
  .detail-modal{
    position: fixed;
    inset: 0;
    z-index: 300;
    background: var(--ak-bg);
    display: none;
    flex-direction: column;
    opacity: 0;
    transform: translateY(14px);
    transition: opacity .22s ease, transform .22s ease;
  }
  .detail-modal.open{
    display: flex;
    opacity: 1;
    transform: translateY(0);
  }

  .detail-hero{
    position: relative;
    flex-shrink: 0;
    padding: 46px 22px 46px;
    color: #fff;
    overflow: hidden;
  }
  .detail-hero-watermark{
    position: absolute;
    top: -26px; right: -26px;
    width: 170px; height: 170px;
    opacity: 0.14;
    pointer-events: none;
  }
  .detail-back-float{
    position: absolute;
    top: 14px; left: 16px;
    width: 32px; height: 32px;
    border-radius: 50%;
    background: rgba(255,255,255,0.18);
    border: 1px solid rgba(255,255,255,0.26);
    display: flex; align-items:center; justify-content:center;
    color: #fff;
    cursor: pointer;
    z-index: 2;
  }
  .detail-hero-icon{
    position: relative; z-index: 1;
    width: 50px; height: 50px;
    border-radius: 16px;
    background: rgba(255,255,255,0.18);
    border: 1px solid rgba(255,255,255,0.26);
    display:flex; align-items:center; justify-content:center;
    margin-bottom: 14px;
    box-shadow: 0 10px 22px -8px rgba(0,0,0,0.3);
  }
  .detail-hero-icon svg{ width:23px; height:23px; }
  .detail-hero-type{
    position: relative; z-index: 1;
    display:inline-flex; align-items:center; gap:5px;
    padding: 3px 11px;
    border-radius: 20px;
    background: rgba(255,255,255,0.18);
    border: 1px solid rgba(255,255,255,0.26);
    font-size: 10.5px;
    font-weight: 800;
    margin-bottom: 10px;
  }
  .detail-hero h2{
    position: relative; z-index: 1;
    font-size: 19px;
    font-weight: 900;
    margin: 0 0 12px;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .detail-hero-meta{
    position: relative; z-index: 1;
    display:flex; gap:8px; flex-wrap:wrap;
  }
  .glass-chip{
    display:inline-flex; align-items:center; gap:6px;
    padding: 5px 12px;
    border-radius: 20px;
    background: rgba(255,255,255,0.16);
    border: 1px solid rgba(255,255,255,0.22);
    font-size: 11px;
    font-weight: 800;
    color: #fff;
  }
  .glass-chip .dot{ width:6px; height:6px; border-radius:50%; flex-shrink:0; }
  .glass-avatar{
    width:16px; height:16px; border-radius:50%;
    background: rgba(255,255,255,0.35);
    display:flex; align-items:center; justify-content:center;
    font-size: 9px; font-weight: 900;
  }

  .detail-sheet{
    flex: 1;
    overflow-y: auto;
    background: var(--ak-bg);
    border-radius: 24px 24px 0 0;
    margin-top: -18px;
    position: relative;
    z-index: 2;
  }
  .detail-sheet-inner{
    max-width: 760px;
    margin: 0 auto;
    padding: 22px 20px 24px;
    box-sizing: border-box;
  }

  .detail-desc{
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ak-text-sub);
    line-height: 1.6;
    margin: 0 0 20px;
  }

  .detail-progress-card{
    background: var(--ak-surface);
    border-radius: 16px;
    padding: 14px 15px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
    margin-bottom: 20px;
  }
  .detail-progress-label{
    display:flex; justify-content:space-between; align-items:baseline;
    font-size: 12px; font-weight: 800; color: var(--ak-text);
    margin-bottom: 8px;
  }
  .detail-progress-label span:last-child{ color: var(--indigo); }
  .detail-progress-track{
    display:flex; gap:5px;
  }
  .detail-progress-track i{
    flex:1; height:8px; border-radius:4px;
    background: var(--ak-border2);
    font-style: normal;
  }
  .detail-progress-track i.filled{
    background: linear-gradient(135deg, var(--indigo), #6D5CE8);
  }

  .detail-section-label{
    font-size: 12.5px;
    font-weight: 800;
    color: var(--ak-text);
    margin: 0 0 12px;
  }

  /* stage cards — each stage is its own elevated card, connected by a small chevron */
  .stage-list{ display:flex; flex-direction:column; }
  .stage-connector{
    display:flex; align-items:center; justify-content:center;
    height: 20px;
    color: var(--ak-text-muted);
  }
  .stage-card{
    display:flex; gap:12px;
    background: var(--ak-surface);
    border-radius: 18px;
    padding: 14px 15px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
  }
  .stage-card.locked{ opacity: 0.55; }
  .stage-icon{
    width: 34px; height: 34px;
    border-radius: 11px;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .stage-icon svg{ width:15px; height:15px; }
  .stage-self-study .stage-icon{ background:#0D948814; }
  .stage-agent-battle .stage-icon{ background:#EF444414; }
  .stage-assignment .stage-icon{ background:#6C3BFF14; }

  .stage-body{ flex:1; min-width:0; }
  .stage-title-row{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .stage-title{ font-size:13.5px; font-weight:800; color:var(--ak-text); }
  .stage-sub{ font-size:10.5px; font-weight:800; color:var(--ak-text-muted); text-transform:uppercase; letter-spacing:0.03em; }
  .stage-desc{ font-size:12.5px; font-weight:500; color:var(--ak-text-sub); margin:3px 0 8px; line-height:1.5; }
  .stage-hint{ font-size:11.5px; font-weight:700; color:var(--ak-text-muted); }

  .detail-footer{
    flex-shrink:0;
    display:flex;
    align-items:center;
    gap: 12px;
    padding: 14px 20px;
    background: var(--ak-surface);
    box-shadow: 0 -8px 20px rgba(17,24,39,0.07);
  }
  .detail-footer .points{ font-size:12.5px; font-weight:800; color:var(--ak-text-sub); }
  .detail-footer .action-btn.premium{
    margin-left: auto;
    padding: 12px 22px;
    border-radius: 20px;
    font-size: 13.5px;
    font-weight: 800;
    color: #fff;
    border: none;
    box-shadow: 0 10px 20px -8px rgba(17,24,39,0.4);
  }

  .detail-stats-grid{
    display:grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0 0 20px;
  }
  .detail-stat{
    display:flex;
    align-items:center;
    gap: 8px;
    background: var(--ak-surface);
    border-radius: 14px;
    padding: 10px 10px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
  }
  .detail-stat .stat-icon{
    width: 26px; height: 26px;
    border-radius: 8px;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .detail-stat .stat-icon svg{ width:12px; height:12px; }
  .detail-stat .label{
    font-size: 9px;
    font-weight: 800;
    color: var(--ak-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .detail-stat .value{
    font-size: 12px;
    font-weight: 800;
    color: var(--ak-text);
    margin-top: 2px;
    line-height: 1.25;
  }

  /* ── Questions section ── */
  .detail-section-head{
    display:flex;
    align-items:baseline;
    gap: 8px;
    margin: 0 0 12px;
  }
  .detail-section-head .detail-section-label{ margin:0; }
  .detail-section-count{
    font-size: 11px;
    font-weight: 800;
    color: var(--ak-text-muted);
    background: var(--ak-surface);
    border: 1px solid var(--ak-border2);
    padding: 2px 9px;
    border-radius: 10px;
  }

  .question-card{
    background: var(--ak-surface);
    border-radius: 16px;
    padding: 13px 14px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
    margin-bottom: 10px;
  }
  .question-head{
    display:flex;
    align-items:flex-start;
    gap: 10px;
  }
  .question-index{
    flex-shrink:0;
    width: 22px; height: 22px;
    border-radius: 50%;
    display:flex; align-items:center; justify-content:center;
    font-size: 11px;
    font-weight: 900;
    color: #fff;
    margin-top: 1px;
  }
  .question-text{
    flex:1;
    font-size: 13px;
    font-weight: 700;
    color: var(--ak-text);
    line-height: 1.45;
  }
  .round-badge{
    flex-shrink:0;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 9px;
    border-radius: 20px;
  }
  .round-badge.won{ background:#10B98114; color:#047857; }
  .round-badge.lost{ background:#EF444414; color:#B91C1C; }

  .option-list{
    display:flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
    padding-left: 32px;
  }
  .option-row{
    display:flex;
    align-items:center;
    gap: 9px;
    padding: 8px 11px;
    border-radius: 10px;
    background: var(--ak-surface-hover);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ak-text-sub);
  }
  .option-row .opt-dot{
    width: 16px; height:16px;
    border-radius: 50%;
    border: 2px solid var(--ak-border3);
    flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
  }
  .option-row.correct{
    background: #10B98114;
    color: #047857;
    font-weight: 800;
  }
  .option-row.correct .opt-dot{
    border-color: #10B981;
    background: #10B981;
  }
  .option-row.correct .opt-dot svg{ width:9px; height:9px; stroke:#fff; }

  .answer-box{
    margin-top: 10px;
    margin-left: 32px;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.5;
  }
  .answer-box.empty{
    border: 1.5px dashed var(--ak-border2);
    color: var(--ak-text-muted);
    font-style: italic;
    font-weight: 500;
  }
  .answer-box.filled{
    background: #10B98114;
    color: #047857;
    display:flex;
    align-items:center;
    gap: 7px;
  }
  .answer-box.filled svg{ width:14px; height:14px; flex-shrink:0; }

  /* ── Submission upload ── */
  .submission-zone{
    margin-top: 6px;
    border: 1.5px dashed var(--ak-border2);
    border-radius: 14px;
    padding: 22px 14px;
    text-align: center;
    cursor: pointer;
    background: var(--ak-surface-hover);
    position: relative;
  }
  .submission-zone:hover{ border-color: var(--brand); background:#6C3BFF08; }
  .submission-zone.dragover{ border-color: var(--brand); background:#6C3BFF10; }
  .submission-zone input[type="file"]{
    position:absolute; inset:0;
    opacity:0;
    cursor:pointer;
  }
  .submission-zone-icon{
    width: 34px; height:34px;
    border-radius: 10px;
    background: #6C3BFF14;
    color: var(--brand);
    display:flex; align-items:center; justify-content:center;
    margin: 0 auto 8px;
  }
  .submission-zone-icon svg{ width:16px; height:16px; }
  .submission-zone-label{ font-size:12.5px; font-weight:800; color:var(--ak-text); }
  .submission-zone-hint{ font-size:10.5px; font-weight:600; color:var(--ak-text-muted); margin-top:3px; }

  .file-chip{
    display:flex; align-items:center; gap:10px;
    background: var(--ak-surface);
    border-radius: 14px;
    padding: 10px 12px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
    margin-top: 6px;
  }
  .file-chip-icon{
    width:32px; height:32px; border-radius:9px;
    background:#6C3BFF14; color:var(--brand);
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .file-chip-icon svg{ width:15px; height:15px; }
  .file-chip-info{ flex:1; min-width:0; }
  .file-chip-name{ font-size:12.5px; font-weight:800; color:var(--ak-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .file-chip-size{ font-size:10.5px; font-weight:700; color:var(--ak-text-muted); margin-top:1px; }
  .file-chip-remove{
    border:none; background:none; color:var(--ak-text-muted); cursor:pointer;
    width:26px; height:26px; border-radius:8px;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .file-chip-remove:hover{ background:#EF444414; color:#B91C1C; }

  .submitted-summary{
    display:flex; align-items:center; gap:10px;
    background:#10B98114;
    border-radius: 14px;
    padding: 10px 12px;
    margin-top: 6px;
  }
  .submitted-summary-icon{
    width:32px; height:32px; border-radius:9px;
    background:#10B98122; color:#047857;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .submitted-summary-icon svg{ width:15px; height:15px; }
  .submitted-summary-text{ font-size:12.5px; font-weight:800; color:#047857; }
  .submitted-summary-sub{ font-size:10.5px; font-weight:700; color:#047857; opacity:0.75; margin-top:1px; }

  /* ── Question-by-question stepper (one Submission, answered question-by-question) ── */
  .stepper-progress{
    display:flex; align-items:center; gap:9px;
    margin-bottom: 12px;
  }
  .stepper-progress-label{ font-size:11.5px; font-weight:800; color:var(--ak-text-muted); white-space:nowrap; }
  .stepper-progress-track{ flex:1; height:6px; border-radius:3px; background:var(--ak-border2); overflow:hidden; }
  .stepper-progress-fill{ height:100%; border-radius:3px; transition:width .25s ease; }
  .stepper-saved{
    display:flex; align-items:center; gap:4px;
    font-size: 10.5px; font-weight: 800; color:#047857;
    white-space:nowrap;
    opacity: 0;
    transition: opacity .3s ease;
  }
  .stepper-saved.show{ opacity:1; }
  .stepper-saved svg{ width:11px; height:11px; }

  .stepper-question-card{
    background: var(--ak-surface);
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
  }
  .stepper-question-label{
    font-size: 10.5px; font-weight: 800; color: var(--ak-text-muted);
    text-transform: uppercase; letter-spacing: 0.03em;
    margin: 0 0 7px;
  }
  .stepper-question-text{
    font-size: 14.5px; font-weight: 800; color: var(--ak-text);
    line-height: 1.4;
    margin: 0 0 14px;
  }

  .stepper-textarea{
    width: 100%;
    min-height: 96px;
    border-radius: 12px;
    border: 1.5px solid var(--ak-border2);
    padding: 11px 13px;
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ak-text);
    resize: vertical;
  }
  .stepper-textarea:focus{ outline:none; border-color: var(--brand); }

  .stepper-option-list{ display:flex; flex-direction:column; gap:8px; }
  .stepper-option-row{
    display:flex; align-items:center; gap:10px;
    padding: 11px 13px;
    border-radius: 12px;
    border: 1.5px solid var(--ak-border2);
    background: var(--ak-surface);
    font-size: 12.5px; font-weight: 700; color: var(--ak-text-sub);
    cursor: pointer;
  }
  .stepper-option-row:hover{ border-color: var(--ak-border3); }
  .stepper-option-row.selected{
    border-color: var(--brand);
    background: #6C3BFF0C;
    color: var(--ak-text);
    font-weight: 800;
  }
  .stepper-option-dot{
    width:16px; height:16px; border-radius:50%;
    border: 2px solid var(--ak-border3);
    flex-shrink:0;
    position: relative;
  }
  .stepper-option-row.selected .stepper-option-dot{ border-color: var(--brand); }
  .stepper-option-row.selected .stepper-option-dot::after{
    content:''; position:absolute; inset:3px; border-radius:50%;
    background: var(--brand);
  }

  .stepper-nav{ display:flex; align-items:center; gap:8px; margin-top:14px; }
  .stepper-btn{
    padding: 9px 18px;
    border-radius: 20px;
    border: none;
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    cursor: pointer;
  }
  .stepper-btn.secondary{ background: var(--ak-surface-hover); color: var(--ak-text-sub); border: 1px solid var(--ak-border2); }
  .stepper-btn.secondary:disabled{ opacity:0.4; cursor:default; }
  .stepper-btn.primary{
    margin-left: auto;
    background: linear-gradient(135deg, var(--brand), var(--brand-end));
    color: #fff;
    box-shadow: 0 8px 16px -6px rgba(108,59,255,0.5);
  }

  .review-card{
    background: var(--ak-surface);
    border-radius: 16px;
    padding: 18px;
    box-shadow: 0 2px 10px rgba(17,24,39,0.06), 0 1px 2px rgba(17,24,39,0.04);
    text-align: center;
  }
  .review-card .review-icon{
    width:44px; height:44px; border-radius:50%;
    background:#6C3BFF14; color:var(--brand);
    display:flex; align-items:center; justify-content:center;
    margin: 0 auto 12px;
  }
  .review-card h3{ font-size:15.5px; font-weight:900; margin:0 0 4px; color:var(--ak-text); }
  .review-card .review-sub{ font-size:12px; font-weight:700; color:var(--ak-text-sub); margin:0 0 16px; }

  .review-list{ text-align:left; margin-bottom:16px; }
  .review-item{
    display:flex; align-items:center; gap:10px;
    padding: 9px 6px;
    border-bottom: 1px solid var(--ak-border);
    cursor: pointer;
    border-radius: 8px;
  }
  .review-item:last-child{ border-bottom:none; }
  .review-item:hover{ background: var(--ak-surface-hover); }
  .review-item-icon{
    width:20px; height:20px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .review-item-icon.answered{ background:#10B98118; color:#047857; }
  .review-item-icon.unanswered{ background:#F59E0B18; color:#B45309; }
  .review-item-icon svg{ width:11px; height:11px; }
  .review-item-text{ font-size:12px; font-weight:700; color:var(--ak-text); flex:1; text-align:left; }
  .review-item-status{ font-size:10px; font-weight:800; color:var(--ak-text-muted); white-space:nowrap; }

  .submitted-confirm{ text-align:center; padding: 10px 6px; }
  .submitted-confirm .sc-icon{
    width:48px; height:48px; border-radius:50%;
    background:#10B98118; color:#047857;
    display:flex; align-items:center; justify-content:center;
    margin: 0 auto 12px;
  }
  .submitted-confirm h3{ font-size:15.5px; font-weight:900; margin:0 0 4px; color:var(--ak-text); }
  .submitted-confirm p{ font-size:12px; font-weight:700; color:var(--ak-text-sub); margin:0; }

  @media (max-width: 540px){

    .page{ padding: 58px 14px 56px; }
    .hero{ padding: 20px 18px 20px; }
    .activity{ padding: 11px 12px; }
    .icon-badge{ width:30px; height:30px; }
    .hero-stat{ min-width: 92px; }
  }
</style>
<style>
  /* ── Type-preview bar (dev tool, not part of the product UI) ── */
  .preview-bar{
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 500;
    display:flex;
    align-items:center;
    gap: 10px;
    padding: 10px 16px;
    background: #111827;
  }
  .preview-bar label{
    font-size: 10.5px;
    font-weight: 800;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink:0;
  }
  .preview-bar select{
    flex:1;
    max-width: 220px;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
    color: #fff;
    font-family: 'Nunito', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    cursor: pointer;
  }
  .preview-bar select option{ color:#111827; }

  /* push the detail page down below the fixed preview bar */
  .detail-modal{ top: 44px; }
</style>
</head>
<body>

<div class="preview-bar">
  <label for="typeSelector">Previewing</label>
  <select id="typeSelector">
    <option value="type-assignment">Assignments</option>
    <option value="type-quiz">Quizzes</option>
    <option value="type-project">Projects</option>
    <option value="type-reading">Reading</option>
    <option value="type-self-study">Self Study</option>
    <option value="type-agent-battle">Agent Battle</option>
    <option value="type-multi-stage">Multi-Stage</option>
  </select>
</div>

<!-- Hidden data sources — one representative activity per type. Never rendered;
     the detail page below is built from their content via JS. -->
<div id="sourceData" style="display:none;">
    <article class="activity type-assignment">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#6C3BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6M9 16h6M9 8h3M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Quadratic Equations — Problem Set 4</h3>
          <span class="due-chip soon">Due Mon, Sep 8</span>
        </div>
        <p class="desc">Solve questions 1–15 from the worksheet using both factoring and the quadratic formula. Show all working steps.</p>
        <div class="foot">
          <span class="status pending">Upcoming</span>
          <span class="points">20 points</span>
          <a class="action-btn c-purple" href="#">View</a>
        </div>
      </div>
    </article>
    <article class="activity type-quiz">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17h.01M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="12" r="9"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Quiz — Linear Graphs</h3>
          <span class="due-chip soon">Due Wed, Sep 10</span>
        </div>
        <p class="desc">Short quiz covering slope, intercepts, and plotting linear equations. 15 minutes, one attempt.</p>
        <div class="foot">
          <span class="status pending">Upcoming</span>
          <span class="points">10 points</span>
          <a class="action-btn c-blue" href="#">Start</a>
        </div>
      </div>
    </article>
    <article class="activity type-self-study">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 0 4 23Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 1 2.5 2"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Self Study — Read ahead: Ratio &amp; Proportion, Ch. 7</h3>
          <span class="due-chip">Anytime before Sep 10</span>
        </div>
        <p class="desc">Read chapter 7 at your own pace, or revise chapter 6 if you're still unsure of it. No submission needed — your agent tracks reading time and flags topics to revisit.</p>
        <div class="foot">
          <span class="status neutral">Self-paced</span>
          <a class="action-btn c-teal" href="#">Open reader</a>
        </div>
      </div>
    </article>
    <article class="activity type-project">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V6a2 2 0 0 1 2-2h9l5 5v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M15 4v5h5"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Group Project — Geometry in Architecture</h3>
          <span class="due-chip">Submitted Sep 2</span>
        </div>
        <p class="desc">Poster and short presentation identifying geometric shapes and angles in local building designs.</p>
        <div class="foot">
          <span class="status done">Submitted</span>
          <span class="points">30 points</span>
          <a class="action-btn c-gold" href="#">View</a>
        </div>
      </div>
    </article>
    <article class="activity type-reading">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h6a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H4Z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5H20Z"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Reading — Chapter 6: Ratio and Proportion</h3>
          <span class="due-chip">Graded Aug 29</span>
        </div>
        <p class="desc">Read chapter 6 and answer the comprehension check at the end of the section.</p>
        <div class="foot">
          <span class="status review">Graded · 9/10</span>
          <a class="action-btn c-green" href="#">Feedback</a>
        </div>
      </div>
    </article>
    <article class="activity type-agent-battle">
      <div class="icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 3.5-9 9L4 17l4.5-1.5 9-9Z"/><path d="m13 5 6 6M17 3l4 4-2 2-4-4Z"/></svg>
      </div>
      <div class="body">
        <div class="title-row">
          <h3>Agent Battle — Ratios</h3>
          <span class="due-chip">Fought Aug 27</span>
        </div>
        <p class="desc">Three-round duel on ratio and proportion. Won 2 of 3 rounds against Sargeant's hardest difficulty tier.</p>
        <div class="foot">
          <span class="vs-chip"><span class="vs-avatar">S</span>vs. Sargeant</span>
          <span class="status done">Won · 2/3</span>
          <a class="action-btn c-red" href="#">Replay</a>
        </div>
      </div>
    </article>
</div>

<div class="detail-modal" id="detailModal">
  <div class="detail-hero" style="background: radial-gradient(130% 170% at 15% -15%, #6D5CE8 0%, #4338CA 55%, #34248F 100%);">
    <svg class="detail-hero-watermark" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.4"><rect x="4" y="4" width="16" height="5" rx="1.5"/><rect x="4" y="10.5" width="16" height="5" rx="1.5"/><rect x="4" y="17" width="16" height="3" rx="1.5"/></svg>
    <button class="detail-back-float" id="detailCloseBtn" aria-label="Close">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="detail-hero-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="5" rx="1.5"/><rect x="4" y="10.5" width="16" height="5" rx="1.5"/><rect x="4" y="17" width="16" height="3" rx="1.5"/></svg>
    </div>
    <div class="detail-hero-type">Multi-Stage Activity</div>
    <h2>Algebra Fundamentals</h2>
    <div class="detail-hero-meta">
      <span class="glass-chip"><span class="dot" style="background:#F59E0B;"></span>Due Fri, Sep 12</span>
      <span class="glass-chip">Set by Mrs. Adeyemi</span>
      <span class="glass-chip">35 points</span>
    </div>
  </div>

  <div class="detail-sheet">
    <div class="detail-sheet-inner">

      <p class="detail-desc">Complete each stage in order — your Protege carries progress from one stage into the next. You'll study the topic on your own first, then send your Protege into a live classroom battle, and finish by working through the exact questions it faced.</p>

      <div class="detail-progress-card">
        <div class="detail-progress-label"><span>Overall progress</span><span>2 of 3 stages</span></div>
        <div class="detail-progress-track">
          <i class="filled"></i><i class="filled"></i><i></i>
        </div>
      </div>

      <p class="detail-section-label">Stages</p>

      <div class="stage-list">
        <div class="stage-card stage-self-study">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 0 4 23Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 1 2.5 2"/></svg>
          </div>
          <div class="stage-body">
            <div class="stage-title-row">
              <span class="stage-title">Stage 1 · Self Study with Protege</span>
              <span class="status done">Done</span>
            </div>
            <span class="stage-sub">Self Study</span>
            <p class="stage-desc">Your Protege ran an AI study session on quadratic equations, covering factoring and the quadratic formula until every topic in the set was reviewed.</p>
            <a class="action-btn c-teal" href="#">View summary</a>
          </div>
        </div>

        <div class="stage-connector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>

        <div class="stage-card stage-agent-battle">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 3.5-9 9L4 17l4.5-1.5 9-9Z"/><path d="m13 5 6 6M17 3l4 4-2 2-4-4Z"/></svg>
          </div>
          <div class="stage-body">
            <div class="stage-title-row">
              <span class="stage-title">Stage 2 · Classroom Battle Challenge</span>
              <span class="status pending">In progress</span>
            </div>
            <span class="stage-sub">Agent Battle</span>
            <p class="stage-desc">Send your Protege into the classroom battle now that Stage 1 is complete — it plays the questions on your behalf against Sargeant.</p>
            <a class="action-btn c-red" href="#">Continue battle</a>
          </div>
        </div>

        <div class="stage-connector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>

        <div class="stage-card stage-assignment locked">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#6C3BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6M9 16h6M9 8h3M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
          </div>
          <div class="stage-body">
            <div class="stage-title-row">
              <span class="stage-title">Stage 3 · Submit Battle Questions</span>
              <span class="status neutral">Locked</span>
            </div>
            <span class="stage-sub">Assignment</span>
            <p class="stage-desc">Download the question set from your completed battle, work through it by hand, and submit your workings for review.</p>
            <span class="stage-hint">Unlocks after Stage 2 is complete</span>
          </div>
        </div>
      </div>

    </div>
  </div>

  <div class="detail-footer">
    <span class="points">35 points total</span>
    <a class="action-btn premium" href="#" style="background:linear-gradient(135deg, #6D5CE8, #4338CA);">Continue: Enter battle</a>
  </div>
</div>

<div class="detail-modal" id="simpleDetailModal">
  <div class="detail-hero" id="simpleDetailHero">
    <svg class="detail-hero-watermark" id="simpleDetailWatermark" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.4"></svg>
    <button class="detail-back-float" id="simpleDetailCloseBtn" aria-label="Close">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="detail-hero-icon" id="simpleDetailIcon"></div>
    <div class="detail-hero-type" id="simpleDetailSubtitle"></div>
    <h2 id="simpleDetailTitle"></h2>
    <div class="detail-hero-meta" id="simpleDetailMeta"></div>
  </div>

  <div class="detail-sheet">
    <div class="detail-sheet-inner">
      <p class="detail-desc" id="simpleDetailDesc"></p>
      <div class="detail-stats-grid" id="simpleDetailStats"></div>
      <div id="simpleDetailQuestionsWrap">
        <div class="detail-section-head" id="simpleDetailQHead">
          <p class="detail-section-label">Questions</p>
          <span class="detail-section-count" id="simpleDetailQCount"></span>
        </div>
        <div id="simpleDetailQuestions"></div>
      </div>
      <div id="simpleDetailSubmissionWrap">
        <p class="detail-section-label" style="margin-top:20px;" id="simpleDetailSubmissionLabel">Submission</p>
        <div id="simpleDetailSubmission"></div>
      </div>
    </div>
  </div>

  <div class="detail-footer" id="simpleDetailFooter">
    <span class="points" id="simpleDetailFooterPoints"></span>
    <a class="action-btn premium" id="simpleDetailAction" href="#"></a>
  </div>
</div>


<script>
  (function(){
    const ICON_PATHS = {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      coin:     '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><path d="M12 16.5v.01"/>',
      tag:      '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83Z"/><circle cx="8" cy="8.5" r="1.2"/>'
    };

    const TYPE_META = {
      'type-assignment':   { label:'Assignment',   light:'#8B5CF6', mid:'#6C3BFF', dark:'#4C1DCC' },
      'type-quiz':         { label:'Quiz',         light:'#60A5FA', mid:'#3B82F6', dark:'#1D4ED8' },
      'type-project':      { label:'Project',      light:'#FBBF24', mid:'#F59E0B', dark:'#B45309' },
      'type-reading':      { label:'Reading',      light:'#34D399', mid:'#10B981', dark:'#047857' },
      'type-self-study':   { label:'Self Study',   light:'#2DD4BF', mid:'#0D9488', dark:'#0F766E' },
      'type-agent-battle': { label:'Agent Battle', light:'#F87171', mid:'#EF4444', dark:'#B91C1C' },
    };
    const STATUS_DOT = { pending:'#F59E0B', done:'#10B981', review:'#3B82F6', late:'#EF4444', neutral:'#9CA3AF' };

    const QUESTIONS = {
      'Quadratic Equations — Problem Set 4': { type:'open', items:[
        'Solve 3x² + 5x − 2 = 0 by factoring.',
        'Solve 2x² − 7x + 3 = 0 using the quadratic formula.',
        'A ball is thrown upward so that its height is h = −5t² + 20t. Find when it hits the ground.'
      ]},
      'Quiz — Linear Graphs': { type:'mcq', items:[
        { q:'What is the slope of y = 3x + 2?', options:['3','2','-3','1/3'], correct:0 },
        { q:'Where does y = -2x + 4 cross the y-axis?', options:['(0, 4)','(4, 0)','(2, 0)','(0, -4)'], correct:0 },
        { q:'Which equation is parallel to y = 4x - 1?', options:['y = 4x + 7','y = -4x + 1','y = ¼x - 1','y = x - 4'], correct:0 }
      ]},
      'Weekly Reflection — Fractions Unit': { type:'open', items:[
        'What fraction concept did you find most difficult this week?',
        'How did you work through that difficulty?',
        'What would help you understand it better next time?'
      ]},
      'Self Study — Read ahead: Ratio & Proportion, Ch. 7': { type:'open', items:[
        'What is the difference between a ratio and a proportion?',
        'Simplify the ratio 18:24.',
        'If 3 pens cost ₦450, how much do 7 pens cost?'
      ]},
      'Agent Battle — Fractions': { type:'mcq', items:[
        { q:'Round 1 — Simplify 8/12.', options:['2/3','3/4','4/6','1/2'], correct:0 },
        { q:'Round 2 — 1/3 + 1/4 = ?', options:['7/12','2/7','1/2','5/12'], correct:0 },
        { q:'Round 3 — Which is greater: 3/5 or 5/8?', options:['3/5','5/8','They are equal','Cannot tell'], correct:1 }
      ]},
      'Group Project — Geometry in Architecture': { type:'open', items:[
        'Which geometric shapes did you identify in your chosen building?',
        'How do these shapes contribute to the structure\u2019s strength?',
        'What angles did you measure, and how did you calculate them?'
      ]},
      'Reading — Chapter 6: Ratio and Proportion': { type:'mcq', items:[
        { q:'A ratio compares two quantities by:', options:['Division','Addition','Subtraction','Multiplication only'], correct:0 },
        { q:'If a:b = 2:3, and a = 10, what is b?', options:['15','12','20','6'], correct:0 },
        { q:'A proportion states that two ratios are:', options:['Equal','Opposite','Unrelated','Always whole numbers'], correct:0 },
        { q:'Simplify the ratio 25:100.', options:['1:4','1:5','2:5','1:2'], correct:0 }
      ]},
      'Self Study — Revise: Linear Graphs': { type:'open', items:[
        'What does the slope of a line tell you?',
        'How do you find the y-intercept from an equation?',
        'Describe the direction of the graph of y = -x + 3.'
      ]},
      'Agent Battle — Ratios': { type:'mcq', items:[
        { q:'Round 1 — Simplify 20:30.', options:['2:3','3:2','4:5','1:2'], correct:0, won:true },
        { q:'Round 2 — Share ₦900 in the ratio 2:1.', options:['₦600 : ₦300','₦450 : ₦450','₦700 : ₦200','₦500 : ₦400'], correct:0, won:true },
        { q:'Round 3 — A recipe needs flour and sugar in ratio 3:1. For 12 cups flour, how much sugar?', options:['4 cups','3 cups','6 cups','2 cups'], correct:0, won:false }
      ]},
    };

    function openModal(modal){
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('open'));
      document.body.style.overflow = 'hidden';
    }
    function closeModal(modal){
      modal.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(() => { modal.style.display = 'none'; }, 220);
    }


    const multiModal = document.getElementById('detailModal');
    const simpleModal = document.getElementById('simpleDetailModal');

    function makeGlassChip(text, dotColor){
      if (!text) return null;
      const span = document.createElement('span');
      span.className = 'glass-chip';
      if (dotColor){
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = dotColor;
        span.appendChild(dot);
      }
      span.appendChild(document.createTextNode(text));
      return span;
    }

    function addStat(container, label, value, iconKey){
      if (!value) return;
      const el = document.createElement('div');
      el.className = 'detail-stat';
      el.innerHTML = `<div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[iconKey] || ''}</svg></div>
        <div><div class="label">${label}</div><div class="value">${value}</div></div>`;
      container.appendChild(el);
    }

    // One Submission per activity, containing many answers — the student can move
    // back and forth between questions (autosaved as they go) before a single
    // final submit. Only unresolved Assignment/Quiz/Project activities with
    // question data use this flow; everything else (a graded/reviewed activity,
    // or a Self Study "practice" set with no formal submission) shows the
    // simpler static read-only list further below.
    const STEPPER_TYPES = ['type-assignment', 'type-quiz', 'type-project'];
    const activityState = {}; // keyed by title -> { fileName, fileSize, answers, currentIndex, reviewing, submitted }
    function stateFor(title){
      return activityState[title] || (activityState[title] = {
        fileName: null, fileSize: 0, answers: {}, currentIndex: 0, reviewing: false, submitted: false
      });
    }
    function labelForType(typeClass){
      return { 'type-assignment':'Assignment', 'type-quiz':'Quiz', 'type-project':'Project' }[typeClass] || 'Activity';
    }
    function isAnswered(data, i, state){
      const val = state.answers[i];
      if (data.type === 'mcq') return val !== undefined && val !== null;
      return !!(val && val.trim().length);
    }

    function renderQuestions(title, typeClass, statusClass, colorMid, card){
      const wrap = document.getElementById('simpleDetailQuestionsWrap');
      const head = document.getElementById('simpleDetailQHead');
      const countEl = document.getElementById('simpleDetailQCount');
      const list = document.getElementById('simpleDetailQuestions');
      list.innerHTML = '';

      const data = QUESTIONS[title];
      if (!data){ wrap.style.display = 'none'; return; }
      wrap.style.display = '';

      const resolved = statusClass === 'done' || statusClass === 'review';
      const useStepper = !resolved && STEPPER_TYPES.includes(typeClass);

      if (!useStepper){
        head.style.display = '';
        countEl.textContent = data.items.length + (data.type === 'mcq' && typeClass === 'type-agent-battle' ? ' rounds' : (data.items.length === 1 ? ' question' : ' questions'));
        renderStaticQuestionList(list, data, typeClass, statusClass, colorMid, resolved);
        return;
      }

      head.style.display = 'none';
      const state = stateFor(title);
      if (state.submitted){
        paintSubmittedConfirm(list, typeClass, data, state);
      } else if (state.reviewing){
        renderReviewScreen(title, typeClass, statusClass, colorMid, data, card, list);
      } else {
        renderQuestionStep(title, typeClass, statusClass, colorMid, data, card, list);
      }
    }

    function renderStaticQuestionList(list, data, typeClass, statusClass, colorMid, resolved){
      data.items.forEach((item, i) => {
        const qCard = document.createElement('div');
        qCard.className = 'question-card';

        if (data.type === 'mcq'){
          const isBattle = typeClass === 'type-agent-battle';
          let roundBadge = '';
          if (resolved && isBattle){
            roundBadge = `<span class="round-badge ${item.won ? 'won' : 'lost'}">${item.won ? 'Won' : 'Lost'}</span>`;
          }
          const optionsHtml = item.options.map((opt, oi) => {
            const isCorrect = resolved && oi === item.correct;
            return `<div class="option-row ${isCorrect ? 'correct' : ''}">
              <span class="opt-dot">${isCorrect ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</span>
              ${opt}
            </div>`;
          }).join('');
          qCard.innerHTML = `
            <div class="question-head">
              <span class="question-index" style="background:${colorMid};">${i + 1}</span>
              <span class="question-text">${item.q}</span>
              ${roundBadge}
            </div>
            <div class="option-list">${optionsHtml}</div>`;
        } else {
          const answerHtml = resolved
            ? `<div class="answer-box filled"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Submitted</div>`
            : `<div class="answer-box empty">${statusClass === 'late' ? 'Not yet submitted' : 'Your answer will go here'}</div>`;
          qCard.innerHTML = `
            <div class="question-head">
              <span class="question-index" style="background:${colorMid};">${i + 1}</span>
              <span class="question-text">${item}</span>
            </div>
            ${answerHtml}`;
        }
        list.appendChild(qCard);
      });
    }

    function renderQuestionStep(title, typeClass, statusClass, colorMid, data, card, list){
      const state = stateFor(title);
      const idx = state.currentIndex;
      const item = data.items[idx];
      const total = data.items.length;
      const answeredCount = data.items.reduce((n, _, i) => n + (isAnswered(data, i, state) ? 1 : 0), 0);
      const pct = Math.round((answeredCount / total) * 100);
      const isLast = idx === total - 1;

      let bodyHtml;
      if (data.type === 'mcq'){
        const optionsHtml = item.options.map((opt, oi) => `
          <div class="stepper-option-row ${state.answers[idx] === oi ? 'selected' : ''}" data-opt="${oi}">
            <span class="stepper-option-dot"></span>${opt}
          </div>`).join('');
        bodyHtml = `
          <div class="stepper-question-card">
            <div class="stepper-question-label">Question ${idx + 1}</div>
            <div class="stepper-question-text">${item.q}</div>
            <div class="stepper-option-list">${optionsHtml}</div>
          </div>`;
      } else {
        const existing = state.answers[idx] || '';
        bodyHtml = `
          <div class="stepper-question-card">
            <div class="stepper-question-label">Question ${idx + 1}</div>
            <div class="stepper-question-text">${item}</div>
            <textarea class="stepper-textarea" id="stepperAnswer" placeholder="Type your answer…">${existing}</textarea>
          </div>`;
      }

      list.innerHTML = `
        <div class="stepper-progress">
          <span class="stepper-progress-label">Question ${idx + 1} of ${total}</span>
          <div class="stepper-progress-track"><div class="stepper-progress-fill" style="width:${pct}%; background:${colorMid};"></div></div>
          <span class="stepper-saved" id="stepperSaved"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Saved</span>
        </div>
        ${bodyHtml}
        <div class="stepper-nav">
          <button class="stepper-btn secondary" id="stepperBack" ${idx === 0 ? 'disabled' : ''}>← Back</button>
          <button class="stepper-btn primary" id="stepperNext">${isLast ? 'Review Answers' : 'Next →'}</button>
        </div>`;

      function flashSaved(){
        const el = document.getElementById('stepperSaved');
        if (!el) return;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 1100);
      }
      function rerender(){ renderQuestionStep(title, typeClass, statusClass, colorMid, data, card, list); }

      if (data.type === 'mcq'){
        list.querySelectorAll('.stepper-option-row').forEach(row => {
          row.addEventListener('click', () => {
            state.answers[idx] = Number(row.dataset.opt);
            flashSaved();
            rerender();
          });
        });
      } else {
        const ta = document.getElementById('stepperAnswer');
        ta.addEventListener('input', () => { state.answers[idx] = ta.value; });
        ta.addEventListener('blur', flashSaved);
      }

      document.getElementById('stepperBack').addEventListener('click', () => {
        if (idx === 0) return;
        state.currentIndex = idx - 1;
        rerender();
      });
      document.getElementById('stepperNext').addEventListener('click', () => {
        if (isLast){
          state.reviewing = true;
          renderReviewScreen(title, typeClass, statusClass, colorMid, data, card, list);
        } else {
          state.currentIndex = idx + 1;
          rerender();
        }
      });
    }

    function renderReviewScreen(title, typeClass, statusClass, colorMid, data, card, list){
      const state = stateFor(title);
      const total = data.items.length;
      const answeredCount = data.items.reduce((n, _, i) => n + (isAnswered(data, i, state) ? 1 : 0), 0);
      const typeLabel = labelForType(typeClass);

      const itemsHtml = data.items.map((item, i) => {
        const answered = isAnswered(data, i, state);
        const qText = data.type === 'mcq' ? item.q : item;
        const short = qText.length > 56 ? qText.slice(0, 56) + '…' : qText;
        return `
          <div class="review-item" data-jump="${i}">
            <span class="review-item-icon ${answered ? 'answered' : 'unanswered'}">
              ${answered
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/></svg>'}
            </span>
            <span class="review-item-text">${i + 1}. ${short}</span>
            <span class="review-item-status">${answered ? 'Answered' : 'Not answered'}</span>
          </div>`;
      }).join('');

      list.innerHTML = `
        <div class="review-card">
          <div class="review-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <h3>${typeLabel} complete</h3>
          <p class="review-sub">You answered ${answeredCount} / ${total} questions.</p>
          <div class="review-list">${itemsHtml}</div>
          <button class="stepper-btn primary" id="submitActivityBtn" style="width:100%; justify-content:center; display:flex; margin-left:0;">Submit ${typeLabel}</button>
        </div>`;

      list.querySelectorAll('.review-item').forEach(row => {
        row.addEventListener('click', () => {
          state.currentIndex = Number(row.dataset.jump);
          state.reviewing = false;
          renderQuestionStep(title, typeClass, statusClass, colorMid, data, card, list);
        });
      });

      document.getElementById('submitActivityBtn').addEventListener('click', () => {
        finalizeSubmission(title, typeClass, statusClass, data, card);
      });
    }

    function paintSubmittedConfirm(list, typeClass, data, state){
      const typeLabel = labelForType(typeClass);
      list.innerHTML = `
        <div class="submitted-confirm">
          <div class="sc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          <h3>${typeLabel} submitted</h3>
          <p>Your teacher will review your ${data.items.length} answer${data.items.length === 1 ? '' : 's'}${state.fileName ? ' and attached file' : ''}.</p>
        </div>`;
    }

    function finalizeSubmission(title, typeClass, statusClass, data, card){
      const state = stateFor(title);
      state.submitted = true;
      state.reviewing = false;

      const cardStatus = card.querySelector('.status');
      if (cardStatus){
        cardStatus.textContent = 'Submitted';
        cardStatus.className = 'status done';
      }

      const list = document.getElementById('simpleDetailQuestions');
      paintSubmittedConfirm(list, typeClass, data, state);

      // repaint the (optional) file-attach section so it reflects the same submission
      renderSubmission(title, typeClass, statusClass, card);
    }

    const SUBMISSION_TYPES = ['type-assignment', 'type-project'];

    function formatFileSize(bytes){
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderSubmission(title, typeClass, statusClass, card){
      const wrap = document.getElementById('simpleDetailSubmissionWrap');
      const label = document.getElementById('simpleDetailSubmissionLabel');
      const container = document.getElementById('simpleDetailSubmission');

      if (!SUBMISSION_TYPES.includes(typeClass)){ wrap.style.display = 'none'; return; }
      wrap.style.display = '';

      const resolved = statusClass === 'done' || statusClass === 'review';
      const state = stateFor(title);
      const usesStepper = !resolved && STEPPER_TYPES.includes(typeClass) && !!QUESTIONS[title];
      label.textContent = usesStepper ? 'Attach a file (optional)' : 'Submission';

      function paint(){
        container.innerHTML = '';

        if (resolved || state.submitted){
          container.innerHTML = state.fileName ? `
            <div class="submitted-summary">
              <div class="submitted-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <div>
                <div class="submitted-summary-text">Submitted</div>
                <div class="submitted-summary-sub">${state.fileName}</div>
              </div>
            </div>` : `
            <div class="submitted-summary">
              <div class="submitted-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <div>
                <div class="submitted-summary-text">Submitted</div>
                <div class="submitted-summary-sub">No file attached</div>
              </div>
            </div>`;
          return;
        }

        if (state.fileName){
          container.innerHTML = `
            <div class="file-chip">
              <div class="file-chip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
              <div class="file-chip-info">
                <div class="file-chip-name">${state.fileName}</div>
                <div class="file-chip-size">${formatFileSize(state.fileSize)}</div>
              </div>
              <button class="file-chip-remove" id="fileChipRemove" aria-label="Remove file">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>`;
          container.querySelector('#fileChipRemove').addEventListener('click', () => {
            state.fileName = null; state.fileSize = 0;
            paint();
          });
          return;
        }

        container.innerHTML = `
          <label class="submission-zone" id="dropzone">
            <input type="file" id="fileInput" />
            <div class="submission-zone-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
            <div class="submission-zone-label">Click to upload or drag and drop</div>
            <div class="submission-zone-hint">PDF, JPG, PNG, DOCX up to 10MB</div>
          </label>`;
        const zone = container.querySelector('#dropzone');
        const input = container.querySelector('#fileInput');
        input.addEventListener('change', () => {
          if (input.files && input.files[0]){
            state.fileName = input.files[0].name;
            state.fileSize = input.files[0].size;
            paint();
          }
        });
        ['dragover', 'dragenter'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('dragover'); }));
        ['dragleave'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('dragover'); }));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          zone.classList.remove('dragover');
          if (e.dataTransfer.files && e.dataTransfer.files[0]){
            state.fileName = e.dataTransfer.files[0].name;
            state.fileSize = e.dataTransfer.files[0].size;
            paint();
          }
        });
      }

      paint();

      // For non-stepper submission cases (e.g. no question data for this activity),
      // fall back to the footer button as the single submit action.
      const footerAction = document.getElementById('simpleDetailAction');
      if (usesStepper){
        footerAction.onclick = (e) => e.preventDefault();
      } else {
        if (resolved || state.submitted) footerAction.textContent = 'Submitted';
        footerAction.onclick = (e) => {
          e.preventDefault();
          if (resolved || state.submitted) return;
          if (!state.fileName){
            const zone = container.querySelector('.submission-zone');
            if (zone){
              zone.style.borderColor = '#EF4444';
              setTimeout(() => { zone.style.borderColor = ''; }, 700);
            }
            return;
          }
          state.submitted = true;
          paint();
          const cardStatus = card.querySelector('.status');
          if (cardStatus){
            cardStatus.textContent = 'Submitted';
            cardStatus.className = 'status done';
          }
          footerAction.textContent = 'Submitted';
        };
      }
    }

    function openSimpleDetail(card, typeClass){
      const meta = TYPE_META[typeClass];

      const hero = document.getElementById('simpleDetailHero');
      hero.style.background = `radial-gradient(130% 170% at 15% -15%, ${meta.light} 0%, ${meta.mid} 55%, ${meta.dark} 100%)`;

      const srcIcon = card.querySelector('.icon-badge svg');
      const iconWrap = document.getElementById('simpleDetailIcon');
      iconWrap.innerHTML = srcIcon ? srcIcon.outerHTML : '';
      const clonedSvg = iconWrap.querySelector('svg');
      if (clonedSvg){ clonedSvg.setAttribute('stroke', '#fff'); clonedSvg.style.width = '23px'; clonedSvg.style.height = '23px'; }

      const watermark = document.getElementById('simpleDetailWatermark');
      watermark.innerHTML = srcIcon ? srcIcon.innerHTML : '';

      document.getElementById('simpleDetailTitle').textContent = card.querySelector('h3').textContent;
      document.getElementById('simpleDetailSubtitle').textContent = meta.label;
      document.getElementById('simpleDetailDesc').textContent = card.querySelector('.desc').textContent;

      const due = card.querySelector('.due-chip');
      const status = card.querySelector('.status');
      const vs = card.querySelector('.vs-chip');
      const points = card.querySelector('.points');

      const metaRow = document.getElementById('simpleDetailMeta');
      metaRow.innerHTML = '';
      const dueChip = makeGlassChip(due ? due.textContent.trim() : null);
      if (dueChip) metaRow.appendChild(dueChip);
      let statusClass = null;
      if (status){
        statusClass = Object.keys(STATUS_DOT).find(s => status.classList.contains(s));
        const statusChip = makeGlassChip(status.textContent.trim(), STATUS_DOT[statusClass]);
        if (statusChip) metaRow.appendChild(statusChip);
      }
      if (vs){
        const vsChip = makeGlassChip(vs.textContent.trim());
        if (vsChip) metaRow.appendChild(vsChip);
      }
      const pointsChip = makeGlassChip(points ? points.textContent.trim() : null);
      if (pointsChip) metaRow.appendChild(pointsChip);

      const stats = document.getElementById('simpleDetailStats');
      stats.innerHTML = '';
      addStat(stats, 'Type', meta.label, 'tag');
      addStat(stats, 'Due', due ? due.textContent.trim() : null, 'calendar');
      addStat(stats, 'Points', points ? points.textContent.trim() : null, 'coin');

      const footerPoints = document.getElementById('simpleDetailFooterPoints');
      footerPoints.textContent = points ? points.textContent.trim() : '';
      footerPoints.style.visibility = points ? 'visible' : 'hidden';

      const actionSrc = card.querySelector('.action-btn');
      const footerAction = document.getElementById('simpleDetailAction');
      footerAction.textContent = actionSrc ? actionSrc.textContent.trim() : 'View';
      footerAction.style.background = `linear-gradient(135deg, ${meta.mid}, ${meta.dark})`;

      const titleText = card.querySelector('h3').textContent;
      renderQuestions(titleText, typeClass, statusClass, meta.mid, card);
      renderSubmission(titleText, typeClass, statusClass, card);

      const resolvedNow = statusClass === 'done' || statusClass === 'review';
      const stepperNow = !resolvedNow && STEPPER_TYPES.includes(typeClass) && !!QUESTIONS[titleText];
      document.getElementById('simpleDetailFooter').style.display = stepperNow ? 'none' : '';

      openModal(simpleModal);
    }

    const sourceCards = {
      'type-assignment':   document.querySelector('#sourceData .type-assignment'),
      'type-quiz':         document.querySelector('#sourceData .type-quiz'),
      'type-project':      document.querySelector('#sourceData .type-project'),
      'type-reading':      document.querySelector('#sourceData .type-reading'),
      'type-self-study':   document.querySelector('#sourceData .type-self-study'),
      'type-agent-battle': document.querySelector('#sourceData .type-agent-battle'),
    };

    function selectType(val){
      if (val === 'type-multi-stage'){
        simpleModal.style.display = 'none';
        simpleModal.classList.remove('open');
        openModal(multiModal);
      } else {
        multiModal.style.display = 'none';
        multiModal.classList.remove('open');
        const card = sourceCards[val];
        if (card) openSimpleDetail(card, val);
      }
    }

    const typeSelector = document.getElementById('typeSelector');
    typeSelector.addEventListener('change', (e) => selectType(e.target.value));
    selectType(typeSelector.value);
  })();
</script>
</body>
</html>
