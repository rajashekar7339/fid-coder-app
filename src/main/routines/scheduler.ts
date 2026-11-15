import { schedule, validate, type ScheduledTask } from "node-cron";
import { SETTING_ROUTINES_PAUSED } from "../../shared/app-settings";
import { pruneBeforeIso, routineStatusLabel, runExcerpt } from "../../shared/routine-runs";
import type { Routine } from "../../shared/types";
import type { AppDatabase } from "../db";
import { nextRunIso } from "./cron";
import { notify } from "./notify";

const MAX_TIMER_MS = 2_000_000_000;

type TurnRunner = {
  isRunning(agentId: string): boolean;
  runTurn(input: {
    agentId: string;
    text: string;
    source: "chat" | "routine";
    notify?: (text: string) => void;
  }): Promise<string>;
  abort?(agentId: string): Promise<void>;
};

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledTask>();
  private readonly onceJobs = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly activeAgents = new Set<string>();
  private readonly stopping = new Set<string>();
  private onInbox: (() => void) | null = null;
  private onOpenAgent: ((agentId: string) => void) | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly runner: TurnRunner,
  ) {}

  setHooks(hooks: { onInbox?: () => void; onOpenAgent?: (agentId: string) => void }): void {
    this.onInbox = hooks.onInbox ?? null;
    this.onOpenAgent = hooks.onOpenAgent ?? null;
  }

  isPaused(): boolean {
    return this.db.getSetting(SETTING_ROUTINES_PAUSED) === "1";
  }

  setPaused(paused: boolean): void {
    this.db.setSetting(SETTING_ROUTINES_PAUSED, paused ? "1" : "0");
    this.reload();
  }

  reload(): void {
    this.stop();
    this.db.pruneRoutineHistory(pruneBeforeIso(Date.now()));
    const interrupted = this.db.reconcileRoutineRuns(new Set(this.inflight.values()));
    const paused = this.isPaused();
    for (const routine of this.db.listEnabledRoutines()) {
      if (routine.once) {
        this.scheduleOnce(routine, paused);
        continue;
      }
      if (paused || !validate(routine.cron)) continue;
      const task = schedule(routine.cron, () => {
        void this.launch(routine.id);
      });
      this.jobs.set(routine.id, task);
    }
    if (interrupted > 0) this.onInbox?.();
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
    if (this.inflight.has(id) || this.runner.isRunning(routine.agentId) || this.activeAgents.has(routine.agentId)) {
      throw new Error("This agent is already working");
    }
    await this.launch(id, true);
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.db.getRoutineRun(runId);
    if (!run || run.status !== "running") throw new Error("That run is not in progress");
    if (this.inflight.has(run.routineId)) {
      if (!this.runner.abort) throw new Error("This run cannot be stopped");
      this.stopping.add(run.routineId);
      try {
        await this.runner.abort(run.agentId);
        await this.pending.get(run.routineId);
      } catch (error) {
        this.stopping.delete(run.routineId);
        throw error;
      }
      return;
    }
    const finished = this.db.finishRoutineRun(run.id, { status: "stopped" });
    const routine = this.db.getRoutine(run.routineId);
    if (routine) {
      this.db.markRoutineRun(routine.id, "stopped", routine.nextRunAt);
      if (run.trigger !== "manual") this.noteFinished(routine, finished);
    }
    this.stopping.delete(run.routineId);
    this.onInbox?.();
  }

  private scheduleOnce(routine: Routine, paused: boolean): void {
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
    if (paused) return;
    const wait = Math.min(delay, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.onceJobs.delete(routine.id);
      if (wait < delay) {
        const next = this.db.getRoutine(routine.id);
        if (next?.enabled) this.scheduleOnce(next, this.isPaused());
        return;
      }
      void this.launch(routine.id);
    }, wait);
    timer.unref?.();
    this.onceJobs.set(routine.id, timer);
  }

  private missOnce(routine: Routine, status = "missed: app was closed"): void {
    const run = this.db.startRoutineRun({
      routineId: routine.id,
      agentId: routine.agentId,
      trigger: "schedule",
    });
    const finished = this.db.finishRoutineRun(run.id, { status, error: status });
    this.db.markRoutineRun(routine.id, status, null);
    this.db.updateRoutine(routine.id, { enabled: false }, null);
    this.noteFinished(routine, finished);
    if (routine.notify) {
      notify(routine.name, "Missed the routine's time because Fid Coder was closed.", () =>
        this.onOpenAgent?.(routine.agentId),
      );
    }
    this.onInbox?.();
  }

  private launch(id: string, manual = false): Promise<void> {
    const current = this.pending.get(id);
    if (current) return current;
    const job = this.fire(id, manual).finally(() => {
      if (this.pending.get(id) === job) this.pending.delete(id);
    });
    this.pending.set(id, job);
    return job;
  }

  private async fire(id: string, manual = false): Promise<void> {
    if (this.inflight.has(id)) return;
    const routine = this.db.getRoutine(id);
    if (!routine || (!manual && !routine.enabled)) return;
    if (!manual && this.isPaused()) return;
    const next = !routine.enabled ? null : routine.once ? (manual ? routine.runAt : null) : nextRunIso(routine.cron);
    if (!manual && routine.once) this.consumeOnce(id);
    const run = this.db.startRoutineRun({
      routineId: routine.id,
      agentId: routine.agentId,
      trigger: manual ? "manual" : "schedule",
    });
    this.inflight.set(id, run.id);
    const busy = this.activeAgents.has(routine.agentId) || this.runner.isRunning(routine.agentId);
    if (!busy) this.activeAgents.add(routine.agentId);
    try {
      if (busy) {
        const finished = this.db.finishRoutineRun(run.id, { status: "skipped: agent busy" });
        this.db.markRoutineRun(id, "skipped: agent busy", next);
        if (!manual) this.noteFinished(routine, finished);
        if (!manual && routine.notify) {
          notify(routine.name, "Skipped because the agent is already working.", () => this.onOpenAgent?.(routine.agentId));
        }
        return;
      }
      this.db.markRoutineRun(id, "running", next);
      const text = await this.runner.runTurn({
        agentId: routine.agentId,
        text: routine.prompt,
        source: "routine",
        notify: !manual && routine.notify ? (message) => notify(routine.name, message, () => this.onOpenAgent?.(routine.agentId)) : undefined,
      });
      const turn = this.db.latestTurn(routine.agentId);
      const turnId = turn && turn.startedAt >= run.startedAt ? turn.id : null;
      const stopped = this.stopping.has(id);
      const status = stopped ? "stopped" : "ok";
      const finished = this.db.finishRoutineRun(run.id, { status, turnId, output: runExcerpt(text) });
      this.db.markRoutineRun(id, status, next);
      if (!manual && routine.notify) {
        notify(routine.name, text || routineStatusLabel(status), () => this.onOpenAgent?.(routine.agentId));
      }
      if (!manual) this.noteFinished(routine, finished);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stopped = this.stopping.has(id);
      const status = stopped ? "stopped" : `error: ${message}`;
      const finished = this.db.finishRoutineRun(run.id, {
        status,
        error: message,
        output: runExcerpt(message),
      });
      this.db.markRoutineRun(id, status, next);
      if (!manual && routine.notify) notify(routine.name, message, () => this.onOpenAgent?.(routine.agentId));
      if (!manual) this.noteFinished(routine, finished);
    } finally {
      this.inflight.delete(id);
      if (!busy) this.activeAgents.delete(routine.agentId);
      this.stopping.delete(id);
      this.onInbox?.();
    }
  }

  private noteFinished(routine: Routine, run: { id: string; status: string; output: string | null }): void {
    const label = routineStatusLabel(run.status);
    const body = run.output && run.output !== label ? `${label}. ${run.output}` : label;
    this.db.addInboxItem({
      agentId: routine.agentId,
      kind: "routine",
      refId: run.id,
      title: routine.name,
      body,
    });
  }

  private consumeOnce(id: string): void {
    this.db.updateRoutine(id, { enabled: false }, null);
  }
}
