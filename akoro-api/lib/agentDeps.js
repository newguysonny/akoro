// Boot-installed dependencies. app.js sets them before any handler runs.
let deps = null;
export function setAgentDeps(next) { deps = next; }
export function agentDeps() {
  if (!deps) throw new Error("agent dependencies are not installed yet");
  return deps;
}
