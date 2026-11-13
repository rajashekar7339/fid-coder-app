import { createTask, validate } from "node-cron";

export function assertCron(expression: string): string {
  const trimmed = expression.trim();
  if (!validate(trimmed)) {
    throw new Error("Cron must be a 5-field expression, for example 0 9 * * 1-5");
  }
  return trimmed;
}

export function nextRunIso(expression: string): string | null {
  // A stopped task reports no getNextRun(). getNextRuns still walks the pattern.
  // destroy drops the task from node-cron's process-wide registry.
  let task: ReturnType<typeof createTask> | undefined;
  try {
    task = createTask(expression, () => undefined);
    const next = task.getNextRuns(1)[0];
    return next ? next.toISOString() : null;
  } catch {
    return null;
  } finally {
    void task?.destroy();
  }
}
