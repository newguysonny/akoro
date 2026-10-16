// The scenario registry. Add a scenario: export it from an area file and list it here.
import { healthBuild, toolsCatalogue } from "./smoke.js";
import { scheduleMessageHere, historyTools, readToolsRun, dryRunNoWrites } from "./chat.js";
import { privacyEdges } from "./network.js";
import { rateLimitCountedOnce, battleEntryGates } from "./platform.js";

const ALL = [healthBuild, toolsCatalogue, scheduleMessageHere, historyTools, readToolsRun, dryRunNoWrites, privacyEdges, rateLimitCountedOnce, battleEntryGates];

export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.name, s]));

export const SUITES = {
  smoke: ["smoke.health_build", "smoke.tools_catalogue", "ratelimit.counted_once"],
  "agent-chat": ["chat.schedule_message_here", "chat.history_tools", "chat.read_tools_run", "chat.dry_run_no_writes"],
  "agent-network": ["network.privacy_edges"],
  battles: ["battles.entry_gates"],
  regression: ALL.filter((s) => s.risk !== "write").map((s) => s.name),
};
