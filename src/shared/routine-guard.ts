export const ROUTINE_FAILURE_LIMIT = 10;
export const MIN_ROUTINE_INTERVAL_MS = 15 * 60 * 1000;
export const MIN_ROUTINE_INTERVAL_ERROR =
  "A repeating routine must wait at least 15 minutes between runs.";

export type RoutineFailureNotice = "first" | "limit";

export function intervalTooShort(gapsMs: readonly number[]): boolean {
  return gapsMs.some((gap) => gap < MIN_ROUTINE_INTERVAL_MS);
}

/** A real run error. A closed-app interrupt, a stop, and a skip do not count. */
export function isCountedRoutineFailure(status: string): boolean {
  return status.startsWith("error:") && !status.startsWith("error: interrupted");
}

export function nextRoutineFailures(
  status: string,
  current: number,
  manual: boolean,
): { count: number; changed: boolean; disable: boolean; notice: RoutineFailureNotice | null } {
  const safe = Number.isFinite(current) && current > 0 ? Math.min(ROUTINE_FAILURE_LIMIT, Math.floor(current)) : 0;
  if (status === "ok") {
    return { count: 0, changed: safe !== 0, disable: false, notice: null };
  }
  if (manual || !isCountedRoutineFailure(status)) {
    return { count: safe, changed: false, disable: false, notice: null };
  }
  const count = Math.min(ROUTINE_FAILURE_LIMIT, safe + 1);
  let notice: RoutineFailureNotice | null = null;
  if (count === 1) notice = "first";
  else if (count >= ROUTINE_FAILURE_LIMIT) notice = "limit";
  return { count, changed: count !== safe, disable: count >= ROUTINE_FAILURE_LIMIT, notice };
}

export function routineFailureNotice(kind: RoutineFailureNotice, detail: string): string {
  if (kind === "limit") return "Paused after 10 failures in a row. Enable it to try again.";
  const why = detail.replace(/\s+/g, " ").trim().slice(0, 160);
  return why
    ? `Failed. ${why} It stays scheduled until 10 failures in a row.`
    : "Failed. It stays scheduled until 10 failures in a row.";
}
