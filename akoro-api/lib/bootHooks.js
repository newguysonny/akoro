/**
 * lib/bootHooks.js — boot-installed hooks (Phase 19 step 2). app.js imports this
 * during module evaluation, before any route, worker or job can call them, so
 * battle and tasks never import another module's internals.
 */
import { dailyRanking }          from "../modules/agent-network/index.js";
import { postChallengeRequest }  from "../modules/agent-network/index.js";
import { setAgentNetworkHooks }  from "./agentNetworkHooks.js";
import { registerBattleJobHandler } from "./battleJobHandlers.js";
import { runActivityReview }     from "../modules/self-study/index.js";
import { runTeachingTool }       from "../modules/teaching/index.js";
import { setTeachingToolRunner } from "./teachingTools.js";
import { installAgentDeps }      from "./agentDepsSetup.js";
import * as studyPrepWiring      from "../modules/adaptive-learning/index.js";
import * as decayReviewWiring    from "../modules/adaptive-learning/index.js";
import { setWorkflowWiring }     from "./workflowWiring.js";

// Phase 19 S8b: importing the wiring modules here runs their registration side
// effects (study_prep / decay_review workflows) before app.js starts any route
// or the battle worker; they then reach battle and workflows only through this
// registry.
setWorkflowWiring({
  reportCheckQuestion: studyPrepWiring.reportCheckQuestion,
  completeAgentCheckBattle: studyPrepWiring.completeAgentCheckBattle,
  ensureStudyPrepWorkflow: studyPrepWiring.ensureStudyPrepWorkflow,
  backfillStudyPrepWorkflows: studyPrepWiring.backfillStudyPrepWorkflows,
  decayReview: decayReviewWiring.decayReview,
});

// Phase 19 S7: lower modules read these from lib/agentDeps.js instead of
// importing adaptive-learning lazily. app.js imports this file at boot, before
// any route is mounted or worker starts.
installAgentDeps();

setAgentNetworkHooks({ dailyRanking, postChallengeRequest });
registerBattleJobHandler("activity-review", runActivityReview);
setTeachingToolRunner(runTeachingTool);

// app.js installs the live queues here after it starts each worker, so enqueue
// and cancel paths never import another module's worker.
export { setBattleQueue, setTaskScheduler } from "./jobQueues.js";
