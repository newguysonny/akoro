/**
 * lib/aiFeatureModels.js — the few calls that must name a model directly.
 *
 * Everything else now resolves through a ROLE (chat, controller, persona,
 * background, suggestions, vision, builder, rerank, battle_answer, the locked
 * graders), so the platform default is the only switch.
 *
 * Think and research mode are the exception: they use the OpenAI **Responses**
 * API (reasoning summaries, native tool events), which the chat-completions
 * transport used for the default does not speak. They stay pinned and are
 * listed here so admins can see it rather than discover it in a failure.
 */

export const FEATURE_MODELS = Object.freeze([
  { key: "think_mode",    label: "Chat think mode",    env: "OPENAI_THINK_MODEL",    fallback: "o4-mini", api: "responses",
    reason: "Responses API (reasoning summaries)" },
  { key: "research_mode", label: "Chat research mode", env: "OPENAI_RESEARCH_MODEL", fallback: "gpt-4o",  api: "responses",
    reason: "Responses API (web-search tool events)" },
]);

export function featureModels(env = process.env, defaultId = null) {
  return FEATURE_MODELS.map((f) => {
    const fromEnv = f.env ? String(env[f.env] || "").trim() : "";
    const modelId = fromEnv || f.fallback || defaultId || null;
    const source = fromEnv ? "env" : "fallback";
    return {
      key: f.key,
      label: f.label,
      env: f.env,
      modelId,
      source,
      pinned: true,
      followsDefault: false,
      fallsBackTo: f.fallback,
      envSet: !!fromEnv,
      api: f.api || "chat",
      reason: f.reason || null,
      // The platforms' roles are the rest; this list is deliberately tiny.
      defaultId,
    };
  });
}
