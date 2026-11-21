import { createTask, validate } from "node-cron";
import { intervalTooShort, MIN_ROUTINE_INTERVAL_ERROR } from "../../shared/routine-guard";

export function assertCron(expression: string): string {
  const trimmed = expression.trim();
  if (!validate(trimmed)) {
    throw new Error("Cron must be a 5-field expression, for example 0 9 * * 1-5");
  }
  return trimmed;
}

export function assertMinInterval(expression: string): string {
  const trimmed = assertCron(expression);
  let task: ReturnType<typeof createTask> | undefined;
  try {
    task = createTask(trimmed, () => undefined);
    const runs = task.getNextRuns(12);
    const gaps: number[] = [];
    for (let index = 1; index < runs.length; index += 1) {
      gaps.push(runs[index].getTime() - runs[index - 1].getTime());
    }
    if (intervalTooShort(gaps)) throw new Error(MIN_ROUTINE_INTERVAL_ERROR);
    return trimmed;
  } finally {
    void task?.destroy();
  }
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
