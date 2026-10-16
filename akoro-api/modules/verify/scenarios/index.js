// The scenario registry. Add a scenario: export it from an area file and list it here.
import { healthBuild, toolsCatalogue } from "./smoke.js";
import { scheduleMessageHere, toolErrorHonesty, historyTools, readToolsRun, dryRunNoWrites } from "./chat.js";
import { followUpDeliverIntoChat, taskDueInMinutes, noResidue } from "./writes.js";
import { viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup } from "./selftool.js";
import { privacyEdges } from "./network.js";
import { rateLimitCountedOnce, battleEntryGates } from "./platform.js";

const ALL = [healthBuild, toolsCatalogue, scheduleMessageHere, toolErrorHonesty, historyTools, readToolsRun, dryRunNoWrites,
  privacyEdges, rateLimitCountedOnce, battleEntryGates, followUpDeliverIntoChat, taskDueInMinutes, noResidue,
  viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup];

export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.name, s]));

export const SUITES = {
  smoke: ["smoke.health_build", "smoke.tools_catalogue", "ratelimit.counted_once"],
  "agent-chat": ["chat.schedule_message_here", "chat.tool_error_honesty", "chat.history_tools", "chat.read_tools_run", "chat.dry_run_no_writes"],
  // Real changes on test learners, then proof nothing was left behind.
  writes: ["tasks.create_due_in_minutes", "followups.deliver_into_chat", "writes.no_residue"],
  "agent-network": ["network.privacy_edges"],
  battles: ["battles.entry_gates"],
  "self-tooling": ["selftool.views_match_schema", "selftool.schema_lookup_safe", "selftool.agent_uses_schema_lookup"],
  // Self-tooling scenarios that need the feature on stay in their own suite
  // (BLOCKED while the flag is off); the schema check runs everywhere.
  regression: ALL.filter((s) => s.risk !== "write" && !["selftool.schema_lookup_safe", "selftool.agent_uses_schema_lookup"].includes(s.name)).map((s) => s.name),
};
