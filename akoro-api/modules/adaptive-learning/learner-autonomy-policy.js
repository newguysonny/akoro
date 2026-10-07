/** Pure policy for a due learner task's proactive Agent Chat message. */

const MAX_TASK_TITLE = 180;
const MAX_TASK_DESCRIPTION = 400;

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildAutonomyTaskMessage(task) {
  const title = clean(task?.title, MAX_TASK_TITLE) || "your planned study task";
  const description = clean(task?.description, MAX_TASK_DESCRIPTION);
  const priority = ["high", "medium", "low"].includes(task?.priority) ? task.priority : "planned";
  const detail = description ? ` You wrote: “${description}”` : "";
  return `Your ${priority}-priority task is due: “${title}”. I’ve opened this chat so we can work through it together.${detail} What would you like to tackle first?`;
}
