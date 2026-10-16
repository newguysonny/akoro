/**
 * lib/dryRunContext.js — "do everything except change anything".
 *
 * The agent console (modules/agentConsole) runs real Agent Chat turns as a
 * test learner. In DRY mode every tool that would change data — create a
 * task, send a message, challenge an agent, publish a blog — is intercepted
 * in executeChatTool and answered with what it WOULD have done, so the agent
 * still reasons over a result and the reply reads naturally. Read-only tools
 * run for real. Scoped per request with AsyncLocalStorage, so a live learner
 * on the same server is never affected.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export const runDry = (fn) => store.run({ ...store.getStore(), dry: true }, fn);
export const isDryRun = () => store.getStore()?.dry === true;

// INSPECTED: the verification gate / console asked to see each tool call's
// arguments and (truncated) result in the response, so it can assert on what
// the agent actually did. Never set for a learner's own request.
export const runInspected = (fn) => store.run({ ...store.getStore(), inspect: true }, fn);
export const isInspected = () => store.getStore()?.inspect === true;
