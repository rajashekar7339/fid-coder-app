export type RoutineFrequency = "daily" | "weekdays" | "weekly" | "custom";

export type RoutineSchedule = {
  frequency: RoutineFrequency;
  time: string;
  weekday: string;
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

export function emptySchedule(): RoutineSchedule {
  return { frequency: "weekdays", time: "09:00", weekday: "1", custom: "" };
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
  if (dayOfWeek === "*") return { frequency: "daily", time, weekday: "1", custom: "" };
  if (dayOfWeek === "1-5") return { frequency: "weekdays", time, weekday: "1", custom: "" };
  if (dayOfWeek && /^[0-7]$/.test(dayOfWeek)) {
    return { frequency: "weekly", time, weekday: dayOfWeek === "7" ? "0" : dayOfWeek, custom: "" };
  }
  return { frequency: "custom", time, weekday: "1", custom: cron };
}

export function cronFromSchedule(schedule: RoutineSchedule): string {
  if (schedule.frequency === "custom") return schedule.custom.trim();
  const [hour = "9", minute = "0"] = schedule.time.split(":");
  const day = schedule.frequency === "daily" ? "*" : schedule.frequency === "weekdays" ? "1-5" : schedule.weekday;
  return `${Number(minute)} ${Number(hour)} * * ${day}`;
}

export function scheduleLabel(cron: string): string {
  const schedule = scheduleFromCron(cron);
  if (schedule.frequency === "custom") return `Custom · ${cron}`;
  const time = timeLabel(schedule.time);
  if (schedule.frequency === "daily") return `Every day at ${time}`;
  if (schedule.frequency === "weekdays") return `Weekdays at ${time}`;
  const day = WEEKDAYS.find((item) => item.value === schedule.weekday)?.label ?? "Monday";
  return `${day}s at ${time}`;
}

function timeLabel(value: string): string {
  const [hour = "9", minute = "0"] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
