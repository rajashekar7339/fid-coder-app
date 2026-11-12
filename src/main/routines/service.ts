import type {
  Routine,
  RoutineInput,
  RoutinePatch,
} from "../../shared/types";
import {
  MAX_ROUTINE_NAME,
  MAX_ROUTINE_PROMPT,
  MAX_ROUTINES_PER_AGENT,
  type RoutineDraft,
} from "../../shared/routine-schedule";
import type { AppDatabase } from "../db";
import { assertCron, nextRunIso } from "./cron";
import type { Scheduler } from "./scheduler";

export class RoutineService {
  constructor(
    private readonly db: AppDatabase,
    private readonly scheduler: Scheduler,
  ) {}

  list(agentId: string): Routine[] {
    return this.db.listRoutines(agentId);
  }

  create(agentId: string, draft: RoutineDraft): Routine {
    if (!this.db.getAgent(agentId)) throw new Error("Agent not found");
    const input = cleanRoutine({ agentId, ...draft });
    const existing = this.db.listRoutines(agentId);
    assertNotDuplicate(existing, input, null);
    if (existing.length >= MAX_ROUTINES_PER_AGENT) {
      throw new Error(`This agent already has ${MAX_ROUTINES_PER_AGENT} routines. Delete one first.`);
    }
    const routine = this.db.createRoutine(input, nextRunAt(input));
    this.scheduler.reload();
    return routine;
  }

  update(id: string, patch: RoutinePatch): Routine {
    const current = this.db.getRoutine(id);
    if (!current) throw new Error("Routine not found");
    const merged = cleanRoutine({
      agentId: current.agentId,
      name: patch.name ?? current.name,
      prompt: patch.prompt ?? current.prompt,
      cron: patch.cron ?? current.cron,
      once: patch.once ?? current.once,
      runAt: patch.runAt !== undefined ? patch.runAt : current.runAt,
      enabled: patch.enabled ?? current.enabled,
      notify: patch.notify ?? current.notify,
    });
    assertNotDuplicate(this.db.listRoutines(current.agentId), merged, id);
    const routine = this.db.updateRoutine(id, merged, nextRunAt(merged));
    this.scheduler.reload();
    return routine;
  }

  remove(id: string): Routine {
    const current = this.db.getRoutine(id);
    if (!current) throw new Error("Routine not found");
    this.db.deleteRoutine(id);
    this.scheduler.reload();
    return current;
  }

  removeForAgent(agentId: string, id: string): Routine {
    const current = this.db.getRoutine(id);
    if (!current || current.agentId !== agentId) throw new Error("Routine not found for this agent");
    return this.remove(id);
  }
}

export function cleanRoutine(input: RoutineInput, now = new Date()): RoutineInput {
  const agentId = input.agentId?.trim();
  const name = input.name?.trim().slice(0, MAX_ROUTINE_NAME);
  const prompt = input.prompt?.trim();
  if (!agentId) throw new Error("Agent is required");
  if (!name) throw new Error("Routine name is required");
  if (!prompt) throw new Error("Routine prompt is required");
  if (prompt.length > MAX_ROUTINE_PROMPT) {
    throw new Error(`The instruction is longer than ${MAX_ROUTINE_PROMPT} characters`);
  }
  const once = input.once === true;
  const runAt = once ? cleanRunAt(input.runAt) : null;
  if (once && !runAt) throw new Error("A one-time routine needs a run time");
  if (once && input.enabled !== false && Date.parse(runAt ?? "") <= now.getTime()) {
    throw new Error("That time has already passed. Choose a future time.");
  }
  let cron = input.cron?.trim() ?? "";
  if (!cron && once && runAt) {
    const date = new Date(runAt);
    cron = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
  }
  return {
    agentId,
    name,
    prompt,
    cron: assertCron(cron),
    once,
    runAt,
    enabled: input.enabled !== false,
    notify: input.notify !== false,
  };
}

function cleanRunAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nextRunAt(input: RoutineInput): string | null {
  if (!input.enabled) return null;
  return input.once ? input.runAt : nextRunIso(input.cron);
}

function assertNotDuplicate(routines: Routine[], input: RoutineInput, currentId: string | null): void {
  const prompt = input.prompt.trim();
  const key = input.once ? input.runAt : input.cron.trim();
  const match = routines.find(
    (routine) =>
      routine.id !== currentId &&
      routine.prompt.trim() === prompt &&
      routine.once === input.once &&
      (routine.once ? routine.runAt : routine.cron.trim()) === key,
  );
  if (match) {
    throw new Error(`A matching routine already exists ("${match.name}", id ${match.id}).`);
  }
}
