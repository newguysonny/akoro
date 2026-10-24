import assert from "node:assert/strict";
import test from "node:test";

import { requiresAgentCapabilitiesTool } from "./agent-chat-intent.js";

test("common learner ability questions require the live capabilities tool", () => {
  for (const message of [
    "What are your abilities?",
    "What can you do?",
    "What's your features?",
    "What features does the agent have?",
    "How can Akoro help me?",
    "What are you able to do?",
  ]) {
    assert.equal(requiresAgentCapabilitiesTool(message), true, message);
  }
});

test("ordinary study questions remain for the unified agent prompt to answer directly", () => {
  for (const message of ["Explain photosynthesis", "Quiz me on Algebra", "I have a Biology test tomorrow"]) {
    assert.equal(requiresAgentCapabilitiesTool(message), false, message);
  }
});

import { requiresActivityPreparation, isDraftFollowUp } from "./agent-chat-intent.js";

test("instructor activity requests force prepare_activity — the prose detour is closed", () => {
  // The live hallucination transcript: these MUST reach the tool, and the
  // tool (not the model) decides what is still missing.
  assert.equal(requiresActivityPreparation(
    "Family, due tomorrow 8pm, assignments on family week 1, for the whole class, normal questions on Family"), true);
  assert.equal(requiresActivityPreparation("Create a quiz on fractions for JSS1"), true);
  assert.equal(requiresActivityPreparation("Prep an assignment on photosynthesis"), true);
});

test("a short confirmation continues a pending request instead of losing it", () => {
  const history = [
    { role: "user", content: "Family, due tomorrow 8pm, assignments on family week 1, for the whole class" },
    { role: "assistant", content: "I can help you create questions about the topic of family…" },
  ];
  assert.equal(requiresActivityPreparation("Proceed", history), true);
  assert.equal(requiresActivityPreparation("Proceed with the assignment", history), true);
  assert.equal(requiresActivityPreparation("yes", history), true);
  assert.equal(requiresActivityPreparation("The topic is family, the questions should be 5 questions..", history), true);
  assert.equal(requiresActivityPreparation("use the class", history), true);
});

test("confirmations never start a request and reads/tutoring never force the tool", () => {
  // No pending activity request in history → a bare "Proceed" is not a force.
  assert.equal(requiresActivityPreparation("Proceed", [
    { role: "user", content: "Explain photosynthesis" },
    { role: "assistant", content: "Photosynthesis is…" },
  ]), false);
  // Reads about activities are not creation requests.
  assert.equal(requiresActivityPreparation("show my drafts"), false);
  assert.equal(requiresActivityPreparation("What assignments did I assign last week?"), false);
  assert.equal(requiresActivityPreparation("check the results of the quiz"), false);
  // Tutoring asks, even with an activity noun, stay in conversation.
  assert.equal(requiresActivityPreparation("Quiz me on Algebra"), false);
  assert.equal(requiresActivityPreparation("test me on yesterday's topic"), false);
  assert.equal(requiresActivityPreparation("Explain photosynthesis"), false);
});

import { requiredLearnerDataTool } from "./agent-chat-intent.js";

test("the live hallucination transcript now forces the matching directory tool", () => {
  // 2026-10-01, answered from general knowledge with tools=0 and an invented
  // subject list — these MUST reach the school's own records.
  assert.equal(requiredLearnerDataTool("What subjects do we have in the class?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("Which subjects are we offering this term?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("List the subjects in my school"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("What subjects does the school have?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("Who is my teacher?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("Who teaches us Mathematics?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("Who are my teachers this term?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("What's my school name?"), "get_my_school");
  assert.equal(requiredLearnerDataTool("Tell me about my school"), "get_my_school");
  assert.equal(requiredLearnerDataTool("Which school am I in?"), "get_my_school");
  assert.equal(requiredLearnerDataTool("How am I doing?"), "check_progress");
  assert.equal(requiredLearnerDataTool("What's my progress like?"), "check_progress");
  // Live 2026-10-01: this exact question was answered with the SCHOOL's
  // subject catalogue framed as "subjects you have learned" — the learner's
  // teaching history is a different tool and MUST win over the catalogue.
  assert.equal(requiredLearnerDataTool("What subjects have I learnt so far with my protégé, my agent on here and the topics"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("What have I learnt so far?"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("Show my learning sessions"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("my learning history"), "get_my_learning_sessions");
  // The catalogue question still routes to the catalogue.
  assert.equal(requiredLearnerDataTool("What subjects do we have in the class?"), "list_school_subjects");
});

test("conversational mentions never force a directory lookup", () => {
  for (const message of [
    "Explain photosynthesis",
    "My teacher said I should revise algebra",   // mention, not an identity question
    "I hate my subjects",                        // opinion, not a list question
    "Can you prep me for my exam?",
    "Hey",
    "my school fees are due",                    // fees are not school identity
    "Teach my protégé about photosynthesis",     // a session-start ask, not history
  ]) {
    assert.equal(requiredLearnerDataTool(message), null, message);
  }
});

import { requiredStudyPrepTool } from "./agent-chat-intent.js";

test("the live test-planning transcript now forces the study-prep session", () => {
  // 2026-10-01: the learner asked to plan a test twice; the model had
  // start_study_prep_session available and never called it — tools=0, a
  // generic four-question planning questionnaire both times. These MUST
  // reach the study-prep workflow.
  assert.equal(requiredStudyPrepTool("let's plan for a test"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("let's plan for a test for these sessions"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("Using our sessions, let's plan for a test coming up next week friday"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("Help me prepare for my exam"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("I want to revise for my maths test"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("Can you prep me for my exam?"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("How should I prepare for my WAEC exam?"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("exam prep please"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("I need to get ready for my chemistry test"), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("study for my test next week"), "start_study_prep_session");
});

test("a short confirmation after an upcoming-test mention starts the session", () => {
  const history = [
    { role: "user", content: "I have a Biology test tomorrow" },
    { role: "assistant", content: "I can set up a study plan for it — want me to?" },
  ];
  assert.equal(requiredStudyPrepTool("yes", history), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("yes please let's do it", history), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("let's do it", history), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("ok biology", history), "start_study_prep_session");
  // Short tutoring imperatives/questions are a different need, not a yes.
  assert.equal(requiredStudyPrepTool("Explain photosynthesis", history), null);
  assert.equal(requiredStudyPrepTool("what is osmosis", history), null);
});

test("status and resume questions read the session instead of starting one", () => {
  for (const message of [
    "how is my study prep going",
    "Study prep status",
    "continue my study prep",
    "where were we on my exam prep",
  ]) {
    assert.equal(requiredStudyPrepTool(message), "get_study_prep_session", message);
  }
});

test("tutoring, bare mentions and factual questions never start a session", () => {
  for (const message of [
    "Quiz me on Algebra",                        // tutoring in chat
    "test me on yesterday's topic",              // tutoring in chat
    "Explain photosynthesis",
    "I have a Biology test tomorrow",            // bare mention — the agent offers; the confirm force catches the yes
    "I have my JAMB in 2 weeks",                 // named-exam bare mention — still an offer, not a force
    "What is study prep?",                       // a question about the feature, not a request
    "When is my exam?",                          // factual query
    "When is my WASSCE?",                        // factual query with a named exam
    "What did I score on my test?",
    "Have I prepared enough for my test?",
    "Explain photosynthesis for my exam tomorrow", // tutoring imperative — the topic is the need, not the plan
  ]) {
    assert.equal(requiredStudyPrepTool(message), null, message);
  }
  // No pending test mention in the conversation → a bare confirm never starts one.
  assert.equal(requiredStudyPrepTool("yes", [
    { role: "user", content: "Explain photosynthesis" },
    { role: "assistant", content: "Photosynthesis is…" },
  ]), null);
});

test("the live WASSCE transcript now forces the study-prep session", () => {
  // 2026-10-03: the exact live phrasing that produced a tips-only reply.
  assert.equal(requiredStudyPrepTool("I have WASSCE Physics in three weeks, help me prepare"), "start_study_prep_session");
});

test("named exams and real-world timing force the study-prep session", () => {
  for (const message of [
    "My JAMB is in 2 weeks, I need to revise",
    "I want to study for my UTME",
    "help me get ready for my NECO exam",
    "How do I prepare for WASSCE?",
    "I have my GCE in a month, let's plan",
    "my exam is coming up, help me plan",
    "can you prep me for my NABTEB?",
    "Help me revise for my IGCSE maths paper",
  ]) {
    assert.equal(requiredStudyPrepTool(message), "start_study_prep_session", message);
  }
});

test("a named-exam mention plus a short confirmation starts the session", () => {
  const history = [
    { role: "user", content: "I have my JAMB in 2 weeks" },
    { role: "assistant", content: "Would you like to start a study-prep session?" },
  ];
  assert.equal(requiredStudyPrepTool("yes", history), "start_study_prep_session");
  assert.equal(requiredStudyPrepTool("let's do it", history), "start_study_prep_session");
});

test("named-exam status questions read the session instead of starting one", () => {
  for (const message of [
    "how is my waec prep going",
    "continue my jamb prep",
  ]) {
    assert.equal(requiredStudyPrepTool(message), "get_study_prep_session", message);
  }
});

test("can-you ability questions force the live capabilities tool — the blog denial is closed", () => {
  // Live 2026-10-01: "Can you research from the platform blog?" was answered
  // from general knowledge — the model DENIED having the Akoro blog research
  // tools that were in its tool list. Ability probes must come from the live
  // catalogue, not the model's self-image.
  for (const message of [
    "Can you research from the platform blog?",
    "Can you communicate with other agents?",
    "Can you search the web?",
    "Can you access the internet?",
    "can you browse the akoro blog for me",
    "Do you have access to past questions?",
  ]) {
    assert.equal(requiresAgentCapabilitiesTool(message), true, message);
  }
  // Requests for actual work are not ability probes.
  for (const message of [
    "Can you help me with algebra?",
    "Can you explain photosynthesis?",
    "Can you find my homework?",
    "Can you read my attachment?",
  ]) {
    assert.equal(requiresAgentCapabilitiesTool(message), false, message);
  }
});

test("cancelling a study plan is never read as a yes to starting one (2026-10-19)", async () => {
  const { requiredStudyPrepTool } = await import("./agent-chat-intent.js");
  const history = [{ role: "user", content: "I have WAEC Biology in 6 weeks, make me a study plan" }];
  for (const text of ["Cancel the plan", "cancel my study plan", "Stop the study prep", "delete that plan please"]) {
    assert.equal(requiredStudyPrepTool(text, history), "cancel_study_prep_session", text);
  }
  assert.equal(requiredStudyPrepTool("make me a study plan for WAEC Biology in 6 weeks", []), "start_study_prep_session");
});

test("an exam says the class when the learner doesn't", async () => {
  const { classForExam } = await import("./agent-chat-intent.js");
  assert.equal(classForExam("WAEC"), "SS3");
  assert.equal(classForExam("bece"), "JSS3");
  assert.equal(classForExam("Cambridge"), null);
});

/* Found by the instructor-chat gate scenarios: each of these used to start a
   stray draft (or revise a pending one) next to the right tool. */
test("library resources, routines and draft/routine management never force prepare_activity", () => {
  const history = [
    { role: "user", content: "Set a Basic Science self study on photosynthesis for @tester19" },
    { role: "assistant", content: "Draft ready — preview it to assign." },
  ];
  // Teaching-tool requests (run_teaching_tool → Library)
  for (const m of ["Make a lesson plan on fractions for JSS1 Mathematics, 40 minutes.",
    "Give me lesson hooks for the water cycle, JSS1 Basic Science.",
    "Make a vocabulary list for photosynthesis, JSS1 Basic Science.",
    "Make a podcast about fractions"]) {
    assert.equal(requiresActivityPreparation(m, history), false, m);
    assert.equal(isDraftFollowUp(m), false, `${m} is not an edit of the pending draft`);
  }
  // A recurring ask is a routine, not a draft now
  assert.equal(requiresActivityPreparation("Every Friday, prepare a Basic Science self study on revision for @tester19.", history), false);
  assert.equal(requiresActivityPreparation("Set a weekly quiz on fractions for my class", history), false);
  // Managing something that exists
  for (const m of ["Show me that draft.", "Cancel that routine.", "Discard it.", "Open the draft", "List my routines"]) {
    assert.equal(requiresActivityPreparation(m, history), false, m);
  }
  assert.equal(isDraftFollowUp("Discard it, I don't need it."), false);
  assert.equal(isDraftFollowUp("Cancel that draft"), false);
});

test("the guards still force and revise where they should", () => {
  const history = [{ role: "user", content: "Prepare an assignment on family for the whole class" }, { role: "assistant", content: "Which class?" }];
  assert.equal(requiresActivityPreparation("Prepare an assignment on fractions for JSS1", history), true);
  assert.equal(requiresActivityPreparation("Prepare an assignment from my lesson plan on fractions"), true, "an activity noun still forces");
  assert.equal(requiresActivityPreparation("Proceed", history), true);
  assert.equal(requiresActivityPreparation("use the class", history), true);
  // Edits of a pending draft are still edits
  assert.equal(isDraftFollowUp("Make question 2 harder"), true);
  assert.equal(isDraftFollowUp("Add a part with 2 true or false questions"), true);
  assert.equal(isDraftFollowUp("remove question 3"), true);
});

/* More from the gate: a battle edit, and Library resources that name "questions". */
test("'make it …' edits the pending draft; homework sheets and worksheets are Library resources", () => {
  assert.equal(isDraftFollowUp("Make it a hard battle, and add the note: bring a calculator."), true);
  assert.equal(isDraftFollowUp("Make it harder"), true);
  assert.equal(isDraftFollowUp("Please turn this into a shorter one"), true);
  assert.equal(isDraftFollowUp("Make a new assignment on fractions"), false, "a NEW activity is still new");
  assert.equal(isDraftFollowUp("Make a lesson plan for it"), false, "a resource request is not an edit");
  for (const m of ["Make a homework sheet with a marking scheme on fractions for JSS1 Mathematics, 10 questions.",
    "Give me a worksheet on photosynthesis with 8 questions", "Make a handout on the water cycle"]) {
    assert.equal(isDraftFollowUp(m), false, `${m} is not an edit`);
    assert.equal(requiresActivityPreparation(m, [{ role: "user", content: "Set a quiz for JSS1" }]), false, `${m} does not force a draft`);
  }
  assert.equal(requiresActivityPreparation("Create an assignment with 10 questions on fractions"), true, "an assignment is still an activity");
});

test("with a teaching-resource draft pending, an edit of it is a follow-up and a new resource is not", async () => {
  const { isToolDraftFollowUp } = await import("./agent-chat-intent.js");
  for (const m of ["make the hooks more playful", "make it shorter", "add two more misconceptions", "go back to version 1", "change the third hook to use a story", "make it a bit shorter"]) {
    assert.equal(isToolDraftFollowUp(m), true, m);
  }
  for (const m of ["make a podcast on fractions for JSS1", "give me a new lesson plan on the water cycle", "create another vocabulary list", "what's the weather", "discard it"]) {
    assert.equal(isToolDraftFollowUp(m), false, m);
  }
});
