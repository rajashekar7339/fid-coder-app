import type { Routine } from "./types";

export type RoutineFrequency = "once" | "daily" | "weekdays" | "weekly" | "custom";

export type RoutineSchedule = {
  frequency: RoutineFrequency;
  time: string;
  weekday: string;
  date: string;
  custom: string;
};

export const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

export const MAX_ROUTINES_PER_AGENT = 20;
export const MAX_ROUTINE_PROMPT = 4_000;
export const MAX_ROUTINE_NAME = 80;

export const ROUTINE_WRITE_TOOL_NAMES = new Set(["routine_create", "routine_delete"]);

const FREQUENCIES = new Set<RoutineFrequency>(["once", "daily", "weekdays", "weekly", "custom"]);

export const ROUTINE_COMMAND_HINT =
  "The user sent /routine. Call routine_create exactly once to create the routine for the request in the latest message. Do not perform the task now. Translate the requested local time into the tool's frequency, time, date, or weekday fields. If the message does not include a task, ask for one; if it does not include a time, ask when to run it; do not call the tool until both are present. After the tool succeeds, state the timing and next run in one short reply.";

export type RoutineDraft = {
  name: string;
  prompt: string;
  cron: string;
  once: boolean;
  runAt: string | null;
  enabled: boolean;
  notify: boolean;
};

export type RoutineToolRequest = {
  instruction: string;
  name?: string | null;
  frequency?: string | null;
  time?: string | null;
  date?: string | null;
  weekday?: string | null;
  cron?: string | null;
  notify?: boolean;
};

export function emptySchedule(): RoutineSchedule {
  return { frequency: "weekdays", time: "09:00", weekday: "1", date: "", custom: "" };
}

export function scheduleFromCron(cron: string): RoutineSchedule {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return { ...emptySchedule(), frequency: "custom", custom: cron };

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const numericTime =
    /^\d{1,2}$/.test(minute ?? "") && /^\d{1,2}$/.test(hour ?? "") && Number(minute) < 60 && Number(hour) < 24;
  if (!numericTime || dayOfMonth !== "*" || month !== "*") {
    return { ...emptySchedule(), frequency: "custom", custom: cron };
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (dayOfWeek === "*") return { frequency: "daily", time, weekday: "1", date: "", custom: "" };
  if (dayOfWeek === "1-5") return { frequency: "weekdays", time, weekday: "1", date: "", custom: "" };
  if (dayOfWeek && /^[0-7]$/.test(dayOfWeek)) {
    return { frequency: "weekly", time, weekday: dayOfWeek === "7" ? "0" : dayOfWeek, date: "", custom: "" };
  }
  return { frequency: "custom", time, weekday: "1", date: "", custom: cron };
}

export function scheduleFromRoutine(routine: Pick<Routine, "once" | "runAt" | "cron">): RoutineSchedule {
  if (!routine.once || !routine.runAt) return scheduleFromCron(routine.cron);
  const runAt = new Date(routine.runAt);
  if (Number.isNaN(runAt.getTime())) return scheduleFromCron(routine.cron);
  return {
    frequency: "once",
    time: localTimeText(runAt),
    weekday: "1",
    date: localDateText(runAt),
    custom: "",
  };
}

export function cronFromSchedule(schedule: RoutineSchedule): string {
  if (schedule.frequency === "custom") return schedule.custom.trim();
  if (schedule.frequency === "once") {
    const runAt = runAtFromSchedule(schedule);
    if (!runAt) return "";
    const date = new Date(runAt);
    return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
  }
  const [hour = "9", minute = "0"] = schedule.time.split(":");
  const day = schedule.frequency === "daily" ? "*" : schedule.frequency === "weekdays" ? "1-5" : schedule.weekday;
  return `${Number(minute)} ${Number(hour)} * * ${day}`;
}

export function runAtFromSchedule(schedule: RoutineSchedule): string | null {
  if (schedule.frequency !== "once") return null;
  return localDateTimeIso(schedule.date, schedule.time);
}

export function nextLocalDateForTime(now: Date, time: string): string | null {
  const clock = parseClock(time);
  if (!clock) return null;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.hour, clock.minute, 0, 0);
  if (candidate.getTime() <= now.getTime() + 30_000) candidate.setDate(candidate.getDate() + 1);
  return localDateText(candidate);
}

export function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function localDateTimeIso(dateText: string, timeText: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  const clock = parseClock(timeText);
  if (!dateMatch || !clock) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const date = new Date(year, month - 1, day, clock.hour, clock.minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== clock.hour ||
    date.getMinutes() !== clock.minute
  ) {
    return null;
  }
  return date.toISOString();
}

export function localDateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localTimeText(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function scheduleLabel(cron: string): string {
  const schedule = scheduleFromCron(cron);
  if (schedule.frequency === "custom") return `Custom · ${cron}`;
  return repeatLabel(schedule);
}

export function routineScheduleLabel(
  routine: Pick<Routine, "once" | "runAt" | "cron">,
  now = new Date(),
): string {
  if (routine.once && routine.runAt) {
    const runAt = new Date(routine.runAt);
    if (!Number.isNaN(runAt.getTime())) return `Once · ${describeRunAt(routine.runAt, now)}`;
  }
  return scheduleLabel(routine.cron);
}

export function describeRunAt(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${dayLabel(date, now)}, ${clockLabel(date)}`;
}

function repeatLabel(schedule: RoutineSchedule): string {
  const time = timeLabel(schedule.time);
  if (schedule.frequency === "daily") return `Every day at ${time}`;
  if (schedule.frequency === "weekdays") return `Weekdays at ${time}`;
  const day = WEEKDAYS.find((item) => item.value === schedule.weekday)?.label ?? "Monday";
  return `${day}s at ${time}`;
}

function dayLabel(date: Date, now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function timeLabel(value: string): string {
  const [hour = "9", minute = "0"] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return clockLabel(date);
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function buildRoutineDraft(request: RoutineToolRequest, now = new Date()): RoutineDraft {
  const instruction = request.instruction.trim();
  if (!instruction) throw new Error("Missing instruction");
  if (instruction.length > MAX_ROUTINE_PROMPT) {
    throw new Error(`The instruction is longer than ${MAX_ROUTINE_PROMPT} characters`);
  }
  const name = clip(request.name?.trim() || deriveName(instruction), MAX_ROUTINE_NAME);
  const notify = request.notify !== false;
  const frequency = (request.frequency?.trim() || "once") as RoutineFrequency;
  if (!FREQUENCIES.has(frequency)) {
    throw new Error("frequency must be once, daily, weekdays, weekly, or custom");
  }

  if (frequency === "custom") {
    const cron = request.cron?.trim() ?? "";
    if (!cron) throw new Error("Custom timing needs a five-field cron expression");
    return { name, prompt: instruction, cron, once: false, runAt: null, enabled: true, notify };
  }

  const time = request.time?.trim() ?? "";
  if (!parseClock(time)) throw new Error("time must be a local 24-hour time such as 16:00");

  if (frequency === "once") {
    const dateText = request.date?.trim() || nextLocalDateForTime(now, time);
    if (!dateText) throw new Error("date must be a local date such as 2026-11-12");
    const runAt = localDateTimeIso(dateText, time);
    if (!runAt) throw new Error("date must be a real local date such as 2026-11-12");
    if (Date.parse(runAt) <= now.getTime() + 30_000) {
      throw new Error("That time has already passed. Choose a future time.");
    }
    const cron = cronFromSchedule({ frequency, time, weekday: "1", date: dateText, custom: "" });
    return { name, prompt: instruction, cron, once: true, runAt, enabled: true, notify };
  }

  const weekday = request.weekday?.trim() || "1";
  if (frequency === "weekly" && !/^[0-6]$/.test(weekday)) {
    throw new Error("weekday must be 0 (Sunday) through 6 (Saturday)");
  }
  const cron = cronFromSchedule({ frequency, time, weekday, date: "", custom: "" });
  return { name, prompt: instruction, cron, once: false, runAt: null, enabled: true, notify };
}

export function routineCreatedText(routine: Routine, now = new Date()): string {
  const next = !routine.once && routine.nextRunAt ? ` Next run: ${describeRunAt(routine.nextRunAt, now)}.` : "";
  return [
    `Created routine "${routine.name}" (id ${routine.id}).`,
    `Runs: ${routineScheduleLabel(routine, now)}.${next}`,
    `Instruction: ${clip(routine.prompt, 500)}`,
    "Manage, pause, or delete it in the Agent Desk, Routines section.",
  ].join("\n");
}

export function routineListText(routines: Routine[], now = new Date()): string {
  if (routines.length === 0) return "No routines for this agent.";
  return [
    `Routines (${routines.length}):`,
    ...routines.map((routine) => {
      const state = !routine.enabled
        ? "paused"
        : routine.once
          ? "active"
          : routine.nextRunAt
            ? `next ${describeRunAt(routine.nextRunAt, now)}`
            : "active";
      return `- ${routine.name} · ${routineScheduleLabel(routine, now)} · ${state} · id ${routine.id}\n  Instruction: ${clip(routine.prompt, 300)}`;
    }),
  ].join("\n");
}

function deriveName(instruction: string): string {
  const firstLine = instruction.split(/\r?\n/).find((line) => line.trim()) ?? instruction;
  const cleaned = firstLine
    .replace(/^[#>*_\-\s]+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Routine";
}

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
