export const RUN_EXCERPT_CHARS = 500;
export const RUN_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 4 * 60 * 60 * 1000;
export const RUN_LIST_LIMIT = 50;

export function runExcerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= RUN_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, RUN_EXCERPT_CHARS - 1)}…`;
}

export function isRoutineDue(nextRunAt: string | null, now: number): boolean {
  if (!nextRunAt) return false;
  const time = Date.parse(nextRunAt);
  return Number.isFinite(time) && time <= now;
}

export function pruneBeforeIso(now: number): string {
  return new Date(now - RUN_KEEP_MS).toISOString();
}

export function snoozeUntilIso(now: number): string {
  return new Date(now + SNOOZE_MS).toISOString();
}

export function routineStatusLabel(status: string | null): string {
  if (!status) return "Unknown";
  if (status === "ok") return "Completed";
  if (status === "running") return "Running";
  if (status === "stopped" || status.startsWith("stopped")) return "Stopped";
  if (status.includes("interrupted")) return "Interrupted";
  if (status.startsWith("missed")) return "Missed";
  if (status.startsWith("skipped")) return "Skipped";
  if (status.startsWith("error")) return "Failed";
  return status;
}

export function routineStatusTone(status: string | null): string {
  if (status === "ok") return "is-success";
  if (status?.includes("interrupted") || status?.startsWith("error") || status?.startsWith("missed")) return "is-error";
  return "";
}

export function runDurationLabel(startedAt: string, endedAt: string | null, now = Date.now()): string {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain === 0 ? `${hours}h` : `${hours}h ${remain}m`;
}
