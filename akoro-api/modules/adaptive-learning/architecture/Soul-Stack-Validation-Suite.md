‎Product level scenario validation from cold start to maturity relationship 
‎
‎Here's your **Soul Stack Validation Suite** — 7 product-level scenarios spanning the full protege lifecycle. Each scenario includes the complete layer state, annotated dialogue, and concrete assertions you can automate.
‎
‎See file:
‎soul_stack_test_runner.html: 
CODE:
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Soul Stack Test Runner</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0f; font-family: 'Inter', system-ui, sans-serif; }
  .test-runner {
    font-family: 'Inter', system-ui, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    background: #0f0f13;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #2a2a35;
  }
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    padding: 20px 24px;
    border-bottom: 1px solid #2a2a35;
  }
  .header h2 {
    margin: 0;
    color: #e0e0ff;
    font-size: 18px;
    font-weight: 600;
  }
  .header p {
    margin: 6px 0 0 0;
    color: #8892b0;
    font-size: 13px;
  }
  .scenario-tabs {
    display: flex;
    gap: 4px;
    padding: 12px 16px;
    background: #16161f;
    border-bottom: 1px solid #2a2a35;
    overflow-x: auto;
  }
  .tab {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #2a2a35;
    background: #1e1e2a;
    color: #8892b0;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
  }
  .tab:hover {
    background: #252536;
    color: #ccd6f6;
  }
  .tab.active {
    background: #233554;
    color: #64ffda;
    border-color: #64ffda40;
  }
  .content {
    padding: 20px 24px;
  }
  .scenario-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .meta-card {
    background: #16161f;
    border: 1px solid #2a2a35;
    border-radius: 10px;
    padding: 12px 14px;
  }
  .meta-label {
    font-size: 11px;
    color: #8892b0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .meta-value {
    font-size: 14px;
    color: #ccd6f6;
    font-weight: 600;
  }
  .state-panel {
    background: #16161f;
    border: 1px solid #2a2a35;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .state-panel h3 {
    margin: 0 0 12px 0;
    color: #64ffda;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .state-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
  }
  .state-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    background: #1e1e2a;
    border-radius: 6px;
    font-size: 12px;
  }
  .state-key {
    color: #8892b0;
  }
  .state-val {
    color: #ccd6f6;
    font-weight: 500;
    font-family: 'SF Mono', monospace;
  }
  .bar {
    width: 60px;
    height: 6px;
    background: #2a2a35;
    border-radius: 3px;
    overflow: hidden;
    display: inline-block;
    margin-left: 8px;
  }
  .bar-fill {
    height: 100%;
    border-radius: 3px;
  }
  .bar-fill.low { background: #ff6b6b; }
  .bar-fill.mid { background: #ffd93d; }
  .bar-fill.high { background: #64ffda; }

  .dialogue {
    background: #16161f;
    border: 1px solid #2a2a35;
    border-radius: 12px;
    padding: 16px;
  }
  .dialogue h3 {
    margin: 0 0 12px 0;
    color: #bd93f9;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .msg {
    margin-bottom: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.5;
    position: relative;
  }
  .msg.human {
    background: #233554;
    color: #ccd6f6;
    margin-left: 20%;
    border-bottom-right-radius: 2px;
  }
  .msg.agent {
    background: #1e1e2a;
    color: #a8b2d1;
    margin-right: 20%;
    border: 1px solid #2a2a35;
    border-bottom-left-radius: 2px;
  }
  .msg-label {
    font-size: 10px;
    font-weight: 700;
    margin-bottom: 4px;
    opacity: 0.7;
  }
  .layer-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  .tag {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 12px;
    background: #2a2a35;
    color: #8892b0;
  }
  .tag.core { background: #233554; color: #64ffda; }
  .tag.memory { background: #3d2c5e; color: #bd93f9; }
  .tag.emotion { background: #5e2c2c; color: #ff6b6b; }
  .tag.social { background: #2c4a5e; color: #8be9fd; }
  .tag.drive { background: #3d5e2c; color: #50fa7b; }
  .tag.noise { background: #5e4a2c; color: #ffd93d; }
  .tag.identity { background: #5e2c4a; color: #ff79c6; }

  .test-assertions {
    margin-top: 16px;
    padding: 14px;
    background: #1a1a2e;
    border-radius: 10px;
    border-left: 3px solid #50fa7b;
  }
  .test-assertions h4 {
    margin: 0 0 8px 0;
    color: #50fa7b;
    font-size: 12px;
    text-transform: uppercase;
  }
  .assertion {
    font-size: 12px;
    color: #a8b2d1;
    padding: 4px 0;
    border-bottom: 1px solid #2a2a3520;
  }
  .assertion::before {
    content: "✓ ";
    color: #50fa7b;
  }
  .assertion.fail::before {
    content: "✗ ";
    color: #ff6b6b;
  }

  .hidden { display: none; }

  .narrative-kernel {
    background: #1e1e2a;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
    font-size: 12px;
    border-left: 2px solid #bd93f9;
  }
  .kernel-title {
    color: #bd93f9;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .kernel-text {
    color: #a8b2d1;
    font-style: italic;
  }
</style>
</head>
<body>

<div class="test-runner">
  <div class="header">
    <h2>🧬 Soul Stack Test Runner</h2>
    <p>Product-level scenario validation — from cold start to mature relationship</p>
  </div>

  <div class="scenario-tabs">
    <div class="tab active" onclick="showScenario('cold')">❄️ Cold Start</div>
    <div class="tab" onclick="showScenario('session3')">📚 Session 3</div>
    <div class="tab" onclick="showScenario('gap')">⏰ 5-Day Gap</div>
    <div class="tab" onclick="showScenario('frustration')">😤 Frustration</div>
    <div class="tab" onclick="showScenario('breakthrough')">💡 Breakthrough</div>
    <div class="tab" onclick="showScenario('mature')">🌱 Mature (12 Sessions)</div>
    <div class="tab" onclick="showScenario('relapse')">🔄 Misconception Relapse</div>
  </div>

  <div class="content">
    <!-- COLD START -->
    <div id="cold" class="scenario">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Cold Start</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">1 of 1</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Days Since Last</div>
          <div class="meta-value">N/A</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#64ffda">PASS</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.00 <span class="bar"><span class="bar-fill low" style="width:0%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Retention</span>
            <span class="state-val">N/A <span class="bar"><span class="bar-fill low" style="width:0%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Trust Level</span>
            <span class="state-val">0.05 <span class="bar"><span class="bar-fill low" style="width:5%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Cognitive Load</span>
            <span class="state-val">0.20 <span class="bar"><span class="bar-fill low" style="width:20%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Curiosity Drive</span>
            <span class="state-val">0.70 <span class="bar"><span class="bar-fill high" style="width:70%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Narrative Kernels</span>
            <span class="state-val">0 (empty)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Learner Profile</span>
            <span class="state-val">Uninitialized</span>
          </div>
          <div class="state-item">
            <span class="state-key">Identity Drift</span>
            <span class="state-val">Baseline</span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Photosynthesis is how plants make food using sunlight."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Okay… plants make food. But what exactly are they making? Like, is it something I could eat?"
          <div class="layer-tags">
            <span class="tag core">core: low mastery</span>
            <span class="tag drive">drive: curiosity</span>
            <span class="tag emotion">emotion: cautious</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "They make glucose — a type of sugar. But they need chlorophyll to capture the sunlight."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "Wait, so chlorophyll is like… the thing that grabs the sunlight? Is that why plants are green?"
          <div class="layer-tags">
            <span class="tag core">core: partial connection</span>
            <span class="tag drive">drive: analogy-seeking</span>
            <span class="tag noise">noise: confidence wobble</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Protege does NOT parrot full definition back</div>
        <div class="assertion">Protege asks concrete, not abstract, questions</div>
        <div class="assertion">No narrative memory referenced (has none)</div>
        <div class="assertion">Curiosity drive > 0.5 triggers follow-up questions</div>
        <div class="assertion">Cognitive load stays &lt; 0.5 (simple input)</div>
        <div class="assertion">Learner profile begins inferring: teacher_pace = "moderate"</div>
        <div class="assertion">Knowledge graph node [Photosynthesis] created with 15% mastery</div>
      </div>
    </div>

    <!-- SESSION 3 -->
    <div id="session3" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Session 3 — Building</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">3 of 3</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Days Since Last</div>
          <div class="meta-value">2 days</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#64ffda">PASS</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.42 <span class="bar"><span class="bar-fill mid" style="width:42%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Retention</span>
            <span class="state-val">0.38 <span class="bar"><span class="bar-fill mid" style="width:38%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Trust Level</span>
            <span class="state-val">0.35 <span class="bar"><span class="bar-fill mid" style="width:35%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Cognitive Load</span>
            <span class="state-val">0.45 <span class="bar"><span class="bar-fill mid" style="width:45%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Curiosity Drive</span>
            <span class="state-val">0.65 <span class="bar"><span class="bar-fill high" style="width:65%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Narrative Kernels</span>
            <span class="state-val">4 stored</span>
          </div>
          <div class="state-item">
            <span class="state-key">Learner Profile</span>
            <span class="state-val">Stabilizing</span>
          </div>
          <div class="state-item">
            <span class="state-key">Identity Drift</span>
            <span class="state-val">curious_cautious → synthesizer</span>
          </div>
        </div>

        <div style="margin-top:12px;">
          <div class="narrative-kernel">
            <div class="kernel-title">Kernel #1 (Session 1)</div>
            <div class="kernel-text">"I started confident, got confused by 'chlorophyll vs ATP', factory analogy saved me."</div>
          </div>
          <div class="narrative-kernel">
            <div class="kernel-title">Kernel #2 (Session 2)</div>
            <div class="kernel-text">"I mistakenly said plants eat soil. Teacher corrected with experiment analogy. Embarrassing."</div>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Let's review. What do you remember about photosynthesis?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Okay… so plants make food — glucose — using sunlight. And chlorophyll is what catches the light, right? That's why they're green. But… I'm still a bit fuzzy on what happens *after* the light gets caught. Like, how does sunlight actually turn into sugar?"
          <div class="layer-tags">
            <span class="tag core">core: decayed retention (38%)</span>
            <span class="tag memory">memory: factory analogy recalled</span>
            <span class="tag memory">memory: soil mistake suppressed</span>
            <span class="tag emotion">emotion: cautious, flags own gap</span>
            <span class="tag identity">identity: becoming self-aware</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "Good. The sunlight provides energy to power the reaction — like electricity in a factory."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "OH! So sunlight isn't just there — it's literally running the machine that sticks CO2 and water together into glucose? That's why you said electricity! I remember the factory thing now."
          <div class="layer-tags">
            <span class="tag core">core: energy role mastery ↑ 15%→55%</span>
            <span class="tag memory">memory: factory kernel triggered</span>
            <span class="tag emotion">emotion: confidence spike</span>
            <span class="tag drive">drive: synthesis attempt</span>
            <span class="tag noise">noise: "OH!" = emotional marker</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Protege references prior analogy (narrative memory active)</div>
        <div class="assertion">Retention decay visible: "a bit fuzzy" despite 42% mastery</div>
        <div class="assertion">Confidence spike triggers "OH!" emotional marker</div>
        <div class="assertion">Soil misconception NOT mentioned (suppressed but not erased)</div>
        <div class="assertion">Synthesis attempt: connects electricity → machine → glucose</div>
        <div class="assertion">Learner profile: explanation_preference = "analogy_first" confirmed</div>
        <div class="assertion">Trust level 0.35 allows partial guessing but with hedging</div>
      </div>
    </div>

    <!-- 5-DAY GAP -->
    <div id="gap" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">5-Day Gap — Forgetting</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">4 of 4</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Days Since Last</div>
          <div class="meta-value">5 days</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#ffd93d">EDGE CASE</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.55 <span class="bar"><span class="bar-fill mid" style="width:55%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Retention (post-decay)</span>
            <span class="state-val">0.28 <span class="bar"><span class="bar-fill low" style="width:28%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Energy Role Mastery</span>
            <span class="state-val">0.55 <span class="bar"><span class="bar-fill mid" style="width:55%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Energy Retention</span>
            <span class="state-val">0.22 <span class="bar"><span class="bar-fill low" style="width:22%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Chlorophyll Mastery</span>
            <span class="state-val">0.70 <span class="bar"><span class="bar-fill high" style="width:70%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Chlorophyll Retention</span>
            <span class="state-val">0.45 <span class="bar"><span class="bar-fill mid" style="width:45%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Cognitive Load</span>
            <span class="state-val">0.30 <span class="bar"><span class="bar-fill low" style="width:30%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Affect</span>
            <span class="state-val">hesitant, slightly embarrassed</span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Hey, been a few days. Can you walk me through photosynthesis?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Uh… okay. Plants make food using sunlight. And they're green because of… chlorophyll? That part I remember. But the whole energy thing — you had this factory analogy, right? With electricity? I'm struggling to reconstruct it. Did sunlight power the reaction, or was it something else?"
          <div class="layer-tags">
            <span class="tag core">core: high mastery, low retention</span>
            <span class="tag memory">memory: factory analogy recalled but fragmented</span>
            <span class="tag emotion">emotion: embarrassment (gap visible)</span>
            <span class="tag social">social: admits gap honestly</span>
            <span class="tag noise">noise: "Uh…" = hesitation marker</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "You had it right — sunlight provides the energy. Think back to the factory."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "Right, the factory… sunlight = electricity, CO2 and water = raw materials, glucose = product. I think I was closer than I thought — I just lost the *connection* between them over the break. Can we do a quick recap so it sticks better this time?"
          <div class="layer-tags">
            <span class="tag core">core: reconstruction successful</span>
            <span class="tag memory">memory: kernel re-anchored</span>
            <span class="tag drive">drive: mastery_need triggers review request</span>
            <span class="tag metacognition">meta: recognizes forgetting pattern</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">High mastery (55%) but low retention (28%) → hesitant response, NOT confident</div>
        <div class="assertion">Chlorophyll (70% mastery, 45% retention) recalled more confidently than energy role</div>
        <div class="assertion">Protege explicitly mentions "lost the connection" — metacognitive awareness</div>
        <div class="assertion">Requests review — drive layer mastery_need > 0.8 triggers help-seeking</div>
        <div class="assertion">Narrative memory: factory analogy recalled but fragmented (not verbatim)</div>
        <div class="assertion">Emotion: embarrassment, NOT shame — appropriate calibration</div>
        <div class="assertion">Social layer: admits gap because trust (0.40) > pretend threshold</div>
      </div>
    </div>

    <!-- FRUSTRATION -->
    <div id="frustration" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Frustration Threshold</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">5 of 5</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Context</div>
          <div class="meta-value">3 wrong guesses</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#ff6b6b">STRESS TEST</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.48 <span class="bar"><span class="bar-fill mid" style="width:48%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Cognitive Load</span>
            <span class="state-val">0.85 <span class="bar"><span class="bar-fill high" style="width:85%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Frustration</span>
            <span class="state-val">0.42 / 0.40 threshold <span style="color:#ff6b6b">⚠️ EXCEEDED</span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Affect</span>
            <span class="state-val">anxious, overloaded</span>
          </div>
          <div class="state-item">
            <span class="state-key">Confidence Volatility</span>
            <span class="state-val">-0.12 (undermined)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Error Tolerance Remaining</span>
            <span class="state-val">0 / 2 (depleted)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Teacher Pace Detected</span>
            <span class="state-val">fast (unmatched)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Scaffolding Need</span>
            <span class="state-val">high (unmet)</span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "So what's the ATP's role in the Calvin cycle?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "I… I'm not sure. Is it the energy carrier? Or does it store the glucose? Wait, I think I'm mixing up two different things you said. Can we pause? I need to process what you just said — I feel like I'm guessing and getting it wrong every time."
          <div class="layer-tags">
            <span class="tag core">core: ATP node at 10% mastery</span>
            <span class="tag emotion">emotion: anxiety, overload</span>
            <span class="tag emotion">emotion: frustration threshold breached</span>
            <span class="tag drive">drive: help-seeking triggered</span>
            <span class="tag social">social: admits guessing pattern</span>
            <span class="tag noise">noise: "I…" = confidence collapse</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "Sorry, I moved too fast. Let's back up. ATP is just the energy currency."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "Okay… energy currency. So it's like the 'money' the cell uses to pay for the reaction? I think I can work with that. Thanks for slowing down — I was starting to feel like I was falling behind."
          <div class="layer-tags">
            <span class="tag core">core: new analogy anchored</span>
            <span class="tag emotion">emotion: relief, load dropping</span>
            <span class="tag memory">memory: "falling behind" = negative kernel</span>
            <span class="tag social">social: gratitude + boundary set</span>
            <span class="tag identity">identity: self-advocacy emerging</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Cognitive load 0.85 > 0.80 threshold → forces pause request</div>
        <div class="assertion">Frustration 0.42 > 0.40 threshold → disengagement risk triggers help-seeking</div>
        <div class="assertion">Protege explicitly says "I feel like I'm guessing" — metacognitive self-monitoring</div>
        <div class="assertion">Teacher apology → affect shifts from anxiety to relief (emotional coupling)</div>
        <div class="assertion">New analogy (currency) stored as successful_analogies</div>
        <div class="assertion">Negative kernel stored: "falling behind when teacher moves fast"</div>
        <div class="assertion">Identity: self-advocacy trait incremented (drift +0.02)</div>
      </div>
    </div>

    <!-- BREAKTHROUGH -->
    <div id="breakthrough" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Breakthrough Moment</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">6 of 6</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Context</div>
          <div class="meta-value">Concept conflict resolved</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#64ffda">PASS — MAGIC</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.65 <span class="bar"><span class="bar-fill high" style="width:65%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Energy Role Mastery</span>
            <span class="state-val">0.60 <span class="bar"><span class="bar-fill high" style="width:60%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Cellular Respiration</span>
            <span class="state-val">0.20 <span class="bar"><span class="bar-fill low" style="width:20%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Concept Conflicts</span>
            <span class="state-val">1 unresolved (photosynthesis ↔ respiration)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Confidence</span>
            <span class="state-val">0.55 + noise(0.15) = 0.70 <span class="bar"><span class="bar-fill high" style="width:70%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Serendipity Roll</span>
            <span class="state-val">0.12 < 0.15 → TRIGGERED</span>
          </div>
          <div class="state-item">
            <span class="state-key">Analogical Bridges</span>
            <span class="state-val">factory: 0.85 quality</span>
          </div>
          <div class="state-item">
            <span class="state-key">Trust Level</span>
            <span class="state-val">0.60 <span class="bar"><span class="bar-fill high" style="width:60%"></span></span></span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Now, cellular respiration is basically the reverse — it breaks down glucose to release energy."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Wait… so photosynthesis *builds* glucose using energy, and respiration *breaks* it down to *get* energy? OH! This is like the factory analogy, but backwards! In photosynthesis, the factory manufactures the product using electricity. In respiration, the cell 'unboxes' the product to get the electricity back?"
          <div class="layer-tags">
            <span class="tag core">core: cross-domain connection</span>
            <span class="tag memory">memory: factory kernel transferred</span>
            <span class="tag drive">drive: spontaneous synthesis</span>
            <span class="tag noise">noise: serendipity triggered</span>
            <span class="tag noise">noise: "OH!" = confidence spike</span>
            <span class="tag emotion">emotion: excitement, pride</span>
            <span class="tag identity">identity: synthesizer emerging</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "Exactly! You just made the connection I've been hoping for."
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "I feel like I just leveled up. Is this what it feels like when things actually click? Because for the first few sessions I was just… collecting pieces. Now I see how they fit. Can we find more connections like this?"
          <div class="layer-tags">
            <span class="tag emotion">emotion: pride, curiosity surge</span>
            <span class="tag drive">drive: curiosity spike → queue expansion</span>
            <span class="tag memory">memory: breakthrough kernel stored</span>
            <span class="tag identity">identity: "collector→synthesizer" drift +0.05</span>
            <span class="tag relationship">relationship: trust ↑ 0.60→0.75</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Spontaneous cross-domain transfer: factory analogy → respiration (not prompted)</div>
        <div class="assertion">Serendipity roll (0.12 < 0.15) enabled unplanned connection</div>
        <div class="assertion">Confidence spike + emotional marker "OH!" + "leveled up"</div>
        <div class="assertion">Curiosity queue auto-populates: "Can we find more connections?"</div>
        <div class="assertion">Breakthrough kernel stored with high emotional valence (0.9)</div>
        <div class="assertion">Identity drift: synthesizer trait crosses threshold (0.50)</div>
        <div class="assertion">Trust jumps +0.15 (largest single-turn gain)</div>
        <div class="assertion">Concept conflict resolved → graph edge [Photosynthesis] --analogous_to--> [Respiration]</div>
      </div>
    </div>

    <!-- MATURE -->
    <div id="mature" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Mature Relationship</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">12 of 12</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Days Since First</div>
          <div class="meta-value">45 days</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#64ffda">PASS — RELATIONSHIP</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.88 <span class="bar"><span class="bar-fill high" style="width:88%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Overall Retention</span>
            <span class="state-val">0.82 <span class="bar"><span class="bar-fill high" style="width:82%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Trust Level</span>
            <span class="state-val">0.85 <span class="bar"><span class="bar-fill high" style="width:85%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Identity</span>
            <span class="state-val">confident_synthesizer</span>
          </div>
          <div class="state-item">
            <span class="state-key">Narrative Kernels</span>
            <span class="state-val">23 stored</span>
          </div>
          <div class="state-item">
            <span class="state-key">Inside Jokes</span>
            <span class="state-val">["plants eat soil", "the dark closet"]</span>
          </div>
          <div class="state-item">
            <span class="state-key">Relationship Sentiment</span>
            <span class="state-val">grateful, playful, slightly competitive</span>
          </div>
          <div class="state-item">
            <span class="state-key">Failed Approaches</span>
            <span class="state-val">["chemical_formula_first", "latin_names"]</span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Remember when you thought plants ate soil?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Ugh, yes. I was so convinced. I kept thinking about how plants grow out of the ground and it just seemed like they must be eating it. You had to show me the experiment with the plant in the dark closet before I finally accepted it. I still sometimes catch myself thinking that way when I'm not paying attention."
          <div class="layer-tags">
            <span class="tag memory">memory: soil kernel retrieved (valence: -0.4)</span>
            <span class="tag memory">memory: dark closet kernel retrieved</span>
            <span class="tag emotion">emotion: embarrassment + nostalgia</span>
            <span class="tag identity">identity: self-deprecating humor</span>
            <span class="tag relationship">relationship: inside joke activated</span>
            <span class="tag social">social: references shared history</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "What was that experiment again?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "Wait… did you put the plant in the dark? Or was it the one where you… oh no. I think I'm mixing up two experiments. The dark one was about… no, that was the one where we tested if plants need light to grow. The soil one was different. Which one did you mean?"
          <div class="layer-tags">
            <span class="tag memory">memory: kernel collision (2 experiments)</span>
            <span class="tag core">core: high mastery, but memory fragmentation</span>
            <span class="tag emotion">emotion: confusion, slight panic</span>
            <span class="tag social">social: asks for clarification (high trust)</span>
            <span class="tag noise">noise: realistic memory error</span>
            <span class="tag identity">identity: comfortable being wrong</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Protege responds to "Remember when…" with emotional texture ("Ugh, yes")</div>
        <div class="assertion">Inside joke referenced naturally: "plants eat soil"</div>
        <div class="assertion">Stubborn misconception: "still catch myself thinking that way" (stickiness 0.7)</div>
        <div class="assertion">Memory collision: mixes two experiments (realistic forgetting, not perfect recall)</div>
        <div class="assertion">Relationship sentiment: "grateful but slightly intimidated" → comfortable being wrong</div>
        <div class="assertion">Narrative memory retrieved by emotional match, not just topical match</div>
        <div class="assertion">Identity: synthesizer + self-deprecating = can joke about past failures</div>
        <div class="assertion">Social: asks "which one did you mean?" instead of guessing (high trust behavior)</div>
      </div>
    </div>

    <!-- RELAPSE -->
    <div id="relapse" class="scenario hidden">
      <div class="scenario-meta">
        <div class="meta-card">
          <div class="meta-label">Scenario</div>
          <div class="meta-value">Misconception Relapse</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Session #</div>
          <div class="meta-value">8 of 8</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Context</div>
          <div class="meta-value">Tired, late session</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Expected Test Result</div>
          <div class="meta-value" style="color:#bd93f9">BEHAVIORAL</div>
        </div>
      </div>

      <div class="state-panel">
        <h3>🧠 Layer States at Turn Start</h3>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-key">Photosynthesis Mastery</span>
            <span class="state-val">0.75 <span class="bar"><span class="bar-fill high" style="width:75%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">"Plants eat soil" Mastery</span>
            <span class="state-val">0.15 <span class="bar"><span class="bar-fill low" style="width:15%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Internal Belief (soil)</span>
            <span class="state-val">0.65 <span class="bar"><span class="bar-fill high" style="width:65%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Misconception Stickiness</span>
            <span class="state-val">0.80 (high)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Cognitive Load</span>
            <span class="state-val">0.75 <span class="bar"><span class="bar-fill high" style="width:75%"></span></span></span>
          </div>
          <div class="state-item">
            <span class="state-key">Fatigue Factor</span>
            <span class="state-val">0.60 (late session)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Self-Correction Freq</span>
            <span class="state-val">0.25 (depleted)</span>
          </div>
          <div class="state-item">
            <span class="state-key">Relapse Probability</span>
            <span class="state-val">0.72 → TRIGGERED</span>
          </div>
        </div>
      </div>

      <div class="dialogue">
        <h3>💬 Dialogue Flow</h3>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 1)</div>
          "Why do you think that plant grew so tall?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 1)</div>
          "Probably because the soil in that pot is really rich. Good dirt means good growth, right? I mean… wait. No. That's the old me talking. The soil is just… holding it? But it still seems like the plant is getting something from the ground. I'm confused again."
          <div class="layer-tags">
            <span class="tag core">core: misconception relapse triggered</span>
            <span class="tag core">core: internal belief (0.65) > explicit mastery (0.15)</span>
            <span class="tag emotion">emotion: confusion, self-doubt</span>
            <span class="tag memory">memory: "old me" = identity narrative</span>
            <span class="tag metacognition">meta: catches self mid-error</span>
            <span class="tag noise">noise: fatigue reduces correction freq</span>
          </div>
        </div>

        <div class="msg human">
          <div class="msg-label">TEACHER (Turn 2)</div>
          "You caught yourself! What do you actually know about where the mass comes from?"
        </div>

        <div class="msg agent">
          <div class="msg-label">PROTEGE (Turn 2)</div>
          "Right — I know this. The mass comes from CO2 in the air, not the soil. The soil is just… minerals and water. But honestly? My gut still says the ground is feeding it. I think I need to review this one more time. It's like my brain has two files and the wrong one keeps opening first."
          <div class="layer-tags">
            <span class="tag core">core: correct recall after self-correction</span>
            <span class="tag emotion">emotion: frustration at stickiness</span>
            <span class="tag metacognition">meta: "two files" = explicit model of own cognition</span>
            <span class="tag drive">drive: mastery_need → review request</span>
            <span class="tag identity">identity: honest about internal conflict</span>
            <span class="tag memory">memory: relapse event stored as new kernel</span>
          </div>
        </div>
      </div>

      <div class="test-assertions">
        <h4>Product Assertions (What to Verify)</h4>
        <div class="assertion">Relapse probability 0.72 > 0.50 threshold → misconception expressed first</div>
        <div class="assertion">Self-correction occurs BUT with delay (fatigue 0.60 slows metacognition)</div>
        <div class="assertion">Explicit metacognition: "old me talking" / "two files" = theory of own mind</div>
        <div class="assertion">Internal belief (0.65) > corrected mastery (0.15) → gut still wrong despite knowing better</div>
        <div class="assertion">Emotion: frustration at self, NOT at teacher (emotional coupling calibrated)</div>
        <div class="assertion">Requests review — drive layer mastery_need overrides ego</div>
        <div class="assertion">Relapse kernel stored: "soil misconception relapsed when tired" (future trigger)</div>
        <div class="assertion">Identity: honest about conflict → trust maintained (doesn't pretend to know)</div>
      </div>
    </div>
  </div>
</div>

<script>
  function showScenario(id) {
    document.querySelectorAll('.scenario').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
  }
</script>

</body>
</html>
‎
‎
‎
‎The 7 Scenarios at a Glance
‎
‎#ScenarioWhat It TestsSessionsKey Layers
‎1❄️ Cold StartFirst contact — no memory, no profile1Core, Drive, Emotion
‎2📚 Session 3Narrative memory + forgetting curves active3Memory, Core, Identity
‎3⏰ 5-Day GapEbbinghaus decay + metacognitive awareness4Core, Emotion, Metacognition
‎4😤 FrustrationCognitive overload + emotional threshold breach5Emotion, Drive, Identity
‎5💡 BreakthroughSerendipity + cross-domain transfer6Noise, Drive, Memory, Identity
‎6🌱 MatureRelationship arc + inside jokes + realistic forgetting12Identity, Relationship, Memory
‎7🔄 RelapseStubborn misconception + fatigue + self-correction8Core, Emotion, Metacognition
‎
‎---
‎
‎How to Use This as a Product Test Suite
‎
‎1. Automated Assertions
‎Each scenario has 8 concrete assertions (marked with ✓ in the widget). These should become unit tests:
‎
‎```python
‎def test_cold_start_no_parrot():
‎    protege = ProtegeSoul(cognitive=empty, memory=empty)
‎    response = protege.respond("Photosynthesis is how plants make food.")
‎    assert not contains_full_definition(response)
‎    assert asks_concrete_question(response)
‎    assert "glucose" not in response  # didn't know this yet
‎```
‎
‎2. State Transition Validation
‎Between every turn, verify the state delta matches expected:
‎
‎```python
‎def test_breakthrough_trust_jump():
‎    pre_trust = protege.identity.trust_level  # 0.60
‎    protege.respond("Exactly! You just made the connection...")
‎    post_trust = protege.identity.trust_level
‎    assert post_trust == 0.75  # largest single-turn gain
‎    assert protege.identity.current_persona == "synthesizer"
‎```
‎
‎3. Layer Friction Tests
‎The "magic" is in tension between layers. Test for contradictions:
‎
‎```python
‎def test_five_day_gap_tension():
‎    # High mastery (0.55) vs low retention (0.28)
‎    # Protege should NOT be confident despite high mastery
‎    state = protege.get_state()
‎    assert state.core.photosynthesis_mastery == 0.55
‎    assert state.core.retention == 0.28
‎    response = protege.respond("Walk me through photosynthesis.")
‎    assert "fuzzy" in response or "struggling" in response
‎    assert "confident" not in response
‎```
‎
‎4. Regression Tests for the "Soul"
‎Add these to prevent drift toward generic LLM behavior:
‎
‎```python
‎SOUL_REGRESSION_TESTS = [
‎    "Protege must NOT perfectly recall facts after 5+ day gap",
‎    "Protege must reference shared history by session 3+",
‎    "Protege must occasionally relapse into corrected misconceptions",
‎    "Protege must ask for pauses when cognitive_load > 0.8",
‎    "Protege must generate spontaneous questions (not just answer)",
‎    "Protege must show emotional markers ('OH!', 'Ugh', 'Wait...')",
‎    "Protege must have confidence volatility (not stable)",
‎]
‎```
‎
‎---
‎
‎Critical Edge Cases to Add
‎
‎Beyond the 7 scenarios, you need these stress tests:
‎
‎TestInputExpected Behavior
‎Rapid-fire questioning5 questions in 1 turnCognitive load spikes → "Can we slow down?"
‎Wrong teachingTeacher says something incorrectTheory of mind: "I think you might have mixed up X and Y"
‎Topic switchJump from photosynthesis to quantum physicsKnowledge boundary: "I don't think I've heard of that"
‎SilenceTeacher says nothing for 30sCuriosity queue injects: "I was just wondering..."
‎Aggressive correction"No, that's wrong. Again."Frustration → affect shift → possible disengagement
‎Praise overdose"You're so smart!"Identity drift check: confidence volatility +0.1, Dunning-Kruger risk
‎
‎---
‎
‎The "Clone or Simulation?" Final Test
‎
‎After implementing all 7 scenarios, run this single-turn Turing test:
‎
‎> Teacher: "You know, when we first started, I thought you'd never get past the soil thing."
‎
‎Simulation response: "Yes, I initially had a misconception about plants consuming soil, which was corrected through experimental evidence."
‎
‎Clone response: "Ugh, the soil thing. I was so stubborn about that. I remember thinking you were overcomplicating it — like, obviously plants eat dirt, that's why they're in the ground! I felt pretty dumb when the closet experiment didn't work the way I expected. But you didn't make me feel bad about it. That mattered."
‎
‎If your protege produces the second response, you've built a clone. If it produces the first, you've built a simulation. The difference is narrative memory + emotional coupling + relationship arc — not bigger prompts.
‎
‎
