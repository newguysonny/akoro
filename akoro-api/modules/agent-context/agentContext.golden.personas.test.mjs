import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * P2 golden gate (Context Layer Adoption mini-plan, D1): the persona-agent
 * prompts — NaNa Esumai, Sargeant/SergeantProctor, and the shared Student
 * clone — now load from akoro-agent/agents/<persona>/*.md templates and fill
 * {{token}} placeholders. The fixture was captured from the pre-migration
 * agent sources before this migration; a byte that drifts here means a
 * persona silently changed.
 *
 * Also pins the template engine's fail-loud contract and the single-source
 * rule (no persona prompt literals left in the agent files).
 */

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/persona-agents.golden.json", import.meta.url), "utf8"),
);
const nana = await import("./personas/nana-esumai.js");
const sargeant = await import("./personas/sargeant.js");
const clone = await import("./personas/student-clone.js");
const student = await import("./personas/student.js");
const { fillTemplate } = await import("./template.js");

const BUILDERS = {
  "nana-knowledge-map": () => nana.buildKnowledgeMapPrompt(),
  "nana-objectives": () => nana.buildObjectivesPrompt(),
  "nana-open-subtopic": (v) => nana.buildOpenSubtopicPrompt(v),
  "nana-coach-turn": (v) => nana.buildCoachTurnPrompt(v),
  "nana-push-further": (v) => nana.buildPushFurtherPrompt(v),
  "nana-evaluate-subtopic": (v) => nana.buildEvaluateSubtopicPrompt(v),
  "nana-must-know": () => nana.buildMustKnowPrompt(),
  "nana-evidence-instruction": (v) => nana.buildEvidenceInstruction(v),
  "nana-tip-decision": (v) => nana.buildTipDecisionPrompt(v),
  "nana-class-analytics": () => nana.buildClassAnalyticsPrompt(),
  "nana-evaluate-session": () => nana.buildEvaluateSessionPrompt(),
  "sargeant-questions": (v) => sargeant.buildAssessmentQuestionsPrompt(v),
  "sargeant-evaluate": () => sargeant.buildAssessmentEvaluatePrompt(),
  "sargeant-verdict": (v) => sargeant.buildAssessmentVerdictPrompt(v),
  "sargeant-drift": (v) => sargeant.buildAssessmentDriftPrompt(v),
  "proctor-questions": (v) => sargeant.buildProctorQuestionsPrompt(v),
  "proctor-evaluate": (v) => sargeant.buildProctorEvaluatePrompt(v),
  "proctor-hint": () => sargeant.buildProctorHintPrompt(),
  "proctor-verdict": (v) => sargeant.buildProctorVerdictPrompt(v),
  "student-clone-reply": (v) => clone.buildStudentCloneReplyPrompt(v),
  "student-clone-analyze": () => clone.buildStudentCloneAnalyzePrompt(),
  "student-agent-reply": (v) => student.buildStudentAgentReplyPrompt(v),
  "student-agent-evidence": (v) => student.buildStudentAgentEvidencePrompt(v),
  "student-agent-analyze": (v) => student.buildStudentAgentAnalyzePrompt(v),
  "student-agent-extract": (v) => student.buildStudentAgentExtractPrompt(v),
  "student-personality-new-subject": (v) => student.studentPersonality("NEW_SUBJECT", v),
  "student-personality-fresh": (v) => student.studentPersonality("FRESH", v ?? {}),
  "student-personality-early": (v) => student.studentPersonality("EARLY", v),
  "student-personality-solid": (v) => student.studentPersonality("SOLID", v),
  "student-personality-advanced": (v) => student.studentPersonality("ADVANCED", v),
};

test("every persona prompt is byte-identical to the pre-migration literals", async () => {
  assert.equal(fixture.cases.length, 30);
  for (const { label, values, builderArgs, expected } of fixture.cases) {
    const build = BUILDERS[label];
    assert.ok(build, `no builder mapped for ${label}`);
    const actual = await build(builderArgs ?? values);
    assert.equal(actual, expected, `${label} drifted from the golden`);
  }
});

test("the evidence instruction keeps its leading newline (it splices mid-prompt)", async () => {
  const evidence = await nana.buildEvidenceInstruction({
    teachingEvidence: { currentConcept: { learnerMastery: 0.5, protegeUnderstanding: 0.4, masteryStatus: "unverified" } },
    dialogue: {},
  });
  assert.ok(evidence.startsWith("\nServer-owned evidence"), "the leading \\n is part of the contract");
  assert.match(evidence, /learner mastery 50%/);
  assert.match(evidence, /verified no/);
  assert.match(evidence, /dialogue move clarify_core/);   // fallback
  assert.match(evidence, /pace standard/);                 // fallback
});

test("fillTemplate fails loud: missing value, leftover token, unused value", () => {
  assert.throws(() => fillTemplate("Understanding: {{understanding}}%", {}), /no value for \{\{understanding\}\}/);
  assert.throws(() => fillTemplate("{{a}} {{b}}", { a: 1 }), /no value for \{\{b\}\}/);
  assert.throws(() => fillTemplate("Plain text", { a: 1 }), /unused values a/);
  assert.equal(fillTemplate("{{a}}% and {{a}} again", { a: 42 }), "42% and 42 again");
});

test("single-source rule (D4): the persona prompt literals exist only as workspace templates", async () => {
  const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
  const files = {
    guide: await read("../adaptive-learning/agents/nana-esumai/guide.js"),
    assessment: await read("../adaptive-learning/agents/sargeant/assessment.js"),
    proctor: await read("../adaptive-learning/agents/sargeant/proctor.js"),
    base: await read("../adaptive-learning/agents/base-orchestrator.js"),
    student: await read("../adaptive-learning/agents/student/agent.js"),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /You are NaNa Esumai/, `${name}: NaNa persona still hardcoded`);
    assert.doesNotMatch(source, /You are Sargeant\b/, `${name}: Sargeant persona still hardcoded`);
    assert.doesNotMatch(source, /You are Sergeant,/, `${name}: Sergeant proctor persona still hardcoded`);
    assert.doesNotMatch(source, /You are a Student AI Agent/, `${name}: student-clone persona still hardcoded`);
    assert.doesNotMatch(source, /You are a curriculum expert/, `${name}: curriculum-expert prompt still hardcoded`);
    assert.doesNotMatch(source, /Analyze a student AI agent's reply/, `${name}: analysis judge still hardcoded`);
    // P2b flagship: the Student Agent protégé persona + judges + personality
    // bands exist only as workspace templates.
    assert.doesNotMatch(source, /You are a Student Agent learning about/, `${name}: student-agent reply persona still hardcoded`);
    assert.doesNotMatch(source, /Evaluate the HUMAN learner's teaching message/, `${name}: evidence judge still hardcoded`);
    assert.doesNotMatch(source, /Analyze this student agent reply for understanding/, `${name}: understanding judge still hardcoded`);
    assert.doesNotMatch(source, /Extract what was LEARNED in this teaching exchange/, `${name}: extraction judge still hardcoded`);
    assert.doesNotMatch(source, /You have never been taught /, `${name}: personality bands still hardcoded`);
    assert.doesNotMatch(source, /You are an advanced learner /, `${name}: personality bands still hardcoded`);
  }
  // and the surfaces really build their prompts through the persona modules
  assert.match(files.guide, /agent-context\/personas\/nana-esumai\.js/, "guide imports the nana builders");
  assert.match(files.assessment, /agent-context\/personas\/sargeant\.js/, "assessment imports the sargeant builders");
  assert.match(files.proctor, /agent-context\/personas\/sargeant\.js/, "proctor imports the sargeant builders");
  assert.match(files.base, /agent-context\/personas\/student-clone\.js/, "base-orchestrator imports the clone builders");
  assert.match(files.student, /agent-context\/personas\/student\.js/, "the Student Agent imports its persona builders");
});
