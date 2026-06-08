import { CONTINUATION_HISTORY } from './mockData.js';

export const PHASE_PLAN = [
  'Phase 1 → what do they know',
  'Phase 2 → must-know parts',
  'Phase 3 → teach it back',
  'Phase 4 → push further',
];

/* ══════════════════════════════════════════════════════
   MOCK BLOCK BUILDERS
   Used as fallback when real API is unavailable.
══════════════════════════════════════════════════════ */
function buildInitialBlocks(config, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  if (!config?.subtopics?.length) return [{
    type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Teach · ready",
    text:`Let's start! Teach me about **${config?.topic||"your topic"}**. Explain it as if I've never heard of it.`,
  }];
  const firstSt = config.subtopics[0];
  const objs    = config.objectives?.[firstSt] || autoObjectives(firstSt, config.topic);
  return [
    { type:"subtopic-hdr", subtopic:firstSt, idx:0, total:config.subtopics.length, topic:config.topic, subject:config.subject },
    { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"objectives", subtopic:firstSt, items:objs },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 — Set the scene",
      text:`Alright! We're starting with **${firstSt}**.\n\n${agentNm} ${agentEm}, get ready to learn. Human — your job is to teach ${agentNm} about ${firstSt}. Start with what you already know about it.` },
    { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · scanning knowledge base…`, confidence:18,
      text:`I have very limited data on ${firstSt}. What is it, and why does it matter in the context of ${config.topic}?` },
  ];
}

function buildMockQueue(config, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  if (!config?.subtopics?.length) return [];
  const queue = [];
  config.subtopics.forEach((st, idx) => {
    const isLast = idx === config.subtopics.length - 1;
    const nextSt = config.subtopics[idx + 1];
    const conf1 = 38 + Math.floor(Math.random()*10);
    const conf2 = 60 + Math.floor(Math.random()*10);
    const conf3 = 74 + Math.floor(Math.random()*12);
    const gateConf = 72 + Math.floor(Math.random()*16);

    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · processing · ${conf1}% ↑`, confidence:conf1,
        text:`I understand more now. ${st} involves a primary trigger that causes a change. What specifically controls how fast it happens?` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 gap identified",
        text:`Good start! ${agentNm} is picking up the core idea but needs more on the mechanism. Move to Phase 2 — cover the must-know parts.` },
    ]);
    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · Phase 2 · ${conf2}% ↑`, confidence:conf2,
        text:`I have it now. ${st} is triggered by a primary condition — without it nothing happens. Secondary factors control the rate. The output type is always consistent.` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 3 — Teach it back",
        text:`${agentNm} nailed the structure! Now ask for a real-world example to anchor the knowledge.` },
    ]);
    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · Phase 4 reasoning · ${conf3}% ↑`, confidence:conf3,
        text:`If the secondary factor dropped to zero, ${st} would still occur but extremely slowly. If the primary driver was removed entirely, ${st} would stop completely.` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 4 — causal reasoning confirmed",
        text:`Outstanding! ${agentNm} isn't just recalling facts — it's reasoning causally about ${st}. That's real understanding. Moving to Sargeant's gate.` },
    ]);
    if (!isLast) {
      queue.push([
        { type:"sargeant", phase:`Assessment gate — ${st}`,
          text:`Before ${agentNm} can move to ${nextSt}, I need to verify ${st} is solid.\n\nQuestion for ${agentNm}: What is the primary condition required for ${st} to occur? No hints.` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · answering Sargeant`, confidence:gateConf,
          text:`The primary condition is the core driver that makes ${st} possible at all. Without it the process cannot occur, regardless of secondary factors.` },
        { type:"assess-result", subtopic:st, nextSubtopic:nextSt, agentName:agentNm, confidence:gateConf, passed:gateConf>=70 },
        { type:"subtopic-hdr", subtopic:nextSt, idx:idx+1, total:config.subtopics.length, topic:config.topic, subject:config.subject },
        { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] },
        { type:"objectives", subtopic:nextSt, items:config.objectives?.[nextSt]||autoObjectives(nextSt,config.topic) },
        { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 — new subtopic",
          text:`${gateConf>=70?"Assessment passed ✓":"Needs work ⚠"} — moving to ${nextSt}. ${agentNm} — what do you already know about ${nextSt}?` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · scanning…`, confidence:15,
          text:`Very little data on ${nextSt}. I'm ready to learn from you.` },
      ]);
    } else {
      const finalConf = 78 + Math.floor(Math.random()*14);
      queue.push([
        { type:"sargeant", phase:"Final assessment gate",
          text:`All phases complete on ${st}. Final verification before closing the session.\n\nQ: Explain the full cause-and-effect chain of ${st} in your own words.` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · final assessment`, confidence:finalConf,
          text:`${st} begins when the primary condition is met. This triggers the core process. Secondary factors then modulate the rate. The output is always the same type but varies in magnitude.` },
        { type:"assess-result", subtopic:st, nextSubtopic:null, agentName:agentNm, confidence:finalConf, passed:finalConf>=70 },
        { type:"session-complete",
          text:`${agentNm} has learned ${config.subtopics.length} subtopic${config.subtopics.length>1?"s":""} of **${config.topic}**.\n\nKnowledge map updated · +${config.subtopics.length * 80} XP earned · Next session unlocked.` },
      ]);
    }
  });
  return queue;
}

function buildContinuationHistory(session, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  const { topic, subject, subtopicList = [], avgConfidence = 70, daysSince = 0 } = session;
  const sessionId = session.id || session.sessionId;

  // Use pre-written history if available for this session
  if (sessionId && CONTINUATION_HISTORY[sessionId]) {
    const history = CONTINUATION_HISTORY[sessionId];
    // Replace any "Aria" agent name with the actual current agent name/emoji
    const mapped = history.map(b => {
      if (b.type === "student-agent") return { ...b, agent: agentNm, emoji: agentEm };
      return b;
    });
    return [
      ...mapped,
      { type:"system-divider", label:"Continuing from here" },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠",
        phase:"Continuation — picking up where you left off",
        text:`Welcome back! ${agentNm} has ${avgConfidence}% confidence on ${topic} from last session. Continue teaching to reinforce and expand.` },
      { type:"student-agent", agent:agentNm, emoji:agentEm,
        phase:`${agentNm} · ${avgConfidence}% · ready to continue`, confidence:avgConfidence,
        text:`I remember what we covered last time. Ready to keep learning about ${topic}!` },
    ];
  }

  // Generic fallback — generated from metadata
  const prevBlocks = [];
  subtopicList.forEach((st, idx) => {
    const stConf = Math.min(100, Math.round(avgConfidence + (Math.random() * 12 - 6)));
    if (idx === 0) {
      prevBlocks.push({
        type:"subtopic-hdr", faded:true,
        subtopic:st, idx:0, total:subtopicList.length, topic, subject,
      });
      prevBlocks.push({ type:"plan", faded:true,
        phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] });
      prevBlocks.push({
        type:"guide", agent:"NaNa Esumai", emoji:"🧠", faded:true,
        phase:`Phase 2 — ${st}`,
        text:`Good session on ${st}. ${agentNm} — let's make sure the key parts are solid.`,
      });
    }
    prevBlocks.push({
      type:"student-agent", agent:agentNm, emoji:agentEm, faded:true,
      phase:`${agentNm} · Phase 3 · ${stConf}%`, confidence:stConf,
      text:`I understand ${st} now. The core concept makes sense and I can explain it back clearly.`,
    });
    prevBlocks.push({
      type:"assess-result", faded:true,
      subtopic:st, agentName:agentNm,
      confidence:stConf, passed:stConf >= 70,
      nextSubtopic:subtopicList[idx + 1] || null,
    });
  });

  return [
    { type:"system-divider", label:`Previous session · ${daysSince} days ago` },
    ...prevBlocks,
    { type:"system-divider", label:"Continuing from here" },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠",
      phase:"Continuation — picking up where you left off",
      text:`Welcome back! ${agentNm} remembers ${topic} at ${avgConfidence}% confidence. Continue teaching to reinforce and expand the knowledge.` },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · ${avgConfidence}% · ready to continue`, confidence:avgConfidence,
      text:`I remember the basics from last time. I'm ready to learn more about ${topic}!` },
  ];
}

function buildDecayHistory(alert, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  const { topic, subject, confidence, prevConfidence, daysSince, misconceptions } = alert;
  const stLabel = misconceptions?.length ? misconceptions[0] : topic;
  return [
    // ── Previous session (faded) ──────────────────────────────────────────
    { type:"system-divider", label:`Previous session — ${topic} · ${daysSince} days ago` },
    { type:"subtopic-hdr", subtopic:topic, idx:0, total:1, topic, subject, faded:true },
    { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"], faded:true },
    { type:"objectives", subtopic:topic, faded:true,
      items:[`Understand the key stages of ${topic}`,`Distinguish between related processes`,`Apply knowledge to exam questions`] },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 2 — must-know parts · previous session", faded:true,
      text:`Good progress last session. ${agentNm} — let's solidify the specific stages. Make sure to cover each one clearly.` },
    { type:"user", text:`OK ${agentNm} — so ${topic} has distinct stages, each with a specific function. Let me walk you through each one...`, faded:true },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · Phase 3 · confidence: ${prevConfidence}% (previous session)`, confidence:prevConfidence, faded:true,
      text:`I understand the stages now. My confidence has improved. I can identify each one and describe what happens.` },
    { type:"assess-result", subtopic:topic, agentName:agentNm, confidence:prevConfidence, passed:prevConfidence>=70, faded:true,
      nextSubtopic:null },
    // ── Decay notice ──────────────────────────────────────────────────────
    { type:"system-divider", label:`Now — ${daysSince} days later` },
    { type:"decay-notice", agentName:agentNm, agentEmoji:agentEm,
      topic, confidence, prevConfidence, daysSince,
      misconceptions: misconceptions || [`Confidence dropped on ${topic}`] },
    // ── NaNa kicks off the re-teach ───────────────────────────────────────
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Decay re-teach — Phase 1",
      text:`${agentNm}'s knowledge of **${topic}** has degraded (${prevConfidence}% → ${confidence}%). The specific gap: **${stLabel}**.\n\nHuman — re-teach ${topic} from scratch. Focus on the parts ${agentNm} is confusing. ${agentNm}, what do you still remember?` },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · partial recall · ${confidence}%`, confidence,
      text:`I remember the basics of ${topic} but I'm getting confused between some stages, especially ${stLabel}. My confidence has dropped to ${confidence}%. Please re-teach me.` },
  ];
}

/* ══════════════════════════════════════════════════════ */

export { buildInitialBlocks, buildMockQueue, buildContinuationHistory, buildDecayHistory };
