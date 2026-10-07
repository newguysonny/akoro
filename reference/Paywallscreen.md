<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Akoro — Upgrade to Premium</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --purple: #6C3BFF;
    --purple-dark: #5A2FE0;
    --purple-soft: #F1ECFF;
    --coral: #FF6B57;
    --green: #2BB673;
    --green-soft: #E7F8EF;
    --bg: #FAFAFC;
    --surface: #FFFFFF;
    --border: #E7E4F0;
    --text: #221D33;
    --text-dim: #6B667E;
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  :root[data-theme="dark"] {
    --bg: #17151F; --surface: #211E2C; --border: #322E40;
    --text: #F1EFF7; --text-dim: #A29CB8; --purple-soft: #2A2140; --green-soft: #16302344;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Nunito', system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .phone {
    width: 100%;
    max-width: 430px;
    min-height: 100%;
    background: var(--surface);
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 20px 24px 28px;
  }
  .close-btn {
    width: 34px; height: 34px; border-radius: 50%;
    border: 1px solid var(--border); background: var(--bg);
    color: var(--text-dim); font-size: 1rem; font-weight: 700;
    cursor: pointer; margin-bottom: 18px;
  }

  .devbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 22px; }
  .devbar span { font-size: 0.68rem; color: var(--text-dim); font-weight: 700; width: 100%; margin-bottom: 2px; }
  .devbar button {
    font-family: inherit; font-size: 0.72rem; font-weight: 700; padding: 5px 10px;
    border-radius: 100px; border: 1px solid var(--border); background: var(--surface);
    color: var(--text-dim); cursor: pointer;
  }
  .devbar button.active { background: var(--purple); border-color: var(--purple); color: white; }

  .icon-badge {
    width: 56px; height: 56px; border-radius: 18px; background: var(--purple-soft);
    display: flex; align-items: center; justify-content: center; font-size: 1.6rem;
    margin-bottom: 16px;
  }
  h1 { font-size: 1.55rem; font-weight: 900; margin: 0 0 8px; line-height: 1.2; }
  .social-proof { font-size: 0.9rem; color: var(--text-dim); margin: 0 0 22px; }
  .social-proof b { color: var(--green); }

  .features { list-style: none; margin: 0 0 26px; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .features li { display: flex; align-items: flex-start; gap: 10px; font-size: 0.94rem; font-weight: 600; }
  .features li.highlight { color: var(--purple); }
  .check {
    flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: var(--green-soft);
    color: var(--green); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 900;
    margin-top: 1px;
  }
  .features li.highlight .check { background: var(--purple-soft); color: var(--purple); }

  .plans { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
  .plan-card {
    width: 100%; text-align: left; padding: 15px 18px; border-radius: 18px;
    border: 2px solid var(--border); background: var(--surface); cursor: pointer;
    display: flex; justify-content: space-between; align-items: center; font-family: inherit;
  }
  .plan-card.selected { border-color: var(--purple); background: var(--purple-soft); }
  .plan-name { font-weight: 800; font-size: 0.98rem; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .save-badge { background: var(--green); color: white; font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 100px; }
  .plan-price { text-align: right; font-weight: 800; font-size: 0.98rem; }
  .plan-price small { display: block; font-weight: 600; color: var(--text-dim); font-size: 0.76rem; }

  .cta {
    width: 100%; padding: 16px; border-radius: 100px; border: none;
    background: var(--purple); color: white; font-family: inherit; font-weight: 800;
    font-size: 1.02rem; cursor: pointer; margin-bottom: 14px;
  }
  .cta:hover { background: var(--purple-dark); }
  .secondary {
    width: 100%; background: none; border: none; text-align: center;
    color: var(--text-dim); font-family: inherit; font-weight: 700; font-size: 0.9rem;
    cursor: pointer; margin-bottom: 16px;
  }
  .fine-print { font-size: 0.74rem; color: var(--text-dim); text-align: center; line-height: 1.4; margin: 0; }
  .fine-print a { color: var(--text-dim); text-decoration: underline; }
</style>
</head>
<body>

<div class="phone">
  <button class="close-btn" onclick="alert('Would return to the app')">✕</button>

  <div class="devbar">
    <span>Preview trigger (demo only)</span>
    <button class="active" data-t="default" onclick="setTrigger('default', this)">Default</button>
    <button data-t="battles" onclick="setTrigger('battles', this)">Battles</button>
    <button data-t="voice" onclick="setTrigger('voice', this)">Voice</button>
    <button data-t="credits" onclick="setTrigger('credits', this)">Credit limit</button>
  </div>

  <div class="icon-badge" id="icon">✨</div>
  <h1 id="headline">Upgrade to Premium</h1>
  <p class="social-proof" id="subhead">Join over <b>50,000</b> Nigerian students learning smarter with Akoro</p>

  <ul class="features" id="features">
    <li data-f="credits"><span class="check">✓</span> Full AI credit allowance — 1,000 credits/month</li>
    <li data-f="battles"><span class="check">✓</span> Battles &amp; Challenges with classmates</li>
    <li><span class="check">✓</span> Full leaderboards &amp; rankings</li>
    <li data-f="voice"><span class="check">✓</span> Voice &amp; push-to-talk tutoring</li>
    <li><span class="check">✓</span> Full gradebook &amp; progress tracking</li>
  </ul>

  <div class="plans">
    <button class="plan-card selected" data-plan="annual" onclick="selectPlan('annual', this)">
      <span class="plan-name">Annual <span class="save-badge">Save 20%</span></span>
      <span class="plan-price">₦14,400/yr<small>₦1,200/mo</small></span>
    </button>
    <button class="plan-card" data-plan="monthly" onclick="selectPlan('monthly', this)">
      <span class="plan-name">Monthly</span>
      <span class="plan-price">₦1,500/mo</span>
    </button>
  </div>

  <button class="cta" id="cta">Upgrade to Premium</button>
  <button class="secondary" onclick="alert('Would dismiss and continue on Freemium')">Continue with Freemium</button>
  <p class="fine-print">Cancel anytime. By upgrading, you agree to Akoro's <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a>.</p>
</div>

<script>
  const copy = {
    default: { icon: '✨', headline: 'Upgrade to Premium', sub: 'Join over <b>50,000</b> Nigerian students learning smarter with Akoro', feature: null },
    battles: { icon: '⚔️', headline: 'Unlock Battles & Challenges', sub: 'Go Premium to compete with classmates and climb the leaderboard', feature: 'battles' },
    voice: { icon: '🎙️', headline: 'Unlock Voice Tutoring', sub: 'Talk through problems with Amara\\'s Agent, hands-free', feature: 'voice' },
    credits: { icon: '⚡', headline: "You've used all your free credits", sub: 'Upgrade for 1,000 AI credits every month — no more waiting', feature: 'credits' },
  };

  function setTrigger(key, btn){
    document.querySelectorAll('.devbar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const c = copy[key];
    document.getElementById('icon').textContent = c.icon;
    document.getElementById('headline').textContent = c.headline;
    document.getElementById('subhead').innerHTML = c.sub;
    document.querySelectorAll('#features li').forEach(li => li.classList.remove('highlight'));
    if (c.feature) {
      const li = document.querySelector(`#features li[data-f="${c.feature}"]`);
      if (li) li.classList.add('highlight');
    }
  }

  function selectPlan(plan, btn){
    document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('cta').textContent = plan === 'annual'
      ? 'Upgrade to Premium — ₦14,400/yr'
      : 'Upgrade to Premium — ₦1,500/mo';
  }
</script>
</body>
</html>
