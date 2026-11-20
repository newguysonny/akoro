// Shared preconditions for the self-tooling scenarios.
export const needCreate = async (ctx) => {
  const { getLearnerChatTools } = await import("../../../adaptive-learning/index.js");
  if (!getLearnerChatTools().some((t) => t.name === "create_tool")) ctx.expect.blocked("self-tooling is off on this server");
};
