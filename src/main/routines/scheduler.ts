import { schedule, validate, type ScheduledTask } from "node-cron";
import { nextRunIso } from "./cron";
import type { AppDatabase } from "../db";
import { notify } from "./notify";
import type { Runner } from "../chat/runner";
import type { Routine } from "../../shared/types";

const MAX_TIMER_MS = 2_000_000_000;

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledTask>();
  private readonly onceJobs = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly runner: Runner,
  ) {}

  reload(): void {
    this.stop();
    for (const routine of this.db.listEnabledRoutines()) {
      if (routine.once) {
        this.scheduleOnce(routine);
        continue;
      }
      if (!validate(routine.cron)) continue;
      const task = schedule(routine.cron, () => {
        void this.fire(routine.id);
      });
      this.jobs.set(routine.id, task);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) void job.destroy();
    this.jobs.clear();
    for (const timer of this.onceJobs.values()) clearTimeout(timer);
    this.onceJobs.clear();
  }

  async runNow(id: string): Promise<void> {
    const routine = this.db.getRoutine(id);
    if (!routine) throw new Error("Routine not found");
    if (this.runner.isRunning(routine.agentId)) throw new Error("This agent is already working");
    await this.fire(id, true);
  }

  private scheduleOnce(routine: Routine): void {
    const runAt = routine.runAt ? Date.parse(routine.runAt) : Number.NaN;
    if (!Number.isFinite(runAt)) {
      this.missOnce(routine, "missed: invalid run time");
      return;
    }
    const delay = runAt - Date.now();
    if (delay <= 0) {
      this.missOnce(routine);
      return;
    }
    const wait = Math.min(delay, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.onceJobs.delete(routine.id);
      if (wait < delay) {
        const next = this.db.getRoutine(routine.id);
        if (next?.enabled) this.scheduleOnce(next);
        return;
      }
      void this.fire(routine.id);
    }, wait);
    timer.unref?.();
    this.onceJobs.set(routine.id, timer);
  }

  private missOnce(routine: Routine, status = "missed: app was closed"): void {
    this.db.markRoutineRun(routine.id, status, null);
    this.db.updateRoutine(routine.id, { enabled: false }, null);
    if (routine.notify) notify(routine.name, "Missed the routine's time because Fid Coder was closed.");
  }

  private async fire(id: string, manual = false): Promise<void> {
    const routine = this.db.getRoutine(id);
    if (!routine || (!manual && !routine.enabled)) return;
    const next = !routine.enabled ? null : routine.once ? (manual ? routine.runAt : null) : nextRunIso(routine.cron);
    // Consume a one-time routine before the run so a scheduler reload cannot
    // reschedule or mark it missed while this turn is working.
    if (!manual && routine.once) this.consumeOnce(id);
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
        notify: !manual && routine.notify ? (message) => notify(routine.name, message) : undefined,
      });
      this.db.markRoutineRun(id, "ok", next);
      if (!manual && routine.notify) notify(routine.name, text || "Finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.markRoutineRun(id, `error: ${message}`, next);
      if (!manual && routine.notify) notify(routine.name, message);
    }
  }

  private consumeOnce(id: string): void {
    this.db.updateRoutine(id, { enabled: false }, null);
  }
}
