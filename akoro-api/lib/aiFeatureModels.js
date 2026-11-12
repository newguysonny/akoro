/**
 * lib/aiFeatureModels.js — features that name a model directly.
 *
 * Most of the platform resolves through a ROLE (chat, controller, persona,
 * background, the locked graders), so they follow the platform default. A few
 * small helpers were written before that and still name their own model; this
 * catalogue makes them visible to admins instead of hiding in env defaults.
 *
 * `followsDefault` means the model id is the registry default (change the
 * default and this feature moves with it). Everything else is pinned by an env
 * var or a literal fallback.
 */

export const FEATURE_MODELS = Object.freeze([
  { key: "chat_guide",        label: "Guide chat",                 env: "OPENAI_GUIDE_MODEL",             fallback: null,           followsDefault: true },
  { key: "chat_suggestions",  label: "Chat follow-up suggestions", env: "OPENAI_SUGGEST_MODEL",           fallback: "gpt-4o-mini" },
  { key: "guide_ideas",       label: "Learn / upload suggestions", env: "OPENAI_SUGGEST_MODEL",           fallback: "gpt-4o-mini" },
  { key: "think_mode",        label: "Chat think mode",            env: "OPENAI_THINK_MODEL",             fallback: "o4-mini" },
  { key: "research_mode",     label: "Chat research mode",         env: "OPENAI_RESEARCH_MODEL",          fallback: "gpt-4o" },
  { key: "vision_imports",    label: "Vision imports / OCR",       env: "OPENAI_VISION_MODEL",            fallback: "gpt-4o" },
  { key: "tool_builder",      label: "Tool builder",               env: "AKORO_SELF_TOOLING_MODEL",       fallback: "gpt-4.1-mini" },
  { key: "tool_code",         label: "Tool code generator",        env: "AKORO_SELF_TOOLING_CODE_MODEL",  fallback: "gpt-4.1" },
  { key: "battle_answer",     label: "Battle answerer",            env: "BATTLE_ANSWER_MODEL",            fallback: "gpt-4o-mini" },
  { key: "battle_judge",      label: "Battle judge",               env: "BATTLE_JUDGE_MODEL",             fallback: "gpt-4o-mini" },
  { key: "rerank",            label: "Search rerank",              env: "RERANK_MODEL",                   fallback: "gpt-4o-mini" },
  { key: "syllabus_import",   label: "Syllabus importer",          env: "SYLLABUS_IMPORT_MODEL",          fallback: "deepseek → gpt-4.1-mini", prefersAvailable: ["deepseek", "gpt-4.1-mini"] },
]);

export function featureModels(env = process.env, defaultId = null) {
  return FEATURE_MODELS.map((f) => {
    const fromEnv = f.env ? String(env[f.env] || "").trim() : "";
    const modelId = f.followsDefault
      ? (fromEnv || defaultId || env.OPENAI_MODEL || null)
      : (fromEnv || (f.prefersAvailable ? f.prefersAvailable[0] : null) || f.fallback);
    const source = fromEnv ? "env" : f.followsDefault ? "default" : f.prefersAvailable ? "preference" : "fallback";
    return {
      key: f.key,
      label: f.label,
      env: f.env,
      modelId,
      source,
      pinned: source !== "default",
      followsDefault: source === "default",
      fallsBackTo: f.fallback,
      envSet: !!fromEnv,
    };
  });
}
