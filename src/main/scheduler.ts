import { schedule, validate, type ScheduledTask } from "node-cron";
import { nextRunIso } from "./cron";
import type { AppDatabase } from "./db";
import { notify } from "./notify";
import type { Runner } from "./runner";

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledTask>();

  constructor(
    private readonly db: AppDatabase,
    private readonly runner: Runner,
  ) {}

  reload(): void {
    this.stop();
    for (const routine of this.db.listEnabledRoutines()) {
      if (!validate(routine.cron)) continue;
      const task = schedule(routine.cron, () => {
        void this.fire(routine.id);
      });
      this.jobs.set(routine.id, task);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  private async fire(id: string): Promise<void> {
    const routine = this.db.getRoutine(id);
    if (!routine || !routine.enabled) return;
    const next = nextRunIso(routine.cron);
    if (this.runner.isRunning(routine.agentId)) {
      this.db.markRoutineRun(id, "skipped: agent busy", next);
      if (routine.notify) notify(routine.name, "Skipped because the agent is already working.");
      return;
    }
    try {
      const text = await this.runner.runTurn({
        agentId: routine.agentId,
        text: routine.prompt,
        source: "routine",
      });
      this.db.markRoutineRun(id, "ok", next);
      if (routine.notify) notify(routine.name, text || "Finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.markRoutineRun(id, `error: ${message}`, next);
      if (routine.notify) notify(routine.name, message);
    }
  }
}
