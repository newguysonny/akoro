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

setAgentNetworkHooks({ dailyRanking, postChallengeRequest });
registerBattleJobHandler("activity-review", runActivityReview);
setTeachingToolRunner(runTeachingTool);
