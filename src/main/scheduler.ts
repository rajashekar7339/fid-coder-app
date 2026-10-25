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

  async runNow(id: string): Promise<void> {
    const routine = this.db.getRoutine(id);
    if (!routine) throw new Error("Routine not found");
    if (this.runner.isRunning(routine.agentId)) throw new Error("This agent is already working");
    await this.fire(id, true);
  }

  private async fire(id: string, manual = false): Promise<void> {
    const routine = this.db.getRoutine(id);
    if (!routine || (!manual && !routine.enabled)) return;
    const next = routine.enabled ? nextRunIso(routine.cron) : null;
    if (this.runner.isRunning(routine.agentId)) {
      this.db.markRoutineRun(id, "skipped: agent busy", next);
      if (!manual && routine.notify) notify(routine.name, "Skipped because the agent is already working.");
      return;
    }
    try {
      const text = await this.runner.runTurn({
        agentId: routine.agentId,
        text: routine.prompt,
        source: "routine",
      });
      this.db.markRoutineRun(id, "ok", next);
      if (!manual && routine.notify) notify(routine.name, text || "Finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.markRoutineRun(id, `error: ${message}`, next);
      if (!manual && routine.notify) notify(routine.name, message);
    }
  }
}
