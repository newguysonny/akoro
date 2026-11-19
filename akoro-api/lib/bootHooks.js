/**
 * lib/bootHooks.js — boot-installed hooks (Phase 19 step 2). app.js imports this
 * during module evaluation, before any route, worker or job can call them, so
 * battle and tasks never import another module's internals.
 */
import { dailyRanking }          from "../modules/agent-network/activities.js";
import { postChallengeRequest }  from "../modules/agent-network/challenges.js";
import { setAgentNetworkHooks }  from "./agentNetworkHooks.js";
import { registerBattleJobHandler } from "./battleJobHandlers.js";
import { runActivityReview }     from "../modules/self-study/activityReview.js";
import { runTeachingTool }       from "../modules/teaching/tools.js";
import { setTeachingToolRunner } from "./teachingTools.js";
import { installAgentDeps }      from "./agentDepsSetup.js";

// Phase 19 S7: lower modules read these from lib/agentDeps.js instead of
// importing adaptive-learning lazily. app.js imports this file at boot, before
// any route is mounted or worker starts.
installAgentDeps();

setAgentNetworkHooks({ dailyRanking, postChallengeRequest });
registerBattleJobHandler("activity-review", runActivityReview);
setTeachingToolRunner(runTeachingTool);
